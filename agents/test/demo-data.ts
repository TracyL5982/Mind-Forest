import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './temp.ts';

/**
 * Data folders for boots of the demo in a test file. A boot stores the demo's pictures in its data folder, about 30 MB, so the
 * folders of one file share one store: each new folder's `assets` is a link to it, and comes with the record of what is stored
 * there, so only the file's first boot copies the pictures. Everything made is removed when the file's tests end (`temp.ts`).
 */
export function demoData() {
  const temp = tempDir;
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
  };
}
