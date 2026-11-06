const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/骰子系统/table-template-requirements.ts');
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
loaded._compile(js, file);
const { createBuiltinTableTemplateRequirementPreset, inspectTableTemplateWithPreset, buildTableTemplateAppendRepairPlan } = loaded.exports;
const raw = fs.readFileSync(path.join(root, 'tests/fixtures/legacy-dice-template.json'), 'utf8');
const preset = createBuiltinTableTemplateRequirementPreset(raw, 'v4.5');
const original = JSON.parse(raw);
const databaseRaw = fs.readFileSync(path.join(root, 'assets/templates/database-default-1.3.6.json'), 'utf8');
const databaseOriginal = JSON.parse(databaseRaw);
const databasePreset = createBuiltinTableTemplateRequirementPreset(databaseRaw);
const v45Raw = fs.readFileSync(path.join(root, 'assets/templates/TavernDB_template_runtime_SQL_v4.5.json'), 'utf8');
const v45Preset = createBuiltinTableTemplateRequirementPreset(v45Raw, 'v4.5');
const clone = value => JSON.parse(JSON.stringify(value));
const translated = {
  sheet_global_data: 'sheet_quan_ju_shu_ju_biao',
  sheet_world_map: 'sheet_shi_jie_di_tu_dian',
  sheet_map_elements: 'sheet_di_tu_yuan_su_biao',
  sheet_protagonist: 'sheet_zhu_jue_xin_xi',
  sheet_important_npc: 'sheet_zhong_yao_jue_se_biao',
  sheet_inventory: 'sheet_wu_pin_biao',
  sheet_equipment: 'sheet_zhuang_bei_biao',
};

function fixture() {
  const data = clone(original);
  for (const [oldKey, newKey] of Object.entries(translated)) {
    const sheet = data[oldKey];
    delete data[oldKey];
    sheet.uid = newKey;
    sheet.sourceData.ddl = sheet.sourceData.ddl.replace(/(CREATE\s+TABLE\s+)\w+/i, `$1${newKey}`);
    data[newKey] = sheet;
  }
  data.sheet_wu_pin_biao.content.push(['81', '匕首', '武器', '2', '普通', '合成数据']);
  data.sheet_extra = {
    uid: 'sheet_extra', name: '合成附表', orderNo: 99,
    content: [['row_id', '内容'], ['9', '其他表保持原样']],
    sourceData: { ddl: 'CREATE TABLE sheet_extra (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  body TEXT -- 内容\n);' },
  };
  assert.equal(Object.keys(data).filter(key => key.startsWith('sheet_')).length, 12);
  return data;
}

