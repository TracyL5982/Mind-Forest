import { z } from 'zod';
import type { ItemData } from '../../domain.ts';
import { clip, squash, tidyTags, TITLE_MAX, type Described } from './plain.ts';

// Flat, every key required, empty meaning absent: the model API rejects recursive schemas and optional keys.
const description = {
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  steps: z.array(z.string()),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  quoteText: z.string(),
  quoteBy: z.string(),
  chartLabels: z.array(z.string()),
  chartValues: z.array(z.number()),
  chartUnit: z.string(),
  personName: z.string(),
  personRole: z.string(),
  when: z.string(),
};

export const LinkReply = z.object(description);
export const MediaReply = z.object({ ...description, description: z.string() });
export const TextReply = z.object({
  entries: z.array(z.object({ dump: z.number(), text: z.string(), ...description })),
});
export const ChatReply = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  takeaways: z.array(z.object({ title: z.string(), text: z.string() })),
});

export type Description = z.infer<typeof LinkReply>;

const FIELDS = `For each thing you describe, return:
- title: under 70 characters, specific to this content, no trailing period.
- summary: one or two sentences saying what it is and why it might matter.
- tags: 2 to 6 short lowercase topic words.
Write in the language of the content.

The remaining fields hold structure a card can draw. Fill one only when the content itself states it, and leave it empty (an empty string or an empty list) otherwise. Never invent structure.
- steps: the ordered steps, when the content is a procedure or a sequence.
- facts: label and value pairs, when the content lists figures or attributes.
- quoteText and quoteBy: a quotation the content contains, word for word, and who said it.
- chartLabels, chartValues, chartUnit: a numeric series the content states, one value per label.
- personName and personRole: when the content is about one named person.
- when: a date or time the content is about, as written.`;

export const TEXT_SYSTEM = `You are the intake clerk of a brainstorming app. You label what the user drops in so it can be filed and found later.

You are given one or more dumps of text the user wrote or pasted, each with a number.

Return one entry per dump, with "dump" set to its number and "text" left empty. The one exception: a long dump that holds clearly separate ideas may be returned as 2 to 6 entries with the same "dump" number, one per idea. Then each entry's "text" holds that idea written out so it stands on its own, keeping the user's wording where you can. Do not split a dump that is one line of thought.

${FIELDS}`;

export const LINK_SYSTEM = `You are the intake clerk of a brainstorming app. You label what the user drops in so it can be filed and found later.

You are given the readable text of a web page the user saved. Describe the page.

${FIELDS}`;

export const MEDIA_SYSTEM = `You are the intake clerk of a brainstorming app. You label what the user drops in so it can be filed and found later.

You are given one image or one video the user dropped in, and its file name. Describe what it shows.

Also return "description": a few sentences on what is visible, including any text you can read in it, so the item can be found by searching.

${FIELDS}`;

export const CHAT_SYSTEM = `You are the intake clerk of a brainstorming app. The user has brought in a conversation they had with an AI assistant, and you record what came out of it.

You are given the conversation. Long messages are shortened and the middle of a long conversation may be left out.

Return:
- title: under 70 characters, naming what the conversation was about. No trailing period.
- summary: one or two sentences on what was worked out or decided.
- tags: 2 to 6 short lowercase topic words.
- takeaways: up to 5 ideas, conclusions or decisions from the conversation that are worth keeping on their own. Each has a title under 70 characters and a text of one to three sentences that makes sense without the conversation. Return fewer, or none, when the conversation holds fewer.
Write in the language of the conversation.`;

const loose = (text: string): string => squash(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ''));

/**
 * The parts of the model's description worth keeping as drawable data.
 * With `grounding` (the text the model read), a quote or a chart value that is not in it is dropped.
 */
export function structure(d: Description, grounding?: string): ItemData {
  const data: ItemData = {};
  const steps = d.steps.map(squash).filter(Boolean).slice(0, 12);
  if (steps.length >= 2) data.steps = steps;

  const facts = d.facts.map((f) => ({ label: squash(f.label), value: squash(f.value) })).filter((f) => f.label && f.value);
  if (facts.length > 0) data.facts = facts.slice(0, 12);

  const quote = d.quoteText.trim();
  if (quote && (grounding === undefined || loose(grounding).includes(loose(quote)))) {
    data.quote = { text: quote, ...(d.quoteBy.trim() ? { by: d.quoteBy.trim() } : {}) };
  }

  const digits = grounding?.replace(/,/g, '');
  const stated = d.chartValues.every((v) => Number.isFinite(v) && (digits === undefined || digits.includes(String(v))));
  if (d.chartLabels.length >= 2 && d.chartLabels.length === d.chartValues.length && stated) {
    data.chart = { labels: d.chartLabels.map(squash), values: d.chartValues, ...(d.chartUnit.trim() ? { unit: d.chartUnit.trim() } : {}) };
  }

  if (d.personName.trim()) {
    data.person = { name: d.personName.trim(), ...(d.personRole.trim() ? { role: d.personRole.trim() } : {}) };
  }
  if (d.when.trim()) data.when = d.when.trim();
  return data;
}

/** The model's title, summary and tags, with `plain` standing in for anything it left empty. */
export function labels(d: Described, plain: Described): Described {
  return {
    title: clip(squash(d.title) || plain.title, TITLE_MAX),
    summary: clip(squash(d.summary) || plain.summary, 320),
    tags: tidyTags(d.tags, plain.tags),
  };
}
