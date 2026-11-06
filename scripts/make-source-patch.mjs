import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = process.argv[2];
if (!upstream) throw new Error('用法：node scripts/make-source-patch.mjs <上游 Git checkout 路径>');
const baseline = '0b8bf2498d066a20d26e0418e3eec50d8bb04368';
function run(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Git 操作失败');
  return result.stdout;
}
const gitDir = run(['-C', path.resolve(upstream), 'rev-parse', '--absolute-git-dir']).trim();
if (run(['--git-dir', gitDir, 'rev-parse', `${baseline}^{commit}`]).trim() !== baseline) {
  throw new Error('上游 checkout 中没有固定的 v6.32 基线');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'tavern-frontend-patch-'));
const index = path.join(temporary, 'index');
const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: root, GIT_INDEX_FILE: index };
try {
  run(['read-tree', baseline], { env });
  run(['add', '-A', '--', 'src/骰子系统', 'assets'], { env });
  const patch = run(['diff', '--cached', '--binary', '--no-ext-diff', '--no-color', baseline, '--', 'src/骰子系统', 'assets'], { env });
  if (!patch.trim()) throw new Error('没有找到源码差异');
  run(['read-tree', baseline], { env });
  run(['apply', '--check', '--cached', '-'], { env, input: patch });
  await mkdir(path.join(root, 'patches'), { recursive: true });
  const destination = path.join(root, 'patches', 'dice-v6.32-V1.0.1.patch');
  await writeFile(destination, patch, 'utf8');
  console.log(`源码补丁可干净应用于固定 v6.32 基线：${destination}`);
} finally {
  await unlink(index).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(temporary);
}
