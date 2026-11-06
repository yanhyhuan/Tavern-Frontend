const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const loadTs = file => {
  const filename = path.join(root, 'src/骰子系统', file);
  const result = new Module(filename, module);
  result._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return result.exports;
};
const attributes = loadTs('chat-attributes.ts');
const guard = loadTs('crud-write-guard.ts');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  return {
    sheet_player: { uid: 'sheet_player', name: '主角信息表', content: [
      ['row_id', '姓名', '性别', '近况'], [1, '主角甲', '女', '叙事内容不变'],
    ] },
    sheet_npc: { uid: 'sheet_npc', name: '重要角色表', content: [
      ['row_id', '姓名', '在场状态'], [3, '合成人物甲', '在场'], [8, '合成人物乙', '离开'],
    ] },
    sheet_skill: { uid: 'sheet_skill', name: '主角技能表', content: [
      ['row_id', '技能名称', '等级/阶段'], [5, '演奏', '熟练'],
    ] },
  };
}

function storage() {
  const data = new Map();
  let writes = 0;
  return {
    data, get writes() { return writes; }, fail: false,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { if (this.fail) throw new Error('模拟配额失败'); writes++; data.set(key, value); },
  };
}

function harness(sharedStorage = storage(), initial = fixture()) {
  let runtime = clone(initial);
  const context = { version: 1, chatId: '合成聊天A', characterId: 4, groupId: null, isolationKey: '' };
  const api = {
    getTableHistoryContext: () => ({ ...context }),
    getTableLockState: () => ({ rows: [], cols: [], cells: [] }),
  };
  const file = path.join(root, 'src/骰子系统/index.ts');
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !declarations.has(node.name.text)) {
      declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(ast)};`);
    }
    if (ts.isFunctionDeclaration(node) && node.name && !declarations.has(node.name.text)) {
      declarations.set(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const names = [
    'findAttributeColumnIndices', 'pickFallbackAttributeColumn', 'findPrimaryAttributeColumns',
    'findCharacterAttributeRow', 'attributeTransactions', 'captureChatAttributeBinding',
    'tryCaptureChatAttributeBinding', 'requireChatAttributeBinding', 'getChatAttributeTransaction',
    'assertChatAttributeIdentityCurrent', 'getAttributeIdentityForCharacter', 'normalizeAttributeName',
    'resolveAttributeAliasName', 'getAttributeEntryForCharacter', 'getAttributeValue', 'STANDARD_ATTRS',
    'getStandardAttrs', 'clearPresetAttributesForCharacter', 'writeAttributesToCharacter',
    'updateSingleAttribute', 'getFullAttributesForCharacter', 'executeEffects', 'executeSecondaryEffectsChain',
    'processJsonData', 'readChatAttributesForSheetRow', 'readDashboardChatAttributes',
    'renderIndependentCharacterAttributes',
  ];
  const extracted = names.map(name => {
    assert.ok(declarations.has(name), `Production function missing: ${name}`);
    return declarations.get(name);
  }).join('\n');
  const sandbox = {
    ...attributes, ...guard, localStorage: sharedStorage, console: { info() {}, warn() {}, error() {}, log() {} },
    window: {}, api,
    getCore: () => ({ getDB: () => api, ST: { getContext: () => ({ ...context }) } }),
    getTableData: () => clone(runtime),
    isUserCharacterName: name => !name || name === '<user>' || name === '主角甲',
    isPlayerTableName: name => name.includes('主角'),
    isNpcLikeTableName: name => name.includes('角色'),
    isCharacterTable: name => /主角|角色|人物/.test(name),
    characterNamesMatch: (a, b) => String(a) === String(b),
    findExplicitAttributeTableNameColumnIndex: headers => headers.indexOf('姓名'),
    GACHA_CATALOG_RAW_ROW_INDEX_PROP: '__acuRawRowIndex',
    escapeHtml: value => String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]),
    renderInlineQuickCheckButton: (name, value) => `<i data-name="${name}" data-value="${value}"></i>`,
    AttributePresetManager: { getActivePreset: () => ({
      baseAttributes: [{ name: '力量' }, { name: '敏捷' }], specialAttributes: [{ name: '幸运' }],
    }) },
    parseAttributeString: value => String(value || '').split(';').filter(Boolean).map(item => {
      const [name, number] = item.split(':'); return { name, value: Number(number) };
    }),
    saveRowInstantly: async (key, row, value) => { runtime[key].content[row + 1] = value; },
    showActionableErrorToast() {}, errorTableTemplateIssue() {},
    withTableTemplateCheckHint: text => text,
    parseEffectValueInput: value => ({ finalValue: Number(value), formulaText: String(value), rolledValue: Number(value), valid: true }),
    evaluateCondition: (expression, values = {}) => ({ success: true, value: values[expression] ?? Number(expression) }),
    isSameAttributeAlias: (left, right) => left === right,
    performSaveDataOnly: async () => { throw new Error('独立属性不应写数据库'); },
    runInSaveQueue: async callback => { if (sandbox.queueGate) await sandbox.queueGate; return callback(); },
  };
  vm.createContext(sandbox);
  const tail = `globalThis.subject = { captureChatAttributeBinding, getAttributeIdentityForCharacter,
    getFullAttributesForCharacter, getAttributeValue, writeAttributesToCharacter,
    clearPresetAttributesForCharacter, updateSingleAttribute, executeEffects, findCharacterAttributeRow,
    processJsonData, readChatAttributesForSheetRow, readDashboardChatAttributes, renderIndependentCharacterAttributes };
    globalThis.bumpEpoch = () => { databaseWriteEpoch += 1; };`;
  vm.runInContext(ts.transpileModule(`let databaseWriteEpoch = 0;\n${extracted}\n${tail}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, sandbox);
  return { sandbox, subject: sandbox.subject, context, api, storage: sharedStorage,
    data: () => clone(runtime), replace: value => { runtime = clone(value); } };
}

