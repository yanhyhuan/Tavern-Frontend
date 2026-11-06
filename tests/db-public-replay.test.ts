import { afterEach, describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createTableHistoryApi } from '../../src/presentation/bootstrap/api-groups/table-history-api';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../src/shared/host-api';
import { _set_currentJsonTableData_ACU, currentJsonTableData_ACU, _set_settings_ACU, settings_ACU } from '../../src/service/runtime/state-manager';

const original = { host: SillyTavern_API_ACU, tables: currentJsonTableData_ACU, settings: settings_ACU };
// Copy this file into the database checkout's tests/integration directory and
// point DICE_FRONTEND_ROOT to the frontend checkout before running Vitest.
const frontendRoot = process.env.DICE_FRONTEND_ROOT;
if (!frontendRoot) throw new Error('请设置 DICE_FRONTEND_ROOT 指向前端源码目录');
const guardUrl = pathToFileURL(join(frontendRoot, 'src/骰子系统/crud-write-guard.ts')).href;
const { assertRegexScopeUnchanged, countVerifiedRegexChanges } = await import(/* @vite-ignore */ guardUrl);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const checkpoint = () => ({
  mate: { type: 'acu', version: 1 },
  sheet_role: {
    uid: 'sheet_role', name: '重要角色表', orderNo: 0,
    content: [['row_id', 'name', 'state'], ['1', '合成甲', '旧值'], ['2', '合成乙', '保留']],
    sourceData: { ddl: 'CREATE TABLE sheet_role (row_id INTEGER PRIMARY KEY, name TEXT, state TEXT);' },
    updateConfig: {}, exportConfig: {},
  },
  sheet_empty: {
    uid: 'sheet_empty', name: '空表', orderNo: 1,
    content: [['row_id', 'value']],
    sourceData: { ddl: 'CREATE TABLE sheet_empty (row_id INTEGER PRIMARY KEY, value TEXT);' },
    updateConfig: {}, exportConfig: {},
  },
  sheet_other: {
    uid: 'sheet_other', name: '其他表', orderNo: 2,
    content: [['row_id', 'value'], ['7', '不变']],
    sourceData: { ddl: 'CREATE TABLE sheet_other (row_id INTEGER PRIMARY KEY, value TEXT);' },
    updateConfig: {}, exportConfig: {},
  },
});
const chatFixture = () => [
  { is_user: false, swipe_id: 0, TavernDB_ACU_IsolatedData: { '': {
    _acu_storage_version: 2, storageFrame: { version: 2, headRevision: '1:opening',
      checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpoint(),
        event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] } }, logEntries: [] },
  } } },
  { is_user: true, mes: 'synthetic no-frame message' },
  { is_user: false, TavernDB_ACU_IsolatedData: { '': {
    _acu_storage_version: 2, storageFrame: { version: 2, headRevision: '1:later', logEntries: [{
      seq: 1, entryId: 'synthetic', createdAt: 2, source: 'manual_crud', targetMessageIndex: 2, aiFloor: 3,
      filledSheetKeys: ['sheet_role'], changedSheetKeys: ['sheet_role'], groupKeys: [],
      operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_role', tableName: 'sheet_role',
        statements: ["UPDATE sheet_role SET state = '新值' WHERE row_id = 1"], reason: 'system' }],
    }] },
  } } },
];
const setHost = (chat: any[]) => _set_SillyTavern_API_ACU({ chat, chatId: 'synthetic-replay', characterId: 0, saveChat: vi.fn() } as any);
afterEach(() => {
  _set_SillyTavern_API_ACU(original.host);
  _set_currentJsonTableData_ACU(original.tables);
  _set_settings_ACU(original.settings);
});

describe('original 1.3.6 public V2 replay with all sheets', () => {
  it('returns complete checkpoint sheets including header-only table and survives synthetic reopening', async () => {
    const baseline = checkpoint();
    const live = clone(baseline);
    live.sheet_role.content[1][2] = '新值';
    const chat = chatFixture();
    setHost(chat);
    _set_settings_ACU({ ...original.settings, dataIsolationEnabled: false });
    _set_currentJsonTableData_ACU(live as any);
    const first = await createTableHistoryApi().exportTableSnapshotsAtMessages([2]);
    expect(first.success, JSON.stringify(first)).toBe(true);
    if (!first.success) throw new Error(first.error);
    const data = first.snapshots[0].data as any;
    const keys = (value: any) => Object.keys(value).filter(k => k.startsWith('sheet_')).sort();
    expect(keys(data)).toEqual(keys(live));
    expect(data.sheet_empty).toEqual(live.sheet_empty);
    expect(data.sheet_other).toEqual(live.sheet_other);
    expect(countVerifiedRegexChanges(data, [{ sheetKey: 'sheet_role', rowId: '1', colIndex: 2, value: '新值' }])).toBe(1);
    expect(() => assertRegexScopeUnchanged(baseline, data, [{ sheetKey: 'sheet_role', rowId: '1', colIndex: 2, value: '新值' }])).not.toThrow();

    // Reopen only a JSON-cloned synthetic chat; the replay does not use current runtime tables.
    setHost(clone(chat));
    _set_currentJsonTableData_ACU(null);
    const reopened = await createTableHistoryApi().exportTableSnapshotsAtMessages([2]);
    expect(reopened.success).toBe(true);
    if (!reopened.success) throw new Error(reopened.error);
    expect(reopened.snapshots[0].data).toEqual(data);
  });

  it('does not fabricate tables present only in runtime but absent from history', async () => {
    const live: any = checkpoint();
    live.sheet_unpersisted = { uid: 'sheet_unpersisted', name: '未落盘表', content: [['row_id', 'value']] };
    setHost(chatFixture());
    _set_settings_ACU({ ...original.settings, dataIsolationEnabled: false });
    _set_currentJsonTableData_ACU(live);
    const result = await createTableHistoryApi().exportTableSnapshotsAtMessages([2]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect((result.snapshots[0].data as any).sheet_unpersisted).toBeUndefined();
    expect(() => assertRegexScopeUnchanged(live, result.snapshots[0].data, [])).toThrow(/表格集合已变化/);
  });
});
