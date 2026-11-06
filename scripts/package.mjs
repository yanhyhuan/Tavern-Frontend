import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuildInputHash } from './build-inputs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = 'V1.0.1';
const releaseRoot = path.join(root, 'release');
const stage = path.join(releaseRoot, version, 'Tavern-Frontend');
const archive = path.join(releaseRoot, `Tavern-Frontend-${version}.zip`);
const rootFiles = [
  'manifest.json', 'index.js', 'loader.js', 'bridge.js', 'dice.js',
  'README.md', 'NOTICE.md', 'LICENSE', 'package.json', 'pnpm-lock.yaml',
  'tsconfig.json', 'webpack.config.ts', 'eslint.config.mjs',
  'global.d.ts', 'postcss.config.cjs', 'tailwind.config.js', '.gitignore', '.gitattributes',
  '.editorconfig', '.prettierignore', '.prettierrc',
];
const directories = ['src', 'assets', 'scripts', 'tests', 'diagnostics', 'docs', 'patches', '@types'];

async function walk(directory, prefix = '') {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...await walk(path.join(directory, item.name), relative));
    else if (item.isFile()) result.push(relative);
    else throw new Error(`不支持发布非常规文件：${relative}`);
  }
  return result.sort();
}

const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.version !== '1.0.1' || manifest.dice_patch_version !== version) throw new Error('版本不一致');
if (!(await readFile(path.join(root, 'dice.js'), 'utf8')).startsWith(`/*! Tavern Frontend ${version};`)) {
  throw new Error('请先执行 pnpm build，不能打包旧 bundle');
}
const built = JSON.parse(await readFile(path.join(root, '.build', 'build-inputs.json'), 'utf8'));
if (built.inputHash !== await getBuildInputHash(root)) throw new Error('源码已改变，请重新执行 pnpm build 再打包。');
if (!Buffer.from(await readFile(path.join(root, 'dice.js'))).equals(await readFile(path.join(root, '.build', 'dice.js')))) {
  throw new Error('根目录 dice.js 与本次构建产物不一致，请重新构建。');
}
const files = [...rootFiles];
for (const directory of directories) files.push(...(await walk(path.join(root, directory))).map(file => `${directory}/${file}`));
for (const file of files) {
  const destination = path.join(stage, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, file), destination);
}

for (const item of [
  { file: 'tavern-helper-test.js', name: '只读测试', id: '67ae61bc-10a0-4586-86f1-a2c34552ef61' },
  { file: 'tavern-helper-load-test.js', name: '加载测试', id: 'b147c309-27a0-4076-b982-1435b3e04480' },
]) {
  const content = await readFile(path.join(root, 'diagnostics', item.file), 'utf8');
  const script = {
    type: 'script', id: item.id, name: `Tavern Frontend ${version} ${item.name}`,
    enabled: false, content,
    info: item.name === '只读测试'
      ? '默认停用；只读检查已启动的固定版扩展及公开 API，不改数据库，不代替重开聊天验收。'
      : '默认停用；请在合成聊天运行。加载固定本地扩展后，其自动规则会按当前配置运行；不代替重开聊天验收。',
    button: { enabled: false, buttons: [] }, data: {}, export_with: { data: false, button: false },
  };
  const filename = `diagnostics/酒馆助手${item.name}-${version}.json`;
  const json = `${JSON.stringify(script, null, 2)}\n`;
  await writeFile(path.join(root, filename), json, 'utf8');
  await writeFile(path.join(stage, filename), json, 'utf8');
  if (!files.includes(filename)) files.push(filename);
}

const allowed = new Set([...files, 'SHA256SUMS.txt', 'release-manifest.json']);
const unexpected = (await walk(stage)).filter(file => !allowed.has(file));
if (unexpected.length) throw new Error(`发布目录有未列入清单的文件，已停止：${unexpected.join(', ')}`);
const hashes = {};
for (const file of files.sort()) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(stage, file))).digest('hex');
}
await writeFile(path.join(stage, 'release-manifest.json'), `${JSON.stringify({
  name: 'Tavern Frontend', extensionName: '数据库 骰子系统', version,
  buildInputHash: built.inputHash,
  upstream: { repository: 'jerryzmtz/my-tavern-scripts', tag: 'v6.32', commit: '0b8bf2498d066a20d26e0418e3eec50d8bb04368' },
  databaseReference: { repository: 'AlbusKen/shujuku', tag: 'naiv1.3.6', commit: '0814f5a2fba925315654d66f4e534cecb98bce63', modified: false },
  sha256: hashes,
}, null, 2)}\n`, 'utf8');
await writeFile(path.join(stage, 'SHA256SUMS.txt'), `${Object.entries(hashes).map(([file, hash]) => `${hash}  ${file}`).join('\n')}\n`, 'utf8');

if (process.platform !== 'win32') throw new Error(`发布目录已生成：${stage}；ZIP 打包步骤需要 Windows PowerShell。`);
const zipped = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  'Compress-Archive -LiteralPath $env:DICE_RELEASE_STAGE -DestinationPath $env:DICE_RELEASE_ARCHIVE -Force',
], {
  env: { ...process.env, DICE_RELEASE_STAGE: stage, DICE_RELEASE_ARCHIVE: archive },
  encoding: 'utf8', timeout: 120_000,
});
if (zipped.error || zipped.status !== 0) throw new Error(zipped.error?.message || zipped.stderr || 'ZIP 打包失败');
const archiveHash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${archiveHash}  ${path.basename(archive)}\n`, 'utf8');
console.log(`${archive}\nSHA256 ${archiveHash}`);
