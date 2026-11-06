const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const file = path.join(root, 'src/骰子系统/index.ts');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !declarations.has(node.name.text)) {
    declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(ast)};`);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const helperPath = path.join(root, 'src/骰子系统/crud-write-guard.ts');
const helper = new Module(helperPath, module);
helper._compile(ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, helperPath);

const names = [
  'readRuntimeTableData', 'hasRuntimeTableReadApi', 'assertRuntimeCrudApi', 'getSheetRows', 'getSheetHeaders',
  'sameRow', 'sameHeaders', 'getCrudChangedColumns', 'applyExistingRowCellPatchesViaCrud',
  'findDeletionIndicesForCrud', 'assertAppendOnlyRows', 'findRuntimeSheetEntryForCrud',
  'applySheetDataViaCrud', 'applyRuntimeDataViaCrud', 'runInSaveQueue', 'saveRegexTransformViaCrud',
  'normalizeSheetKeys', 'getStableRowKeyForCrud', 'RegexTransformationEngine', 'verifyRuntimeCrudPersistence',
  'getLiveCrudSheet', 'getCrudTableIdentifier', 'getCrudRowIndexById',
];
const extracted = names.map(name => {
  assert.ok(declarations.has(name), `Production function missing: ${name}`);
  return declarations.get(name);
}).join('\n');

function fixture() {
  return {
    mate: { type: 'chatSheets', version: 1 },
    sheet_jue_se: { uid: 'sheet_jue_se', name: '重要角色表', sourceData: { ddl: 'CREATE TABLE jue_se (row_id TEXT PRIMARY KEY, name TEXT, state TEXT);' },
      content: [['row_id', '姓名', '状态'], ['stable-17', '合成人物甲', '旧值'], ['stable-88', '合成人物乙', '不变']] },
    sheet_other: { uid: 'sheet_other', name: '其他表', content: [['row_id', '值'], ['other-1', '保留']], sourceData: { ddl: 'unchanged' } },
  };
}

function harness(options = {}) {
  let runtime = fixture();
  let persisted = clone(runtime);
  const calls = [];
  const logs = [];
  const stats = { replays: 0, hostVerifications: 0 };
  const context = { version: 1, chatId: 'synthetic-chat-A', characterId: 3, groupId: null, isolationKey: '' };
  const api = {
    getTableHistoryContext: () => ({ ...context }),
    exportTableAsJson: () => runtime,
    exportTableSnapshotsAtMessages: async indices => {
      stats.replays++;
      return options.historyFailure
        ? { success: false, error: '模拟历史回放失败' }
        : { success: true, snapshots: indices.map(messageIndex => ({ messageIndex, data: clone(runtime) })) };
    },
    _notifyTableUpdate: () => {},
    updateCell: async payload => {
      calls.push(clone(payload));
      if (options.beforeWrite) await options.beforeWrite({ payload, context, calls, api, runtime });
      if (options.rejectAt === calls.length) return false;
      if (options.throwAt === calls.length) throw new Error('模拟宿主保存失败');
      if (options.locked) return false;
      const sheet = Object.values(runtime).find(value => value.name === payload.tableName);
      const column = sheet.content[0].indexOf(payload.colIdentifier);
      assert.ok(column > 0);
      assert.equal(payload.expectedRowId, undefined, 'Use only original 1.3.6 parameters');
      assert.equal(payload.expectedValue, undefined, 'Use only original 1.3.6 parameters');
      assert.equal(payload.skipChatSave, undefined, 'Must persist through database');
      assert.equal(payload.skipNotify, true);
      if (!options.fakeSuccess) {
        sheet.content[payload.rowIndex][column] = payload.value;
        if (!options.noHostSave) persisted = clone(runtime);
      }
      if (options.afterWrite) await options.afterWrite({ payload, context, calls, api, runtime });
      return options.undefinedResult ? undefined : true;
    },
    insertRow: () => { throw new Error('Regex must never insert rows'); },
    deleteRow: () => { throw new Error('Regex must never delete rows'); },
  };
  const noOp = () => {};
  const sandbox = {
    ...helper.exports, api,
    console: Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level =>
      [level, (...args) => logs.push({ level, args })])),
    getCore: () => ({ getDB: () => api, hostWindow: { fetch: () => {} }, ST: { getContext: () => ({ ...context, chat: [{ mes: '合成测试消息' }] }) } }),
    getCurrentContextFingerprint: () => JSON.stringify(context),
    cloneRuntimeDataValue: clone,
    // Host request/response behavior is exercised separately by host-persistence.test.cjs.
    verifyHostChatPersistence: async ({ assertCurrent, getHostContext, verifyReplay }) => {
      stats.hostVerifications++;
      assertCurrent();
      getHostContext();
      await verifyReplay?.();
      if (JSON.stringify(runtime) !== JSON.stringify(persisted)) throw new Error('宿主持久化尚未确认');
      await options.afterHostVerification?.({ runtime, persisted, context, api });
      assertCurrent();
    },
    getRuntimeErrorMessage: error => error.message || String(error), getRuntimeErrorLogPayload: error => ({ message: error.message }),
    normalizeDiffText: value => String(value ?? '').trim(), buildCrudColumnAliasMap: () => ({}),
    assertCrudRequiredColumnsRepresented: noOp, assertCrudRequiredCellValues: noOp,
    assertCrudEnumConstraints: noOp, assertCrudLengthConstraints: noOp, assertCrudInsertRequiredCells: noOp,
    getCrudCellValueForWrite: (_headers, row, index) => row[index] ?? '',
    sanitizeRuntimeTableData: () => { throw new Error('Regex must bypass inventory metadata synchronization'); },
    findDiffSnapshotEntry: (data, key, desired) => data?.[key] ? { key, sheet: data[key] } : null,
  };
  vm.createContext(sandbox);
  const prelude = 'let databaseWriteEpoch = 0; let saveQueue = Promise.resolve(); let cachedRawData = null;';
  const tail = `globalThis.runSave = saveRegexTransformViaCrud;
    globalThis.findCrudRowIndex = getCrudRowIndexById;
    globalThis.transform = (data, rules) => RegexTransformationEngine.applyToTable(data, rules);
    globalThis.bumpEpoch = () => { databaseWriteEpoch += 1; };
    globalThis.getCache = () => cachedRawData;
    globalThis.blockQueue = p => { saveQueue = p; };`;
  vm.runInContext(ts.transpileModule(`${prelude}\n${extracted}\n${tail}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, sandbox);
  return { api, context, calls, logs, stats, sandbox, before: () => clone(runtime), mutate: callback => callback(runtime),
    reopen: () => { runtime = clone(persisted); return clone(runtime); }, disk: () => clone(persisted) };
}

