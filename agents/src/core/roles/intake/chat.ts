import { clip } from './plain.ts';

export type ChatFrom = 'chat-export:chatgpt' | 'chat-export:claude' | 'chat-export:generic' | 'chat-export:transcript';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface Conversation {
  from: ChatFrom;
  /** Empty when the export names none. */
  title: string;
  messages: ChatMessage[];
  /** When it was last active, in milliseconds, when the export says. */
  at: number | null;
}

export const MAX_MESSAGES = 200;
export const MAX_MESSAGE_CHARS = 4000;

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function toRole(value: unknown): ChatMessage['role'] | null {
  const role = str(value).toLowerCase();
  if (/^(user|human|you|me)$/.test(role)) return 'user';
  if (/^(assistant|model|ai|bot|chatgpt|claude|muse|gemini|copilot|gpt)$/.test(role)) return 'assistant';
  return null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join('\n');
  if (isRec(content)) return typeof content.text === 'string' ? content.text : textOf(content.parts);
  return '';
}

function timeOf(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return Date.parse(value);
  }
  return null;
}

function conversation(from: ChatFrom, title: unknown, at: number | null, messages: (ChatMessage | null)[]): Conversation {
  const kept = messages
    .filter((m): m is ChatMessage => m !== null && m.text.trim().length > 0)
    .map((m) => ({ role: m.role, text: clip(m.text, MAX_MESSAGE_CHARS) }));
  // The end of a conversation is where things were worked out, so that is the part kept.
  return { from, title: str(title).trim(), at, messages: kept.slice(-MAX_MESSAGES) };
}

function message(role: unknown, content: unknown): ChatMessage | null {
  const parsed = toRole(role);
  return parsed ? { role: parsed, text: textOf(content) } : null;
}

/** The nodes of a ChatGPT conversation in reading order, along the branch the user ended on. */
function chatgptThread(mapping: Rec, current: unknown): Rec[] {
  const node = (id: unknown): Rec | null => (typeof id === 'string' && isRec(mapping[id]) ? (mapping[id] as Rec) : null);
  const seen = new Set<Rec>();
  const thread: Rec[] = [];
  const walk = (from: Rec | null, next: (n: Rec) => Rec | null) => {
    for (let n = from; n && !seen.has(n); n = next(n)) {
      seen.add(n);
      thread.push(n);
    }
  };
  const leaf = node(current);
  if (leaf) {
    walk(leaf, (n) => node(n.parent));
    return thread.reverse();
  }
  const nodes = Object.values(mapping).filter(isRec);
  const root = nodes.find((n) => n.parent == null);
  if (root) {
    walk(root, (n) => (Array.isArray(n.children) ? node(n.children.at(-1)) : null));
    return thread;
  }
  const created = (n: Rec) => (isRec(n.message) ? (timeOf(n.message.create_time) ?? 0) : 0);
  return nodes.sort((a, b) => created(a) - created(b));
}

function fromChatgpt(conv: Rec): Conversation | null {
  if (!isRec(conv.mapping)) return null;
  const messages = chatgptThread(conv.mapping, conv.current_node).map((n) => {
    const m = n.message;
    return isRec(m) && isRec(m.author) ? message(m.author.role, m.content) : null;
  });
  return conversation('chat-export:chatgpt', conv.title, timeOf(conv.update_time, conv.create_time), messages);
}

function fromClaude(conv: Rec): Conversation | null {
  if (!Array.isArray(conv.chat_messages)) return null;
  const messages = conv.chat_messages.map((m) => (isRec(m) ? message(m.sender, str(m.text).trim() ? m.text : m.content) : null));
  return conversation('chat-export:claude', conv.name, timeOf(conv.updated_at, conv.created_at), messages);
}

function fromGeneric(conv: Rec): Conversation | null {
  if (!Array.isArray(conv.messages)) return null;
  const messages = conv.messages.map((m) => (isRec(m) ? message(m.role, m.content) : null));
  return conversation('chat-export:generic', conv.title || conv.name, timeOf(conv.updated_at, conv.created_at), messages);
}

/** The conversations in parsed JSON when it is a chat export, or null when it is something else. */
export function parseChatJson(value: unknown): Conversation[] | null {
  const list = Array.isArray(value) ? value : [value];
  const records = list.filter(isRec);
  if (records.length === 0) return null;

  let found: (Conversation | null)[];
  if (Array.isArray(value) && records.length === list.length && records.every((r) => typeof r.role === 'string' && 'content' in r)) {
    found = [fromGeneric({ messages: records })];
  } else if (records.some((r) => isRec(r.mapping))) {
    found = records.map(fromChatgpt);
  } else if (records.some((r) => Array.isArray(r.chat_messages))) {
    found = records.map(fromClaude);
  } else {
    found = records.map(fromGeneric);
  }
  const conversations = found.filter((c): c is Conversation => c !== null && c.messages.length > 0);
  return conversations.length > 0 ? conversations : null;
}

const USERS = 'user|you|human|me';
const ASSISTANTS = 'assistant|chatgpt|claude|muse|ai|gemini|copilot|bot|gpt';
const SPEAKER = new RegExp(`^[\\s*_#>]*(${USERS}|${ASSISTANTS})[*_]*(?:\\s+said)?\\s*[*_]*[:：][*_]*\\s*(.*)$`, 'i');

/** A pasted transcript with speaker prefixes, or null when the text is not one. */
export function parseTranscript(text: string): Conversation | null {
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim().length > 0);
  if (!first || !SPEAKER.test(first)) return null;

  const messages: ChatMessage[] = [];
  for (const line of lines) {
    const match = SPEAKER.exec(line);
    const role = match ? toRole(match[1]) : null;
    if (match && role) messages.push({ role, text: match[2] ?? '' });
    else if (messages.length > 0) messages[messages.length - 1]!.text += `\n${line}`;
  }
  const parsed = conversation('chat-export:transcript', '', null, messages);
  const roles = new Set(parsed.messages.map((m) => m.role));
  return roles.size === 2 ? parsed : null;
}

/** The most recent `max`, in the export's own order. Exports without dates are taken from the top. */
export function mostRecent(conversations: Conversation[], max: number): Conversation[] {
  if (conversations.length <= max) return conversations;
  if (conversations.some((c) => c.at === null)) return conversations.slice(0, max);
  const keep = new Set([...conversations].sort((a, b) => b.at! - a.at!).slice(0, max));
  return conversations.filter((c) => keep.has(c));
}
