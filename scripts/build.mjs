import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import webpack from 'webpack';
import { getBuildInputHash } from './build-inputs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = 'V1.0.1';
const scopeNames = [
  'window', 'self', 'globalThis', 'console', 'SillyTavern', '_', 'toastr',
  'getCharData', 'getChatMessages', 'setChatMessages', 'getLastMessageId',
  'formatAsDisplayedMessage', 'formatAsTavernRegexedString', 'retrieveDisplayedMessage',
  'substitudeMacros', 'waitGlobalInitialized', 'triggerSlash', 'builtin', 'getCurrentChatId',
  'eventOn', 'eventOff', 'eventEmit', 'tavern_events',
];

process.chdir(root);
process.env.BUILD_TYPE = 'stable';
const inputHash = await getBuildInputHash(root);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.version !== '1.0.1' || manifest.dice_patch_version !== version) {
  throw new Error('扩展 manifest 与固定构建版本不一致');
}

// Preserve the upstream loaders, plugins and minification for the original UI.
const { default: factories } = await import('../webpack.config.ts');
const entry = path.join(root, 'src', '骰子系统', 'index.ts');
const matches = factories.map(factory => factory({}, { mode: 'production' }))
  .filter(configuration => path.resolve(String(configuration.entry)) === entry);
if (matches.length !== 1) throw new Error(`期望一个骰子系统入口，实际为 ${matches.length}`);
const configuration = matches[0];
configuration.mode = 'production';
configuration.output = {
  ...configuration.output,
  path: path.join(root, '.build', 'core'),
  filename: 'stable.js',
};
// The upstream schema exporter belongs to other scripts, not this extension.
configuration.plugins = configuration.plugins.filter(plugin => plugin?.apply?.name !== 'dump_schema');
// Bundle the pinned identity helper; upstream externalizes unknown packages to a live CDN.
const upstreamExternals = configuration.externals;
if (typeof upstreamExternals !== 'function') throw new Error('上游 externals 配置不符合预期');
configuration.externals = (data, callback) => data.request === 'pinyin-pro'
  ? callback()
  : upstreamExternals(data, callback);
const compiler = webpack(configuration);
try {
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => {
      if (error) return reject(error);
      if (!result) return reject(new Error('Webpack 没有返回结果'));
      resolve(result);
    });
  });
  console.log(stats.toString({ colors: Boolean(process.stdout.isTTY), modules: false, chunks: false }));
  if (stats.hasErrors()) throw new Error('骰子系统构建失败');
} finally {
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
}

const bundlePath = path.join(root, '.build', 'core', 'stable.js');
const code = await readFile(bundlePath, 'utf8');
const source = ts.createSourceFile('stable.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
if (!code.trim() || source.parseDiagnostics.length) throw new Error('构建产物为空或无法解析');
for (const statement of source.statements) {
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement) ||
      statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    throw new Error('原 bundle 出现顶层 import/export，不能安全封装');
  }
}
let hasImportMeta = false;
const visit = node => {
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) hasImportMeta = true;
  ts.forEachChild(node, visit);
};
visit(source);
if (hasImportMeta) throw new Error('原 bundle 使用 import.meta，不能安全封装');
const bundle = code.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]+\s*$/, '');
if (bundle === code) throw new Error('原 bundle 缺少预期的 sourceMappingURL');
const wrapped = `/*! Tavern Frontend ${version}; based on jerryzmtz/my-tavern-scripts v6.32; modified by yanhyhuan 2026-11-06 for extension/database compatibility; see LICENSE. */\n` +
  `export function runDice(__diceBridge) {\n  const { ${scopeNames.join(', ')} } = __diceBridge.scope;\n` +
  `  (() => {\n${bundle}\n  })();\n}\n`;
const staged = path.join(root, '.build', 'dice.js');
await mkdir(path.dirname(staged), { recursive: true });
await writeFile(staged, wrapped, 'utf8');
for (const file of [staged, ...['index.js', 'loader.js', 'bridge.js'].map(file => path.join(root, file))]) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 30_000 });
  if (checked.error || checked.status !== 0) throw new Error(checked.error?.message || checked.stderr || 'JavaScript 语法检查失败');
}
await copyFile(staged, path.join(root, 'dice.js'));
if (inputHash !== await getBuildInputHash(root)) throw new Error('构建期间源码发生变化，请重新构建。');
await writeFile(path.join(root, '.build', 'build-inputs.json'), JSON.stringify({ inputHash }), 'utf8');
console.log(`数据库 骰子系统 ${version}：${path.join(root, 'dice.js')}`);