test('regex saves only changed cells via public CRUD; simulated persisted reload retains stable identity and other tables', async () => {
  const h = harness();
  const before = h.before();
  const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  const result = await h.sandbox.runSave(before, desired, ['sheet_jue_se']);
  assert.equal(result.sheet_jue_se.content[1][2], '新值');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].rowIndex, 1);
  assert.equal(h.calls[0].colIdentifier, '状态');
  assert.equal(h.calls[0].expectedRowId, undefined);
  const reopened = h.reopen();
  assert.equal(reopened.sheet_jue_se.content[1][0], 'stable-17');
  assert.equal(reopened.sheet_jue_se.content[1][2], '新值');
  assert.deepEqual(reopened.sheet_other, before.sheet_other);
  assert.deepEqual(reopened.sheet_jue_se.content[2], before.sheet_jue_se.content[2]);
  assert.deepEqual(reopened.sheet_jue_se.sourceData, before.sheet_jue_se.sourceData);
  await h.sandbox.runSave(before, desired, ['sheet_jue_se']);
  assert.equal(h.calls.length, 1, 'Repeat must not write already persisted cells');
  assert.deepEqual(before, fixture(), 'Do not mutate baseline or API read reference');
});

test('pending unrelated edits and row reorder are preserved by row_id', async () => {
  const h = harness();
  const before = h.before();
  const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  h.mutate(data => {
    data.sheet_jue_se.content[1][1] = '同时编辑的名字';
    [data.sheet_jue_se.content[1], data.sheet_jue_se.content[2]] = [data.sheet_jue_se.content[2], data.sheet_jue_se.content[1]];
  });
  await h.sandbox.runSave(before, desired, ['sheet_jue_se']);
  assert.equal(h.calls[0].rowIndex, 2);
  assert.equal(h.disk().sheet_jue_se.content[2][1], '同时编辑的名字');
});

