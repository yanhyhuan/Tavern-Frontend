export async function run() {
  const { createDiceBridge } = await import('/extension/bridge.js');
  const { startExtension, STATE_KEY } = await import('/extension/loader.js');
  const bridge = createDiceBridge(window);
  const facade = bridge.scope.window;
  const descriptors = Object.fromEntries(['window', 'self', 'parent', 'top'].map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    return [key, { configurable: descriptor?.configurable, getter: typeof descriptor?.get === 'function' }];
  }));
  const identity = facade !== window && facade.window === facade && facade.self === facade &&
    facade.parent === facade && facade.top === facade && bridge.scope.globalThis === facade;
  Object.defineProperty(facade, '__diceFacadeProbe', { value: 42, configurable: true });
  const propertyForwarded = window.__diceFacadeProbe === 42;
  delete facade.__diceFacadeProbe;
  const fetchStatus = (await facade.fetch('/jquery.js')).status;

  let localErrors = 0;
  facade.onerror = () => { localErrors += 1; };
  window.dispatchEvent(new ErrorEvent('error', { message: 'unrelated', filename: 'https://example.test/other.js' }));
  window.dispatchEvent(new ErrorEvent('error', { message: 'own', filename: new URL('/extension/dice.js', location.href).href }));
  const hostOnerrorPreserved = window.onerror === window.__smoke.hostError;
  const originalConsole = console.error;
  let localLogs = 0;
  facade.console.error = () => { localLogs += 1; };
  facade.console.error('probe');
  const consoleIsolated = console.error === originalConsole && localLogs === 1 && bridge.scope.console === facade.console;

  const own = () => {};
  const other = () => {};
  const source = window.__smoke.context.eventSource;
  source.on('isolation-test', other);
  bridge.scope.SillyTavern.eventSource.on('isolation-test', own);
  bridge.dispose();
  const ownedRemoved = (window.__smoke.listeners.get('isolation-test') || []).length === 1;
  source.removeListener('isolation-test', other);

  const state = window[STATE_KEY];
  const repeat = startExtension(window);
  return {
    identity, descriptors, propertyForwarded, fetchStatus, localErrors, hostOnerrorPreserved,
    consoleIsolated, ownedRemoved, samePromise: repeat === state.promise,
    state: state.status, version: state.version, api: Boolean(window.AcuDice),
    rootCount: document.querySelectorAll('.acu-wrapper.acu-dice-ui-root').length,
    hostSTPreserved: window.SillyTavern === window.__smoke.hostSt,
    hostLogPreserved: console.log === window.__smoke.hostLog,
  };
}

export async function loadFromIframe() {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.srcdoc = '<script src="/test-loader.js"><\/script>';
  document.body.appendChild(iframe);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const state = window[Symbol.for('acu.dice.compat.extension')];
    const root = document.querySelector('.acu-wrapper.acu-dice-ui-root');
    if (state?.status === 'failed') throw new Error(state.error);
    if (state?.status === 'running' && root) {
      const nativeModule = document.querySelector('script[type="module"][src$="/Tavern-Frontend/index.js"]');
      return {
        state: state.status,
        version: state.version,
        api: Boolean(window.AcuDice),
        loaderInHostDocument: nativeModule?.ownerDocument === document,
        nodeInHostRealm: root.ownerDocument === document && root instanceof HTMLElement,
        rootCount: document.querySelectorAll('.acu-wrapper.acu-dice-ui-root').length,
        successToast: window.__smoke.toasts.some(item => item.type === 'success'),
        hostSTPreserved: window.SillyTavern === window.__smoke.hostSt,
        hostOnerrorPreserved: window.onerror === window.__smoke.hostError,
        hostConsolePreserved: console.log === window.__smoke.hostLog,
      };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('等待 iframe 加载测试完成超时');
}
