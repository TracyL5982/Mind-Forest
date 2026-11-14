const FENCED = /^```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?```$/;
const MIN_LINES = 3;
const CODE_SHARE = 0.7;

/** A bracket, a brace or an assignment: what a line of code holds and a line of notes seldom does. */
const HOLDS = /[()[\]{}]|(?<![=!<>])=(?![=>])/;
/** The words a statement opens with, in the languages that end one with a semicolon. */
const STATEMENT = /^(?:public|private|protected|static|final|const|let|var|return|import|export|using|package|use|typedef|struct|extern|throw|break|continue)\b/;

/**
 * Whether a line ending in a semicolon is a statement: it holds a mark of code, opens with a statement's word, or is three words at most, as `int n;` is.
 * A sentence of notes that happens to end in a semicolon is none of these.
 */
const statement = (line: string): boolean => line.endsWith(';') && (HOLDS.test(line) || STATEMENT.test(line) || line.split(/\s+/).length <= 3);

/**
 * What a line of code looks like. A bracket at the end of a line counts only as the end of a call, with no space before the bracket that opens it,
 * so "Eggs (a dozen)" and ":)" are not code. A word or a sign that notes also use, `return` or `=>`, counts only beside something notes do not.
 */
const SURE: ((line: string) => boolean)[] = [
  (line) => /[{}]\s*[;,]?$|^[)\]}]+[;,]?$/.test(line),
  (line) => /[\w\]]\(.*\)\s*[;,]?$/.test(line),
  statement,
  (line) => /=>|==|!=|::/.test(line) && (HOLDS.test(line) || line.includes(';')),
  (line) => /^#include\b|^import [\w.]+(?: as \w+)?$|^from [\w.]+ import \S/.test(line),
  (line) => /^(?:(?:async )?(?:if|elif|for|while|def|class|with|except) .+|else|try|finally|except):$/.test(line),
  (line) => /^(?:if|for|while|switch)\s*\(.*\)/.test(line),
  (line) => /^(?:return|yield)(?: \S+| .*(?: [-+*/%] |\*\*|[[{]|\w\().*)$/.test(line),
  (line) => /^(?:SELECT|FROM|WHERE|INSERT|UPDATE|CREATE|(?:(?:LEFT|RIGHT|INNER|OUTER|FULL|CROSS) )?JOIN|GROUP BY|ORDER BY) /.test(line),
];

/**
 * What a line of code and a line of notes may both look like: `rent = 800`, or "update the mailing list", which opens as a query does.
 * Such a line is counted, and a paste of nothing but such lines is notes.
 */
const MAYBE: ((line: string, next: string | undefined) => boolean)[] = [
  (line) => /^[\w.[\]'"]+(?:\s*,\s*[\w.[\]'"]+)*(?:\s*:\s*[\w.[\]|, ]+?)?\s*[-+*/%|&^]?=(?![=>])\s*\S/.test(line),
  (line) => /^(?:select|from|where|insert|update|create|(?:(?:left|right|inner|outer|full|cross) )?join|group by|order by) /i.test(line),
  // A decorator is one only above what it decorates: a line that is "@ana" and nothing more is a name.
  (line, next) => /^@\w[\w.]*(?:\(.*\))?$/.test(line) && next !== undefined && /^(?:@|(?:async )?def |class )/.test(next),
];

/** What a terminal shows before a command. A line that begins `# ` is a heading or a comment far more often than a root prompt, so it is not read as one. */
const PROMPT = /^\$ [A-Za-z.~/]/;

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

/** A paste that is one JSON object or array, written over lines. A value on one line is as likely a note as a file. */
function isJson(pasted: string): boolean {
  if (!/^[{[]/.test(pasted) || pasted.split('\n').length < MIN_LINES) return false;
  try {
    return typeof JSON.parse(pasted) === 'object';
  } catch {
    return false;
  }
}

/** A paste copied from a terminal: it opens with a prompt and a command, and has a second one further down. What lies between is output. */
function isTranscript(pasted: string): boolean {
  const lines = pasted.split('\n').filter((line) => line.trim());
  return lines.length >= MIN_LINES && PROMPT.test(lines[0]!) && lines.filter((line) => PROMPT.test(line)).length >= 2;
}

/**
 * The code a pasted text is, when it is code and not prose: one fenced block, with the language its fence names, a JSON file,
 * a terminal's transcript, or at least three lines outside its comments, of which most look like code and one could not be notes.
 */
export function codeIn(text: string): { language?: string; source: string } | undefined {
  const pasted = text.trim();
  const fenced = FENCED.exec(pasted);
  if (fenced && !fenced[2]!.includes('```')) return { ...(fenced[1] ? { language: fenced[1] } : {}), source: fenced[2]! };
  if (isJson(pasted)) return { language: 'json', source: pasted };
  if (isTranscript(pasted)) return { language: 'sh', source: pasted };
  const lines = uncommented(pasted);
  const sure = lines.filter((line) => SURE.some((looks) => looks(line)));
  const maybe = lines.filter((line, at) => !sure.includes(line) && MAYBE.some((looks) => looks(line, lines[at + 1])));
  return lines.length >= MIN_LINES && sure.length > 0 && sure.length + maybe.length >= CODE_SHARE * lines.length ? { source: pasted } : undefined;
}