test('CRUD uses unique display name even if its physical name is another table display name', async () => {
  const h = harness();
  h.mutate(data => { data.sheet_other.name = 'jue_se'; });
  const before=h.before(), desired=clone(before);
  desired.sheet_jue_se.content[1][2]='新值';
  await h.sandbox.runSave(before,desired,['sheet_jue_se']);
  assert.equal(h.calls[0].tableName,'重要角色表');
  assert.deepEqual(h.disk().sheet_other,before.sheet_other);
});

test('row operations resolve stable row_id after reorder and reject missing or duplicate identity', () => {
  const h=harness(), sheet=h.before().sheet_jue_se;
  [sheet.content[1],sheet.content[2]]=[sheet.content[2],sheet.content[1]];
  assert.equal(h.sandbox.findCrudRowIndex(sheet,'stable-17'),2);
  assert.throws(()=>h.sandbox.findCrudRowIndex(sheet,''),/row_id/);
  assert.throws(()=>h.sandbox.findCrudRowIndex(sheet,'missing'),/row_id/);
  sheet.content[1][0]='stable-17';
  assert.throws(()=>h.sandbox.findCrudRowIndex(sheet,'stable-17'),/row_id/);
});

test('duplicate display names or key/uid/DDL changes between cells stop subsequent calls', async () => {
  for (const change of [
    data => { data.sheet_jue_se.uid='changed'; },
    data => { data.sheet_jue_se.sourceData.ddl+=' -- changed'; },
    data => { data.sheet_replacement=data.sheet_jue_se; delete data.sheet_jue_se; },
    data => { data.sheet_other.name='重要角色表'; },
  ]) {
    const h=harness({afterWrite:({runtime,calls})=>{if(calls.length===1)change(runtime);}});
    const before=h.before(),desired=clone(before);
    desired.sheet_jue_se.content[1][1]='改名';
    desired.sheet_jue_se.content[1][2]='新值';
    await assert.rejects(h.sandbox.runSave(before,desired,['sheet_jue_se']),/未完成/);
    assert.equal(h.calls.length,1);
  }
});

test('conflicting target edit, missing or duplicate IDs and identity changes stop before any write', async () => {
  for (const mutate of [
    data => { data.sheet_jue_se.content[1][2] = '外部编辑'; },
    data => { data.sheet_jue_se.content[1][0] = ''; },
    data => { data.sheet_jue_se.content[2][0] = 'stable-17'; },
    data => { data.sheet_jue_se.uid = 'other'; },
  ]) {
    const h = harness(); const before = h.before(); const desired = clone(before);
    desired.sheet_jue_se.content[1][2] = '新值'; h.mutate(mutate);
    await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']));
    assert.equal(h.calls.length, 0);
  }
});

test('API false/throw/undefined, locks and fake success never report success or mutate read reference', async () => {
  for (const options of [{ rejectAt: 1 }, { throwAt: 1 }, { locked: true }, { fakeSuccess: true }, { fakeSuccess: true, undefinedResult: true }]) {
    const h = harness(options); const before = h.before(); const desired = clone(before);
    desired.sheet_jue_se.content[1][2] = '新值';
    await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /未完成/);
    assert.deepEqual(h.before(), before);
    assert.deepEqual(h.disk(), before);
    assert.equal(h.calls.length, 1, 'No automatic retry or JSON fallback');
  }
});

