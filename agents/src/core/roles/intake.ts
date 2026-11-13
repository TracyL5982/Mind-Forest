import type { Item, ItemData } from '../domain.ts';
import type { JsonRequest } from '../ports.ts';
import { mostRecent, parseChatJson, parseTranscript, type Conversation } from './intake/chat.ts';
import {
  CHAT_SYSTEM,
  ChatReply,
  labels,
  LINK_SYSTEM,
  LinkReply,
  MEDIA_SYSTEM,
  MediaReply,
  structure,
  TEXT_SYSTEM,
  TextReply,
} from './intake/describe.ts';
import { asUrl, clip, decodeText, firstLine, middleOut, nameStem, plainly, squash, TITLE_MAX, toBase64, type Described } from './intake/plain.ts';
import { AGENT, makeItem, type RawDump, type RoleContext, type Roles } from './types.ts';

const ROLE = 'intake';
const USER = { by: 'user' as const };

const CONCURRENCY = 4;
const MAX_CONVERSATIONS = 20;
const MAX_TAKEAWAYS = 5;
const MAX_PARTS = 6;
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
/** Texts up to this length share a model call. Longer ones get their own and may be split. */
const SHORT_TEXT = 1500;
const BATCH_SIZE = 8;
const PROMPT_TEXT = 12_000;
/** A dropped file's text is kept up to this much. The asset holds the rest. */
const STORED_FILE_TEXT = 20_000;

interface Arrival {
  from: 'paste' | 'drop';
  asset?: string;
  name?: string;
}

/** A dump once Intake knows what it is. Each job becomes one or more items. */
type Job =
  | { type: 'text'; text: string; arrival: Arrival }
  | { type: 'link'; url: string }
  | { type: 'media'; kind: 'image' | 'video'; asset: string; name: string; dataUrl: string | null }
  | { type: 'file'; asset: string; mime: string; name: string }
  | { type: 'chat'; conversation: Conversation; arrival: Arrival };

type TextJob = Extract<Job, { type: 'text' }>;

interface Run {
  ctx: RoleContext;
  calls: number;
  failures: number;
}

export const intake: Roles['intake'] = async (ctx, dumps) => {
  const run: Run = { ctx, calls: 0, failures: 0 };
  const jobs = (await Promise.all(dumps.map((dump) => recognise(ctx, dump)))).flat();

  const slots: Item[][] = jobs.map(() => []);
  const tasks: (() => Promise<void>)[] = [];
  const texts: { slot: number; job: TextJob }[] = [];
  jobs.forEach((job, slot) => {
    if (job.type === 'text') texts.push({ slot, job });
    else if (job.type === 'file') slots[slot] = [fileItem(ctx, job)];
    else if (job.type === 'link') tasks.push(async () => void (slots[slot] = [await linkItem(run, job.url)]));
    else if (job.type === 'media') tasks.push(async () => void (slots[slot] = [await mediaItem(run, job)]));
    else tasks.push(async () => void (slots[slot] = await chatItems(run, job.conversation, job.arrival)));
  });
  for (const batch of batches(texts)) {
    tasks.push(async () => {
      const made = await textItems(run, batch.map((b) => b.job));
      batch.forEach((b, i) => (slots[b.slot] = made[i] ?? []));
    });
  }

  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]!();
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));

  if (run.failures > 0) {
    ctx.note(ROLE, `The model failed on ${run.failures} of ${run.calls} descriptions. Those items have plain titles and tags.`);
  }
  return slots.flat();
};

async function recognise(ctx: RoleContext, dump: RawDump): Promise<Job[]> {
  if (dump.kind === 'link') return [{ type: 'link', url: dump.url }];
  if (dump.kind === 'text') return recogniseText(ctx, dump.text, { from: 'paste', name: dump.name });

  const name = dump.name ?? dump.asset;
  const file = await ctx.assets.get(dump.asset).catch(() => null);
  if (!file) {
    ctx.note(ROLE, `Could not open "${name}", so it is filed by name only.`);
    return [{ type: 'file', asset: dump.asset, mime: dump.mime, name }];
  }
  const kind = dump.mime.startsWith('image/') ? 'image' : dump.mime.startsWith('video/') ? 'video' : null;
  if (kind) {
    const tooLarge = kind === 'video' && file.bytes.length >= MAX_VIDEO_BYTES;
    if (tooLarge) ctx.note(ROLE, `"${name}" is over 15 MB, too large to watch, so it is filed by name only.`);
    const dataUrl = tooLarge ? null : `data:${dump.mime};base64,${toBase64(file.bytes)}`;
    return [{ type: 'media', kind, asset: dump.asset, name, dataUrl }];
  }
  const text = decodeText(file.bytes, dump.mime, name);
  if (text === null || !text.trim()) return [{ type: 'file', asset: dump.asset, mime: dump.mime, name }];
  return recogniseText(ctx, text, { from: 'drop', asset: dump.asset, name });
}

