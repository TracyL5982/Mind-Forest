import { z } from 'zod';
import { Command, Id } from '../core/domain.ts';

export const PROTOCOL_VERSION = 1;

const Scene = z.object({ focus: Id.optional(), selection: z.array(Id).default([]), treeId: Id.optional() });
const Scope = z.object({ treeIds: z.array(Id).default([]), nodeIds: z.array(Id).default([]) });
const RawDump = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1), name: z.string().optional() }),
  z.object({ kind: z.literal('link'), url: z.string().url() }),
  z.object({ kind: z.literal('asset'), asset: z.string(), mime: z.string(), name: z.string().optional() }),
]);

/** Every message a client may send. See docs/protocol.md. */
export const ClientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('dump'), dumps: z.array(RawDump).min(1).max(50) }),
  z.object({ t: z.literal('utter'), text: z.string(), final: z.boolean(), scene: Scene }),
  z.object({ t: z.literal('focus'), nodeId: Id }),
  z.object({ t: z.literal('questions'), nodeId: Id }),
  z.object({ t: z.literal('ask'), nodeId: Id, need: z.string().min(1) }),
  z.object({ t: z.literal('more'), nodeId: Id, need: z.string().optional() }),
  z.object({ t: z.literal('keep'), nodeIds: z.array(Id).min(1) }),
  z.object({ t: z.literal('undo'), id: Id.optional() }),
  z.object({ t: z.literal('commands'), label: z.string(), commands: z.array(Command).min(1) }),
  z.object({ t: z.literal('organize'), request: z.string().min(1), scope: Scope, focus: Id.optional() }),
  z.object({ t: z.literal('handoff'), scope: Scope, note: z.string().optional() }),
  z.object({ t: z.literal('client'), media: z.object({ embeds: z.boolean(), files: z.array(z.string().regex(/^[a-z0-9]{2,5}$/)).max(20) }) }),
  z.object({ t: z.literal('settings'), patch: z.object({
    picksMode: z.enum(['provisional', 'immediate']).optional(),
    picksPerRun: z.number().int().min(1).max(8).optional(),
    scoutOnDump: z.boolean().optional(),
  }) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
