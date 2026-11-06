// Playwright CLI run-code entry; open the local extension-browser-server first.
// All tables and host APIs here are synthetic. This is not real-host acceptance.
async page => {
  const origin = new URL(page.url()).origin;
  const selected = new URL(page.url()).searchParams.get('case') || 'all';
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, fn) => {
    try { results.push({ name, ok: true, detail: await fn() }); }
    catch (error) { results.push({ name, ok: false, error: String(error?.stack || error) }); }
  };
  const reset = async (query, settings = {}) => {
    await page.goto(`${origin}/?mode=manual`, { waitUntil: 'networkidle' });
    await page.evaluate(values => {
      localStorage.clear();
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
    }, settings);
    await page.goto(`${origin}/?${query}`, { waitUntil: 'networkidle' });
  };
  const waitState = status => page.waitForFunction(expected =>
    window[Symbol.for('acu.dice.compat.extension')]?.status === expected, status, { timeout: 15_000 });
  const closeTour = async () => {
    const button = page.getByRole('button', { name: '关闭教程' });
    if (await button.isVisible().catch(() => false)) await button.click();
  };
  const fixtureState = () => page.evaluate(() => {
    const fixture = window.__smoke.fixture;
    return { initial: fixture.initial, tables: fixture.snapshot(), history: fixture.replay(), calls: fixture.calls, toasts: window.__smoke.toasts };
  });
  const roleValue = data => {
    const sheet = Object.values(data).find(item => item?.name === '重要角色表');
    return sheet?.content?.[1]?.[sheet.content[0].indexOf('人际关系')];
  };
  const regexSettings = {
    acu_regex_rules_v1: [{
      id: 'synthetic-normalize-relations',
      name: '合成人际关系标点',
      operation: 'replace',
      pattern: '\\s*([:;])\\s*',
      flags: { global: true },
      replacement: '$1',
      scope: { type: 'column', tableNames: ['重要角色表'], columnNames: ['人际关系'] },
      enabled: true,
      priority: 50,
      executeMode: 'auto',
    }],
  };
  const effectSettings = {
    acu_active_advanced_preset: 'synthetic-effect',
    acu_advanced_presets_v1: [{
      kind: 'advanced', id: 'synthetic-effect', name: '合成效果', version: '99.0.0', builtin: false, visible: true,
      diceExpression: '1d1', attribute: { label: '属性值', defaultValue: 50 },
      dc: { defaultValue: 0, hidden: true }, mod: { defaultValue: 0, hidden: true },
      effectsConfig: { triggerPatterns: ['力量'], allowedTargets: ['力量'] },
      resourceBurners: [{ id: 'synthetic-burn', resourceName: '力量', target: 'roll', ratio: 1,
        direction: 'decrease', ui: { tooltip: '合成燃运' } }],
      outcomes: [{ id: 'success', name: '成功', condition: '$roll.total >= 1', priority: 1,
        effects: [{ id: 'synthetic-add', target: '力量', operation: 'add', value: '3', needsConfirm: false }] }],
      outputTemplate: '<meta:检定结果>\n$initiator $attrName $outcomeName\n</meta:检定结果>',
    }],
  };

  if (selected === 'all' || selected === 'lifecycle') {
    await test('正常启动、重复加载和桥接隔离', async () => {
      await reset('mode=normal');
      await waitState('running');
      const probe = await page.evaluate(async () => (await import('/probes.js')).run());
      assert(probe.identity && probe.propertyForwarded && probe.fetchStatus === 200, '桥接窗口或 fetch 不正确');
      assert(probe.hostOnerrorPreserved && probe.consoleIsolated && probe.ownedRemoved, '宿主监听或日志受到影响');
      assert(probe.samePromise && probe.state === 'running' && probe.rootCount === 1 && probe.api, '重复启动或入口状态不正确');
      return { version: probe.version, roots: probe.rootCount };
    });
    for (const [mode, expected] of [['original', '原骰子脚本'], ['missing-helper', 'builtin.renderMarkdown']]) {
      await test(`启动失败明确提示：${mode}`, async () => {
        await reset(`mode=${mode}`);
        await waitState('failed');
        const observed = await page.evaluate(() => ({
          state: window[Symbol.for('acu.dice.compat.extension')], toasts: window.__smoke.toasts,
        }));
        assert(observed.state.error.includes(expected), `错误信息不含 ${expected}`);
        assert(observed.toasts.some(toast => toast.type === 'error'), '未显示错误提示');
        return { error: observed.state.error };
      });
    }
    await test('酒馆助手 iframe 加载入口', async () => {
      await reset('mode=manual');
      const result = await page.evaluate(async () => (await import('/probes.js')).loadFromIframe());
      assert(result.state === 'running' && result.loaderInHostDocument && result.nodeInHostRealm, '未在宿主页面正确加载');
      assert(result.rootCount === 1 && result.successToast && result.hostSTPreserved && result.hostConsolePreserved, '实例数量或宿主状态异常');
      return { version: result.version, roots: result.rootCount };
    });
  }

  if (selected === 'all' || selected === 'templates') {
    for (const [variant, expectedCount, presetId] of [
      ['default8', 8, '__builtin_table_template_dice_v42__'],
      ['v45', 12, '__builtin_table_template_dice_v45__'],
    ]) {
      await test(`重复检查 ${variant}`, async () => {
        await reset(`fixture=${variant}`, { acu_active_table_template_requirement_preset_v1: presetId });
        await waitState('running');
        await page.getByRole('button', { name: '全能设置' }).waitFor();
        await closeTour();
        const before = await fixtureState();
        const sheets = Object.entries(before.initial).filter(([, sheet]) => sheet?.name);
        assert(sheets.length === expectedCount && sheets.every(([key, sheet]) => sheet.uid === key), '表数量、key 或 uid 不正确');
        await page.getByRole('button', { name: '全能设置' }).click();
        await page.getByText('高级设置', { exact: true }).click();
        for (let iteration = 0; iteration < 2; iteration += 1) {
          await page.getByRole('button', { name: '检验', exact: true }).click();
          await page.getByText('模板关键结构完整', { exact: true }).waitFor({ timeout: 10_000 });
          assert((await page.locator('#template-inspection-repair').count()) === 0, '完整模板仍生成新增表候选');
          await page.getByRole('button', { name: '关闭检验表格模板结果' }).click();
        }
        const downloads = [];
        if (variant === 'default8') {
          const selector = page.getByRole('combobox', { name: '选择内置表格模板' });
          const choices = await selector.locator('option').allTextContents();
          assert(choices.length === 2 && choices.some(text => text.includes('1.3.6')) && choices.some(text => text.includes('v4.5')), '运行模板选项不正确');
          assert(choices.every(text => !text.includes('v4.3')), '旧模板仍在运行菜单');
          for (let index = 0; index < choices.length; index += 1) {
            await selector.selectOption({ index });
            const promise = page.waitForEvent('download');
            await page.getByRole('button', { name: '下载', exact: true }).click();
            const download = await promise;
            downloads.push({ choice: choices[index], name: download.suggestedFilename(), path: await download.path() });
          }
        }
        const after = await fixtureState();
        assert(JSON.stringify(after.tables) === JSON.stringify(before.initial), '检查或下载改变了原有表');
        assert(after.calls.length === 0, '检查或下载调用了写入 API');
        return { sheets: expectedCount, checks: 2, writes: 0, downloads };
      });
    }
  }

  if (selected === 'all' || selected === 'regex') {
    await test('正则转换公开 CRUD、回读和合成切回', async () => {
      await reset('fixture=v45&regex=1', regexSettings);
      await waitState('running');
      await page.waitForFunction(() => {
        const fixture = window.__smoke.fixture;
        const sheet = Object.values(fixture.snapshot()).find(item => item?.name === '重要角色表');
        const column = sheet.content[0].indexOf('人际关系');
        return sheet.content[1][column] === '合成主角:旧识;合成角色乙:同事' && fixture.calls.some(call => call.method === 'updateCell');
      }, null, { timeout: 15_000 });
      const observed = await fixtureState();
      const expected = structuredClone(observed.initial);
      const role = Object.values(expected).find(sheet => sheet?.name === '重要角色表');
      role.content[1][role.content[0].indexOf('人际关系')] = '合成主角:旧识;合成角色乙:同事';
      assert(JSON.stringify(observed.tables) === JSON.stringify(expected), '转换改变了其他数据');
      assert(JSON.stringify(observed.history) === JSON.stringify(expected), '合成历史回放不一致');
      assert(observed.calls.filter(call => call.method === 'updateCell').length === 1, '并非恰好更新一个单元格');
      assert(observed.calls.every(call => call.method === 'updateCell'), '调用了不应使用的写入接口');
      await page.evaluate(async () => {
        await window.__smoke.fixture.switchChat('synthetic-other');
        await window.__smoke.fixture.switchChat('synthetic-chat');
      });
      const reopened = await fixtureState();
      assert(JSON.stringify(reopened.tables) === JSON.stringify(expected) && JSON.stringify(reopened.history) === JSON.stringify(expected), '合成切回后读取不一致');
      return { updatedCells: 1, rowId: role.content[1][0], reopened: true };
    });
    for (const mode of ['fail', 'lock']) {
      await test(`正则保存失败提示：${mode}`, async () => {
        await reset(`fixture=v45&regex=1&${mode}=1`, regexSettings);
        await waitState('running');
        await page.waitForFunction(() => window.__smoke.toasts.some(toast => toast.type === 'error'), null, { timeout: 15_000 });
        const observed = await fixtureState();
        assert(JSON.stringify(observed.tables) === JSON.stringify(observed.initial), '失败或锁定后表格被修改');
        assert(!observed.toasts.some(toast => toast.type === 'success'), '失败后出现成功提示');
        return { writesAttempted: observed.calls.length, error: observed.toasts.find(toast => toast.type === 'error')?.args?.[0] };
      });
    }
  }

  if (selected === 'chat-switch') {
    await test('在途 API 调用切换聊天时不跨聊天写入', async () => {
      await reset('fixture=v45&regex=1&delay=2500', regexSettings);
      await waitState('running');
      await page.waitForFunction(() => window.__smoke.fixture.calls.some(call => call.method === 'updateCell'), null, { timeout: 15_000 });
      await page.evaluate(async () => { await window.__smoke.fixture.switchChat('synthetic-other'); });
      const before = roleValue((await fixtureState()).tables);
      await page.waitForTimeout(3000);
      const after = await fixtureState();
      const errors = after.toasts.filter(toast => toast.type === 'error').map(toast => String(toast.args[0]));
      assert(errors.some(error => error.includes('切换')), '切换后未明确报告保存失败');
      assert(!after.toasts.some(toast => toast.type === 'success'), '切换后出现成功提示');
      assert(before === roleValue(after.tables), `在途 API 跨聊天写入：${before} → ${roleValue(after.tables)}`);
      return { before, after: roleValue(after.tables), otherChatChanged: false, errors };
    });
  }

  if (selected === 'all' || selected === 'effects') {
    await test('默认表属性生成和自动效果单次提交', async () => {
      await reset('fixture=default8', effectSettings);
      await waitState('running');
      await page.waitForFunction(() => (window.__smoke.listeners.get('message_sent')?.length || 0) >= 3, null, { timeout: 10_000 });
      await page.getByRole('button', { name: '掷骰', exact: true }).waitFor();
      await closeTour();
      await page.getByRole('button', { name: '掷骰', exact: true }).click();
      await page.getByRole('button', { name: '合成主角', exact: true }).click();
      await page.getByRole('button', { name: '为当前角色生成属性' }).click();
      await page.locator('.acu-dice-attr-btn[data-name="力量"]').waitFor({ timeout: 10_000 });
      const strength = () => page.evaluate(() => {
        const key = Object.keys(localStorage).find(item => item.startsWith('acu_chat_attributes_v1:'));
        return key ? JSON.parse(localStorage.getItem(key)).characters[0].attributes.find(item => item.name === '力量')?.value : null;
      });
      const before = await strength();
      assert(Number.isFinite(before), '生成的力量未写入本机属性');
      const backup = await page.evaluate(() => window.AcuDice.exportChatAttributes());
      const initialTables = await fixtureState();
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.__smoke.attributeWrites = 0;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('acu_chat_attributes_v1:')) window.__smoke.attributeWrites += 1;
          return original.call(this, key, value);
        };
      });
      await page.locator('.acu-dice-attr-btn[data-name="力量"]').click();
      await page.getByRole('button', { name: '掷骰！' }).click();
      await page.waitForFunction(() => document.querySelector('#send_textarea')?.value.includes('<meta:检定结果>'));
      assert(await strength() === before, '发送前效果提前执行');
      const messageId = await page.evaluate(() => window.__smoke.fixture.sendUserMessage(document.querySelector('#send_textarea').value));
      await page.waitForFunction(expected => {
        const key = Object.keys(localStorage).find(item => item.startsWith('acu_chat_attributes_v1:'));
        return key && JSON.parse(localStorage.getItem(key)).characters[0].attributes.find(item => item.name === '力量')?.value === expected;
      }, before + 3, { timeout: 10_000 });
      await page.evaluate(id => window.__smoke.context.eventSource.emit(window.__smoke.context.eventTypes.MESSAGE_SENT, id), messageId);
      assert(await strength() === before + 3, '同一消息重复执行效果');
      const after = await fixtureState();
      const writes = await page.evaluate(() => window.__smoke.attributeWrites);
      assert(writes === 1, `本机属性提交次数为 ${writes}`);
      assert(JSON.stringify(after.tables) === JSON.stringify(initialTables.initial) && after.calls.length === 0, '属性生成或效果更改了数据库表');
      const priorRunId = await page.evaluate(() => window.AcuDice.getLatestCheck().effectRunId);
      await page.locator('.acu-dice-attr-btn[data-name="力量"]').click();
      await page.getByRole('button', { name: '重新投骰', exact: true }).click();
      await page.waitForFunction(previous => {
        const latest = window.AcuDice.getLatestCheck();
        return latest?.effectRunId && latest.effectRunId !== previous && latest.effectStatus === 'confirmed';
      }, priorRunId);
      await page.evaluate(async () => {
        const text = document.querySelector('#send_textarea').value;
        await window.__smoke.fixture.switchChat('synthetic-other');
        await window.__smoke.fixture.sendUserMessage(text);
      });
      const mismatch = await page.evaluate(value => {
        try { window.AcuDice.importChatAttributes(value); return ''; } catch (error) { return String(error.message); }
      }, backup);
      assert(mismatch.includes('不一致'), '其他聊天导入了原聊天的属性备份');
      assert(await page.evaluate(() => window.__smoke.attributeWrites) === 1, '切换聊天后仍执行待提交效果');
      await page.evaluate(() => window.__smoke.fixture.switchChat('synthetic-chat'));
      assert(await strength() === before + 3, '切回后属性未保留');
      await page.evaluate(value => window.AcuDice.importChatAttributes(value), backup);
      assert(await strength() === before, '同一聊天备份未恢复原值');
      assert(await page.evaluate(() => window.__smoke.attributeWrites) === 2, '备份恢复提交次数异常');
      return { before, after: before + 3, writes, rowId: '201', switchCancelled: true, backupRestored: true };
    });
  }

  if (selected === 'all' || selected === 'attributes') {
    await test('默认表独立属性重载后在仪表盘、人物预览和表格卡片一致', async () => {
      await reset('fixture=default8');
      await waitState('running');
      await page.getByRole('button', { name: '仪表盘', exact: true }).waitFor();
      await closeTour();
      await page.getByRole('button', { name: '仪表盘', exact: true }).click();
      await page.getByRole('button', { name: '掷骰', exact: true }).click();
      await page.getByRole('button', { name: '合成主角', exact: true }).click();
      await page.getByRole('button', { name: '为当前角色生成属性' }).click();
      await page.waitForFunction(() => Number.isFinite(window.AcuDice.getAttributeValue('<user>', '力量')));
      await page.locator('.acu-dice-char-btn[data-char="合成角色甲"]').click();
      await page.getByRole('button', { name: '为当前角色生成属性' }).click();
      await page.waitForFunction(() => Number.isFinite(window.AcuDice.getAttributeValue('合成角色甲', '力量')));
      const expected = await page.evaluate(() => ({
        player: window.AcuDice.getAttributeValue('<user>', '力量'),
        npc: window.AcuDice.getAttributeValue('合成角色甲', '力量'),
      }));
      await page.reload({ waitUntil: 'networkidle' });
      await waitState('running');
      await page.locator('.acu-dash-dice-btn[data-name="力量"]').waitFor();
      const dashboard = Number(await page.locator('.acu-dash-dice-btn[data-name="力量"]').getAttribute('data-target'));
      assert(dashboard === expected.player, `主角仪表盘值 ${dashboard} 与独立属性 ${expected.player} 不同`);
      await page.getByTitle('合成角色甲', { exact: true }).click();
      const preview = page.locator('.acu-chat-attributes .acu-inline-dice-btn[data-attr-name="力量"]');
      const previewValue = Number(await preview.getAttribute('data-attr-value'));
      assert(previewValue === expected.npc, `人物预览值 ${previewValue} 与独立属性 ${expected.npc} 不同`);
      await page.getByRole('button', { name: '关闭卡片预览' }).click();
      await page.getByRole('button', { name: '打开重要角色表' }).click();
      const npcCard = page.locator('.acu-data-card').filter({ has: page.locator('.acu-editable-title').getByText('合成角色甲', { exact: true }) });
      const cardValue = Number(await npcCard.locator('.acu-chat-attributes .acu-inline-dice-btn[data-attr-name="力量"]').getAttribute('data-attr-value'));
      assert(cardValue === expected.npc, `人物卡片值 ${cardValue} 与独立属性 ${expected.npc} 不同`);
      const otherCard = page.locator('.acu-data-card').filter({ has: page.locator('.acu-editable-title').getByText('合成角色乙', { exact: true }) });
      assert(await otherCard.locator('.acu-chat-attributes').count() === 0, '另一个角色显示了不属于其自身的属性');
      const observed = await fixtureState();
      assert(JSON.stringify(observed.tables) === JSON.stringify(observed.initial) && observed.calls.length === 0, '独立属性显示修改了数据库表');
      return { player: expected.player, npc: expected.npc, databaseWrites: 0, reloaded: true };
    });

    await test('v4.5 原属性列继续显示', async () => {
      await reset('fixture=v45');
      await waitState('running');
      await page.getByRole('button', { name: '仪表盘', exact: true }).waitFor();
      await closeTour();
      await page.getByRole('button', { name: '仪表盘', exact: true }).click();
      const dashboard = page.locator('.acu-dash-dice-btn[data-name="观察"]');
      await dashboard.waitFor();
      assert(Number(await dashboard.getAttribute('data-target')) === 50, 'v4.5 主角属性列未显示原值');
      await page.getByTitle('合成角色甲', { exact: true }).click();
      const preview = page.locator('.acu-inline-dice-btn[data-attr-name="观察"]');
      assert(Number(await preview.getAttribute('data-attr-value')) === 40, 'v4.5 角色预览未显示原属性列');
      assert(await page.locator('.acu-chat-attributes').count() === 0, 'v4.5 原属性列被重复显示为独立属性');
      const observed = await fixtureState();
      assert(JSON.stringify(observed.tables) === JSON.stringify(observed.initial) && observed.calls.length === 0, '读取 v4.5 原属性列修改了数据库表');
      return { player: 50, npc: 40, databaseWrites: 0 };
    });
  }

  if (selected === 'all' || selected === 'map') {
    await test('默认表地点生成只读地图概览', async () => {
      await reset('fixture=default8');
      await waitState('running');
      await page.getByRole('button', { name: '仪表盘', exact: true }).waitFor();
      await closeTour();
      await page.getByRole('button', { name: '仪表盘', exact: true }).click();
      await page.getByTitle('地图可视化').click();
      await page.getByRole('button', { name: '查看地点：中央车站' }).waitFor();
      await page.getByRole('button', { name: '其他', exact: true }).click();
      await page.getByRole('button', { name: '查看地点：图书馆' }).waitFor();
      const observed = await fixtureState();
      assert(JSON.stringify(observed.tables) === JSON.stringify(observed.initial) && observed.calls.length === 0, '查看地图改变了数据库表');
      return { locations: ['中央车站', '图书馆'], writes: 0 };
    });
  }

  if (selected === 'all' || selected === 'burner') {
    await test('默认表燃运使用独立属性', async () => {
      await reset('fixture=default8', effectSettings);
      await waitState('running');
      await page.getByRole('button', { name: '掷骰', exact: true }).waitFor();
      await closeTour();
      await page.getByRole('button', { name: '掷骰', exact: true }).click();
      await page.getByRole('button', { name: '合成主角', exact: true }).click();
      await page.getByRole('button', { name: '为当前角色生成属性' }).click();
      await page.locator('.acu-dice-attr-btn[data-name="力量"]').waitFor({ timeout: 10_000 });
      const before = await page.evaluate(() => window.AcuDice.getAttributeValue('<user>', '力量'));
      assert(Number.isFinite(before) && before >= 2, '生成的力量不足以执行合成燃运');
      await page.locator('.acu-dice-attr-btn[data-name="力量"]').click();
      await page.getByRole('button', { name: '掷骰！' }).click();
      await page.getByTitle('合成燃运').click();
      await page.locator('#burner-amount').fill('2');
      await page.locator('#burner-confirm').click();
      await page.waitForFunction(expected => window.AcuDice.getAttributeValue('<user>', '力量') === expected, before - 2);
      const observed = await fixtureState();
      assert(JSON.stringify(observed.tables) === JSON.stringify(observed.initial) && observed.calls.length === 0, '燃运改变了数据库表');
      return { before, after: before - 2, databaseWrites: 0 };
    });
  }

  if (selected === 'all' || selected === 'shop') {
    await test('默认背包商城单抽保存和回读', async () => {
      await reset('fixture=default8', { acu_gacha_state_v1: { wallet: { fortune: 1000, shards: {} } } });
      await waitState('running');
      await page.getByRole('button', { name: '仪表盘', exact: true }).waitFor();
      await closeTour();
      await page.getByRole('button', { name: '仪表盘', exact: true }).click();
      await page.getByTitle('骰子商店', { exact: true }).click();
      await page.locator('.acu-gacha-overlay').waitFor();
      await page.waitForTimeout(250);
      assert(await page.locator('.acu-gacha-overlay').count() === 1, '单击商城入口打开了多个弹窗');
      await page.locator('.acu-gacha-draw-single').click();
      await page.waitForFunction(() => window.__smoke.fixture.calls.some(call => call.method === 'insertRow') ||
        window.__smoke.toasts.some(toast => toast.type === 'error'), null, { timeout: 15_000 });
      await page.waitForTimeout(500);
      const observed = await fixtureState();
      const errors = observed.toasts.filter(toast => toast.type === 'error').map(toast => toast.args[0]);
      assert(errors.length === 0, `商城保存失败：${errors.join('；')}`);
      const [inventoryKey, inventory] = Object.entries(observed.tables).find(([, sheet]) => sheet?.name === '背包物品表');
      const original = observed.initial[inventoryKey];
      assert(inventory.content.length === original.content.length + 1, '单抽未新增恰好一条物品');
      assert(JSON.stringify(inventory.content.slice(0, -1)) === JSON.stringify(original.content), '单抽修改了已有背包行');
      for (const key of Object.keys(observed.initial)) {
        if (key !== inventoryKey) assert(JSON.stringify(observed.tables[key]) === JSON.stringify(observed.initial[key]), `单抽改变了 ${key}`);
      }
      assert(JSON.stringify(observed.history) === JSON.stringify(observed.tables), '商城合成历史回读不一致');
      await page.evaluate(async () => {
        await window.__smoke.fixture.switchChat('synthetic-other');
        await window.__smoke.fixture.switchChat('synthetic-chat');
      });
      const reopened = await fixtureState();
      assert(JSON.stringify(reopened.tables) === JSON.stringify(observed.tables), '单抽物品在合成切回后丢失');
      return { newRowId: inventory.content.at(-1)[0], apiCalls: observed.calls.map(call => call.method), reopened: true };
    });
  }

  return { selected, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, results };
}
