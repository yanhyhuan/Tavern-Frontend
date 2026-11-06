import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { createDiceBridge } from '../bridge.js';
import { findEnabledDiceScript, startExtension, STATE_KEY } from '../loader.js';

// This emitter mirrors the listener ownership and ordering behavior of the
// SillyTavern event source; it deliberately requires the correct receiver.
class FakeEventSource {
  events = new Map();

  on(event, listener) {
    const listeners = this.events.get(event) || [];
    listeners.push(listener);
    this.events.set(event, listeners);
  }

  removeListener(event, listener) {
    const listeners = this.events.get(event) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  makeFirst(event, listener) {
    this.removeListener(event, listener);
    const listeners = this.events.get(event) || [];
    listeners.unshift(listener);
    this.events.set(event, listeners);
  }

  makeLast(event, listener) {
    this.removeListener(event, listener);
    this.on(event, listener);
  }

  async emit(event, ...args) {
    for (const listener of [...(this.events.get(event) || [])]) {
      await listener.apply(this, args);
    }
  }

  count(event) {
    return (this.events.get(event) || []).length;
  }
}

const helperFunctionNames = [
  'getCharData',
  'getChatMessages',
  'setChatMessages',
  'getLastMessageId',
  'formatAsDisplayedMessage',
  'formatAsTavernRegexedString',
  'retrieveDisplayedMessage',
  'substitudeMacros',
  'waitGlobalInitialized',
  'triggerSlash',
];

function makeHost() {
  const listeners = new Map();
  const source = new FakeEventSource();
  const calls = [];
  const trees = { global: [], preset: [], character: [] };
  const hostConsole = Object.fromEntries(
    ['log', 'info', 'warn', 'error', 'debug'].map(name => [
      name,
      function (...args) {
        assert.equal(this, hostConsole);
        calls.push({ name, args });
      },
    ]),
  );
  const initialOnError = () => false;
  const host = {
    document: { querySelector: () => null },
    location: { href: 'https://tavern.example/' },
    console: hostConsole,
    toastr: { error: (...args) => calls.push({ name: 'toast', args }) },
    jQuery: () => {},
    _: {},
    onerror: initialOnError,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener, options) {
      assert.equal(this, host);
      const current = listeners.get(type) || [];
      current.push({ listener, once: options === true ? false : Boolean(options?.once) });
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      assert.equal(this, host);
      const current = listeners.get(type) || [];
      const index = current.findIndex(item => item.listener === listener);
      if (index >= 0) current.splice(index, 1);
    },
    dispatchEvent(event) {
      assert.equal(this, host);
      for (const item of [...(listeners.get(event.type) || [])]) {
        if (item.once) host.removeEventListener(event.type, item.listener);
        item.listener.call(host, event);
      }
      return true;
    },
    async fetch(...args) {
      assert.equal(this, host);
      return { ok: true, args };
    },
  };
  host.window = host;
  host.self = host;
  host.parent = host;
  host.top = host;
  const context = {
    chatId: 'chat-a',
    characterId: 0,
    characters: [{ name: '角色', avatar: 'test.png' }],
    name1: '玩家',
    eventSource: source,
    eventTypes: { CHAT_CHANGED: 'chat_changed', MESSAGE_SENT: 'message_sent' },
    extensionSettings: {
      tavern_helper: { script: { enabled: { global: true, presets: [], characters: [] } } },
    },
    getCurrentChatId: () => context.chatId,
  };
  host.SillyTavern = { getContext: () => context };
  host.TavernHelper = {
    builtin: { renderMarkdown: text => `render:${text}` },
    tavern_events: { MESSAGE_SENT: 'message_sent' },
    getScriptTrees({ type }) {
      assert.equal(this, host.TavernHelper);
      return trees[type];
    },
  };
  for (const name of helperFunctionNames) {
    host.TavernHelper[name] = function (...args) {
      assert.equal(this, host.TavernHelper);
      return { name, args };
    };
  }
  return { host, context, source, calls, trees, initialOnError };
}

test('window relations and SillyTavern context retain identity and update dynamically', () => {
  const { host, context } = makeHost();
  const bridge = createDiceBridge(host);
  const { scope } = bridge;
  assert.equal(scope.window.window, scope.window);
  assert.equal(scope.window.self, scope.window);
  assert.equal(scope.window.parent, scope.window);
  assert.equal(scope.window.top, scope.window);
  assert.equal(scope.self, scope.window);
  assert.equal(scope.globalThis, scope.window);
  assert.equal(scope.window.SillyTavern, scope.SillyTavern);
  assert.equal(scope.SillyTavern.getContext().chatId, 'chat-a');
  assert.equal(scope.SillyTavern.chatId, 'chat-a');
  assert.equal(scope.SillyTavern.name1, '玩家');
  context.chatId = 'chat-b';
  context.name1 = '另一玩家';
  assert.equal(scope.SillyTavern.chatId, 'chat-b');
  assert.equal(scope.SillyTavern.getContext().chatId, 'chat-b');
  assert.equal(scope.getCurrentChatId(), 'chat-b');
  assert.equal(scope.SillyTavern.name1, '另一玩家');
  bridge.dispose();
});

