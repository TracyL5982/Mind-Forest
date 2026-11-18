import { z } from 'zod';
import { Command, Id, Sound } from '../core/domain.ts';

export const PROTOCOL_VERSION = 1;

/**
 * Most characters a user's words to Momo may be: what the headset sends from speech (a recording of a minute at most, about a
 * thousand characters) and from typing in a card, with room to spare.
 */
export const WORDS_CHARS = 4000;
const Words = z.string().max(WORDS_CHARS);

const Scene = z.object({ focus: Id.optional(), selection: z.array(Id).default([]), treeId: Id.optional() });
const Scope = z.object({ treeIds: z.array(Id).default([]), nodeIds: z.array(Id).default([]) });
const RawDump = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1), name: z.string().optional() }),
  z.object({ kind: z.literal('link'), url: z.string().url().refine((url) => /^https?:$/i.test(new URL(url).protocol), 'a link is an http or https address') }),
  z.object({ kind: z.literal('asset'), asset: z.string(), mime: z.string(), name: z.string().optional(), sound: Sound.optional() }),
]);

/** Most characters of one picture a headset shows Momo, as a data URL: a JPEG of 512 px at most is well under it. */
export const SEEN_CHARS = 300_000;
const Seen = z.string().max(SEEN_CHARS).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, 'a JPEG as a data URL');
/**
 * What the user marked on a card's picture, for Momo to see (WS89): the part (`box`: x, y, width and height, 0 to 1 of the
 * picture, y down) as `crop`, and the whole picture as `whole`, each with the user's line drawn on it in red. A card of the
 * service's is named by `nodeId`; one of the headset's own (the welcome walk's) by its title alone. With no pictures, the
 * card's marks are gone.
 */
export const Look = z.object({
  t: z.literal('look'),
  nodeId: Id.optional(),
  title: z.string().max(200),
  box: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  crop: Seen.optional(),
  whole: Seen.optional(),
});
export type Look = z.infer<typeof Look>;

/** Every message a client may send. See docs/protocol.md. */
export const ClientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('dump'), dumps: z.array(RawDump).min(1).max(50) }),
  z.object({ t: z.literal('utter'), text: Words, final: z.boolean(), scene: Scene }),
  z.object({ t: z.literal('focus'), nodeId: Id }),
  z.object({ t: z.literal('questions'), nodeId: Id }),
  z.object({ t: z.literal('ask'), nodeId: Id, need: Words.min(1) }),
  z.object({ t: z.literal('more'), nodeId: Id, need: Words.optional() }),
  z.object({ t: z.literal('keep'), nodeIds: z.array(Id).min(1) }),
  z.object({ t: z.literal('undo'), id: Id.optional() }),
  z.object({ t: z.literal('commands'), label: z.string(), commands: z.array(Command).min(1) }),
  z.object({ t: z.literal('organize'), request: Words.min(1), scope: Scope, focus: Id.optional() }),
  z.object({ t: z.literal('handoff'), scope: Scope, note: z.string().optional() }),
  z.object({ t: z.literal('client'), media: z.object({ embeds: z.boolean(), files: z.array(z.string().regex(/^[a-z0-9]{2,5}$/)).max(20) }) }),
  /** The headset was put on again, still joined: how long it was off, in seconds. */
  z.object({ t: z.literal('worn'), away: z.number().nonnegative().finite() }),
  Look,
  /** Shares a tree with a friend. In the demo (the film) the friend is the user; between two people it is to come. */
  z.object({ t: z.literal('share'), tree: Id }),
  z.object({ t: z.literal('pair') }),
  z.object({ t: z.literal('settings'), patch: z.object({
    picksMode: z.enum(['provisional', 'immediate']).optional(),
    picksPerRun: z.number().int().min(1).max(8).optional(),
    scoutOnDump: z.boolean().optional(),
    agentName: z.string().trim().min(1).max(32).regex(/^\p{L}[\p{L}\p{N}' -]*$/u, 'a name is letters, with spaces, hyphens or apostrophes').optional(),
  }) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Every frame a device may send on `/live`. Audio is base64 of 16-bit mono PCM at 16 kHz. */
export const DeviceFrame = z.discriminatedUnion('t', [
  // The sound that woke the device, base64 of 16-bit mono PCM at 16 kHz and four seconds at most, for the service to check.
  z.object({ t: z.literal('name'), pcm: z.string().min(1).max(180_000) }),
  z.object({ t: z.literal('start'), turn: z.number().int().min(1), scene: Scene }),
  z.object({ t: z.literal('audio'), pcm: z.string().max(1 << 20) }),
  z.object({ t: z.literal('end') }),
  z.object({ t: z.literal('cancel') }),
  /**
   * A lesson of the welcome walk that Momo answers: what the user said there, written down by the device, what the lesson's picture
   * shows, and the lesson's own cards, which come up as she answers. `turn` is a new turn, as `start` takes.
   */
  z.object({
    t: z.literal('lesson'),
    turn: z.number().int().min(1),
    words: z.string().trim().min(1).max(500),
    picture: z.string().trim().min(1).max(600),
    cards: z.array(z.object({ title: z.string().trim().min(1).max(120), says: z.string().trim().max(240).default('') })).max(8),
  }),
]);
export type DeviceFrame = z.infer<typeof DeviceFrame>;
