/* Modified by yanhyhuan on 2026-11-06: Tavern Frontend V1.0.1 database-template, public-CRUD and extension compatibility. Upstream: jerryzmtz/my-tavern-scripts v6.32; see LICENSE. */
type TableData = Record<string, any>;
type ContextApi = {
  getTableHistoryContext?: () => unknown;
};

// 只使用数据库 1.3.6 的公开上下文 API；空 isolationKey 也是有效环境。
export const bindCrudWriteContext = <T extends ContextApi>(
  api: T,
  getCurrentApi: () => unknown,
  getEpoch: () => number,
): T & { assertCurrent: () => void } => {
  const fingerprint = (): string => {
    const context = api.getTableHistoryContext?.() as Record<string, unknown> | undefined;
    const chatId = context?.chatId;
    const hasChatId = (typeof chatId === 'string' && chatId.trim().length > 0) ||
      (typeof chatId === 'number' && Number.isFinite(chatId));
    if (context?.version !== 1 || !hasChatId ||
        typeof context.isolationKey !== 'string') {
      throw new Error('无法确认数据库聊天/隔离环境，请等待数据库就绪后再保存。');
    }
    return JSON.stringify([context.chatId, context.characterId, context.groupId, context.isolationKey]);
  };
  const origin = fingerprint();
  const epoch = getEpoch();
  const assertCurrent = (): void => {
    if (getCurrentApi() !== api || getEpoch() !== epoch || fingerprint() !== origin) {
      throw new Error('聊天或数据库隔离环境已切换，已停止剩余写入；先前操作可能已部分保存，请回到原聊天核对。');
    }
  };
  const bound = Object.create(api);
  bound.assertCurrent = assertCurrent;
  for (const name of ['updateCell', 'insertRow', 'deleteRow', 'exportTableSnapshotsAtMessages']) {
    const method = (api as Record<string, any>)[name];
    if (typeof method !== 'function') continue;
    bound[name] = async (...args: unknown[]) => {
      assertCurrent();
      // 原版 1.3.6 的公开 CRUD 没有 expectedChat/取消参数；前后检查只能
      // 阻止后续调用，不能原子取消已进入数据库内部的调用。
      const result = await method.apply(api, args);
      assertCurrent();
      return result;
    };
  }
  for (const name of ['getCurrentData', 'exportTableAsJson', '_notifyTableUpdate']) {
    const method = (api as Record<string, any>)[name];
    if (typeof method !== 'function') continue;
    bound[name] = (...args: unknown[]) => {
      assertCurrent();
      return method.apply(api, args);
    };
  }
  return bound;
};

const cellEquals = (left: unknown, right: unknown): boolean => String(left ?? '') === String(right ?? '');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sheetShape = (sheet: any): string =>
  JSON.stringify([sheet?.uid, sheet?.name, sheet?.content?.[0], sheet?.sourceData?.ddl]);

const rowsById = (sheet: any): Map<string, any[]> => {
  if (!Array.isArray(sheet?.content) || !Array.isArray(sheet.content[0])) {
    throw new Error('表格结构无效，已取消正则保存。');
  }
  const result = new Map<string, any[]>();
  for (const row of sheet.content.slice(1)) {
    const id = Array.isArray(row) ? String(row[0] ?? '').trim() : '';
    if (!id || result.has(id) || row.length !== sheet.content[0].length) {
      throw new Error(`表“${sheet.name}”存在缺失/重复 row_id 或行宽冲突，已取消保存。`);
    }
    result.set(id, row);
  }
  return result;
};

export type RegexCellChange = { sheetKey: string; rowId: string; colIndex: number; value: unknown };