test('the helper bridge forwards real exported functions and does not invent missing APIs', () => {
  const { host } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  for (const name of helperFunctionNames) {
    assert.deepEqual(scope[name]('sample'), { name, args: ['sample'] });
  }
  assert.equal(scope.builtin, host.TavernHelper.builtin);
  assert.equal(scope.builtin.renderMarkdown('hello'), 'render:hello');
  assert.equal(scope.window.tavern_events, host.TavernHelper.tavern_events);
  assert.equal(scope.nonexistentHelperApi, undefined);
  dispose();
});

test('event registration, removal, once, and disposal preserve unrelated listeners', async () => {
  const { host, source } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  const events = scope.SillyTavern.getContext().eventSource;
  const seen = [];
  const unrelated = value => seen.push(`host:${value}`);
  const owned = value => seen.push(`owned:${value}`);
  source.on('change', unrelated);
  events.on('change', owned);
  events.once('change', value => seen.push(`once:${value}`));
  assert.equal(source.count('change'), 3);
  await source.emit('change', 1);
  await source.emit('change', 2);
  assert.deepEqual(seen, ['host:1', 'owned:1', 'once:1', 'host:2', 'owned:2']);
  events.removeListener('change', owned);
  assert.equal(source.count('change'), 1);
  dispose();
  assert.equal(source.count('change'), 1);
  await source.emit('change', 3);
  assert.equal(seen.at(-1), 'host:3');
});

test('the global event facade can stop, reorder and dispose its own handlers', async () => {
  const { host, source } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  const seen = [];
  const first = value => seen.push(`first:${value}`);
  const second = value => seen.push(`second:${value}`);
  const subscription = scope.eventOn('custom', first);
  const events = scope.SillyTavern.eventSource;
  events.on('custom', second);
  events.makeFirst('custom', second);
  await scope.eventEmit('custom', 1);
  assert.deepEqual(seen, ['second:1', 'first:1']);
  subscription.stop();
  scope.eventOff('custom', second);
  assert.equal(source.count('custom'), 0);
  events.on('custom', first);
  dispose();
  assert.equal(source.count('custom'), 0);
  assert.throws(() => events.on('custom', first), /卸载|刷新/);
});

test('removing an unowned event handler cannot remove another extension listener', async () => {
  const { host, source } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  let calls = 0;
  const otherExtensionHandler = () => { calls += 1; };
  source.on('shared', otherExtensionHandler);
  scope.SillyTavern.eventSource.removeListener('shared', otherExtensionHandler);
  await source.emit('shared');
  assert.equal(calls, 1);
  dispose();
});

test('removing an unowned window handler cannot remove another extension listener', () => {
  const { host } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  let calls = 0;
  const otherExtensionHandler = () => { calls += 1; };
  host.addEventListener('resize', otherExtensionHandler);
  scope.window.removeEventListener('resize', otherExtensionHandler);
  host.dispatchEvent({ type: 'resize' });
  assert.equal(calls, 1);
  dispose();
});

test('console and onerror changes remain local to the dice bridge', () => {
  const { host, calls, initialOnError } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  const originalLog = host.console.log;
  assert.equal(scope.console, scope.window.console);
  scope.console.log('forwarded');
  assert.deepEqual(calls.at(-1), { name: 'log', args: ['forwarded'] });
  const localLog = () => {};
  scope.console.log = localLog;
  assert.equal(scope.window.console.log, localLog);
  assert.equal(host.console.log, originalLog);
  const localError = () => false;
  scope.window.onerror = localError;
  assert.equal(scope.window.onerror, localError);
  assert.equal(host.onerror, initialOnError);
  dispose();
  assert.equal(host.onerror, initialOnError);
});

test('error and rejection relays ignore unrelated extensions and are removed on disposal', () => {
  const { host } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  const diceUrl = new URL('../dice.js', import.meta.url).href;
  const errors = [];
  const rejections = [];
  scope.window.onerror = (...args) => errors.push(args);
  scope.window.addEventListener('unhandledrejection', event => rejections.push(event.reason));
  host.dispatchEvent({ type: 'error', filename: 'https://other.example/plugin.js', error: new Error('other') });
  host.dispatchEvent({ type: 'unhandledrejection', reason: new Error('other') });
  assert.equal(errors.length, 0);
  assert.equal(rejections.length, 0);

  const diceError = new Error('dice failure');
  diceError.stack = `Error: dice failure\n    at ${diceUrl}:1:2`;
  host.dispatchEvent({ type: 'error', filename: diceUrl, message: 'dice failure', lineno: 1, colno: 2, error: diceError });
  host.dispatchEvent({ type: 'unhandledrejection', reason: diceError });
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'dice failure');
  assert.equal(rejections.length, 1);
  dispose();
  host.dispatchEvent({ type: 'error', filename: diceUrl, message: 'again', error: diceError });
  host.dispatchEvent({ type: 'unhandledrejection', reason: diceError });
  assert.equal(errors.length, 1);
  assert.equal(rejections.length, 1);
});