test('partial success reports count and stops subsequent cells', async () => {
  const h = harness({ rejectAt: 2 }); const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][1] = '改名'; desired.sheet_jue_se.content[1][2] = '新值';
  await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /1\/2/);
  assert.equal(h.disk().sheet_jue_se.content[1][1], '改名');
  assert.equal(h.disk().sheet_jue_se.content[1][2], '旧值');
});

test('queued chat/isolation switches and ABA event abort with zero writes', async () => {
  for (const switchContext of [
    h => { h.context.chatId = 'synthetic-chat-B'; },
    h => { h.context.isolationKey = 'other-isolation'; },
    h => { h.sandbox.bumpEpoch(); },
  ]) {
    const h = harness(); let release; h.sandbox.blockQueue(new Promise(resolve => { release = resolve; }));
    const before = h.before(); const desired = clone(before); desired.sheet_jue_se.content[1][2] = '新值';
    const saving = h.sandbox.runSave(before, desired, ['sheet_jue_se']);
    switchContext(h); release();
    await assert.rejects(saving, /已切换/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.sandbox.getCache(), null);
  }
});

test('switch after awaited API prevents remaining writes, cache publication and success', async () => {
  const h = harness({ afterWrite: ({ context }) => { context.chatId = 'synthetic-chat-B'; } });
  const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][1] = '改名'; desired.sheet_jue_se.content[1][2] = '新值';
  await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /已切换/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.sandbox.getCache(), null);
});

test('original database works without a companion capability or undocumented parameters', async () => {
  const h = harness(); const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  await h.sandbox.runSave(before, desired, ['sheet_jue_se']);
  assert.equal(h.calls.length, 1);
  assert.equal(h.api.getTableCrudContextGuardVersion, undefined);
});

test('public history context accepts finite numeric chat IDs and rejects invalid IDs', async () => {
  for (const chatId of [0, 37]) {
    const h = harness(); h.context.chatId = chatId;
    const before = h.before(); const desired = clone(before);
    desired.sheet_jue_se.content[1][2] = '新值';
    await h.sandbox.runSave(before, desired, ['sheet_jue_se']);
    assert.equal(h.calls.length, 1);
  }
  for (const chatId of ['', '  ', null, undefined, NaN, Infinity, {}]) {
    const h = harness(); h.context.chatId = chatId;
    const before = h.before(); const desired = clone(before);
    desired.sheet_jue_se.content[1][2] = '新值';
    assert.throws(() => h.sandbox.runSave(before, desired, ['sheet_jue_se']), /无法确认/);
    assert.equal(h.calls.length, 0);
  }
});

test('original API limitation: in-flight reorder is detected after the call and remaining writes stop', async () => {
  const h = harness({ beforeWrite: ({ runtime }) => {
    [runtime.sheet_jue_se.content[1], runtime.sheet_jue_se.content[2]] =
      [runtime.sheet_jue_se.content[2], runtime.sheet_jue_se.content[1]];
  } });
  const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /未完成/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.before().sheet_jue_se.content[2][2], '旧值', 'Original target was not changed');
  assert.equal(h.before().sheet_jue_se.content[1][2], '新值', 'Unmodified API can already have changed another row');
});

test('in-flight reorder with target already updated cannot hide a write to an unrelated row', async () => {
  const h = harness({ beforeWrite: ({ runtime }) => {
    runtime.sheet_jue_se.content[1][2] = '新值';
    [runtime.sheet_jue_se.content[1], runtime.sheet_jue_se.content[2]] =
      [runtime.sheet_jue_se.content[2], runtime.sheet_jue_se.content[1]];
  } });
  const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /未完成.*未修改的单元格/);
  assert.equal(h.calls.length, 1);
  const rows = h.before().sheet_jue_se.content.slice(1);
  assert.equal(rows.find(row => row[0] === 'stable-17')[2], '新值', 'Target alone appears correct');
  assert.equal(rows.find(row => row[0] === 'stable-88')[2], '新值', 'The original API already miswrote another row');
  assert.equal(h.logs.some(({ args }) => args.some(arg => String(arg).includes('目标值已通过'))), false);
});