test('默认表生成、读取、燃运与重开保留，数据库原数据不变', async () => {
  const h = harness();
  const before = h.data();
  const binding = h.subject.captureChatAttributeBinding();
  const result = await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 55, 敏捷: 60 }, false, { 幸运: 40 }, binding);
  assert.equal(result.success, true);
  assert.deepEqual(h.data(), before);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 55);
  const burned = await h.subject.updateSingleAttribute('合成人物甲', '幸运', 'subtract', 3, { scopeBinding: binding });
  assert.equal(burned.success, true);
  assert.equal(burned.newValue, 37);
  const reopened = harness(h.storage, before);
  assert.equal(reopened.subject.getAttributeValue('合成人物甲', '幸运'), 37);
  assert.equal(reopened.subject.getAttributeValue('合成人物乙', '力量'), null);
  assert.deepEqual(reopened.data(), before);
});

test('仪表盘和人物卡片重开后读取各自行的独立属性，按聊天隔离', async () => {
  const h = harness();
  const before = h.data();
  await h.subject.writeAttributesToCharacter('<user>', { 力量: 0, 敏捷: 60 }, false, { 幸运: 40 });
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 77 }, false, null);
  const writes = h.storage.writes;
  const reopened = harness(h.storage, before);
  const tables = reopened.subject.processJsonData(reopened.data());
  const player = { key: 'sheet_player', data: tables['主角信息表'] };
  assert.deepEqual(clone(reopened.subject.readDashboardChatAttributes(player)), [
    { name: '力量', value: 0, source: 'base' },
    { name: '敏捷', value: 60, source: 'base' },
    { name: '幸运', value: 40, source: 'special' },
  ]);
  const npc = tables['重要角色表'];
  const html = reopened.subject.renderIndependentCharacterAttributes('sheet_npc', npc, npc.rows[0]);
  assert.match(html, /力量/);
  assert.match(html, /77/);
  assert.doesNotMatch(html, /acu-cell/);
  assert.equal(reopened.subject.renderIndependentCharacterAttributes('sheet_npc', npc, npc.rows[1]), '');
  reopened.context.chatId = '合成聊天B';
  assert.deepEqual(clone(reopened.subject.readDashboardChatAttributes(player)), []);
  assert.equal(reopened.subject.renderIndependentCharacterAttributes('sheet_npc', npc, npc.rows[0]), '');
  reopened.context.chatId = '合成聊天A';
  assert.equal(reopened.subject.readDashboardChatAttributes(player)[0].value, 0);
  assert.equal(h.storage.writes, writes);
  assert.deepEqual(reopened.data(), before);
});

