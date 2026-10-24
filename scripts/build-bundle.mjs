// Bundle the frontend (public/ts/main.ts) into public/dist/ with content-hashed filenames.
// Writes public/dist/manifest.json ({ "main.js": "main-<hash>.js" }), which the server uses
// to point index.html at the hashed entry. Type checking stays with `tsc --noEmit`.
import { build } from 'esbuild';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'public/dist');

await rm(outdir, { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { main: path.join(root, 'public/ts/main.ts') },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  logLevel: 'info',
});

const manifest = {};
for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (meta.entryPoint && file.endsWith('.js')) {
    manifest[path.basename(meta.entryPoint, '.ts') + '.js'] = path.relative(
      outdir,
      path.resolve(root, file)
    );
  }
}
await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Wrote public/dist/manifest.json', manifest);
