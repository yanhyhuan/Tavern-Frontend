import { createDiceBridge } from './bridge.js';

export const PATCH_VERSION = 'V1.0.1';
export const STATE_KEY = Symbol.for('acu.dice.compat.extension');
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 200;

function notifyFailure(host, message, error) {
  console.error(`[DICE extension] ${message}`, error || '');
  try {
    host.toastr?.error?.(message, '骰子系统扩展', { timeOut: 0, extendedTimeOut: 0 });
  } catch (toastError) {
    console.error('[DICE extension] 无法显示错误提示:', toastError);
  }
}

function contextIfReady(host) {
  const helper = host.TavernHelper;
  if (
    !host.document ||
    typeof host.jQuery !== 'function' ||
    typeof host.SillyTavern?.getContext !== 'function' ||
    typeof helper?.getChatMessages !== 'function' ||
    typeof helper?.setChatMessages !== 'function' ||
    typeof helper?.getScriptTrees !== 'function'
  ) return null;
  try {
    const context = host.SillyTavern.getContext();
    return context && typeof context.eventSource?.on === 'function' &&
      (typeof context.eventSource.removeListener === 'function' || typeof context.eventSource.off === 'function')
      ? context
      : null;
  } catch {
    return null;
  }
}

function hasLiveDice(host) {
  return Boolean(host.AcuDice || host.document?.querySelector?.('.acu-wrapper.acu-dice-ui-root'));
}

function decodeContent(value) {
  const text = String(value || '');
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function looksLikeDiceScript(script) {
  const name = String(script?.name || '').replace(/\s+/g, '');
  if (/^(?:(?:数据库前端|数据库)[·•・-]?)?骰子系统(?:(?:[（(].*|v?\d.*))?$/i.test(name)) return true;
  const content = decodeContent(script?.content);
  return (
    content.includes('acu_visualizer_ui_v19_6_ai_overlay') ||
    (content.includes('my-tavern-scripts') &&
      (content.includes('骰子系统') || /(?:^|\/)骰子[^/]*\/|(?:stable|nightly)\.js/i.test(content)))
  );
}

function activeScopeTypes(context) {
  const settings = context.extensionSettings?.tavern_helper?.script?.enabled;
  if (!settings || typeof settings !== 'object') return ['global', 'preset', 'character'];
  const active = [];
  if (settings.global !== false) active.push('global');
  if (!Array.isArray(settings.characters)) {
    active.push('character');
  } else if (settings.characters.length > 0) {
    const avatar = context.characters?.[context.characterId]?.avatar;
    if (!avatar || settings.characters.includes(avatar)) active.push('character');
  }
  if (!Array.isArray(settings.presets)) {
    active.push('preset');
  } else if (settings.presets.length > 0) {
    let preset;
    try {
      preset = context.getPresetManager?.('openai')?.getSelectedPresetName?.();
    } catch {
      // If the selected preset is unavailable, check the current tree conservatively.
    }
    if (!preset || settings.presets.includes(preset)) active.push('preset');
  }
  return active;
}

export function findEnabledDiceScript(host, context) {
  const helper = host.TavernHelper;
  for (const type of activeScopeTypes(context)) {
    const trees = helper.getScriptTrees({ type });
    if (!Array.isArray(trees)) throw new Error(`酒馆助手未返回有效的${type}脚本列表`);
    for (const tree of trees) {
      if (!tree?.enabled) continue;
      const scripts = tree.type === 'folder' ? tree.scripts : [tree];
      if (!Array.isArray(scripts)) continue;
      if (scripts.some(script => script?.enabled && looksLikeDiceScript(script))) return true;
    }
  }
  return false;
}

async function waitForHost(host, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (hasLiveDice(host)) throw new Error('检测到已有骰子系统实例，请先停用原骰子脚本并刷新酒馆');
    const context = contextIfReady(host);
    if (context) return context;
    await new Promise(resolve => host.setTimeout(resolve, pollMs));
  } while (Date.now() < deadline);
  throw new Error('等待酒馆助手超时，请启用酒馆助手并刷新酒馆');
}

/** Start exactly once per host page. Disabling the extension takes effect after reload. */
export function startExtension(host, options = {}) {
  const previous = host[STATE_KEY];
  if (previous?.promise) return previous.promise;
  if (previous) return Promise.reject(new Error('骰子系统扩展状态无效，请刷新酒馆'));

  const state = { version: PATCH_VERSION, status: 'starting', error: '', promise: null };
  Object.defineProperty(host, STATE_KEY, { value: state, configurable: true });
  state.promise = (async () => {
    let bridge;
    try {
      let context = await waitForHost(host, options.timeoutMs ?? READY_TIMEOUT_MS, options.pollMs ?? READY_POLL_MS);
      if (findEnabledDiceScript(host, context)) {
        throw new Error('检测到已启用的原骰子脚本，请先停用它并刷新酒馆');
      }
      const load = options.load || (() => import('./dice.js'));
      const module = await load();
      context = contextIfReady(host);
      if (!context) throw new Error('酒馆助手在加载扩展时变为不可用，请刷新酒馆');
      if (hasLiveDice(host) || findEnabledDiceScript(host, context)) {
        throw new Error('检测到已有骰子系统实例或原骰子脚本，请先停用原脚本并刷新酒馆');
      }
      if (typeof module.runDice !== 'function') throw new Error('骰子系统扩展产物缺少入口');
      bridge = createDiceBridge(host);
      module.runDice(bridge);
      state.status = 'running';
      console.info(`[DICE extension] 已加载 ${PATCH_VERSION}`);
      return state;
    } catch (error) {
      bridge?.dispose();
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      notifyFailure(host, state.error, error);
      throw error;
    }
  })();
  return state.promise;
}
