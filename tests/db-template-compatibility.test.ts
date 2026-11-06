import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateImportedTemplateObject_ACU } from '../../src/service/template/template-import-validator';
import { validateDDLTextAgainstHeaders_ACU } from '../../src/shared/ddl-utils';
import { validateSqliteTemplateDataStrict_ACU } from '../../src/service/table/sqlite-template-validation';
import { parseImportedTemplateData_ACU } from '../../src/service/template/template-preset-service';
import { reconcileChatTemplate_ACU } from '../../src/service/template/chat-template-reconciler';
import { parseDDLTableName } from '../../src/shared/ddl-utils';
import { detectPhysicalTableNameCollisions_ACU, resolvePhysicalTableName_ACU } from '../../src/shared/sheet-identity';

// Place this test in the database's tests/integration directory. The frontend
// directory is explicit so the test can be run from any pair of checkouts.
const frontendRoot = process.env.DICE_FRONTEND_ROOT || resolve(process.cwd(), '../Tavern-Frontend');
const frontendUrl = pathToFileURL(join(frontendRoot, 'src/骰子系统/table-template-requirements.ts')).href;
const { buildTableTemplateAppendRepairPlan, createBuiltinTableTemplateRequirementPreset, resolveDatabase136PhysicalName } = await import(/* @vite-ignore */ frontendUrl);
const legacyRaw = readFileSync(join(frontendRoot, 'tests/fixtures/legacy-dice-template.json'), 'utf8');
const variants = [
  { name: '数据库默认', raw: readFileSync(join(frontendRoot, 'assets/templates/database-default-1.3.6.json'), 'utf8'), kind: 'database-default' },
  { name: 'v4.5', raw: readFileSync(join(frontendRoot, 'assets/templates/TavernDB_template_runtime_SQL_v4.5.json'), 'utf8'), kind: 'v4.5' },
  { name: '旧版回归夹具', raw: legacyRaw, kind: 'v4.5' },
];

