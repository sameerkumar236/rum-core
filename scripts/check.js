import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

async function findJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return findJavaScript(filename);
      return filename.endsWith('.js') ? [filename] : [];
    }),
  );
  return files.flat();
}

const files = (
  await Promise.all(
    ['server', 'tracker', 'scripts'].map((directory) =>
      findJavaScript(path.join(root, directory)),
    ),
  )
).flat();

for (const filename of files) {
  const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  `JavaScript syntax checked: ${files.length} files. React is checked by npm run build.`,
);