test('仪表盘按选中表与展示行的稳定身份查找，拒绝错 uid 和重复 row_id', () => {
  const custom = fixture();
  custom.sheet_custom = { uid: 'sheet_custom', name: '角色自定义表', content: [
    ['row_id', '姓名'], ['11', '同名'], ['12', '同名'],
  ] };
  const h = harness(undefined, custom);
  const tx = attributes.createChatAttributeStore(h.storage, h.subject.captureChatAttributeBinding()).begin();
  for (const [index, value] of [[1, 11], [2, 22]]) {
    tx.set(attributes.getChatAttributeIdentity('sheet_custom', custom.sheet_custom, index), [
      { name: '力量', value, source: 'base' },
    ]);
  }
  tx.commit();
  const table = h.subject.processJsonData(h.data())['角色自定义表'];
  table.rows.reverse();
  assert.equal(h.subject.readDashboardChatAttributes({ key: 'sheet_custom', data: table })[0].value, 22);
  assert.match(h.subject.renderIndependentCharacterAttributes('sheet_custom', table, table.rows[0]), /22/);
  assert.throws(() => h.subject.readDashboardChatAttributes({ key: 'sheet_player', data: table }), /key、uid/);
  table.content[1][0] = '12';
  assert.throws(() => h.subject.readDashboardChatAttributes({ key: 'sheet_custom', data: table }), /重复 row_id/);
  assert.match(h.subject.renderIndependentCharacterAttributes('sheet_custom', table, table.rows[0]), /属性读取失败/);
});

test('旧属性列不读取独立存储，损坏的独立属性显示明确错误', async () => {
  const legacy = fixture();
  legacy.sheet_npc.content[0].push('基础属性');
  legacy.sheet_npc.content[1].push('力量:55');
  legacy.sheet_npc.content[2].push('');
  const old = harness(undefined, legacy);
  old.storage.getItem = () => { throw new Error('不应读取'); };
  const table = old.subject.processJsonData(old.data())['重要角色表'];
  assert.equal(old.subject.renderIndependentCharacterAttributes('sheet_npc', table, table.rows[0]), '');

  const h = harness();
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 55 }, false, null);
  h.storage.data.set([...h.storage.data.keys()][0], '{broken');
  const broken = h.subject.processJsonData(h.data())['重要角色表'];
  assert.throws(() => h.subject.readChatAttributesForSheetRow('sheet_npc', broken, broken.rows[0]), /读取独立聊天属性失败/);
  assert.match(h.subject.renderIndependentCharacterAttributes('sheet_npc', broken, broken.rows[0]), /属性读取失败/);
});

test('聊天、隔离槽和角色 row_id 分区；重排行不串角色', async () => {
  const h = harness();
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 55, 敏捷: 60 }, false, null);
  const original = h.data();
  const reordered = clone(original);
  reordered.sheet_npc.content.splice(1, 2, reordered.sheet_npc.content[2], reordered.sheet_npc.content[1]);
  h.replace(reordered);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 55);
  assert.equal(h.subject.getAttributeValue('合成人物乙', '力量'), null);
  h.context.chatId = '合成聊天B';
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), null);
  h.context.chatId = '合成聊天A';
  h.context.isolationKey = '另一个隔离槽';
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), null);
  h.context.isolationKey = '';
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 55);
});

