/**
 * The closed language a slider's formula is written in, and the program a card carries it as.
 *
 * A formula is numbers, the names of quantities, the operators `+ - * / ^`, round brackets, and the functions `min`, `max`, `round`,
 * `sqrt`, `exp`, `ln` and `atan`. Nothing else is read, and nothing a model writes is ever run as code: `parse` turns the words into
 * a postfix program of tokens, and `evaluate` steps through the program with a stack.
 */

/**
 * A formula in postfix order. A number pushes itself and a name pushes its quantity's value. An operator or a function takes its
 * arguments off the stack and pushes its result, and one value is left at the end.
 */
export type Program = (number | string)[];

/** Each function, with how many arguments it takes off the stack. A `min` or `max` of more than two is written as several. */
export const FUNCTIONS = { min: 2, max: 2, round: 1, sqrt: 1, exp: 1, ln: 1, atan: 1 } as const;
/** `neg` is a minus sign written before a value. */
export const OPERATORS = { '+': 2, '-': 2, '*': 2, '/': 2, '^': 2, neg: 1 } as const;
type Step = keyof typeof FUNCTIONS | keyof typeof OPERATORS;

/** The longest formula read, in characters. A card's formula is a line, and the bound keeps the parser's depth small. */
export const LONGEST = 300;

const isStep = (token: string): token is Step => Object.hasOwn(FUNCTIONS, token) || Object.hasOwn(OPERATORS, token);
/** A name a quantity may not take, because a program could not tell it from a step. */
export const reserved = (name: string): boolean => isStep(name);

const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const SIGNS = new Set(['+', '-', '*', '/', '^', '(', ')', ',']);

type Lexeme = { kind: 'number'; value: number } | { kind: 'name'; name: string } | { kind: 'sign'; sign: string };

class Unread extends Error {}

function lexemes(source: string): Lexeme[] {
  const out: Lexeme[] = [];
  let at = 0;
  const take = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = at;
    const found = pattern.exec(source)?.[0];
    if (found !== undefined) at += found.length;
    return found;
  };
  while (at < source.length) {
    const char = source[at]!;
    let text: string | undefined;
    if (/\s/.test(char)) at++;
    else if ((text = take(NUMBER)) !== undefined) out.push({ kind: 'number', value: Number(text) });
    else if ((text = take(NAME)) !== undefined) out.push({ kind: 'name', name: text });
    else if (SIGNS.has(char)) {
      out.push({ kind: 'sign', sign: char });
      at++;
    } else throw new Unread(`"${char}" is not part of the language`);
  }
  return out;
}

/** What `parse` makes of a formula: its program and the names it reads, or why it cannot be read. */
export type Parsed = { program: Program; names: string[] } | { error: string };

/**
 * Reads a formula whose quantities are `known`.
 *
 *   sum     = product { ("+" | "-") product }
 *   product = signed { ("*" | "/") signed }
 *   signed  = ("-" | "+") signed | power
 *   power   = atom [ "^" signed ]
 *   atom    = number | name | function "(" sum { "," sum } ")" | "(" sum ")"
 *
 * So `^` binds tightest and to the right, a sign before a value binds looser than `^`, and `-2^2` is -4.
 */
