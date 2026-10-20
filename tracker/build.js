import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

await build({
  absWorkingDir: projectRoot,
  entryPoints: ['./tracker/src/index.js'],
  outfile: 'server/public/tracker.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  tsconfigRaw: {},
  minify: true,
  legalComments: 'inline',
});

console.log('Tracker built: server/public/tracker.js');