// 原版 CRUD 在内部等待后才选择行；除目标值外，还必须核对未修改的数据。
// 这只能发现并发副作用，不能原子取消或回滚已进入原版 API 的调用。
export const assertRegexScopeUnchanged = (
  before: TableData,
  actual: TableData,
  changes: RegexCellChange[],
): void => {
  const keys = (data: TableData): string[] => Object.keys(data || {}).filter(key => key.startsWith('sheet_')).sort();
  const sheetKeys = keys(before);
  if (JSON.stringify(sheetKeys) !== JSON.stringify(keys(actual))) {
    throw new Error('正则保存期间表格集合已变化，不能确认保存成功。');
  }
  for (const key of sheetKeys) {
    const original = before[key];
    const live = actual[key];
    if (sheetShape(original) !== sheetShape(live)) {
      throw new Error(`表“${original?.name || key}”身份或结构已变化，不能确认正则保存成功。`);
    }
    const targets = changes.filter(change => change.sheetKey === key);
    if (targets.length === 0) {
      if (JSON.stringify(original?.content) !== JSON.stringify(live?.content)) {
        throw new Error(`未修改的表“${original?.name || key}”数据发生变化，不能确认正则保存成功。`);
      }
      continue;
    }
    const oldRows = rowsById(original);
    const liveRows = rowsById(live);
    if (oldRows.size !== liveRows.size || [...oldRows.keys()].some(id => !liveRows.has(id))) {
      throw new Error(`表“${original.name}”行身份已变化，不能确认正则保存成功。`);
    }
    const targetCells = new Set(targets.map(change => JSON.stringify([change.rowId, change.colIndex])));
    for (const [id, row] of oldRows) {
      const liveRow = liveRows.get(id)!;
      for (let colIndex = 1; colIndex < row.length; colIndex++) {
        if (!targetCells.has(JSON.stringify([id, colIndex])) && !cellEquals(row[colIndex], liveRow[colIndex])) {
          throw new Error(`表“${original.name}”未修改的单元格 row_id=${id}、列“${original.content[0][colIndex]}”发生变化，不能确认正则保存成功。`);
        }
      }
    }
  }
};

// 以转换前快照计算真正的变更，再合并到最新公开快照，避免覆盖排队期间的其他编辑。
export const prepareRegexCellChanges = (
  before: TableData,
  desired: TableData,
  current: TableData,
  keys: string[],
): { data: TableData; sheetKeys: string[]; changes: RegexCellChange[] } => {
  const data = clone(current);
  const changes: RegexCellChange[] = [];
  const sheetKeys: string[] = [];
  for (const key of new Set(keys)) {
    const original = before[key];
    const next = desired[key];
    const live = data[key];
    if (!key.startsWith('sheet_') || !original || !next || !live ||
        sheetShape(original) !== sheetShape(next) || sheetShape(original) !== sheetShape(live)) {
      throw new Error(`表“${original?.name || key}”身份或结构已变化，已取消正则保存。`);
    }
    const oldRows = rowsById(original);
    const nextRows = rowsById(next);
    const liveRows = rowsById(live);
    if (oldRows.size !== nextRows.size || [...oldRows.keys()].some(id => !nextRows.has(id))) {
      throw new Error('正则转换不能新增/删除行或更换 row_id。');
    }
    for (const [id, row] of oldRows) {
      const nextRow = nextRows.get(id)!;
      for (let colIndex = 1; colIndex < row.length; colIndex++) {
        if (cellEquals(row[colIndex], nextRow[colIndex])) continue;
        const liveRow = liveRows.get(id);
        if (!liveRow || (!cellEquals(liveRow[colIndex], row[colIndex]) &&
            !cellEquals(liveRow[colIndex], nextRow[colIndex]))) {
          throw new Error(`表“${original.name}” row_id=${id} 的“${original.content[0][colIndex]}”已被其他操作修改，已取消保存。`);
        }
        changes.push({ sheetKey: key, rowId: id, colIndex, value: nextRow[colIndex] });
        liveRow[colIndex] = nextRow[colIndex];
      }
    }
    if (changes.some(change => change.sheetKey === key)) sheetKeys.push(key);
  }
  return { data, sheetKeys, changes };
};

export const countVerifiedRegexChanges = (data: TableData, changes: RegexCellChange[]): number =>
  changes.filter(change => {
    const row = rowsById(data[change.sheetKey]).get(change.rowId);
    return row && cellEquals(row[change.colIndex], change.value);
  }).length;
