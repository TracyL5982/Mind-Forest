import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Data folders for boots of the demo in a test file. A boot stores the demo's pictures in its data folder, about 30 MB, so the
 * folders of one file share one store: each new folder's `assets` is a link to it, and comes with the record of what is stored
 * there, so only the file's first boot copies the pictures. `clean` removes everything made, for the file's `after`.
 */
export function demoData() {
  const made: string[] = [];
  const temp = (prefix: string): string => {
    made.push(mkdtempSync(join(tmpdir(), prefix)));
    return made.at(-1)!;
  };
  const store = join(temp('mp-demo-store-'), 'assets');
  mkdirSync(store);
  const folders: string[] = [];
  return {
    temp,
    /** A data folder for one boot of the demo. */
    fresh(): string {
      const dir = temp('mp-demo-');
      symlinkSync(store, join(dir, 'assets'));
      const record = folders.map((folder) => join(folder, 'demo-media.json')).find((file) => existsSync(file));
      if (record) copyFileSync(record, join(dir, 'demo-media.json'));
      folders.push(dir);
      return dir;
    },
    clean: () => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })),
  };
}
