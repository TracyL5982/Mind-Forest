/**
 * Searches sources live and prints what each returns. The web source needs the model, so it is skipped here.
 * Usage: tsx scripts/source-probe.ts <source> "<query>" [<source> "<query>" ...]
 */
import { loadEnv } from '../src/node/env.ts';
import { makeTools } from '../src/node/tools.ts';

const tools = makeTools({ model: {} as never, assets: {} as never, keys: loadEnv() });
const args = process.argv.slice(2);
for (let i = 0; i + 1 < args.length; i += 2) {
  if (args[i] === 'videos') {
    const videos = await tools.web.videos(args[i + 1]!).catch((err) => `FAILED ${String(err)}`);
    console.log(`\nvideos "${args[i + 1]}":`, typeof videos === 'string' ? videos : videos.map((v) => `${v.title} | ${v.embed}`));
    continue;
  }
  const started = Date.now();
  const found = await tools.sources.search(args[i]!, args[i + 1]!).catch((err) => `FAILED ${String(err)}`);
  console.log(`\n${args[i]} "${args[i + 1]}": ${typeof found === 'string' ? found : `${found.length} records`} in ${Date.now() - started} ms`);
  if (typeof found === 'string') continue;
  for (const f of found.slice(0, 3)) {
    console.log(`- ${f.title} | ${f.by} | ${f.date}${f.from ? ` | ${f.from}` : ''}${f.image ? ' | picture' : ''}${f.media ? ' | media' : ''}${f.chart ? ` | chart ${JSON.stringify(f.chart)}` : ''}${f.steps ? ` | ${f.steps.length} steps` : ''}`);
    console.log(`    ${f.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}