function recogniseText(ctx: RoleContext, text: string, arrival: Arrival): Job[] {
  if (!text.trim()) return [];
  const url = asUrl(text);
  if (url) return [{ type: 'link', url }];

  const conversations = chatsIn(text);
  if (!conversations) return [{ type: 'text', text, arrival }];
  if (conversations.length > MAX_CONVERSATIONS) {
    ctx.note(ROLE, `The export holds ${conversations.length} conversations. Took the ${MAX_CONVERSATIONS} most recent.`);
  }
  return mostRecent(conversations, MAX_CONVERSATIONS).map((conversation) => ({ type: 'chat', conversation, arrival }));
}

function chatsIn(text: string): Conversation[] | null {
  if (/^\s*[[{]/.test(text)) {
    try {
      return parseChatJson(JSON.parse(text));
    } catch {
      return null;
    }
  }
  const transcript = parseTranscript(text);
  return transcript ? [transcript] : null;
}

function batches(texts: { slot: number; job: TextJob }[]): { slot: number; job: TextJob }[][] {
  const short = texts.filter((t) => t.job.text.length <= SHORT_TEXT);
  const out = texts.filter((t) => t.job.text.length > SHORT_TEXT).map((t) => [t]);
  for (let i = 0; i < short.length; i += BATCH_SIZE) out.push(short.slice(i, i + BATCH_SIZE));
  return out;
}

/** One model reply, or null when the model fails. The caller falls back to a plain description. */
async function ask<T>(run: Run, req: Omit<JsonRequest<T>, 'effort'>): Promise<T | null> {
  run.calls++;
  try {
    return await run.ctx.model.json({ ...req, effort: 'low' });
  } catch {
    run.failures++;
    return null;
  }
}

function sourceOf(arrival: Arrival): { from: string; asset?: string } {
  return { from: arrival.from, ...(arrival.asset ? { asset: arrival.asset } : {}) };
}

async function textItems(run: Run, jobs: TextJob[]): Promise<Item[][]> {
  const reply = await ask(run, {
    role: 'intake.text',
    system: TEXT_SYSTEM,
    user: jobs
      .map((job, i) => `Dump ${i}${job.arrival.name ? ` (file name: ${job.arrival.name})` : ''}:\n"""\n${middleOut(job.text, PROMPT_TEXT)}\n"""`)
      .join('\n\n'),
    schema: TextReply,
  });
  return jobs.map((job, i) => {
    const plain = plainly(job.text, 'note', job.arrival.name);
    const stored = job.arrival.asset ? clip(job.text, STORED_FILE_TEXT) : job.text;
    const entries = (reply?.entries ?? []).filter((e) => e.dump === i).slice(0, job.text.length > SHORT_TEXT ? MAX_PARTS : 1);
    const item = (described: Described, text: string, data: ItemData) =>
      makeItem(run.ctx, { kind: 'text', ...described, text, data, origin: USER, source: sourceOf(job.arrival) });
    if (entries.length === 0) return [item(plain, stored, {})];
    if (entries.length === 1) return [item(labels(entries[0]!, plain), stored, structure(entries[0]!, job.text))];
    return entries.map((entry) => {
      const text = entry.text.trim() || entry.summary.trim();
      return item(labels(entry, plainly(text, 'note')), text, structure(entry, job.text));
    });
  });
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url);
  const tail = decodeURIComponent(parsed.pathname).split('/').filter(Boolean).at(-1) ?? '';
  const host = parsed.hostname.replace(/^www\./, '');
  return clip(tail ? `${nameStem(tail)} (${host})` : host, TITLE_MAX);
}

async function linkItem(run: Run, url: string): Promise<Item> {
  const { ctx } = run;
  const page = URL.canParse(url) ? await ctx.tools.web.read(url).catch(() => null) : null;
  const host = URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : '';
  const link = { kind: 'link' as const, origin: USER, source: { from: 'link', url } };

  if (!page) {
    ctx.note(ROLE, `Could not read ${url}, so the link is filed by its address alone.`);
    const title = host ? titleFromUrl(url) : clip(url, TITLE_MAX);
    const plain = plainly(`${title} ${host}`, 'link');
    return makeItem(ctx, { ...link, ...plain, title, summary: host ? `A link to ${host}. The page could not be read.` : 'A link that could not be read.' });
  }

  const plain = plainly(`${page.title}\n${page.text}`, 'link');
  if (page.title.trim()) plain.title = clip(squash(page.title), TITLE_MAX);
  const reply = page.text.trim()
    ? await ask(run, {
        role: 'intake.link',
        system: LINK_SYSTEM,
        user: `Address: ${url}\nSite: ${page.site}\nPage title: ${page.title}\n\nPage text:\n"""\n${middleOut(page.text, 6000)}\n"""`,
        schema: LinkReply,
      })
    : null;
  const site = page.site || host;
  return makeItem(ctx, {
    ...link,
    ...(reply ? labels(reply, plain) : plain),
    text: clip(page.text, 8000),
    data: { ...(reply ? structure(reply, `${page.title}\n${page.text}`) : {}), ...(site ? { site } : {}) },
  });
}

async function mediaItem(run: Run, job: Extract<Job, { type: 'media' }>): Promise<Item> {
  const plain: Described = {
    title: clip(nameStem(job.name) || job.kind, TITLE_MAX),
    summary: `${job.kind === 'image' ? 'An image' : 'A video'} dropped in as ${job.name}.`,
    tags: plainly(nameStem(job.name), job.kind).tags,
  };
  const reply = job.dataUrl
    ? await ask(run, {
        role: `intake.${job.kind}`,
        system: MEDIA_SYSTEM,
        user: `File name: ${job.name}`,
        schema: MediaReply,
        ...(job.kind === 'image' ? { images: [job.dataUrl] } : { videos: [job.dataUrl] }),
      })
    : null;
  return makeItem(run.ctx, {
    kind: job.kind,
    ...(reply ? labels(reply, plain) : plain),
    text: reply ? reply.description.trim() : '',
    data: reply ? structure(reply) : {},
    origin: USER,
    source: { from: 'drop', asset: job.asset },
  });
}

function fileItem(ctx: RoleContext, job: Extract<Job, { type: 'file' }>): Item {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(job.name)?.[1]?.toLowerCase();
  return makeItem(ctx, {
    kind: 'file',
    title: clip(job.name, TITLE_MAX),
    summary: `A ${job.mime || 'file'} file dropped in as ${job.name}.`,
    tags: plainly(`${nameStem(job.name)} ${extension ?? ''}`, 'file').tags,
    origin: USER,
    source: { from: 'drop', asset: job.asset },
  });
}

const SPEAKER = { user: 'User', assistant: 'Assistant' };

async function chatItems(run: Run, conversation: Conversation, arrival: Arrival): Promise<Item[]> {
  const { ctx } = run;
  const { messages, from } = conversation;
  const transcript = messages.map((m) => `${SPEAKER[m.role]}: ${m.text}`).join('\n\n');
  const opening = messages.find((m) => m.role === 'user')?.text ?? messages[0]?.text ?? '';
  const plain = plainly(opening, 'chat', conversation.title || undefined);
  plain.tags = plainly(transcript, 'chat').tags;

  const reply = await ask(run, {
    role: 'intake.chat',
    system: CHAT_SYSTEM,
    user: `${conversation.title ? `Title in the export: ${conversation.title}\n\n` : ''}Conversation:\n"""\n${middleOut(
      messages.map((m) => `${SPEAKER[m.role]}: ${clip(m.text, 800)}`).join('\n\n'),
      PROMPT_TEXT,
    )}\n"""`,
    schema: ChatReply,
  });
  const described = reply ? labels(reply, plain) : plain;
  if (conversation.title) described.title = clip(squash(conversation.title), TITLE_MAX);

  const source = { from, ...(arrival.asset ? { asset: arrival.asset } : {}) };
  const chat = makeItem(ctx, { kind: 'chat', ...described, text: clip(transcript, 8000), data: { messages }, origin: USER, source });
  const takeaways = (reply?.takeaways ?? [])
    .map((t) => ({ title: squash(t.title), text: t.text.trim() }))
    .filter((t) => t.text)
    .slice(0, MAX_TAKEAWAYS)
    .map((t) =>
      makeItem(ctx, {
        kind: 'text',
        title: clip(t.title || firstLine(t.text), TITLE_MAX),
        text: t.text,
        summary: clip(squash(t.text), 320),
        tags: described.tags,
        data: { fromChat: chat.id },
        origin: AGENT(ROLE),
        source,
      }),
    );
  return [chat, ...takeaways];
}
