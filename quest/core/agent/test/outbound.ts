// Checks every message the C++ client builds against the service's own schema
// (agents/src/node/protocol.ts), one JSON message per line on stdin. A message passes when the schema
// accepts it and reads back exactly what was sent, so a misspelled optional key, which zod would
// quietly drop, fails. A kind the schema doesn't have yet is reported as pending, not failed.
//   cd agents && <tests> --outbound | node --import tsx ../quest/core/agent/test/outbound.ts
import { readFileSync } from 'node:fs';
import { ClientMessage } from '../../../../agents/src/node/protocol.ts';

const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sorted(v)]))
      : value;

const known = new Set(ClientMessage.options.map((option) => option.shape.t.value as string));
const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
let failed = 0;
let pending = 0;
for (const line of lines) {
  const message = JSON.parse(line);
  if (!known.has(message.t)) {
    pending++;
    console.log(`  pending  ${message.t}: not in this service's schema yet`);
    continue;
  }
  const read = ClientMessage.safeParse(message);
  if (!read.success) {
    failed++;
    console.log(`  REJECTED ${line}\n${read.error.message}`);
  } else if (JSON.stringify(sorted(read.data)) !== JSON.stringify(sorted(message))) {
    failed++;
    console.log(`  CHANGED  ${line}\n        -> ${JSON.stringify(read.data)}`);
  } else {
    console.log(`  accepted ${line}`);
  }
}
console.log(`${lines.length} outbound messages: ${lines.length - failed - pending} accepted, ${pending} pending, ${failed} failed`);
if (lines.length === 0 || failed > 0) process.exit(1);
