/**
 * Puts what the web client needs to listen for its name into client/vendor/sherpa-onnx/, which git ignores and the service serves.
 * The keyword model comes from sherpa-onnx's release and is checked against its checksum. sherpa-onnx publishes no browser build of its
 * keyword spotter, so the WebAssembly is built from the v1.13.8 source with Emscripten 4.0.23, both pinned to their commits,
 * and the toolchain and sources are deleted afterwards.
 * Usage: tsx scripts/fetch-wake.ts [--keep <work dir>]
 * Needs git, cmake and make, and about 2 GB free while it builds. It takes several minutes. A finished folder is left alone.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MODEL = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
  sha256: 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a',
  folder: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01',
  files: ['encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx', 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 'tokens.txt'],
};
const SHERPA = { repo: 'https://github.com/k2-fsa/sherpa-onnx.git', tag: 'v1.13.8', commit: '11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf' };
const EMSDK = { repo: 'https://github.com/emscripten-core/emsdk.git', tag: '4.0.23', commit: 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56' };
const BUILT = ['sherpa-onnx-kws.js', 'sherpa-onnx-wasm-kws-main.js', 'sherpa-onnx-wasm-kws-main.wasm', 'sherpa-onnx-wasm-kws-main.data'];

const vendor = resolve(import.meta.dirname, '../client/vendor/sherpa-onnx');
const keep = process.argv.indexOf('--keep');
const work = keep > 0 ? resolve(process.argv[keep + 1]!) : mkdtempSync(join(tmpdir(), 'mp-wake-'));
mkdirSync(work, { recursive: true });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const run = (command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) =>
  execFileSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });

if ([...BUILT, 'bpe.model'].every((file) => existsSync(join(vendor, file)))) {
  console.log(`${vendor} is complete. Delete it to fetch and build again.`);
  process.exit(0);
}

try {
  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`the model answered ${res.status}`);
  const archive = new Uint8Array(await res.arrayBuffer());
  if (sha256(archive) !== MODEL.sha256) throw new Error(`the model's checksum is ${sha256(archive)}, not ${MODEL.sha256}`);
  writeFileSync(join(work, 'model.tar.bz2'), archive);
  run('tar', ['-xjf', join(work, 'model.tar.bz2'), '-C', work]);
  rmSync(join(work, 'model.tar.bz2'));
  const model = join(work, MODEL.folder);

  const clone = (from: typeof SHERPA, into: string) => {
    run('git', ['clone', '--quiet', '--depth', '1', '--branch', from.tag, from.repo, into]);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: into, encoding: 'utf8' }).trim();
    if (head !== from.commit) throw new Error(`${from.repo} ${from.tag} is at ${head}, not ${from.commit}`);
  };
  const emsdk = join(work, 'emsdk');
  const sherpa = join(work, 'sherpa-onnx');
  clone(EMSDK, emsdk);
  run(join(emsdk, 'emsdk'), ['install', EMSDK.tag], emsdk);
  run(join(emsdk, 'emsdk'), ['activate', EMSDK.tag], emsdk);
  clone(SHERPA, sherpa);
  for (const file of MODEL.files) copyFileSync(join(model, file), join(sherpa, 'wasm/kws/assets', file));
  run('bash', ['-c', `source "${join(emsdk, 'emsdk_env.sh')}" >/dev/null && ./build-wasm-simd-kws.sh`], sherpa, { CMAKE_POLICY_VERSION_MINIMUM: '3.5' });

  mkdirSync(vendor, { recursive: true });
  const made: Record<string, string> = {};
  for (const file of BUILT) {
    copyFileSync(join(sherpa, 'build-wasm-simd-kws/install/bin/wasm', file), join(vendor, file));
    made[file] = sha256(readFileSync(join(vendor, file)));
  }
  copyFileSync(join(model, 'bpe.model'), join(vendor, 'bpe.model'));
  made['bpe.model'] = sha256(readFileSync(join(vendor, 'bpe.model')));
  writeFileSync(join(vendor, 'versions.json'), JSON.stringify({ sherpaOnnx: SHERPA, emsdk: EMSDK, model: { url: MODEL.url, sha256: MODEL.sha256, files: MODEL.files }, sha256: made }, null, 1));
  console.log(`Put ${Object.keys(made).length} files in ${vendor}.`);
} finally {
  if (keep < 0) rmSync(work, { recursive: true, force: true });
}
