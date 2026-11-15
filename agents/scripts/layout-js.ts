/**
 * Builds src/core/layout.ts into client/js/core/layout.js, so the web client places an assembled arrangement with the service's
 * own code. Run it after any change to layout.ts: node --no-warnings --import tsx scripts/layout-js.ts
 * test/layout.test.ts fails while the built file is older than its source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SOURCE = new URL('../src/core/layout.ts', import.meta.url);
export const BUILT = new URL('../client/js/core/layout.js', import.meta.url);

export function built(): string {
  const { outputText } = ts.transpileModule(readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  });
  return `// Built from src/core/layout.ts by scripts/layout-js.ts. Edit that file and run the script.\n${outputText}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(BUILT, built());
