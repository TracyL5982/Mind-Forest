/**
 * Momo's lines in the walkthrough demo as one listing, in the rounds' recording order: what the user says, her lines at fast pace
 * and at real speed, then the lines said outside any round. The user reads and edits this listing, so their copy and the
 * repository can be compared line by line.
 * Usage: node --no-warnings --import tsx scripts/demo-listing.ts                 prints the listing
 *        node --no-warnings --import tsx scripts/demo-listing.ts --check <file>  says where <file> differs from it, and exits 1 if it does
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LinesFile } from '../src/demo/lines.ts';
import { loadScript, type DemoScript } from '../src/demo/script.ts';

/** The listing of `script` and `lines`. */
export function listing(script: DemoScript, lines: LinesFile): string {
  const out = ["# Momo's lines in the walkthrough demo", ''];
  const pace = (label: string, said: { text: string }[] | undefined) => {
    const words = (said ?? []).map((line) => line.text).filter((text) => text.trim());
    if (words.length === 0) return out.push(`**Momo, ${label}:** no recorded lines`, '');
    out.push(`**Momo, ${label}:**`, '', ...words.map((text) => `- ${text}`), '');
  };
  for (const [n, phase] of script.phases.entries()) {
    out.push(`## ${n + 1}. ${phase.title}`, '', `**You:** ${phase.say}`, '');
    pace('fast', lines.rounds[phase.id]);
    pace('real speed', lines.real[phase.id]);
    out.push('');
  }
  out.push('## Lines outside the rounds', '', ...Object.entries(lines.said ?? {}).map(([key, text]) => `- **${key}:** ${text}`));
  return `${out.join('\n')}\n`;
}

/** The lines only one of the two has, in order: `- ` for `ours`, `+ ` for `theirs`, by their longest run of lines in common. */
export function differences(ours: string[], theirs: string[]): string[] {
  const common: number[][] = Array.from({ length: ours.length + 1 }, () => new Array<number>(theirs.length + 1).fill(0));
  for (let i = ours.length - 1; i >= 0; i--) {
    for (let j = theirs.length - 1; j >= 0; j--) common[i]![j] = ours[i] === theirs[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < ours.length || j < theirs.length) {
    if (i < ours.length && j < theirs.length && ours[i] === theirs[j]) {
      i++;
      j++;
    } else if (j >= theirs.length || (i < ours.length && common[i + 1]![j]! >= common[i]![j + 1]!)) {
      out.push(`- ${ours[i++]}`);
    } else {
      out.push(`+ ${theirs[j++]}`);
    }
  }
  return out;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const demo = resolve(import.meta.dirname, '../demo');
  const made = listing(loadScript(join(demo, 'script.json')), LinesFile.parse(JSON.parse(readFileSync(join(demo, 'lines.json'), 'utf8'))));
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    process.stdout.write(made);
  } else {
    const file = args[args.indexOf('--check') + 1] ?? '';
    const changes = differences(made.split('\n'), readFileSync(file, 'utf8').split('\n'));
    for (const change of changes) console.log(change);
    console.log(changes.length ? `${changes.length} lines differ: - as the repository has them, + as ${file} has them` : 'the listing is the repository\'s, line for line');
    process.exit(changes.length ? 1 : 0);
  }
}