export function parse(source: string, known: readonly string[]): Parsed {
  if (source.length > LONGEST) return { error: `it is longer than ${LONGEST} characters` };
  try {
    const read = lexemes(source);
    if (read.length === 0) return { error: 'it is empty' };
    const program: Program = [];
    const names = new Set<string>();
    let at = 0;
    const peek = () => read[at];
    const isSign = (sign: string) => {
      const next = peek();
      return next?.kind === 'sign' && next.sign === sign;
    };
    const expect = (sign: string, after: string) => {
      if (!isSign(sign)) throw new Unread(`"${sign}" is missing after ${after}`);
      at++;
    };
    const sum = (): void => {
      product();
      while (isSign('+') || isSign('-')) {
        const sign = (read[at++] as { sign: string }).sign;
        product();
        program.push(sign);
      }
    };
    const product = (): void => {
      signed();
      while (isSign('*') || isSign('/')) {
        const sign = (read[at++] as { sign: string }).sign;
        signed();
        program.push(sign);
      }
    };
    const signed = (): void => {
      if (isSign('-') || isSign('+')) {
        const minus = (read[at++] as { sign: string }).sign === '-';
        signed();
        if (minus) program.push('neg');
        return;
      }
      atom();
      if (isSign('^')) {
        at++;
        signed();
        program.push('^');
      }
    };
    const atom = (): void => {
      const next = read[at++];
      if (next === undefined) throw new Unread('it ends where a value should be');
      if (next.kind === 'number') {
        if (!Number.isFinite(next.value)) throw new Unread(`${next.value} is too large`);
        program.push(next.value);
        return;
      }
      if (next.kind === 'sign') {
        if (next.sign !== '(') throw new Unread(`"${next.sign}" stands where a value should be`);
        sum();
        expect(')', 'a bracket\'s contents');
        return;
      }
      const { name } = next;
      if (isSign('(')) {
        if (!Object.hasOwn(FUNCTIONS, name)) throw new Unread(`it calls the unknown function "${name}"`);
        at++;
        let count = 1;
        sum();
        for (; isSign(','); count++) {
          at++;
          sum();
        }
        expect(')', `the arguments of ${name}`);
        const fn = name as keyof typeof FUNCTIONS;
        const exactly = FUNCTIONS[fn] === 1;
        if (exactly ? count !== 1 : count < 2) throw new Unread(`${name} takes ${exactly ? 'one argument' : 'two or more arguments'}, and is given ${count}`);
        for (let n = 0; n < Math.max(1, count - 1); n++) program.push(fn);
        return;
      }
      if (Object.hasOwn(FUNCTIONS, name)) throw new Unread(`${name} needs its arguments in brackets`);
      if (!known.includes(name)) throw new Unread(`it reads the unknown name "${name}"`);
      names.add(name);
      program.push(name);
    };
    sum();
    const left = peek();
    if (left !== undefined) throw new Unread(`${left.kind === 'sign' ? `"${left.sign}"` : left.kind === 'name' ? `"${left.name}"` : left.value} follows a whole formula`);
    return { program, names: [...names] };
  } catch (err) {
    if (err instanceof Unread) return { error: err.message };
    throw err;
  }
}

const APPLY: Record<Step, (...args: number[]) => number> = {
  '+': (a, b) => a! + b!,
  '-': (a, b) => a! - b!,
  '*': (a, b) => a! * b!,
  '/': (a, b) => (b === 0 ? Number.NaN : a! / b!),
  '^': (a, b) => a! ** b!,
  neg: (a) => -a!,
  min: (a, b) => Math.min(a!, b!),
  max: (a, b) => Math.max(a!, b!),
  round: (a) => Math.floor(a! + 0.5),
  sqrt: (a) => Math.sqrt(a!),
  exp: (a) => Math.exp(a!),
  ln: (a) => (a! > 0 ? Math.log(a!) : Number.NaN),
  atan: (a) => Math.atan(a!),
};

/** How many arguments each step takes. */
const ARITY: Record<Step, number> = { ...OPERATORS, ...FUNCTIONS };

/**
 * The program's value when its quantities have these values, or `undefined` when it has none there: a division by zero, the root
 * of a negative number, the log of a number that is not above zero, or any step whose result is not a finite number. `atan` is in
 * radians and `round` is `floor(x + 0.5)`.
 */
export function evaluate(program: Program, values: Readonly<Record<string, number>>): number | undefined {
  const stack: number[] = [];
  for (const token of program) {
    let value: number;
    if (typeof token === 'number') value = token;
    else if (isStep(token)) value = APPLY[token](...stack.splice(stack.length - ARITY[token]));
    else value = Object.hasOwn(values, token) ? values[token]! : Number.NaN;
    if (!Number.isFinite(value)) return undefined;
    stack.push(value);
  }
  return stack.length === 1 ? stack[0] : undefined;
}

/** Whether a program stands as one: every token a finite number, one of `names` or a step, no step short of its arguments, one value at the end. */
export function wellFormed(program: readonly unknown[], names: readonly string[]): boolean {
  let depth = 0;
  for (const token of program) {
    if (typeof token === 'number') {
      if (!Number.isFinite(token)) return false;
      depth++;
    } else if (typeof token === 'string' && isStep(token)) {
      if (depth < ARITY[token]) return false;
      depth -= ARITY[token] - 1;
    } else if (typeof token === 'string' && names.includes(token)) depth++;
    else return false;
  }
  return depth === 1;
}