function report(data, rule = preset) { return inspectTableTemplateWithPreset(data, rule); }
function plan(data, rule = preset) { return buildTableTemplateAppendRepairPlan(data, rule); }
function issuesContaining(result, text) {
  return result.issues.filter(issue => [issue.title, ...issue.missing].some(value => value.includes(text)));
}
function assertSheetsUnchanged(before, after) {
  for (const key of Object.keys(before).filter(key => key.startsWith('sheet_'))) assert.deepEqual(after[key], before[key], key);
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('数据库默认 8 表和可选 v4.5 的 12 表分别按自己的结构检验', () => {
  assert.equal(Object.keys(databasePreset.template).length, 8);
  assert.equal(Object.keys(v45Preset.template).length, 12);
  assert.notEqual(databasePreset.id, v45Preset.id);
  assert.deepEqual(report(databaseOriginal, databasePreset).issues, []);
  assert.deepEqual(report(JSON.parse(v45Raw), v45Preset).issues, []);
  const before = clone(databaseOriginal);
  assert.equal(plan(databaseOriginal, databasePreset).changed, false);
  assert.deepEqual(databaseOriginal, before);
});

test('默认 8 表的稳定 key 和 SQL 表名全部变化时不误判或改动数据', () => {
  const data = clone(databaseOriginal);
  const entries = Object.entries(data).filter(([key]) => key.startsWith('sheet_'));
  for (let i = 0; i < entries.length; i++) {
    const [oldKey, sheet] = entries[i];
    const key = `sheet_synthetic_${i + 1}`;
    delete data[oldKey];
    sheet.uid = key;
    sheet.sourceData.ddl = sheet.sourceData.ddl.replace(/(CREATE\s+TABLE\s+)\w+/i, `$1${key}`);
    sheet.content.push(sheet.content[0].map((_, col) => col === 0 ? '42' : `保留${i}-${col}`));
    data[key] = sheet;
  }
  const before = clone(data);
  const result = report(data, databasePreset);
  assert.equal(result.issues.filter(issue => issue.title.startsWith('缺少“') && issue.title.endsWith('”表')).length, 0);
  assert.equal(result.issues.filter(issue => issue.repairBlocking).length, 0);
  const first = plan(data, databasePreset);
  assert.equal(first.changed, false);
  assert.deepEqual(first.repairedTemplate, before);
  assert.deepEqual(plan(first.repairedTemplate, databasePreset).repairedTemplate, before);
  assert.deepEqual(data, before);
});

test('默认缺表候选保留数据库原版建表说明及规则，uid 与 key 一致', () => {
  const data = clone(databaseOriginal);
  const key = Object.keys(data).find(k => data[k]?.name === '背包物品表');
  const originalSheet = clone(data[key]);
  delete data[key];
  const before = clone(data);
  const result = plan(data, databasePreset);
  assert.equal(result.changed, true, result.manualIssues.join('\n'));
  assertSheetsUnchanged(before, result.repairedTemplate);
  assert.equal(result.repairedTemplate[key].uid, key);
  assert.deepEqual(result.repairedTemplate[key].sourceData, originalSheet.sourceData);
  assert.deepEqual(result.repairedTemplate[key].content, [originalSheet.content[0]]);
  assert.equal(plan(result.repairedTemplate, databasePreset).changed, false);
});

test('已知旧表别名结构不兼容时报告冲突，不新增近义表', () => {
  const data = fixture();
  const before = clone(data);
  const result = report(data, databasePreset);
  assert.equal(issuesContaining(result, '需要追加“主角信息表”表').length, 0);
  assert.equal(issuesContaining(result, '需要追加“背包物品表”表').length, 0);
  assert.ok(result.issues.some(issue => issue.repairBlocking && issue.title.includes('结构冲突')));
  const repaired = plan(data, databasePreset);
  assert.equal(repaired.changed, false);
  assert.deepEqual(repaired.repairedTemplate, before);
});

test('数据库允许的首列 null 行号占位不误报，错误位置的 row_id 会阻止新增', () => {
  const data = clone(databaseOriginal);
  const keys = Object.keys(databasePreset.template);
  data[keys[0]].content[0][0] = null;
  assert.equal(report(data, databasePreset).issues.filter(issue => issue.repairBlocking).length, 0);
  data[keys[0]].content[0][0] = '行号';
  delete data[keys[1]];
  const before = clone(data);
  const result = plan(data, databasePreset);
  assert.equal(result.changed, false);
  assert.ok(result.manualIssues.some(issue => issue.includes('首列必须是 row_id')));
  assert.deepEqual(result.repairedTemplate, before);
});

test('12 表，7 个 key 和 SQL 表名不同：检查、修复均保留已有表', () => {
  const data = fixture();
  const before = clone(data);
  const result = report(data);
  assert.equal(result.issues.filter(issue => issue.title.startsWith('缺少“') && issue.title.endsWith('”表')).length, 0);
  assert.equal(issuesContaining(result, '建表说明表名为').length, 0);
  const repaired = plan(data);
  assert.equal(repaired.changed, false);
  assert.deepEqual(data, before);
  assert.deepEqual(repaired.repairedTemplate, before);
  assert.deepEqual(plan(repaired.repairedTemplate).repairedTemplate, before);
  assert.deepEqual(report(data).issues, report(data).issues);
});

test('真缺表：新表有正确 uid、首列及 DDL，其他 11 表和数据不变，重复修复稳定', () => {
  const data = fixture();
  delete data.sheet_wu_pin_biao;
  const before = clone(data);
  const repaired = plan(data);
  assert.equal(repaired.changed, true, repaired.manualIssues.join('\n'));
  assert.deepEqual(repaired.actions, ['追加“物品表”表']);
  assertSheetsUnchanged(before, repaired.repairedTemplate);
  const added = repaired.repairedTemplate.sheet_inventory;
  assert.equal(added.uid, 'sheet_inventory');
  assert.equal(added.content[0][0], 'row_id');
  assert.match(added.sourceData.ddl, /row_id\s+INTEGER\s+PRIMARY\s+KEY/i);
  assert.equal(report(repaired.repairedTemplate).issues.filter(issue => issue.title.startsWith('缺少“')).length, 0);
  const second = plan(repaired.repairedTemplate);
  assert.equal(second.changed, false);
  assert.deepEqual(second.repairedTemplate, repaired.repairedTemplate);
});

test('同音名称会产生数据库物理表名冲突，停止全部新增候选', () => {
  const data = JSON.parse(v45Raw);
  delete data.sheet_wu_pin_biao;
  delete data.sheet_zhuang_bei_biao;
  data.sheet_other = {
    uid: 'sheet_other', name: '物品标', orderNo: 99,
    content: [['row_id', '内容'], ['9', '保留']],
    sourceData: { ddl: 'CREATE TABLE other_physical (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  body TEXT -- 内容\n);' },
  };
  const before = clone(data);
  const repaired = plan(data, v45Preset);
  assert.equal(repaired.changed, false);
  assert.deepEqual(repaired.actions, []);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('物理表名') && issue.includes('物品标')));
  assert.deepEqual(repaired.repairedTemplate, before);
  assert.deepEqual(data, before);
  assert.equal(plan(repaired.repairedTemplate, v45Preset).changed, false);
});

