import { makeTools } from '../src/node/tools.ts';

const tools = makeTools({ model: {} as never, assets: {} as never });
for (const query of process.argv.slice(2)) {
  const started = Date.now();
  const works = await tools.art.search(query, 12);
  console.log(`\n"${query}": ${works.length} works in ${Date.now() - started} ms`);
  for (const w of works) console.log(`- ${w.title} | ${w.maker} | ${w.date} | ${w.museum}`);
}
