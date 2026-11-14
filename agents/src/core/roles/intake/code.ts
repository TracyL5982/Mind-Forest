const FENCED = /^```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?```$/;
const ENDS_AS_CODE = /[;{})]$/;
const BEGINS_AS_CODE = /^(?:import |from |def |function |const |let |var |class |return |#include|public |private |if \(|for \(|while \()/;
const HOLDS_CODE = /=>|==|!=|::/;
const MIN_LINES = 3;
const CODE_SHARE = 0.7;

const LINE_COMMENT = /^(?:\/\/|--|#(?!include\b))/;
/** How a comment that runs over lines opens, and how it closes: a docstring, or a block comment. */
const BLOCKS: [open: string, close: string][] = [['"""', '"""'], ["'''", "'''"], ['/*', '*/']];

/**
 * The lines of a paste that are neither empty nor comment: a line comment, or a line inside a docstring or a block comment.
 * A comment holds prose or a table, which says nothing about whether the lines around it are code.
 * A comment that opens and never closes is no comment, so its lines are kept.
 */
function uncommented(pasted: string): string[] {
  const kept: string[] = [];
  let inside: { close: string; lines: string[] } | undefined;
  for (const line of pasted.split('\n').map((one) => one.trim())) {
    if (inside) {
      inside.lines.push(line);
      if (line.includes(inside.close)) inside = undefined;
      continue;
    }
    if (!line || LINE_COMMENT.test(line)) continue;
    const block = BLOCKS.map(([open, close]) => ({ close, at: line.indexOf(open), after: open.length })).filter(({ at }) => at >= 0).sort((a, b) => a.at - b.at)[0];
    if (block && !line.includes(block.close, block.at + block.after)) inside = { close: block.close, lines: [] };
    if (block?.at !== 0) kept.push(line);
    else inside?.lines.push(line);
  }
  return inside ? [...kept, ...inside.lines.filter((line) => line && !LINE_COMMENT.test(line))] : kept;
}

/**
 * The code a pasted text is, when it is code and not prose: one fenced block, with the language its fence names,
 * or at least three lines outside its comments, of which most look like code.
 */
export function codeIn(text: string): { language?: string; source: string } | undefined {
  const pasted = text.trim();
  const fenced = FENCED.exec(pasted);
  if (fenced && !fenced[2]!.includes('```')) return { ...(fenced[1] ? { language: fenced[1] } : {}), source: fenced[2]! };
  const lines = uncommented(pasted);
  const coded = lines.filter((line) => ENDS_AS_CODE.test(line) || BEGINS_AS_CODE.test(line) || HOLDS_CODE.test(line));
  return lines.length >= MIN_LINES && coded.length >= CODE_SHARE * lines.length ? { source: pasted } : undefined;
}
