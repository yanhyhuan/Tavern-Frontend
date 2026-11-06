(async () => {
  const version = 'V1.0.1';
  const stateKey = Symbol.for('acu.dice.compat.extension');
  const host = window.top;
  const message = (type, text) => {
    console[type === 'error' ? 'error' : 'info']('[骰子兼容扩展测试]', text);
    try {
      host?.toastr?.[type]?.(text, '骰子兼容扩展测试', { timeOut: type === 'error' ? 0 : 8000 });
    } catch (error) {
      console.error('[骰子兼容扩展测试] 无法显示提示:', error);
    }
  };

  try {
    if (!host?.document || !host.location) throw new Error('无法访问酒馆宿主页面');
    if (!host[stateKey]) {
      throw new Error('扩展尚未启动，请安装 Tavern-Frontend 扩展、启用并刷新酒馆');
    }

    const state = host[stateKey];
    if (!state?.promise) throw new Error('扩展没有报告启动状态');
    let timer;
    try {
      await Promise.race([
        state.promise,
        new Promise((_, reject) => {
          timer = host.setTimeout(() => reject(new Error('等待扩展启动超时')), 70_000);
        }),
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
    message('success', `${version} 已加载，数据库 CRUD API 已就绪。持久化和重开聊天仍需按说明手动验证。`);
  } catch (error) {
    message('error', error instanceof Error ? error.message : String(error));
  }
})();
