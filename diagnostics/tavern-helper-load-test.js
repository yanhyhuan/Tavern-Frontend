(async () => {
  const version = 'V1.0.1';
  const stateKey = Symbol.for('acu.dice.compat.extension');
  const host = window.top;
  const report = (type, text) => {
    console[type === 'error' ? 'error' : 'info']('[骰子兼容扩展加载测试]', text);
    try {
      host?.toastr?.[type]?.(text, '骰子兼容扩展加载测试', { timeOut: type === 'error' ? 0 : 8000 });
    } catch (error) {
      console.error('[骰子兼容扩展加载测试] 无法显示提示:', error);
    }
  };

  try {
    if (!host?.document || !host.location) throw new Error('无法访问酒馆宿主页面');
    if (!host[stateKey]) {
      // A module script owned by the host document executes in the host realm,
      // rather than importing the frontend into the helper iframe's realm.
      const src = new URL('/scripts/extensions/third-party/Tavern-Frontend/index.js', host.location.href).href;
      await new Promise((resolve, reject) => {
        const element = host.document.createElement('script');
        const timer = host.setTimeout(() => {
          element.remove();
          reject(new Error('加载本地扩展入口超时'));
        }, 15_000);
        element.type = 'module';
        element.src = src;
        element.onload = () => { host.clearTimeout(timer); resolve(); };
        element.onerror = () => {
          host.clearTimeout(timer);
          element.remove();
          reject(new Error('加载本地扩展入口失败，请检查 Tavern-Frontend 文件夹'));
        };
        host.document.head.appendChild(element);
      });
    }

    const state = host[stateKey];
    if (!state?.promise) throw new Error('扩展没有报告启动状态');
    let timer;
    try {
      await Promise.race([
        state.promise,
        new Promise((_, reject) => { timer = host.setTimeout(() => reject(new Error('等待扩展启动超时')), 70_000); }),
      ]);
    } finally {
      host.clearTimeout(timer);
    }
    if (state.version !== version || state.status !== 'running' || !host.AcuDice) {
      throw new Error(`扩展状态不匹配：${state.version || '未知版本'} / ${state.status || '未知状态'}`);
    }
    const db = host.AutoCardUpdaterAPI;
    if (!db || ['updateCell', 'insertRow', 'deleteRow'].some(name => typeof db[name] !== 'function')) {
      throw new Error('扩展已加载，但数据库公开 CRUD API 尚未就绪');
    }
    report('success', `${version} 已加载。扩展可能按当前规则自动处理聊天，请在合成聊天验证持久化和重开结果。`);
  } catch (error) {
    report('error', error instanceof Error ? error.message : String(error));
  }
})();
