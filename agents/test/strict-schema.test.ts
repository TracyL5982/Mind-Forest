import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { ChatReply, LinkReply, MediaReply, TextReply } from '../src/core/roles/intake/describe.ts';
import { CHOSEN, ComponentsReply, CompositesReply } from '../src/core/roles/renderer.ts';
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

test('every Intake reply is flat: each key required, none nullable, no recursion, and a list holds plain values or flat objects', () => {
  const plain = (node: any) => ['string', 'number', 'boolean'].includes(node.type);
  const flatObject = (node: any) => node.type === 'object' && Object.values(node.properties).every(plain);

  for (const [name, reply] of Object.entries({ LinkReply, MediaReply, TextReply, ChatReply })) {
    const strict = strictSchema(z.toJSONSchema(reply, { io: 'input' })) as any;
    const text = JSON.stringify(strict);
    assert.ok(!text.includes('$ref') && !text.includes('anyOf') && !text.includes('null'), `${name} has a reference or a nullable key`);

    const description = name === 'TextReply' ? strict.properties.entries.items : strict;
    assert.equal(description.additionalProperties, false);
    assert.deepEqual(description.required, Object.keys(description.properties), `${name} leaves a key optional`);
    for (const [key, node] of Object.entries<any>(description.properties)) {
      const ok = plain(node) || (node.type === 'array' && (plain(node.items) || flatObject(node.items)));
      assert.ok(ok, `${name}.${key} nests deeper than a list of flat objects`);
      if (node.type === 'array' && node.items.type === 'object') assert.deepEqual(node.items.required, Object.keys(node.items.properties));
    }
  }
});

test('every Renderer reply is flat: each key required, none nullable, no recursion, and no list of objects holds a list of objects', () => {
  const plain = (node: any) => ['string', 'number', 'boolean'].includes(node.type);
  const plainList = (node: any) => node.type === 'array' && plain(node.items);
  const closed = (node: any, name: string) => {
    assert.equal(node.additionalProperties, false, `${name} is open`);
    assert.deepEqual(node.required, Object.keys(node.properties), `${name} leaves a key optional`);
  };

  for (const [name, reply, list] of [['ComponentsReply', ComponentsReply, 'items'], ['CompositesReply', CompositesReply, 'groups']] as const) {
    const strict = strictSchema(z.toJSONSchema(reply, { io: 'input' })) as any;
    const text = JSON.stringify(strict);
    assert.ok(!text.includes('$ref') && !text.includes('anyOf') && !text.includes('null'), `${name} has a reference or a nullable key`);
    closed(strict, name);

    const entry = strict.properties[list].items;
    closed(entry, `${name}.${list}`);
    for (const [key, node] of Object.entries<any>(entry.properties)) {
      if (plain(node) || plainList(node)) continue;
      assert.ok(node.type === 'array' && node.items.type === 'object', `${name}.${key} is neither a plain value, a list of them, nor a list of objects`);
      closed(node.items, `${name}.${key}`);
      for (const [inner, leaf] of Object.entries<any>(node.items.properties)) assert.ok(plain(leaf) || plainList(leaf), `${name}.${key}.${inner} nests deeper than a list of plain values`);
    }
  }

  const entry = (strictSchema(z.toJSONSchema(ComponentsReply, { io: 'input' })) as any).properties.items.items.properties;
  assert.deepEqual(entry.component.enum, [...CHOSEN]);
  assert.deepEqual(
    Object.keys(entry),
    ['id', 'component', 'subject', 'passage', 'by', 'tone', 'lines', 'labels', 'numbers', 'left', 'right', 'unit', 'emphasis', 'sections', 'controls', 'formula'],
    'a card the model may choose is built from these slots, and adding one adds no key but what no slot can hold: an explorable\'s controls and its formula',
  );
  assert.deepEqual(Object.keys(entry.sections.items.properties), ['kind', 'text', 'by', 'lines']);
  assert.deepEqual(Object.keys(entry.controls.items.properties), ['kind', 'label', 'states', 'texts', 'name', 'unit', 'min', 'max', 'values']);
});
