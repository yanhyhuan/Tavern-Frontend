// Reproduce the small part of the Tavern Helper script environment used by
// the original bundle, without replacing the host's globals or document.
const WINDOW_RELATIONS = new Set(['window', 'self', 'parent', 'top']);
const WINDOW_METHODS = new Set([
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'fetch',
  'getComputedStyle',
  'matchMedia',
  'open',
  'scroll',
  'scrollBy',
  'scrollTo',
  'focus',
  'blur',
]);

const HELPER_GLOBALS = [
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
  'builtin',
];

export function createDiceBridge(host) {
  const helper = host?.TavernHelper;
  if (!host?.document || !helper || typeof host.SillyTavern?.getContext !== 'function') {
    throw new Error('酒馆宿主或酒馆助手尚未就绪');
  }
  if (typeof helper.waitGlobalInitialized !== 'function') {
    throw new Error('酒馆助手缺少 waitGlobalInitialized，请升级或重新启用酒馆助手');
  }
  if (typeof helper.builtin?.renderMarkdown !== 'function') {
    throw new Error('酒馆助手缺少 builtin.renderMarkdown，请升级或重新启用酒馆助手');
  }

  const registrations = [];
  const windowRegistrations = [];
  const eventSources = new WeakMap();
  const windowFacades = new WeakMap();
  const stFacades = new WeakMap();
  const moduleUrl = new URL('./dice.js', import.meta.url).href;
  const nativeConsole = host.console || console;
  const consoleMethods = new Map();
  const localConsole = new Proxy(Object.create(null), {
    get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      const value = Reflect.get(nativeConsole, key, nativeConsole);
      if (typeof value !== 'function') return value;
      let cached = consoleMethods.get(key);
      if (!cached || cached.original !== value) {
        cached = { original: value, bound: value.bind(nativeConsole) };
        consoleMethods.set(key, cached);
      }
      return cached.bound;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  let disposed = false;
  let localOnError = null;
  let errorRelay = null;

  // In a script iframe these listeners only see that iframe's failures. In the
  // host page, restrict them to this bundle so unrelated extensions stay isolated.
  function originatesInDice(filename, error) {
    return String(filename || '').startsWith(moduleUrl) || String(error?.stack || '').includes(moduleUrl);
  }

  const currentContext = () => host.SillyTavern.getContext();
  const removeRaw = (source, event, listener) => {
    const remove = source.removeListener || source.off;
    if (typeof remove !== 'function') throw new Error('酒馆事件源不支持移除监听器');
    return remove.call(source, event, listener);
  };

  function forget(record) {
    const index = registrations.indexOf(record);
    if (index !== -1) registrations.splice(index, 1);
  }

  function addListener(source, method, event, listener) {
    if (disposed) throw new Error('骰子系统扩展已卸载，请刷新酒馆');
    if (typeof listener !== 'function') throw new TypeError('事件监听器必须是函数');
    const rawMethod = method === 'once' ? 'on' : method;
    const register = source[rawMethod];
    if (typeof register !== 'function') throw new Error(`酒馆事件源不支持 ${rawMethod}`);
    const record = { source, event, original: listener, listener };
    if (method === 'once') {
      record.listener = function (...args) {
        forget(record);
        removeRaw(source, event, record.listener);
        return listener.apply(this, args);
      };
    }
    // makeFirst/makeLast move an existing listener instead of registering it twice.
    if (method === 'makeFirst' || method === 'makeLast') {
      const previous = registrations.find(
        item => item.source === source && item.event === event && item.original === listener,
      );
      if (previous) forget(previous);
    }
    registrations.push(record);
    try {
      return register.call(source, event, record.listener);
    } catch (error) {
      forget(record);
      throw error;
    }
  }

  function removeListener(source, event, listener) {
    const record = registrations.find(
      item => item.source === source && item.event === event && (item.original === listener || item.listener === listener),
    );
    if (!record) return;
    forget(record);
    return removeRaw(source, event, record.listener);
  }

  function wrapEventSource(source) {
    if (!source || (typeof source !== 'object' && typeof source !== 'function')) return source;
    if (eventSources.has(source)) return eventSources.get(source);
    const methods = new Map();
    const proxy = new Proxy(source, {
      get(target, key) {
        if (['on', 'once', 'makeFirst', 'makeLast'].includes(key)) {
          if (!methods.has(key)) methods.set(key, (event, listener) => addListener(target, key, event, listener));
          return methods.get(key);
        }
        if (key === 'removeListener' || key === 'off') {
          if (!methods.has(key)) methods.set(key, (event, listener) => removeListener(target, event, listener));
          return methods.get(key);
        }
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        const cached = methods.get(key);
        if (!cached || cached.original !== value) {
          const bound = value.bind(target);
          methods.set(key, { original: value, bound });
        }
        return methods.get(key).bound;
      },
    });
    eventSources.set(source, proxy);
    return proxy;
  }

  function wrapContext(context) {
    if (!context || typeof context !== 'object') throw new Error('酒馆未提供有效的运行上下文');
    return new Proxy(context, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return key === 'eventSource' ? wrapEventSource(value) : value;
      },
    });
  }

  function wrapSillyTavern(real) {
    if (!real || typeof real.getContext !== 'function') return real;
    if (stFacades.has(real)) return stFacades.get(real);
    const getContext = () => wrapContext(real.getContext());
    const facade = new Proxy(real, {
      get(target, key) {
        if (key === 'getContext') return getContext;
        const context = getContext();
        if (key in context) return Reflect.get(context, key, context);
        return Reflect.get(target, key, target);
      },
      has(target, key) {
        return key in getContext() || key in target;
      },
    });
    stFacades.set(real, facade);
    return facade;
  }

  const eventOn = (event, listener) => {
    const source = wrapEventSource(currentContext().eventSource);
    if (!source) throw new Error('酒馆事件源尚未就绪');
    source.on(event, listener);
    return { stop: () => source.removeListener(event, listener) };
  };
  const eventOff = (event, listener) => {
    const source = wrapEventSource(currentContext().eventSource);
    if (!source) throw new Error('酒馆事件源尚未就绪');
    return source.removeListener(event, listener);
  };
  const eventEmit = (event, ...args) => {
    const source = wrapEventSource(currentContext().eventSource);
    if (!source || typeof source.emit !== 'function') throw new Error('酒馆事件源尚未就绪');
    return source.emit(event, ...args);
  };

  function wrapWindow(target) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return target;
    if (windowFacades.has(target)) return windowFacades.get(target);
    const nativeMethods = new Map();
    let proxy;
    function addWindowListener(type, listener, options) {
      if (disposed) throw new Error('骰子系统扩展已卸载，请刷新酒馆');
      if (!listener) return target.addEventListener(type, listener, options);
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const existing = windowRegistrations.find(
        item => item.target === target && item.type === type && item.original === listener && item.capture === capture,
      );
      if (existing) return;
      let forwarded = listener;
      if (type === 'unhandledrejection') {
        forwarded = function (event) {
          if (!originatesInDice('', event?.reason)) return;
          if (typeof listener === 'function') return listener.call(proxy, event);
          return listener.handleEvent(event);
        };
      }
      target.addEventListener(type, forwarded, options);
      windowRegistrations.push({ target, type, original: listener, forwarded, capture });
    }
    function removeWindowListener(type, listener, options) {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const index = windowRegistrations.findIndex(
        item => item.target === target && item.type === type && item.original === listener && item.capture === capture,
      );
      if (index !== -1) {
        const [record] = windowRegistrations.splice(index, 1);
        return target.removeEventListener(type, record.forwarded, capture);
      }
      return undefined;
    }
    proxy = new Proxy(target, {
      get(real, key) {
        if (key === 'console') return localConsole;
        if (key === 'onerror') return localOnError;
        if (key === 'addEventListener') return addWindowListener;
        if (key === 'removeEventListener') return removeWindowListener;
        if (key === 'SillyTavern') return wrapSillyTavern(Reflect.get(real, key, real) || host.SillyTavern);
        if (key === 'eventOn') return eventOn;
        if (key === 'eventOff') return eventOff;
        if (key === 'eventEmit') return eventEmit;
        if (key === 'tavern_events') return helper.tavern_events || currentContext().eventTypes;
        const value = Reflect.get(real, key, real);
        if (WINDOW_RELATIONS.has(key)) {
          if (value === real) return proxy;
          try {
            if (value?.document) return wrapWindow(value);
          } catch {
            // Preserve the browser's normal cross-origin access behavior.
          }
          return value;
        }
        if (WINDOW_METHODS.has(key) && typeof value === 'function') {
          let cached = nativeMethods.get(key);
          if (!cached || cached.original !== value) {
            cached = { original: value, bound: value.bind(real) };
            nativeMethods.set(key, cached);
          }
          return cached.bound;
        }
        return value;
      },
      set(real, key, value) {
        if (key !== 'onerror') return Reflect.set(real, key, value, real);
        localOnError = typeof value === 'function' ? value : null;
        if (!errorRelay) {
          errorRelay = event => {
            if (!localOnError || !originatesInDice(event?.filename, event?.error)) return;
            localOnError.call(proxy, event.message, event.filename, event.lineno, event.colno, event.error);
          };
          real.addEventListener('error', errorRelay);
          windowRegistrations.push({ target: real, type: 'error', forwarded: errorRelay, capture: false });
        }
        return true;
      },
    });
    windowFacades.set(target, proxy);
    return proxy;
  }

  const facade = wrapWindow(host);
  const scope = {
    window: facade,
    self: facade,
    globalThis: facade,
    console: localConsole,
    SillyTavern: wrapSillyTavern(host.SillyTavern),
    _: host._,
    toastr: host.toastr,
    eventOn,
    eventOff,
    eventEmit,
    tavern_events: helper.tavern_events || currentContext().eventTypes,
  };
  for (const name of HELPER_GLOBALS) {
    const value = helper[name];
    scope[name] = typeof value === 'function' ? value.bind(helper) : value;
  }
  const currentChatId = scope.SillyTavern?.getCurrentChatId;
  scope.getCurrentChatId = typeof currentChatId === 'function' ? currentChatId.bind(scope.SillyTavern) : undefined;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const record of registrations.splice(0)) {
      try {
        removeRaw(record.source, record.event, record.listener);
      } catch (error) {
        console.warn('[DICE extension] 移除事件监听失败:', error);
      }
    }
    for (const record of windowRegistrations.splice(0)) {
      try {
        record.target.removeEventListener(record.type, record.forwarded, record.capture);
      } catch (error) {
        console.warn('[DICE extension] 移除窗口监听失败:', error);
      }
    }
  };
  // Let the original bundle's pagehide handlers run before releasing its listeners.
  host.addEventListener('pagehide', () => queueMicrotask(dispose), { once: true });
  return { scope, dispose };
}