test('锁、行身份歧义、损坏存储和写入失败明确阻止保存', async () => {
  const h = harness();
  const binding = h.subject.captureChatAttributeBinding();
  h.api.getTableLockState = () => ({ rows: [0], cols: [], cells: [] });
  await assert.rejects(() => h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 50 }, false, null, binding), /锁定/);
  assert.equal(h.storage.writes, 0);
  h.api.getTableLockState = () => ({ rows: [], cols: [], cells: [] });
  h.storage.fail = true;
  await assert.rejects(() => h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 50 }, false, null, binding), /模拟配额失败/);
  assert.equal(h.storage.writes, 0);
  h.storage.fail = false;
  const malformed = h.data();
  malformed.sheet_npc.content[2][0] = 3;
  h.replace(malformed);
  await assert.rejects(() => h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 50 }, false, null, binding), /重复 row_id/);
  malformed.sheet_npc.content[2][0] = 8;
  malformed.sheet_npc.content[2][1] = '合成人物甲';
  h.replace(malformed);
  assert.throws(() => h.subject.getFullAttributesForCharacter('合成人物甲'), /匹配多行/);
  const ambiguous = await h.subject.updateSingleAttribute('合成人物甲', '力量', 'add', 1, { scopeBinding: binding });
  assert.equal(ambiguous.success, false);
  assert.match(ambiguous.error, /匹配多行/);
});

test('同一批效果只提交一次；任一效果失败或聊天切换均不落盘', async () => {
  const h = harness();
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 55, 敏捷: 60 }, false, { 幸运: 40 });
  const binding = h.subject.captureChatAttributeBinding();
  const characterIdentity = h.subject.getAttributeIdentityForCharacter('合成人物甲');
  const context = { characterName: '合成人物甲', attributeName: '力量', attributeValue: 55, roll: 20, modifier: 0, dc: 55 };
  const pending = effects => ({ scopeBinding: binding, characterIdentity, preset: {}, matchedOutcome: { name: '测试', effects }, context });
  const add = { id: 'a', target: '力量', operation: 'add', value: 3 };
  const burn = { id: 'b', target: '幸运', operation: 'subtract', value: 5 };
  const initialWrites = h.storage.writes;
  const success = await h.subject.executeEffects(pending([add, burn]));
  assert.equal(success.every(item => item.success), true);
  assert.equal(h.storage.writes, initialWrites + 1);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 58);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '幸运'), 35);
  const failed = await h.subject.executeEffects(pending([add, { id: 'invalid', target: '幸运', operation: 'multiply', value: 1 }]));
  assert.equal(failed.some(item => !item.success), true);
  assert.equal(h.storage.writes, initialWrites + 1);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 58);
  let release;
  h.sandbox.queueGate = new Promise(resolve => { release = resolve; });
  const waiting = h.subject.executeEffects(pending([add]));
  await new Promise(resolve => setImmediate(resolve));
  h.context.chatId = '合成聊天B';
  release();
  await assert.rejects(waiting, /切换/);
  assert.equal(h.storage.writes, initialWrites + 1);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), null);
});

test('旧 v4.5 属性列仍走数据库行保存；独立属性导入校验完整身份', async () => {
  const legacy = fixture();
  legacy.sheet_npc.content[0].push('基础属性', '特有属性');
  legacy.sheet_npc.content[1].push('力量:55;敏捷:60', '幸运:40');
  legacy.sheet_npc.content[2].push('', '');
  const h = harness(undefined, legacy);
  const result = await h.subject.updateSingleAttribute('合成人物甲', '幸运', 'subtract', 5);
  assert.equal(result.success, true);
  assert.equal(h.data().sheet_npc.content[1][4], '幸运:35');
  assert.equal(h.storage.writes, 0);

  const current = harness();
  await current.subject.writeAttributesToCharacter('合成人物甲', { 力量: 55, 敏捷: 60 }, false, null);
  const store = attributes.createChatAttributeStore(current.storage, current.subject.captureChatAttributeBinding());
  const exported = store.export();
  const other = harness(storage());
  other.context.chatId = '合成聊天B';
  assert.throws(() => attributes.createChatAttributeStore(other.storage, other.subject.captureChatAttributeBinding())
    .import(exported, () => {}), /不一致/);
  assert.equal(other.storage.writes, 0);
});

test('损坏的本机属性记录明确报错，不能覆盖为默认空值', async () => {
  const h = harness();
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 50 }, false, null);
  const key = [...h.storage.data.keys()][0];
  h.storage.data.set(key, '{broken');
  const writes = h.storage.writes;
  assert.throws(() => h.subject.getAttributeValue('合成人物甲', '力量'), /读取独立聊天属性失败/);
  await assert.rejects(() => h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 60 }, false, null), /读取独立聊天属性失败/);
  assert.equal(h.storage.writes, writes);
  assert.equal(h.storage.data.get(key), '{broken');
});

