import { z } from 'zod';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';

const env = loadEnv();
const model = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', onCall: (c) => console.log('  call', JSON.stringify(c)) });
const what = process.argv[2] ?? 'json';
if (what === 'json') {
  const out = await model.json({
    role: 'probe',
    system: 'You label ideas.',
    user: 'Idea: the dolly zoom makes the background rush while the subject stays still.',
    schema: z.object({ title: z.string(), tags: z.array(z.string()), mood: z.string().optional() }),
  });
  console.log(out);
} else if (what === 'search') {
  console.log(await model.search({ role: 'probe', query: 'dolly zoom Vertigo how it was shot', max: 5 }));
} else if (what === 'image') {
  const img = await model.image({ role: 'probe', prompt: 'a small paper boat on a calm teal ocean, flat illustration' });
  console.log(img.mime, img.bytes.length, 'bytes');
} else if (what === 'vision') {
  const out = await model.json({
    role: 'probe',
    system: 'You describe pictures.',
    user: 'Describe this picture.',
    images: ['https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Avocado_Hass_-_single_and_halved.jpg/640px-Avocado_Hass_-_single_and_halved.jpg'],
    schema: z.object({ title: z.string(), description: z.string() }),
  });
  console.log(out);
}
