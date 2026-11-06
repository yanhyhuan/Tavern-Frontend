// Copy into the unchanged database checkout's tests/integration directory.
// Uses real public CRUD, SQLite commits and V2 replay; only the host/UI are simulated.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[], savedChat: [] as any[], current: null as any, provider: null as any,
  settings: { storageMode: 'sqlite', dataIsolationEnabled: false, dataIsolationCode: '', skipUpdateFloors: 0, updateBatchSize: 1 } as any,
  chatId: 'dice-public-crud-synthetic',
  save: vi.fn(),
}));
vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.save, saveChatToHostStrict_ACU: mocks.save,
  registerPostChatSaveListener_ACU: vi.fn(),
}));
vi.mock('../../src/data/repositories/chat-message-data-repo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/data/repositories/chat-message-data-repo')>()),
  cloneIsolatedData_ACU: vi.fn((message: any) => JSON.parse(JSON.stringify(message.TavernDB_ACU_IsolatedData || {}))),
  writeMessageIdentity_ACU: vi.fn(() => {}),
}));
vi.mock('../../src/shared/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/shared/utils')>()),
  logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn(), logError_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(() => JSON.parse(JSON.stringify(TEMPLATE))),
}));
vi.mock('../../src/service/runtime/state-manager', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/runtime/state-manager')>()),
  settings_ACU: mocks.settings,
  get currentChatFileIdentifier_ACU() { return mocks.chatId; },
  isAutoUpdatingCard_ACU: false,
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  get currentJsonTableData_ACU() { return mocks.current; },
  _set_currentJsonTableData_ACU: vi.fn((value: any) => { mocks.current = value; }),
}));
vi.mock('../../src/data/storage/chat-history', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/data/storage/chat-history')>()),
  getActiveChatStorageIdentity_ACU: vi.fn(() => mocks.chatId),
}));
vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true), getCurrentStorageMode: vi.fn(() => 'sqlite'),
}));
vi.mock('../../src/service/table/table-storage-strategy', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/service/table/table-storage-strategy')>()),
  ensureStorageProviderReady_ACU: vi.fn(async () => mocks.provider),
  getStorageProvider: vi.fn(() => mocks.provider), getActiveStorageProvider: vi.fn(() => mocks.provider),
  reloadStorageProvider: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../src/service/worldbook/pipeline', () => ({
  deleteAllGeneratedEntries_ACU: vi.fn(), loadAllChatMessages_ACU: vi.fn(),
  updateReadableLorebookEntry_ACU: vi.fn(),
}));
vi.mock('../../src/presentation/components/pipeline-ui-helpers', () => ({
  refreshMergedDataAndNotifyWithUI_ACU: vi.fn(async () => {}),
}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const TEMPLATE = {
  mate: { type: 'chatSheets', version: 1 },
  sheet_he_cheng_jue_se: {
    uid: 'sheet_he_cheng_jue_se', name: '重要角色表', orderNo: 0,
    content: [['row_id', '姓名', '一句话介绍'], ['17', '合成甲', '旧描述'], ['29', '合成乙', '保持不变']],
    sourceData: { ddl: 'CREATE TABLE synthetic_role (\n row_id INTEGER PRIMARY KEY, -- 行号\n name TEXT UNIQUE, -- 姓名\n description TEXT -- 一句话介绍\n);' },
    updateConfig: {}, exportConfig: {},
  },
  sheet_other: {
    uid: 'sheet_other', name: '合成附表', orderNo: 1,
    content: [['row_id', '内容'], ['8', '不受影响']],
    sourceData: { ddl: 'CREATE TABLE other_physical (\n row_id INTEGER PRIMARY KEY, -- 行号\n value TEXT -- 内容\n);' },
    updateConfig: {}, exportConfig: {},
  },
  sheet_empty: {
    uid: 'sheet_empty', name: '合成空表', orderNo: 2, content: [['row_id', '内容']],
    sourceData: { ddl: 'CREATE TABLE empty_physical (\n row_id INTEGER PRIMARY KEY, -- 行号\n value TEXT -- 内容\n);' },
    updateConfig: {}, exportConfig: {},
  },
};

import { SqlTableService } from '../../src/service/table/sql-table-service';
import { createTableCrudApi } from '../../src/presentation/bootstrap/api-groups/table-crud-api';
import { createTableHistoryApi } from '../../src/presentation/bootstrap/api-groups/table-history-api';
import { loadTableStateFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';
import { clearRuntimeOnlyPendingSheets_ACU } from '../../src/service/table/runtime-only-pending-state';
import { _set_currentChatFileIdentifier_ACU } from '../../src/service/runtime/state-manager';
import { _set_SillyTavern_API_ACU } from '../../src/shared/host-api';

const host = () => _set_SillyTavern_API_ACU({ chat: mocks.chat, chatId: mocks.chatId, characterId: 0, groupId: null, saveChat: mocks.save } as any);

describe('original public CRUD with real SQLite and V2 persisted replay', () => {
  beforeEach(async () => {
    clearRuntimeOnlyPendingSheets_ACU();
    _set_currentChatFileIdentifier_ACU(mocks.chatId);
    mocks.chat.splice(0, mocks.chat.length, { is_user: false, mes: '合成测试首楼', swipe_id: 0 });
    mocks.savedChat = [];
    mocks.save.mockReset().mockImplementation(async () => { mocks.savedChat = clone(mocks.chat); });
    host();
    mocks.current = clone(TEMPLATE);
    mocks.provider = new SqlTableService();
    expect((await mocks.provider.loadFromData(clone(TEMPLATE)))).not.toHaveProperty('error');
  });

  it('object-form updateCell persists only the changed cell and survives a fresh replay/runtime', async () => {
    const api = createTableCrudApi({} as any);
    expect(await api.updateCell({ tableName: '重要角色表', rowIndex: 1, colIdentifier: '一句话介绍', value: '正则转换后描述', skipNotify: true })).toBe(true);
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.savedChat[0].TavernDB_ACU_IsolatedData['']._acu_storage_version).toBe(2);
    const expected = clone(TEMPLATE);
    expected.sheet_he_cheng_jue_se.content[1][2] = '正则转换后描述';
    expect(mocks.provider.getCurrentData()).toEqual(expected);
    const publicRead = await createTableHistoryApi().exportTableSnapshotsAtMessages([0]);
    expect(publicRead.success, JSON.stringify(publicRead)).toBe(true);
    expect(publicRead.snapshots[0].data).toEqual(expected);
    // Reopen the host's saved copy, discard the current runtime, then hydrate a new one.
    mocks.chat.splice(0, mocks.chat.length, ...clone(mocks.savedChat));
    host();
    const replay = await loadTableStateFromFramesV2Detailed_ACU(mocks.chat, '', { maxMessageIndex: 0, updateRuntimeState: false });
    expect(replay?.data).toEqual(expected);
    const reopened = new SqlTableService();
    expect((await reopened.loadFromData(replay!.data))).not.toHaveProperty('error');
    expect(reopened.getCurrentData()).toEqual(expected);
  });

  it('original API limitation: later edits can append to an earlier existing frame and alter its replay', async () => {
    const api = createTableCrudApi({} as any);
    expect(await api.updateCell({ tableName: '重要角色表', rowIndex: 1, colIdentifier: 2, value: '第一次', skipNotify: true })).toBe(true);
    const firstMessage = clone(mocks.savedChat[0]);
    mocks.chat.push({ is_user: true, mes: '合成用户消息' }, { is_user: false, mes: '合成第二轮', swipe_id: 0 });
    expect(await api.updateCell({ tableName: '重要角色表', rowIndex: 1, colIdentifier: 2, value: '第二次', skipNotify: true })).toBe(true);
    expect(mocks.savedChat[0]).not.toEqual(firstMessage);
    // This is the unmodified database's behavior, not a frontend JSON fallback.
    // Do not hide the limitation by claiming every earlier history floor stays unchanged.
    const history = await createTableHistoryApi().exportTableSnapshotsAtMessages([0, 2]);
    expect(history.success, JSON.stringify(history)).toBe(true);
    expect(history.snapshots[0].data.sheet_he_cheng_jue_se.content[1][2]).toBe('第二次');
    expect(history.snapshots[1].data.sheet_he_cheng_jue_se.content[1][2]).toBe('第二次');
    expect(history.snapshots[1].data.sheet_other).toEqual(TEMPLATE.sheet_other);
  });

  it('host persistence rejection returns failure instead of claiming success', async () => {
    mocks.save.mockRejectedValue(new Error('synthetic host save failed'));
    const api = createTableCrudApi({} as any);
    expect(await api.updateCell({ tableName: '重要角色表', rowIndex: 1, colIdentifier: '一句话介绍', value: '无法持久化', skipNotify: true })).toBe(false);
    expect(mocks.savedChat).toEqual([]);
  });
});
