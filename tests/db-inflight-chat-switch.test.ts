// Place in the fixed naiv1.3.6 database checkout's tests/integration directory.
// This is a risk reproduction, not a passing acceptance test for safe switching.
// It exercises the original public CRUD, SQLite and V2 persistence code. Only
// the host, runtime globals, UI and the first provider-readiness wait are controlled.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  savedChats: new Map<string, any[]>(),
  current: null as any,
  provider: null as any,
  chatId: 'synthetic-chat-A',
  settings: {
    storageMode: 'sqlite', dataIsolationEnabled: false, dataIsolationCode: '',
    skipUpdateFloors: 0, updateBatchSize: 1,
  } as any,
  firstReadyWait: null as Promise<void> | null,
  onFirstReadyWait: null as (() => void) | null,
  save: vi.fn(),
}));

vi.mock('../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: vi.fn(() => mocks.chat),
  saveChatToHost_ACU: mocks.save,
  saveChatToHostStrict_ACU: mocks.save,
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
  ensureStorageProviderReady_ACU: vi.fn(async () => {
    const wait = mocks.firstReadyWait;
    if (wait) {
      mocks.firstReadyWait = null;
      mocks.onFirstReadyWait?.();
      await wait;
    }
    return mocks.provider;
  }),
  getStorageProvider: vi.fn(() => mocks.provider),
  getActiveStorageProvider: vi.fn(() => mocks.provider),
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
  sheet_synthetic_role: {
    uid: 'sheet_synthetic_role', name: '重要角色表', orderNo: 0,
    content: [['row_id', '姓名', '一句话介绍'], ['17', '合成甲', 'A 原文'], ['29', '合成乙', '保持不变']],
    sourceData: { ddl: 'CREATE TABLE synthetic_role (\n row_id INTEGER PRIMARY KEY, -- 行号\n name TEXT UNIQUE, -- 姓名\n description TEXT -- 一句话介绍\n);' },
    updateConfig: {}, exportConfig: {},
  },
  sheet_synthetic_other: {
    uid: 'sheet_synthetic_other', name: '合成附表', orderNo: 1,
    content: [['row_id', '内容'], ['8', '附表不变']],
    sourceData: { ddl: 'CREATE TABLE synthetic_other (\n row_id INTEGER PRIMARY KEY, -- 行号\n value TEXT -- 内容\n);' },
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

const frontendRoot = process.env.DICE_FRONTEND_ROOT || resolve(process.cwd(), '../Tavern-Frontend');
const frontendUrl = pathToFileURL(join(frontendRoot, 'src/骰子系统/crud-write-guard.ts')).href;
const { bindCrudWriteContext } = await import(/* @vite-ignore */ frontendUrl);

function publishSyntheticHost() {
  _set_currentChatFileIdentifier_ACU(mocks.chatId);
  _set_SillyTavern_API_ACU({
    chat: mocks.chat, chatId: mocks.chatId, characterId: 0, groupId: null, saveChat: mocks.save,
  } as any);
}

describe('风险复现：原版 updateCell 在途切聊后可能写入另一聊天', () => {
  beforeEach(() => {
    clearRuntimeOnlyPendingSheets_ACU();
    mocks.savedChats.clear();
    mocks.chatId = 'synthetic-chat-A';
    mocks.firstReadyWait = null;
    mocks.onFirstReadyWait = null;
    mocks.save.mockReset().mockImplementation(async () => {
      mocks.savedChats.set(mocks.chatId, clone(mocks.chat));
    });
  });

  it('受控 SQLite readiness 等待期间切到同隔离槽 B：真实 CRUD 持久化 B，前端随后报错', async () => {
    const dataA = clone(TEMPLATE);
    const dataB = clone(TEMPLATE);
    dataB.sheet_synthetic_role.content[1][2] = 'B 原文';
    const providerA = new SqlTableService();
    const providerB = new SqlTableService();
    expect(await providerA.loadFromData(clone(dataA))).not.toHaveProperty('error');
    expect(await providerB.loadFromData(clone(dataB))).not.toHaveProperty('error');

    mocks.chat = [{ is_user: false, mes: '合成聊天 A', swipe_id: 0 }];
    mocks.current = clone(dataA);
    mocks.provider = providerA;
    publishSyntheticHost();

    let releaseReady!: () => void;
    let markReadyWaitStarted!: () => void;
    mocks.firstReadyWait = new Promise<void>(resolveWait => { releaseReady = resolveWait; });
    const readyWaitStarted = new Promise<void>(resolveStarted => { markReadyWaitStarted = resolveStarted; });
    mocks.onFirstReadyWait = markReadyWaitStarted;

    const api = Object.assign(createTableCrudApi({} as any), createTableHistoryApi());
    const originalUpdateCell = api.updateCell;
    let databaseResult: unknown;
    api.updateCell = async (...args: unknown[]) => {
      databaseResult = await originalUpdateCell(...args);
      return databaseResult;
    };
    const guarded = bindCrudWriteContext(api, () => api, () => 0);
    const pending = guarded.updateCell({
      tableName: '重要角色表', rowIndex: 1, colIdentifier: '一句话介绍',
      value: 'A 的正则结果', skipNotify: true,
    });
    await readyWaitStarted;
    expect(providerA.getCurrentData()).toEqual(dataA);
    expect(providerB.getCurrentData()).toEqual(dataB);
    expect(mocks.savedChats.size).toBe(0);

    // A and B deliberately use the same empty isolation key, table and row_id.
    mocks.chatId = 'synthetic-chat-B';
    mocks.chat = [{ is_user: false, mes: '合成聊天 B', swipe_id: 0 }];
    mocks.current = clone(dataB);
    mocks.provider = providerB;
    publishSyntheticHost();
    releaseReady();

    await expect(pending).rejects.toThrow(/聊天或数据库隔离环境已切换/);
    expect(databaseResult).toBe(true);
    expect(providerA.getCurrentData()).toEqual(dataA);
    const expectedB = clone(dataB);
    expectedB.sheet_synthetic_role.content[1][2] = 'A 的正则结果';
    expect(providerB.getCurrentData()).toEqual(expectedB);
    expect(mocks.savedChats.has('synthetic-chat-A')).toBe(false);
    const savedB = mocks.savedChats.get('synthetic-chat-B');
    expect(savedB).toBeDefined();
    expect(savedB![0].TavernDB_ACU_IsolatedData['']._acu_storage_version).toBe(2);
    const replay = await loadTableStateFromFramesV2Detailed_ACU(savedB!, '', {
      maxMessageIndex: 0, updateRuntimeState: false,
    });
    expect(replay?.data).toEqual(expectedB);
  });
});