test('an unrelated edit after public replay prevents final runtime success', async () => {
  const h = harness({ afterHostVerification: ({ runtime }) => {
    runtime.sheet_jue_se.content[2][2] = '并发改动';
  } });
  const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /未完成.*未修改的单元格/);
  assert.equal(h.stats.replays, 1);
  assert.equal(h.logs.some(({ args }) => args.some(arg => String(arg).includes('目标值已通过'))), false);
});

test('original API limitation: in-flight same-cell edits have no compare-and-set protection', async () => {
  const h = harness({ beforeWrite: ({ runtime }) => { runtime.sheet_jue_se.content[1][2] = '外部编辑'; } });
  const before = h.before(); const desired = clone(before);
  desired.sheet_jue_se.content[1][2] = '新值';
  await h.sandbox.runSave(before, desired, ['sheet_jue_se']);
  assert.equal(h.calls[0].expectedValue, undefined);
  assert.equal(h.before().sheet_jue_se.content[1][2], '新值');
});

test('host save no-op and failed public history replay never report confirmed success', async () => {
  for (const options of [{ noHostSave: true }, { historyFailure: true }]) {
    const h = harness(options); const before = h.before(); const desired = clone(before);
    desired.sheet_jue_se.content[1][2] = '新值';
    await assert.rejects(h.sandbox.runSave(before, desired, ['sheet_jue_se']), /未完成/);
    assert.equal(h.calls.length, 1);
  }
});

test('production regex engine preserves row_id even under global replacement', () => {
  const h = harness(); const data = h.before();
  const rules = [{ id: 'test', name: 'test', enabled: true, priority: 0, operation: 'replace',
    pattern: 'stable|旧值', replacement: '替换', flags: { global: true }, scope: { type: 'global' } }];
  const result = h.sandbox.transform(data, rules);
  assert.equal(result.errors.length, 0);
  assert.equal(data.sheet_jue_se.content[1][0], 'stable-17');
  assert.equal(data.sheet_jue_se.content[1][2], '替换');
});

test('opposite regex rules have no net change and do not claim a save', async () => {
  const h = harness(); const before = h.before(); const desired = clone(before);
  const rules = [
    { id: 'one', name: 'one', enabled: true, priority: 0, operation: 'replace',
      pattern: '^旧值$', replacement: '临时值', flags: { global: true }, scope: { type: 'global' } },
    { id: 'two', name: 'two', enabled: true, priority: 1, operation: 'replace',
      pattern: '^临时值$', replacement: '旧值', flags: { global: true }, scope: { type: 'global' } },
  ];
  const transformed = h.sandbox.transform(desired, rules);
  assert.equal(transformed.totalApplied, 2, 'Both rules ran, but cancel each other');
  assert.equal(transformed.errors.length, 0);
  assert.deepEqual(desired, before);
  const result = await h.sandbox.runSave(before, desired, [...transformed.modifiedSheetKeys]);
  assert.deepEqual(result, before);
  assert.equal(h.calls.length, 0);
  assert.equal(h.stats.replays, 0);
  assert.equal(h.stats.hostVerifications, 0);
  assert.ok(h.logs.some(({ level, args }) => level === 'info' && args.some(arg => String(arg).includes('没有净变化'))));
  assert.equal(h.logs.some(({ args }) => args.some(arg => String(arg).includes('目标值已通过'))), false);
  assert.deepEqual(h.reopen(), before);
});

test('legacy JSON floor persistence and row-id guessing are absent from save chain', () => {
  for (const name of ['saveSheetsViaJsonFloorWithoutTracking', 'applyJsonCellFallbackForCrud', 'prepareCrudRowIdForUpdateCell', 'relocateDbPayloadToAnchor']) {
    assert.equal(source.includes(name), false, name);
  }
});
