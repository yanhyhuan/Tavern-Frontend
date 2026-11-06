const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/骰子系统/database-default-presets.ts');
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createDatabaseDefaultValidationRules, hasDatabaseDefaultBag, formatBagRewardDescription, readBagRewardQuality, createDatabaseLocationView } = loaded.exports;
const template = JSON.parse(fs.readFileSync(path.join(root, 'assets/templates/database-default-1.3.6.json'), 'utf8'));
const sourceText = fs.readFileSync(path.join(root, 'src/骰子系统/index.ts'), 'utf8');
const source = ts.createSourceFile('index.ts', sourceText, ts.ScriptTarget.Latest, true);

// Exercise the actual built-in objects and parsers without starting the UI.
function initializer(name, context = {}) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, name);
  const js = ts.transpileModule(`result = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { result: undefined, console: { info() {}, error() {} }, ...context };
  vm.runInNewContext(js, sandbox, { timeout: 1000 });
  return sandbox.result;
}
const sheets = Object.values(template).filter(sheet => sheet?.name);
const sheetNamed = name => sheets.find(sheet => sheet.name === name);
const config = initializer('DASHBOARD_TABLE_CONFIG', { CHARACTER_NAME_COLUMN_KEYS: ['姓名', '名称', 'name'] });
const parser = initializer('DashboardDataParser', { getDashboardModuleConfig: key => config[key] });
const engine = initializer('ValidationEngine');
const rules = createDatabaseDefaultValidationRules();

test('all default validation targets exist in the unchanged database 8-table template', () => {
  assert.equal(sheets.length, 8);
  assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length);
  for (const rule of rules) {
    const sheet = sheetNamed(rule.targetTable);
    assert.ok(sheet, rule.targetTable);
    if (rule.targetColumn) assert.ok(sheet.content[0].includes(rule.targetColumn), rule.targetColumn);
    assert.equal(rule.intercept, false);
  }
});

test('default task progress accepts narrative and does not require old percent/status fields', () => {
  assert.equal(rules.some(rule => rule.targetTable === '任务与事件表' && rule.targetColumn === '状态'), false);
  assert.equal(rules.some(rule => rule.targetColumn === '当前进度' && rule.ruleType === 'format'), false);
  for (const rule of rules.filter(rule => rule.targetColumn === '当前进度')) {
    assert.equal(engine.validateValue('已找到第一条线索，等待和委托人核对', rule, template), true);
  }
  const taskType = rules.find(rule => rule.targetTable === '任务与事件表' && rule.ruleType === 'enum');
  assert.equal(engine.validateValue('主线任务', taskType, template), true);
  assert.equal(engine.validateValue('无效类型', taskType, template), false);
});

test('database default quantity and role presence still reject invalid values', () => {
  const quantity = rules.find(rule => rule.targetTable === '背包物品表' && rule.ruleType === 'format');
  for (const value of ['0', '2', '120']) assert.equal(engine.validateValue(value, quantity, template), true);
  for (const value of ['-1', '2个', '1.5']) assert.equal(engine.validateValue(value, quantity, template), false);
  const presence = rules.find(rule => rule.targetColumn === '在场状态' && rule.ruleType === 'enum');
  assert.equal(engine.validateValue('在场', presence, template), true);
  assert.equal(engine.validateValue('离场', presence, template), true);
  assert.equal(engine.validateValue('进行中', presence, template), false);
});

test('dashboard reads bag category/count and task narrative without confusing time limit with status', () => {
  const bag = sheetNamed('背包物品表');
  const bagRow = ['71', '合成药水', '3', '用于合成测试', '消耗品'];
  const result = parser.parseRows({ data: { headers: bag.content[0], rows: [bagRow] }, config: config.bag }, 'bag')[0];
  assert.equal(result.name, '合成药水');
  assert.equal(result.type, '消耗品');
  assert.equal(result.count, '3');
  const task = sheetNamed('任务与事件表');
  const row = ['81', '合成任务', '支线任务', '甲', '目标', '等待回信', '剩余两天', '奖励', '后果'];
  const quest = parser.parseRows({ data: { headers: task.content[0], rows: [row] }, config: config.quest }, 'quest')[0];
  assert.equal(quest.progress, '等待回信');
  assert.equal(quest.status, null);
  assert.equal(parser.findColumnIndex(['row_id', '别的字段'], 'count', config.bag), -1);
});

test('player dashboard maps current condition and location from the database default', () => {
  const sheet = sheetNamed('主角信息表');
  assert.equal(parser.findColumnIndex(sheet.content[0], 'status', config.player), sheet.content[0].indexOf('近况'));
  assert.equal(parser.findColumnIndex(sheet.content[0], 'position', config.player), sheet.content[0].indexOf('所在地点'));
});

test('regex defaults only edit existing narrative/relationship columns; identity and numeric fields are excluded', () => {
  const regexRules = initializer('BUILTIN_REGEX_RULES');
  for (const rule of regexRules) {
    assert.equal(rule.scope.type, 'column');
    for (const name of rule.scope.tableNames) assert.ok(sheetNamed(name), name);
    for (const column of rule.scope.columnNames) {
      assert.ok(rule.scope.tableNames.some(name => sheetNamed(name).content[0].includes(column)), column);
      assert.equal(['row_id', '姓名', '物品名称', '数量', '编码索引', '当前时间', '时间跨度'].includes(column), false);
    }
  }
  const relation = regexRules.find(rule => rule.id === 'builtin_normalize_database_relations');
  const output = '主角 : 旧识 ; 乙 : 室友,同学'.replace(new RegExp(relation.pattern, 'g'), relation.replacement);
  assert.equal(output, '主角:旧识;乙:室友,同学');
});

test('default bag detection ignores generated sheet keys and requires its actual semantic columns', () => {
  const before = JSON.stringify(template);
  assert.equal(hasDatabaseDefaultBag(template), true);
  const bag = JSON.parse(JSON.stringify(sheetNamed('背包物品表')));
  assert.equal(hasDatabaseDefaultBag({ sheet_other_key: bag }), true);
  bag.content[0] = ['row_id', '物品名称', '描述/效果', '类别'];
  assert.equal(hasDatabaseDefaultBag({ sheet_other_key: bag }), false);
  assert.equal(JSON.stringify(template), before);
});

test('reward rarity survives serialization through the actual default description field', () => {
  for (const quality of ['普通', '优秀', '稀有', '史诗', '传说', '神话']) {
    const text = formatBagRewardDescription('合成效果', quality);
    const reloaded = JSON.parse(JSON.stringify(['91', '合成奖励', '1', text, '武器']));
    assert.equal(readBagRewardQuality(reloaded[3]), quality);
    assert.ok(reloaded[3].includes('合成效果'));
  }
  assert.equal(readBagRewardQuality('用户原有描述'), '未标注');
});

test('map projects only recorded locations and does not invent regions or change database data', () => {
  const data = JSON.parse(JSON.stringify(template));
  const sheet = name => Object.values(data).find(value => value?.name === name);
  sheet('全局数据表').content.push(['1', '全局状态', '合成公园', '合成区', '合成市', null, '0分', '2026-11-06 12:00']);
  sheet('主角信息表').content.push(['1', '甲', '未知', '20', '合成外貌', '合成身份', '一切如常', '合成公园', '']);
  sheet('重要角色表').content.push(['8', '乙', '未知', '20', '合成角色', '', '', '合成车站', '离场', '甲:旧识', '', '']);
  const before = JSON.stringify(data);
  const view = createDatabaseLocationView(data);
  assert.deepEqual(view.headers, ['名称', '次要地区', '描述']);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows.find(row => row[0] === '合成公园')[1], '合成区');
  assert.equal(view.rows.find(row => row[0] === '合成车站')[1], '');
  assert.equal(JSON.stringify(data), before);
  assert.equal(createDatabaseLocationView(template), null);
});

test('all built-in rewards use the default unified bag, preserving their definitions', () => {
  const definitionFile = path.join(root, 'src/骰子系统/gacha-items.ts');
  const definitionsModule = new Module(definitionFile, module);
  definitionsModule.filename = definitionFile;
  definitionsModule.paths = module.paths;
  definitionsModule._compile(ts.transpileModule(fs.readFileSync(definitionFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, definitionFile);
  const definitions = definitionsModule.exports.GACHA_ITEM_DEFINITIONS;
  const original = JSON.stringify(definitions);
  const getDefinitions = initializer('getAllGachaItemDefinitions', {
    GACHA_ITEM_DEFINITIONS: definitions, hasDatabaseDefaultBag,
    getCustomGachaItemDefinitions: () => [], getStoredGachaItemSettings: () => ({}),
    withGachaItemSettings: item => item,
  });
  const defaults = getDefinitions(template);
  assert.equal(defaults.length, definitions.length);
  assert.ok(defaults.length > 90);
  assert.ok(defaults.every(item => item.rewardTarget === 'inventory'));
  assert.equal(JSON.stringify(definitions), original);
  const custom = getDefinitions({});
  assert.ok(custom.some(item => item.rewardTarget === 'equipment'));
});

test('actual reward setter maps every value to the default bag column and preserves row_id', () => {
  const mapColumns = initializer('getInventoryColumnMap', {
    DashboardDataParser: parser, DASHBOARD_TABLE_CONFIG: config,
    applyGachaTargetColumnOverrides: map => map,
  });
  const headers = sheetNamed('背包物品表').content[0];
  const columns = mapColumns({ data: { headers }, config: config.bag, name: '背包物品表' });
  const write = initializer('setInventoryRowBasicFields', { formatBagRewardDescription });
  const row = ['125', '', '', '', ''];
  write(row, columns, { name: '合成装备', type: '武器', quality: '史诗', description: '合成描述' }, 2);
  assert.deepEqual(row, ['125', '合成装备', '2', '【骰子品质:史诗】合成描述', '武器']);
  assert.equal(columns.quality, -1);
});

test('message review baselines and reward saves retain the shared sheet predicate', async () => {
  const hasSheetKeys = initializer('hasSheetKeys');
  const data = JSON.parse(JSON.stringify(template));
  const before = JSON.stringify(data);
  const snapshots = [];
  const review = initializer('saveCurrentDatabaseSnapshotAsReviewBaseline', {
    hasSheetKeys, getTableData: () => data, saveSnapshot: value => snapshots.push(value),
  });
  assert.equal(review('synthetic-message'), true);
  assert.equal(snapshots[0], data);
  const writes = [];
  const state = { synthetic: true };
  const savedStates = [];
  const saveReward = initializer('persistRawDataWithGacha', {
    hasSheetKeys,
    performSaveDataOnly: async (value, keys) => writes.push({ value, keys }),
    assertSaveStoredGachaStateSnapshot: value => savedStates.push(value),
  });
  const key = Object.keys(data).find(key => key.startsWith('sheet_'));
  await saveReward(data, [key], state);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value, data);
  assert.equal(writes[0].keys[0], key);
  assert.equal(savedStates[0], state);
  await assert.rejects(saveReward({}, [key], state), /缺少有效工作表/);
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(data), before);
});

test('concurrent shop opens create one overlay and a pending chat switch cancels opening', async () => {
  const overlays = [];
  let context = 'synthetic-A';
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const $ = selector => {
    if (selector === '.acu-gacha-overlay') return { length: overlays.length };
    if (selector === 'body') return { append: overlay => overlays.push(overlay) };
    if (typeof selector === 'string' && selector.startsWith('<div')) {
      return { 0: { style: { setProperty() {} } }, html() {} };
    }
    throw new Error(`Unexpected synthetic selector: ${selector}`);
  };
  const open = initializer('showGachaVisualization', {
    getCore: () => ({ $ }), getCurrentContextFingerprint: () => context,
    closeInventoryVisualization() {}, closeGachaVisualization: () => { overlays.length = 0; },
    cachedRawData: template, ensureGachaCatalogLoaded: () => ready,
    getConfig: () => ({ theme: 'native' }), renderGachaPanelHtml: () => 'synthetic shop',
    hydrateCustomTableNameIconsIn() {}, gachaShopRootElement: null,
    startGachaShopUiRefresh() {}, updateGachaShopProgressUi() {}, setupOverlayClose() {},
  });
  const first = open();
  const second = open();
  release();
  await Promise.all([first, second]);
  assert.equal(overlays.length, 1);
  const switched = open();
  context = 'synthetic-B';
  await switched;
  assert.equal(overlays.length, 0);
});
