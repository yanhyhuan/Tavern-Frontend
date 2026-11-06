import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function getBuildInputHash(root) {
  const files = ['package.json', 'pnpm-lock.yaml', 'webpack.config.ts', 'tsconfig.json',
    'global.d.ts', 'tailwind.config.js', 'postcss.config.cjs', 'manifest.json',
    'scripts/build.mjs', 'scripts/build-inputs.mjs'];
  async function visit(relative) {
    for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const filename = `${relative}/${item.name}`;
      if (item.isDirectory()) await visit(filename);
      else if (item.isFile() && /\.(?:[cm]?[jt]sx?|json|vue|s?css)$/.test(item.name)) files.push(filename);
    }
  }
  await visit('src');
  await visit('assets/templates');
  await visit('@types');
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
  return hash.digest('hex');
}