describe('骰子模板新增表与数据库 1.3.6 导入契约', () => {
  it('前端物理名解析与原版数据库的中英文、符号、长度和回退规则一致', () => {
    const samples: Array<[unknown, string]> = [
      ['物品表', 'sheet_item'], ['物品标', 'sheet_other'], ['重庆銀行', 'sheet_bank'],
      ['ＡＢＣ', 'sheet_fullwidth'], ['a   b', 'sheet_space'], ['42 赤壁', 'sheet_number'],
      ['繁體角色表', 'sheet_traditional'], ['sqlite_东西', 'sheet_reserved'],
      ['A'.repeat(60) + '张', 'sheet_long'], ['😀', 'sheet_emoji'], ['', 'sheet_fallback'],
    ];
    for (const [name, key] of samples) {
      expect(resolveDatabase136PhysicalName(name, key)).toBe(resolvePhysicalTableName_ACU({ name } as any, key));
    }
  });

  it('同音但不同名的候选会被数据库真实 SQLite 校验拒绝，前端须整体停止', async () => {
    const raw = variants[1].raw;
    const preset = createBuiltinTableTemplateRequirementPreset(raw, 'v4.5');
    const input: Record<string, any> = JSON.parse(raw);
    const inventory = input.sheet_wu_pin_biao;
    delete input.sheet_wu_pin_biao;
    delete input.sheet_zhuang_bei_biao;
    input.sheet_other = {
      uid: 'sheet_other', name: '物品标', orderNo: 99,
      content: [['row_id', '内容'], ['9', '保留']],
      sourceData: { ddl: 'CREATE TABLE other_physical (\n row_id INTEGER PRIMARY KEY, -- 行号\n body TEXT -- 内容\n);' },
    };
    const before = JSON.parse(JSON.stringify(input));
    const unsafeCandidate = { ...input, sheet_wu_pin_biao: inventory };
    expect(detectPhysicalTableNameCollisions_ACU(unsafeCandidate)).toHaveLength(1);
    const dbResult = await validateSqliteTemplateDataStrict_ACU(unsafeCandidate);
    expect(dbResult.success).toBe(false);
    expect(dbResult.error).toContain('物理表名冲突');
    const plan = buildTableTemplateAppendRepairPlan(input, preset);
    expect(plan.changed).toBe(false);
    expect(plan.actions).toEqual([]);
    expect(plan.repairedTemplate).toEqual(before);
    expect(plan.manualIssues.join('\n')).toContain('物理表名');
  });

  it('不相关附表原有的同音列只影响合并模板，新增表片段仍须通过数据库校验', () => {
    const raw = variants[1].raw;
    const preset = createBuiltinTableTemplateRequirementPreset(raw, 'v4.5');
    const input: Record<string, any> = JSON.parse(raw);
    delete input.sheet_wu_pin_biao;
    input.sheet_other = {
      uid: 'sheet_other', name: '合成附表', orderNo: 99,
      content: [['row_id', '理', '李']],
      sourceData: { ddl: 'CREATE TABLE other_physical (\n row_id INTEGER PRIMARY KEY, -- 行号\n li_one TEXT, -- 理\n li_two TEXT -- 李\n);' },
    };
    const before = JSON.parse(JSON.stringify(input));
    const plan = buildTableTemplateAppendRepairPlan(input, preset);
    expect(plan.changed).toBe(true);
    const candidate = plan.repairedTemplate as Record<string, any>;
    expect(candidate.sheet_other).toEqual(before.sheet_other);
    expect(validateImportedTemplateObject_ACU({ sheet_wu_pin_biao: candidate.sheet_wu_pin_biao })).toEqual([]);
    expect(validateImportedTemplateObject_ACU(candidate)).toContainEqual(expect.objectContaining({
      code: 'physical_column_name_collision', sheetKey: 'sheet_other',
    }));
  });

  for (const { name, raw, kind } of variants) {
    const preset = createBuiltinTableTemplateRequirementPreset(raw, kind);
    const validKeys = Object.keys(preset.template).filter(key => name !== '旧版回归夹具' || key !== 'sheet_quests');
    it.each(validKeys)(`${name} 新增 %s 时满足真实导入、DDL 和 SQLite 校验`, async key => {
    const input: Record<string, any> = JSON.parse(raw);
    delete input[key];
    input.sheet_extra = {
      uid: 'sheet_extra', name: '合成附表', orderNo: 99,
      content: [['row_id', '内容'], ['9', '保留其他表数据']],
      sourceData: { ddl: 'CREATE TABLE sheet_extra (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  body TEXT -- 内容\n);' },
    };
    const before = JSON.parse(JSON.stringify(input));
    const plan = buildTableTemplateAppendRepairPlan(input, preset);
    expect(plan.changed, plan.manualIssues.join('\n')).toBe(true);
    expect(plan.repairedTemplate).toBeTruthy();
    const candidate: any = plan.repairedTemplate;
    for (const [existingKey, existingSheet] of Object.entries(before)) {
      expect(candidate[existingKey]).toEqual(existingSheet);
    }
    expect(candidate[key].uid).toBe(key);
    expect(candidate[key].content[0][0]).toBe('row_id');
    expect(validateImportedTemplateObject_ACU(candidate)).toEqual([]);
    expect(validateDDLTextAgainstHeaders_ACU(candidate[key].sourceData.ddl, candidate[key].content[0])).toMatchObject({ valid: true });
    expect(await validateSqliteTemplateDataStrict_ACU(candidate)).toEqual({ success: true });
    const repeated = buildTableTemplateAppendRepairPlan(candidate, preset);
    expect(repeated.changed).toBe(false);
    expect(repeated.repairedTemplate).toEqual(candidate);
    });
  }

  it('旧版任务表的原始 DDL 注释不符合数据库校验时拒绝生成候选', () => {
    const input: Record<string, any> = JSON.parse(legacyRaw);
    const preset = createBuiltinTableTemplateRequirementPreset(legacyRaw, 'v4.5');
    const quest = input.sheet_quests;
    expect(validateDDLTextAgainstHeaders_ACU(quest.sourceData.ddl, quest.content[0]).valid).toBe(false);
    delete input.sheet_quests;
    const before = JSON.parse(JSON.stringify(input));
    const plan = buildTableTemplateAppendRepairPlan(input, preset);
    expect(plan.changed).toBe(false);
    expect(plan.manualIssues.join('\n')).toContain('列注释与数据库校验要求的表头不一致');
    expect(plan.repairedTemplate).toEqual(before);
  });

  it('数据库真实导入解析拒绝缺失 uid，并可能迁移已有配置', () => {
    const input: Record<string, any> = JSON.parse(legacyRaw);
    delete input.sheet_inventory.uid;
    expect(() => parseImportedTemplateData_ACU(input)).toThrow(/缺少 uid/);

    const synthetic = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_sample: {
        uid: 'sheet_sample', name: '示例表', orderNo: 0,
        content: [['row_id', '内容']], sourceData: {}, updateConfig: { contextDepth: 0 },
      },
    };
    const prepared = parseImportedTemplateData_ACU(synthetic);
    expect(prepared.templateObj.sheet_sample.updateConfig.contextDepth).toBe(-1);
    expect(synthetic.sheet_sample.updateConfig.contextDepth).toBe(0);
  });

  it('数据库真实协调器可能重绑已有表的 DDL 名称', async () => {
    const before = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_sample: {
        uid: 'sheet_sample', name: '示例表', orderNo: 0,
        content: [['row_id', '内容'], ['1', '保留']],
        sourceData: { ddl: 'CREATE TABLE old_sample (\n row_id INTEGER PRIMARY KEY, -- 行号\n body TEXT -- 内容\n);' },
      },
    };
    const candidate: Record<string, any> = JSON.parse(JSON.stringify(before));
    candidate.sheet_other = {
      uid: 'sheet_other', name: '新增表', orderNo: 1, content: [['row_id', '内容']],
      sourceData: { ddl: 'CREATE TABLE other (\n row_id INTEGER PRIMARY KEY, -- 行号\n body TEXT -- 内容\n);' },
    };
    const result = await reconcileChatTemplate_ACU({
      baselineData: before, templateData: candidate, storageMode: 'sqlite', destructiveChangeConfirmed: false,
    });
    expect(result.blockers).toEqual([]);
    expect(parseDDLTableName(result.candidateData.sheet_sample.sourceData.ddl)).toBe('sheet_sample');
    expect(parseDDLTableName(before.sheet_sample.sourceData.ddl)).toBe('old_sample');
    expect(before.sheet_sample.content[1]).toEqual(['1', '保留']);
  });
});