test('并发属性事务拒绝覆盖较新的提交，保存后可独立重新读取', () => {
  const h = harness();
  const store = attributes.createChatAttributeStore(h.storage, h.subject.captureChatAttributeBinding());
  const identity = h.subject.getAttributeIdentityForCharacter('合成人物甲');
  const first = store.begin();
  const second = store.begin();
  first.set(identity, [{ name: '力量', value: 60, source: 'base' }]);
  second.set(identity, [{ name: '力量', value: 70, source: 'base' }]);
  first.commit();
  assert.throws(() => second.commit(), /已被其他操作修改/);
  assert.equal(h.storage.writes, 1);
  assert.equal(store.read(identity)[0].value, 60);
});

test('属性备份导入遇到缺失角色或行锁时整批停止，已暂存项也不提交', async () => {
  const h = harness();
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 50 }, false, null);
  const binding = h.subject.captureChatAttributeBinding();
  const store = attributes.createChatAttributeStore(h.storage, binding);
  const incoming = store.export();
  incoming.characters[0].attributes[0].value = 80;
  incoming.characters.push({ sheetKey: 'sheet_npc', uid: 'sheet_npc', rowId: '999', attributes: [{ name: '力量', value: 90, source: 'base' }] });
  const validate = vm.runInContext('assertChatAttributeIdentityCurrent', h.sandbox);
  const writes = h.storage.writes;
  const validBackup = clone(incoming);
  validBackup.characters.pop();
  store.import(validBackup, identity => validate(identity, binding));
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 80);
  incoming.characters[0].attributes[0].value = 90;
  const writesAfterValid = h.storage.writes;
  assert.throws(() => store.import(incoming, identity => validate(identity, binding)), /已删除/);
  assert.equal(h.storage.writes, writesAfterValid);
  assert.equal(h.storage.writes, writes + 1);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 80);
  incoming.characters.pop();
  h.api.getTableLockState = () => ({ rows: [0], cols: [], cells: [] });
  assert.throws(() => store.import(incoming, identity => validate(identity, binding)), /锁定/);
  assert.equal(h.storage.writes, writesAfterValid);
});

test('真实二级效果读取已暂存属性并单次提交，失败时不提交或调用回调', async () => {
  const h = harness();
  await h.subject.writeAttributesToCharacter('合成人物甲', { 力量: 55, 敏捷: 60 }, false, { 幸运: 40 });
  const binding = h.subject.captureChatAttributeBinding();
  const characterIdentity = h.subject.getAttributeIdentityForCharacter('合成人物甲');
  let callbacks = 0;
  h.sandbox.window.afterSecondary = () => { callbacks++; };
  const primary = { id: 'primary', target: '力量', operation: 'add', value: 3 };
  const run = secondaryOperation => ({
    scopeBinding: binding, characterIdentity,
    preset: { secondaryEffects: [{ id: 'secondary', trigger: { type: 'threshold', attribute: '力量', operator: 'lte', value: '力量' },
      callback: 'afterSecondary', effects: [{ id: 'burn', target: '幸运', operation: secondaryOperation, value: 5 }] }] },
    matchedOutcome: { name: '测试', effects: [primary] },
    context: { characterName: '合成人物甲', attributeName: '力量', attributeValue: 55, roll: 20, modifier: 0, dc: 55 },
  });
  const initialWrites = h.storage.writes;
  const success = await h.subject.executeEffects(run('subtract'));
  assert.equal(success.length, 2);
  assert.equal(success.every(item => item.success), true);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 58);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '幸运'), 35);
  assert.equal(h.storage.writes, initialWrites + 1);
  assert.equal(callbacks, 1);
  const failed = await h.subject.executeEffects(run('multiply'));
  assert.equal(failed.every(item => !item.success), true);
  assert.equal(h.subject.getAttributeValue('合成人物甲', '力量'), 58);
  assert.equal(h.storage.writes, initialWrites + 1);
  assert.equal(callbacks, 1);
});
