/* Modified by yanhyhuan on 2026-11-06: Tavern Frontend V1.0.1 database-template, public-CRUD and extension compatibility. Upstream: jerryzmtz/my-tavern-scripts v6.32; see LICENSE. */
// Dice-side defaults for the unchanged database 1.3.6 template.
export type DatabaseValidationRule = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  intercept: boolean;
  targetTable: string;
  targetColumn: string | null;
  ruleType: string;
  config: Record<string, unknown>;
  errorMessage: string;
};

export const createDatabaseDefaultValidationRules = (): DatabaseValidationRule[] => {
  const rules: DatabaseValidationRule[] = [];
  const add = (table: string, column: string | null, kind: string, config: Record<string, unknown>, message: string) => {
    rules.push({
      id: `database_default_${table}_${column || 'rows'}_${kind}`,
      name: `${table}${column ? `·${column}` : ''}`,
      description: message, enabled: true, builtin: true, intercept: false,
      targetTable: table, targetColumn: column, ruleType: kind, config, errorMessage: message,
    });
  };
  const required: Record<string, string[]> = {
    全局数据表: ['全局状态', '当前详细地点', '当前次要地区', '当前主要地区', '经过的时间', '当前时间'],
    主角信息表: ['姓名', '性别', '年龄', '外貌特征', '身份', '近况', '所在地点'],
    重要角色表: ['姓名', '一句话介绍', '所在地点', '在场状态', '人际关系'],
    主角技能表: ['技能名称', '技能类型', '等级/阶段', '效果描述'],
    背包物品表: ['物品名称', '数量', '描述/效果', '类别'],
    任务与事件表: ['任务名称', '任务类型', '详细描述', '当前进度'],
    纪要表: ['编码索引', '时间跨度', '概览', '纪要'],
    选项表: ['选项一', '选项二', '选项三', '选项四'],
  };
  for (const [table, columns] of Object.entries(required)) {
    for (const column of columns) add(table, column, 'required', {}, `${column}不能为空`);
  }
  for (const table of ['全局数据表', '主角信息表', '选项表']) {
    add(table, null, 'rowLimit', { min: 0, max: 1 }, '初始化后最多保留一行；空模板允许尚未初始化');
  }
  add('全局数据表', '全局状态', 'enum', { values: ['全局状态'] }, '全局状态必须填写“全局状态”');
  add('重要角色表', '在场状态', 'enum', { values: ['在场', '离场'] }, '在场状态必须为在场或离场');
  add('重要角色表', '人际关系', 'keyValue', { valueType: 'text' }, '人际关系应为“角色名:描述;角色名:描述”');
  add('任务与事件表', '任务类型', 'enum', { values: ['主线任务', '支线任务'] }, '任务类型必须为主线任务或支线任务');
  add('背包物品表', '数量', 'format', { pattern: '^\\d+$' }, '数量必须为非负整数');
  add('纪要表', '编码索引', 'format', { pattern: '^AM\\d{4,}$' }, '编码索引应为AM0001起的编号');
  add('纪要表', '编码索引', 'sequence', { prefix: 'AM', startFrom: 1 }, '编码索引必须从AM0001开始递增，不重复、不跳号');
  add('纪要表', '概览', 'format', { pattern: '^[\\s\\S]{1,30}$' }, '概览长度应为1至30字');
  const time = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}';
  add('全局数据表', '当前时间', 'format', { pattern: `^${time}$` }, '当前时间格式应为YYYY-MM-DD HH:MM');
  add('纪要表', '时间跨度', 'format', { pattern: `^${time} ~ ${time}$` }, '时间跨度应为YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM');
  return rules;
};

// The default database stores equipment and ordinary items in the same bag.
// Match its semantic columns; never depend on the template's generated sheet uid.
export const hasDatabaseDefaultBag = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  return Object.entries(data).some(([key, value]) => {
    if (!key.startsWith('sheet_') || !value || typeof value !== 'object') return false;
    const sheet = value as { name?: string; content?: unknown[][] };
    return sheet.name === '背包物品表' && ['row_id', '物品名称', '数量', '描述/效果', '类别']
      .every(header => sheet.content?.[0]?.includes(header));
  });
};

export const formatBagRewardDescription = (description: string, quality: string): string =>
  `【骰子品质:${quality}】${description}`;

export const readBagRewardQuality = (description: unknown): string => {
  const match = String(description || '').match(/^【骰子品质:(普通|优秀|稀有|史诗|传说|神话)】/);
  return match?.[1] || '未标注';
};

// A read-only UI projection, never inserted into exportTableAsJson or the database.
export const createDatabaseLocationView = (data: unknown): { headers: string[]; rows: string[][] } | null => {
  if (!data || typeof data !== 'object') return null;
  const sheets = Object.entries(data).filter(([key]) => key.startsWith('sheet_'))
    .map(([, value]) => value as { name?: string; content?: unknown[][] });
  const named = (name: string) => sheets.find(sheet => sheet?.name === name);
  const cell = (sheet: ReturnType<typeof named>, row: unknown[], header: string): string => {
    const index = sheet?.content?.[0]?.indexOf(header) ?? -1;
    return index >= 0 ? String(row[index] ?? '').trim() : '';
  };
  const global = named('全局数据表');
  const globalRow = global?.content?.[1] || [];
  const current = cell(global, globalRow, '当前详细地点');
  const region = cell(global, globalRow, '当前次要地区');
  const locations = new Map<string, string[]>();
  const add = (name: string, source: string) => {
    if (!name || /^(?:无|未知|null|none)$/i.test(name)) return;
    const row = locations.get(name) || [name, name === current ? region : '', ''];
    row[2] = row[2] ? `${row[2]}；${source}` : source;
    locations.set(name, row);
  };
  add(current, '全局数据表记录的当前地点');
  for (const name of ['主角信息表', '重要角色表']) {
    const sheet = named(name);
    for (const row of sheet?.content?.slice(1) || []) {
      add(cell(sheet, row, '所在地点'), `${cell(sheet, row, '姓名') || name}的已记录位置`);
    }
  }
  return locations.size ? { headers: ['名称', '次要地区', '描述'], rows: [...locations.values()] } : null;
};
