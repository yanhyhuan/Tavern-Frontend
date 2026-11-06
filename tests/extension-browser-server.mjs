import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryBundle = path.join(root, 'dice.js');
const packagedExtension = path.join(root, 'extension', 'dice.js');
const extension = process.env.DICE_BROWSER_EXTENSION_DIR || (existsSync(repositoryBundle)
  ? root
  : existsSync(packagedExtension)
    ? path.dirname(packagedExtension)
    : root);
const routes = new Map([
  ['/', [path.join(root, 'tests', 'extension-browser-harness.html'), 'text/html; charset=utf-8']],
  ['/probes.js', [path.join(root, 'tests', 'extension-browser-probes.js'), 'text/javascript; charset=utf-8']],
  ['/default-fixture.js', [path.join(root, 'tests', 'extension-browser-default-fixture.js'), 'text/javascript; charset=utf-8']],
  ['/default-template.json', [path.join(root, 'assets', 'templates', 'database-default-1.3.6.json'), 'application/json; charset=utf-8']],
  ['/v45-template.json', [path.join(root, 'assets', 'templates', 'TavernDB_template_runtime_SQL_v4.5.json'), 'application/json; charset=utf-8']],
  ['/test-loader.js', [path.join(root, 'diagnostics', 'tavern-helper-load-test.js'), 'text/javascript; charset=utf-8']],
  ['/jquery.js', [path.join(root, 'node_modules', 'jquery', 'dist', 'jquery.min.js'), 'text/javascript; charset=utf-8']],
  ['/lodash.js', [path.join(root, 'node_modules', 'lodash', 'lodash.min.js'), 'text/javascript; charset=utf-8']],
  ...['index.js', 'loader.js', 'bridge.js', 'dice.js'].map(file => [
    `/extension/${file}`, [path.join(extension, file), 'text/javascript; charset=utf-8'],
  ]),
  ...['index.js', 'loader.js', 'bridge.js', 'dice.js'].map(file => [
    `/scripts/extensions/third-party/Tavern-Frontend/${file}`, [path.join(extension, file), 'text/javascript; charset=utf-8'],
  ]),
]);
for (const [route, [filename]] of routes) {
  if (!existsSync(filename)) throw new Error(`缺少 ${route} 所需文件：${filename}`);
}
const server = createServer((request, response) => {
  const [filename, contentType] = routes.get(new URL(request.url, 'http://127.0.0.1').pathname) || [];
  if (!filename) { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  createReadStream(filename).on('error', () => response.destroy()).pipe(response);
});
server.listen(0, '127.0.0.1', () => console.log(`隔离测试地址：http://127.0.0.1:${server.address().port}/`));