test('已有不同名称同音时检查报告物理表名冲突', () => {
  const data = JSON.parse(v45Raw);
  data.sheet_other = {
    uid: 'sheet_other', name: '物品标', orderNo: 99,
    content: [['row_id', '内容']],
    sourceData: { ddl: 'CREATE TABLE other_physical (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  body TEXT -- 内容\n);' },
  };
  const result = report(data, v45Preset);
  assert.ok(result.issues.some(issue => issue.repairBlocking && issue.title.includes('物理表名')));
  assert.equal(plan(data, v45Preset).changed, false);
});

test('数据库无法映射拼音的表名阻止新增候选', () => {
  const data = JSON.parse(v45Raw);
  delete data.sheet_wu_pin_biao;
  data.sheet_other = {
    uid: 'sheet_other', name: '😀', orderNo: 99,
    content: [['row_id', '内容']],
    sourceData: { ddl: 'CREATE TABLE other_physical (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  body TEXT -- 内容\n);' },
  };
  const repaired = plan(data, v45Preset);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('表名') && issue.includes('拼音')));
  assert.equal(repaired.repairedTemplate.sheet_wu_pin_biao, undefined);
});

test('无效 mate 不被自动改写，也不会生成数据库会拒绝的候选', () => {
  for (const keepMate of [true, false]) {
    const data = fixture();
    if (keepMate) data.mate = { custom: { preserve: true } };
    else delete data.mate;
    const before = clone(data);
    const unchanged = plan(data);
    assert.equal(unchanged.changed, false);
    assert.deepEqual(unchanged.repairedTemplate, before);
    const mateIssue = report(data).issues.find(issue => issue.title === '缺少模板全局设置');
    if (mateIssue) assert.equal(mateIssue.fixable, false);
    delete data.sheet_wu_pin_biao;
    const priorToAppend = clone(data);
    const repaired = plan(data);
    assert.equal(repaired.changed, false);
    assert.ok(repaired.manualIssues.some(issue => issue.includes('mate.type=chatSheets')));
    assert.equal(Object.hasOwn(repaired.repairedTemplate, 'mate'), keepMate);
    if (keepMate) assert.deepEqual(repaired.repairedTemplate.mate, priorToAppend.mate);
    assertSheetsUnchanged(priorToAppend, repaired.repairedTemplate);
    assert.equal(plan(repaired.repairedTemplate).changed, false);
  }
});

test('同名缺业务列：报告冲突，不新增重名表，也不补改原表', () => {
  const data = fixture();
  const sheet = data.sheet_wu_pin_biao;
  const index = sheet.content[0].indexOf('数量');
  sheet.content.forEach(row => row.splice(index, 1));
  const before = clone(data);
  const result = report(data);
  assert.ok(issuesContaining(result, '缺少“数量”列').length > 0);
  assert.ok(issuesContaining(result, '结构冲突').length > 0);
  assert.equal(issuesContaining(result, '需要追加“物品表”表').length, 0);
  const repaired = plan(data);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('数量')));
  assert.deepEqual(repaired.repairedTemplate, before);
});

