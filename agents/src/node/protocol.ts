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
  z.object({ t: z.literal('start'), turn: z.number().int().min(1), scene: Scene }),
  z.object({ t: z.literal('audio'), pcm: z.string().max(1 << 20) }),
  z.object({ t: z.literal('end') }),
  z.object({ t: z.literal('cancel') }),
]);
export type DeviceFrame = z.infer<typeof DeviceFrame>;
