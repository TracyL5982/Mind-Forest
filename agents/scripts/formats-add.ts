/**
 * Adds samples to the format sample set in test/fixtures/formats.json, or rebuilds the ones it added before.
 * Each item is built the way Intake builds a text the user typed or pasted: a scripted model reply goes through the real
 * `structure()` and `labels()`, with `plainly()` standing in for what the reply leaves empty. A sample with a key the set
 * already holds takes that sample's place, so a second run changes nothing.
 *
 *   node --no-warnings --import tsx scripts/formats-add.ts
 *
 * To add a sample, append a `text(...)` entry below and run the script. Write the expected card before any model sees the item.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { labels, structure, type Description } from '../src/core/roles/intake/describe.ts';
import { plainly } from '../src/core/roles/intake/plain.ts';
import { Item } from '../src/core/domain.ts';
import type { ComponentId } from '../src/core/views.ts';
import type { Sample } from '../test/formats.ts';

const FIXTURE = new URL('../test/fixtures/formats.json', import.meta.url);
const CAPTURED = '2026-11-14T00:00:00.000Z';

const EMPTY: Description = {
  title: '', summary: '', tags: [], steps: [], facts: [], quoteText: '', quoteBy: '', chartLabels: [], chartValues: [], chartUnit: '', personName: '', personRole: '',
  when: '', where: '', people: [], pros: [], cons: [], tableHeads: [], tableRows: [], question: '', answer: '', term: '', definition: '', items: [], checklist: [],
  colours: [], excerptText: '', excerptAt: '',
};

const added: Sample[] = [];

/** A text the user typed or pasted, with what Intake's model said of it. An empty reply is a model that found nothing to extract. */
function text(key: string, activity: Sample['activity'], language: Sample['language'], what: string, expect: ComponentId, body: string, reply: Partial<Description> = {}, accept: ComponentId[] = []): void {
  const said = { ...EMPTY, ...reply };
  const item = Item.parse({
    id: `formats-${key}`, archived: false, revision: 0, kind: 'text', ...labels(said, plainly(body, 'note')), text: body, data: structure(said, body),
    origin: { by: 'user' }, source: { from: 'paste', capturedAt: CAPTURED },
  });
  added.push({ key, origin: 'authors', activity, language, what, expect, accept, item });
}

// ---- short Chinese texts of 16 to 60 characters, which the idea rule drew as ideas when it stopped at 60 characters in every script.
// Written on 14 November 2026, before the model saw any of them. Intake's model extracted nothing from any, so the rules cannot tell them apart.

text('D01', 'memories', 'zh', '打字记下的提醒：外婆家的井盖', 'callout', '小心：外婆家后院的井盖是松的，带孩子去玩一定要绕开走。');
text('D02', 'research', 'zh', '打字记下的提醒：一份问卷的局限', 'callout', '注意：这份问卷的样本只来自一线城市，结论不能直接推到全国。');
text('D03', 'brainstorming', 'zh', '打字记下的提醒：发版的时间', 'callout', '千万别在周五下午发版，出了问题没人能及时回滚。');
text('D04', 'research', 'zh', '粘贴的文字：一句话解释一个术语', 'definition', '幸存者偏差：只看到经过筛选留下来的人或事，而忽略了被淘汰的那些。');
text('D05', 'brainstorming', 'zh', '打字记下的：一个术语是什么意思', 'definition', '最小可行产品，就是只做核心功能、能拿去给真实用户试的第一个版本。');
text('D06', 'research', 'zh', '粘贴的文字：一个问题和它的答案', 'qa', '为什么飞机舷窗是圆的？因为方形的角会让应力集中，容易产生裂纹。');
text('D07', 'memories', 'zh', '打字记下的：问爸爸的一个问题和他的回答', 'qa', '爸爸为什么总在车里坐一会儿才上楼？他说那几分钟是只属于他自己的。', {}, ['note']);
text('D08', 'brainstorming', 'zh', '打字记下的一个想法，二十来个字', 'idea', '要不要办一个只开在周日早上的社区旧书交换摊');
text('D09', 'brainstorming', 'zh', '打字记下的一个想法，三十多个字', 'idea', '如果把说明书做成一张可以折进包装盒的漫画海报，会不会更多人愿意看完', {}, ['note']);
text('D10', 'memories', 'zh', '打字记下的一个想法：以后想和妈妈做的事', 'idea', '等妈妈退休了，带她把年轻时下乡的那几个村子重新走一遍，拍成一本相册', {}, ['note']);

// ---- explainers, which an explorable shows best: a value that follows from another by a formula, or one thing in two to four states.
// Written on 14 November 2026 with the explorable card, after the measured runs in docs/formats.md. Intake's model extracted nothing from any.

text('E01', 'research', 'en', 'pasted notes: how the field of view follows the focal length', 'explorable', 'On a full-frame camera the sensor is 36 mm wide, so the field of view narrows as the focal length grows. At 24 mm the field of view is 73.7°, at 50 mm it is 39.6°, and at 200 mm it is 10.3°.', {}, ['chart']);
text('E02', 'research', 'zh', '粘贴的笔记：光圈大小怎样改变景深', 'explorable', '光圈开大还是收小，决定了照片里有多少是清楚的。\n大光圈：背景虚化得很厉害，只有对焦的那一层是清楚的。\n小光圈：从前景到远山都清楚，但快门要放慢。', {}, ['note']);
text('E03', 'brainstorming', 'en', 'typed notes: three ways to shoot one shot', 'explorable', 'Three ways to shoot a dolly zoom.\nZoom only: the lens zooms in while the camera stays put, so the background grows with the subject.\nDolly only: the camera moves in on a fixed lens, so the subject grows and the background barely changes.\nBoth: the camera pulls back as the lens zooms in, so the subject holds its size and the background swells behind it.', {}, ['note']);
text('E04', 'brainstorming', 'zh', '打字记下的：复利怎么算', 'explorable', '复利就是利息也生利息。一万元本金，年利率百分之五，每年复利一次，存十年变成16289元，存二十年变成26533元，所以越早开始存越划算。', {}, ['note']);
text('E05', 'memories', 'en', 'typed memory: how fast the dough rose', 'explorable', 'Grandma said the dough tells you the weather. In the cold kitchen at 20 °C it rose in about 4 hours, but on a summer day at 30 °C it was ready in 2 hours, so in August she baked twice a day.', {}, ['note']);
text('E06', 'memories', 'zh', '打字记下的回忆：学骑车', 'explorable', '学骑车那年夏天，爸爸一直扶着后座。\n扶着的时候：车子很稳，可我总想回头看他还在不在。\n松开以后：我反而骑得更直，因为只能看着前面的路。', {}, ['note']);

for (const { key, item } of added) {
  const size = [...item.text.normalize('NFKC')].length;
  if (key.startsWith('D') && (size < 16 || size > 60)) throw new Error(`${key} has ${size} characters, outside 16 to 60`);
}

const set = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { items: Sample[] };
const keys = new Set(added.map((sample) => sample.key));
const items = [...set.items.filter((sample) => !keys.has(sample.key)), ...added];
writeFileSync(FIXTURE, `${JSON.stringify({ items }, null, 1)}\n`);
console.log(`${added.length} samples built, ${items.length} in the set: ${added.map(({ key, item }) => `${key} ${[...item.text.normalize('NFKC')].length}`).join(', ')}`);