test('明确别名可以匹配；存在多个名称／别名候选时报告歧义', () => {
  const data = fixture();
  const sheet = data.sheet_wu_pin_biao;
  sheet.name = '携带物资';
  sheet.sourceData.tableAliases = ['物品表'];
  assert.equal(issuesContaining(report(data), '需要追加“物品表”表').length, 0);
  assert.equal(plan(data).changed, false);
  const conflict = clone(sheet);
  conflict.uid = 'sheet_other';
  conflict.name = '其他物资';
  data.sheet_other = conflict;
  const result = report(data);
  assert.ok(issuesContaining(result, '匹配冲突').length > 0);
  assert.ok(issuesContaining(result, '名称或别名').length > 0);
  assert.equal(issuesContaining(result, '需要追加“物品表”表').length, 0);
  const before = clone(data);
  const repaired = plan(data);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('匹配冲突')));
  assert.deepEqual(repaired.repairedTemplate, before);
});

test('已有同名冲突时即使另缺表也整体停止，不产生部分模板', () => {
  const data = fixture();
  delete data.sheet_zhuang_bei_biao;
  const sheet = data.sheet_wu_pin_biao;
  const index = sheet.content[0].indexOf('数量');
  sheet.content.forEach(row => row.splice(index, 1));
  const before = clone(data);
  const repaired = plan(data);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('结构冲突')));
  assert.deepEqual(repaired.actions, []);
  assert.deepEqual(repaired.repairedTemplate, before);
});

test('SQL 列物理名变化但定义相同不误报；真实约束差异和错误 DDL 仍报告', () => {
  const data = fixture();
  const sheet = data.sheet_wu_pin_biao;
  sheet.sourceData.ddl = sheet.sourceData.ddl.replace(/\bitem_name\b/g, 'wu_pin_ming_cheng');
  assert.equal(issuesContaining(report(data), '当前定义为').length, 0);
  sheet.sourceData.ddl = sheet.sourceData.ddl.replace('TEXT NOT NULL UNIQUE', 'INTEGER NOT NULL UNIQUE');
  assert.ok(issuesContaining(report(data), '当前定义为').length > 0);
  sheet.sourceData.ddl = sheet.sourceData.ddl.replace(/\);\s*$/, ',\n);');
  assert.ok(issuesContaining(report(data), '尾随逗号').length > 0);
  const before = clone(data);
  assert.deepEqual(plan(data).repairedTemplate, before);
});

test('DDL CHECK 字符串字面量大小写和空格差异是实际约束差异', () => {
  const data = fixture();
  const rule = clone(preset);
  rule.template.sheet_inventory.sourceData.ddl = rule.template.sheet_inventory.sourceData.ddl.replace(
    'item_type TEXT NOT NULL', "item_type TEXT NOT NULL CHECK(item_type IN ('Alpha  Beta'))",
  );
  data.sheet_wu_pin_biao.sourceData.ddl = data.sheet_wu_pin_biao.sourceData.ddl.replace(
    'item_type TEXT NOT NULL', "item_type TEXT NOT NULL CHECK(item_type IN ('alpha Beta'))",
  );
  assert.ok(issuesContaining(report(data, rule), '当前定义为').length > 0);
  assert.equal(plan(data, rule).changed, false);
});

test('NFKC 名称冲突和无效占用 key 不能造成重复或无效新增', () => {
  const data = fixture();
  const sameName = clone(data.sheet_wu_pin_biao);
  sameName.uid = 'sheet_other';
  sameName.name = '　物品表　';
  data.sheet_other = sameName;
  assert.ok(issuesContaining(report(data), '匹配冲突').length > 0);
  assert.equal(plan(data).changed, false);

  const withoutInventory = fixture();
  delete withoutInventory.sheet_wu_pin_biao;
  withoutInventory.sheet_inventory = '占用但不是有效表';
  const repaired = plan(withoutInventory);
  assert.equal(repaired.changed, false);
  assert.equal(repaired.repairedTemplate.sheet_inventory, '占用但不是有效表');
  assert.equal(repaired.repairedTemplate.sheet_inventory_2, undefined);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('不是有效对象')));
  assert.equal(plan(repaired.repairedTemplate).changed, false);
});

test('不完整的新表 DDL 不生成无效模板', () => {
  const data = fixture();
  delete data.sheet_wu_pin_biao;
  const custom = clone(preset);
  custom.template.sheet_inventory = {
    name: '物品表', content: [['名称']],
    sourceData: { ddl: 'CREATE TABLE inventory (\n  title TEXT -- 名称\n);' },
  };
  const repaired = plan(data, custom);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('row_id INTEGER PRIMARY KEY')));
  assert.equal(repaired.repairedTemplate.sheet_inventory, undefined);
});

