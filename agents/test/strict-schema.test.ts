import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { strictSchema } from '../src/node/model-meta.ts';

test('a schema with optional keys is sent closed, with every key required and optional ones nullable', () => {
  const schema = z.object({
    operations: z.array(z.object({ op: z.enum(['move', 'rename']), title: z.string().nullish(), n: z.number().optional() })),
    summary: z.string(),
  });
  const strict = strictSchema(z.toJSONSchema(schema, { io: 'input' })) as any;
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.required, ['operations', 'summary']);
  const op = strict.properties.operations.items;
  assert.equal(op.additionalProperties, false);
  assert.deepEqual(op.required, ['op', 'title', 'n']);
  assert.deepEqual(op.properties.n.type, ['number', 'null']);
  assert.ok(JSON.stringify(op.properties.title).includes('null'));
  assert.equal(op.properties.op.type, 'string', 'a required key is left as it was');
});
