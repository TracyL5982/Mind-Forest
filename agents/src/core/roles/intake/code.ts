const FENCED = /^```([\w+#.-]*)[^\n]*\n([\s\S]*?)\n?```$/;
const ENDS_AS_CODE = /[;{})]$/;
const BEGINS_AS_CODE = /^(?:import |from |def |function |const |let |var |class |return |#include|public |private |if \(|for \(|while \()/;
const HOLDS_CODE = /=>|==|!=|::/;
const MIN_LINES = 3;
const CODE_SHARE = 0.7;

/**
 * The code a pasted text is, when it is code and not prose: one fenced block, with the language its fence names,
 * or at least three lines of which most look like code.
 */
export function codeIn(text: string): { language?: string; source: string } | undefined {
  const pasted = text.trim();
  const fenced = FENCED.exec(pasted);
  if (fenced && !fenced[2]!.includes('```')) return { ...(fenced[1] ? { language: fenced[1] } : {}), source: fenced[2]! };
  const lines = pasted.split('\n').map((line) => line.trim()).filter(Boolean);
  const coded = lines.filter((line) => ENDS_AS_CODE.test(line) || BEGINS_AS_CODE.test(line) || HOLDS_CODE.test(line));
  return lines.length >= MIN_LINES && coded.length >= CODE_SHARE * lines.length ? { source: pasted } : undefined;
}