test('新表 DDL 注释和数据库规范化表头不一致时不生成候选', () => {
  const data = fixture();
  delete data.sheet_quests;
  const before = clone(data);
  const repaired = plan(data);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('列注释与数据库校验要求的表头不一致')));
  assert.deepEqual(repaired.repairedTemplate, before);
});

test('预设内共享别名时检查和计划都报告冲突，不漏掉一张表', () => {
  const data = fixture();
  const custom = clone(preset);
  custom.builtin = false;
  custom.template = {
    sheet_a: { name: '合成甲', content: [['名称']], sourceData: { tableAliases: ['共同别名'] } },
    sheet_b: { name: '合成乙', content: [['名称']], sourceData: { tableAliases: ['共同别名'] } },
  };
  const before = clone(data);
  assert.ok(issuesContaining(report(data, custom), '表名或别名冲突').length > 0);
  const repaired = plan(data, custom);
  assert.equal(repaired.changed, false);
  assert.ok(repaired.manualIssues.some(issue => issue.includes('别名冲突')));
  assert.deepEqual(repaired.repairedTemplate, before);
});

test('两项预设要求通过 key 和显示名认领同一张表时报告冲突', () => {
  const data = fixture();
  const custom = clone(preset);
  custom.builtin = false;
  custom.template = {
    sheet_wu_pin_biao: { name: '另一要求', content: [['物品名称']], sourceData: {} },
    sheet_other_requirement: { name: '物品表', content: [['物品名称']], sourceData: {} },
  };
  const result = report(data, custom);
  assert.ok(issuesContaining(result, '多项表要求匹配同一张已有表').length > 0);
  assert.equal(plan(data, custom).changed, false);
});

test('自定义缺失表不猜测数据库的拼音名称和列名校验', () => {
  for (const sheet of [
    { name: '😀', content: [['名称']], sourceData: {} },
    { name: '合成表', content: [['理', '李']], sourceData: {} },
  ]) {
    const data = fixture();
    const custom = clone(preset);
    custom.builtin = false;
    custom.id = 'custom';
    custom.template = { sheet_custom: sheet };
    const repaired = plan(data, custom);
    assert.equal(repaired.changed, false);
    assert.equal(repaired.repairedTemplate.sheet_custom, undefined);
    assert.ok(repaired.manualIssues.some(issue => issue.includes('纯校验接口')));
  }
});

test('锁定行以 row_id 区分同名记录，书签沿用原业务主键', () => {
  const indexPath = path.join(root, 'src/骰子系统/index.ts');
  const text = fs.readFileSync(indexPath, 'utf8');
  const ast = ts.createSourceFile(indexPath, text, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  let primaryKeys;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'PRIMARY_KEYS') primaryKeys = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const funcs = ['getRowKey', 'getRowLockKey', 'findRowIndexByPrimaryKey'];
  for (const name of funcs) assert.ok(declarations.has(name), name);
  assert.ok(primaryKeys);
  const js = ts.transpileModule(
    `const PRIMARY_KEYS = ${primaryKeys};\n${funcs.map(name => declarations.get(name)).join('\n')}\nresult = { ${funcs.join(',')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const data = { sheet_test: { name: '主角信息表', content: [[null, '姓名'], [10, '同名'], [20, '同名']] } };
  const sandbox = { result: null, getTableData: () => data, console };
  vm.runInNewContext(js, sandbox, { timeout: 1000 });
  const { getRowKey, getRowLockKey, findRowIndexByPrimaryKey } = sandbox.result;
  const [headers, first, second] = data.sheet_test.content;
  assert.equal(getRowKey('主角信息表', first, headers), '姓名=同名');
  assert.equal(getRowLockKey('主角信息表', first, headers), 'row_id=10');
  assert.equal(findRowIndexByPrimaryKey('sheet_test', '主角信息表', getRowLockKey('主角信息表', second, headers)), 1);
  assert.equal(findRowIndexByPrimaryKey('sheet_test', '主角信息表', '姓名=同名'), null);
});

for (const [name, fn] of cases) {
  try { fn(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { process.stderr.write(`FAIL ${name}\n${error.stack}\n`); process.exitCode = 1; }
}