test('required helper exports must exist instead of being fabricated', () => {
  const missingWait = makeHost();
  delete missingWait.host.TavernHelper.waitGlobalInitialized;
  assert.throws(() => createDiceBridge(missingWait.host), /waitGlobalInitialized/);
  const missingBuiltin = makeHost();
  delete missingBuiltin.host.TavernHelper.builtin;
  assert.throws(() => createDiceBridge(missingBuiltin.host), /builtin/);
});

test('fetch is called with the real host as its receiver', async () => {
  const { host } = makeHost();
  const { scope, dispose } = createDiceBridge(host);
  const result = await scope.window.fetch('/api/chats/get', { method: 'POST' });
  assert.deepEqual(result.args, ['/api/chats/get', { method: 'POST' }]);
  dispose();
});

test('pagehide handlers run before bridge-owned event handlers are disposed', async () => {
  const { host, source } = makeHost();
  const { scope } = createDiceBridge(host);
  let handled = false;
  scope.SillyTavern.eventSource.on('shared', () => {});
  scope.window.addEventListener('pagehide', () => { handled = true; });
  host.dispatchEvent({ type: 'pagehide' });
  assert.equal(handled, true);
  await Promise.resolve();
  assert.equal(source.count('shared'), 0);
});

test('loader starts one instance and returns the same promise for repeated starts', async () => {
  const { host } = makeHost();
  let loaded = 0;
  let started = 0;
  const load = async () => {
    loaded += 1;
    return { runDice: bridge => { assert.ok(bridge.scope.window); started += 1; } };
  };
  const first = startExtension(host, { load, timeoutMs: 100, pollMs: 1 });
  const second = startExtension(host, { load, timeoutMs: 100, pollMs: 1 });
  assert.equal(first, second);
  const state = await first;
  assert.equal(state, host[STATE_KEY]);
  assert.equal(state.status, 'running');
  assert.equal(loaded, 1);
  assert.equal(started, 1);
});

test('loader rejects an enabled original dice script or a live dice instance', async () => {
  const oldScript = makeHost();
  oldScript.trees.global.push({
    type: 'script',
    enabled: true,
    name: '数据库前端·骰子系统（v6.32）',
    content: 'https://example.test/stable.js',
  });
  assert.equal(findEnabledDiceScript(oldScript.host, oldScript.context), true);
  let invoked = false;
  await assert.rejects(startExtension(oldScript.host, {
    timeoutMs: 100,
    pollMs: 1,
    load: async () => { invoked = true; return { runDice() {} }; },
  }), /原骰子脚本/);
  assert.equal(invoked, false);
  assert.equal(oldScript.host[STATE_KEY].status, 'failed');
  assert.ok(oldScript.calls.some(call => call.name === 'toast'));

  const renamed = makeHost();
  renamed.trees.global.push({ type: 'script', enabled: true, name: '数据库 骰子系统 V1.0.1', content: '' });
  assert.equal(findEnabledDiceScript(renamed.host, renamed.context), true);

  const live = makeHost();
  live.host.AcuDice = {};
  await assert.rejects(startExtension(live.host, {
    timeoutMs: 100,
    pollMs: 1,
    load: async () => { throw new Error('must not load'); },
  }), /已有骰子系统实例/);
  assert.equal(live.host[STATE_KEY].status, 'failed');
});

test('disabled scopes and bundled diagnostics do not falsely block startup', () => {
  const { host, context, trees } = makeHost();
  const activeScript = { type: 'script', enabled: true, name: '骰子系统', content: '' };
  trees.global.push({ type: 'folder', enabled: false, scripts: [activeScript] });
  trees.character.push(activeScript);
  trees.preset.push(activeScript);
  for (const [label, file] of [['加载测试', 'tavern-helper-load-test.js'], ['只读测试', 'tavern-helper-test.js']]) {
    trees.global.push({
      type: 'script', enabled: true, name: `Tavern Frontend V1.0.1 ${label}`,
      content: readFileSync(new URL(`../diagnostics/${file}`, import.meta.url), 'utf8'),
    });
  }
  assert.equal(findEnabledDiceScript(host, context), false);
  trees.global.push({ type: 'script', enabled: true, name: '数据库 骰子系统 V1.0.1', content: '' });
  assert.equal(findEnabledDiceScript(host, context), true);
});
