// Synthetic public-API fixture for browser UI tests. This is not the real database.
const clone = value => structuredClone(value);

const ROWS = {
  '全局数据表': [
    ['101', '全局状态', '中央车站', '东区', '江城', '2026-11-06 06:00', '两小时', '2026-11-06 08:00'],
  ],
  '主角信息表': [
    ['201', '合成主角', '女', '25', '黑发', '记者', '正在调查', '中央车站', '银币:100'],
  ],
  '重要角色表': [
    ['301', '合成角色甲', '女', '24', '车站工作人员', '短发', '制服', '中央车站', '在场', '合成主角:旧识;合成角色乙:同事', '在车站工作', '询问线索'],
    ['302', '合成角色乙', '男', '27', '图书管理员', '戴眼镜', '外套', '图书馆', '离场', '合成主角:朋友', '整理档案', '查看档案'],
  ],
  '主角技能表': [
    ['401', '观察', '主动', '1', '寻找线索'],
  ],
  '背包物品表': [
    ['501', '合成药剂', '3', '恢复精力', '消耗品'],
    ['502', '合成匕首', '1', '普通铁制短刃', '武器'],
  ],
  '任务与事件表': [
    ['601', '合成委托', '支线任务', '掌柜', '寻找遗失物', '正在寻找线索', '两天', '银币', '无'],
  ],
  '纪要表': [
    ['701', 'AM0001', '2026-11-06 06:00 ~ 2026-11-06 08:00', '抵达车站', '合成主角抵达车站并开始调查。', '询问线索'],
  ],
  '选项表': [
    ['801', '前往车站', '访问图书馆', '检查背包', '等待消息'],
  ],
};

const V45_ROWS = {
  '全局数据表': [['101', '中央车站', '东区', '江城', '2026-11-06 06:00', '两小时', '2026-11-06 08:00']],
  '世界地图点': [['102', '中央车站', '东区', '江城', '交通', '合成地点', '普通', '已探索']],
  '地图元素表': [['103', '留言板', '设施', '中央车站', '合成设施', '可用', '查看']],
  '势力': [['104', '合成组织', '测试组织', '合成甲', '友好', '中央车站']],
  '主角信息': [['201', '合成主角', '女', '25', '黑发', '记者', '正在调查', '中央车站', '观察:50', '无', '银币:100']],
  '重要角色表': [
    ['301', '合成角色甲', '女', '24', '车站工作人员', '短发', '制服', '在场', '观察:40', '无', '中央车站', '在场', '合成主角:旧识;合成角色乙:同事', '询问线索', '在车站工作'],
    ['302', '合成角色乙', '男', '27', '图书管理员', '戴眼镜', '外套', '离场', '观察:30', '无', '图书馆', '离场', '合成主角:朋友', '查看档案', '整理档案'],
  ],
  '物品表': [['501', '合成药剂', '消耗品', '3', '普通', '恢复精力']],
  '装备表': [['502', '合成匕首', '武器', '普通', '未装备', '普通铁制短刃']],
  '技能表': [['401', '观察', '主动', '普通', '50', '寻找线索']],
  '任务表': [['601', '合成委托', '支线', '普通', '寻找遗失物', '25', '进行中', '掌柜', '银币']],
  '纪要表': [['701', 'AM0001', '2026-11-06 06:00 ~ 2026-11-06 08:00', '抵达车站', '合成主角抵达车站。']],
  '检定建议表': [['801', '合成调查', '检定 合成主角 观察']],
};

export async function installDefaultFixture(host, variant = 'default8') {
  if (variant !== 'default8' && variant !== 'v45') throw new Error(`未知合成夹具：${variant}`);
  const options = new URL(host.location.href).searchParams;
  const rowsByName = variant === 'v45' ? V45_ROWS : ROWS;
  const response = await host.fetch(variant === 'v45' ? '/v45-template.json' : '/default-template.json');
  if (!response.ok) throw new Error(`合成模板读取失败：HTTP ${response.status}`);
  const template = await response.json();
  const entries = Object.entries(template).filter(([, sheet]) => sheet?.name && Array.isArray(sheet.content));
  if (entries.length !== Object.keys(rowsByName).length || entries.some(([, sheet]) => !Object.hasOwn(rowsByName, sheet.name))) {
    throw new Error('合成夹具与所选模板不匹配');
  }
  const initial = clone(template);
  for (const [, sheet] of Object.entries(initial)) {
    if (!sheet?.name || !Array.isArray(sheet.content)) continue;
    const rows = rowsByName[sheet.name];
    if (rows.some(row => row.length !== sheet.content[0].length)) {
      throw new Error(`合成表 ${sheet.name} 的列数不匹配`);
    }
    sheet.content.push(...clone(rows));
  }
  const roleEntry = Object.entries(initial).find(([, sheet]) => sheet?.name === '重要角色表');
  if (!roleEntry) throw new Error('合成夹具缺少重要角色表');
  const [roleKey, roleSheet] = roleEntry;
  const relationColumn = roleSheet.content[0].indexOf('人际关系');
  if (relationColumn < 1) throw new Error('合成夹具缺少人际关系列');
  if (options.get('regex') === '1') {
    roleSheet.content[1][relationColumn] = '合成主角 : 旧识 ; 合成角色乙 : 同事';
  }

  const context = host.__smoke.context;
  context.chatId = 'synthetic-chat';
  context.getCurrentChatId = () => context.chatId;
  const callbacks = new Set();
  const calls = [];
  const chats = new Map();
  const lockedCells = new Map();
  const lockedRows = new Map();
  let failNext = options.get('fail') === '1';
  let delayMs = Math.max(0, Number(options.get('delay')) || 0);

  if (options.get('lock') === '1') {
    const lock = { chatId: context.chatId, sheetKey: roleKey, rowId: '301', column: '人际关系' };
    lockedCells.set(JSON.stringify([lock.chatId, lock.sheetKey, lock.rowId, lock.column]), lock);
  }

  function createChat(id) {
    const tables = clone(initial);
    if (id !== 'synthetic-chat') tables[roleKey].content[1][relationColumn] = '另一聊天:关系';
    return { tables, history: clone(tables), hostChat: [{ mes: `合成消息 ${id}`, is_user: true, swipe_id: 0 }] };
  }
  chats.set(context.chatId, createChat(context.chatId));
  context.chat = clone(chats.get(context.chatId).hostChat);
  const current = () => chats.get(context.chatId);
  const record = (method, args) => calls.push({ method, chatId: context.chatId, args: clone(args) });
  const helperCalls = [];
  const normalizeMessageIndex = value => {
    const index = Number(value);
    return Number.isInteger(index) ? (index < 0 ? context.chat.length + index : index) : -1;
  };
  host.TavernHelper.getLastMessageId = () => context.chat.length - 1;
  host.TavernHelper.getChatMessages = (range, filter = {}) => {
    const text = String(range);
    const match = /^(-?\d+)-(-?\d+)$/.exec(text);
    let start = normalizeMessageIndex(match ? match[1] : range);
    let end = normalizeMessageIndex(match ? match[2] : range);
    if (start < 0 || end < 0 || start >= context.chat.length || end >= context.chat.length) return [];
    if (start > end) [start, end] = [end, start];
    return context.chat.slice(start, end + 1).map((message, offset) => ({
      message_id: start + offset,
      name: message.name,
      role: message.is_user ? 'user' : 'assistant',
      is_hidden: Boolean(message.is_system),
      message: message.mes ?? '',
      data: clone(message.variables?.[message.swipe_id ?? 0] || {}),
      extra: clone(message.extra || {}),
      swipe_id: message.swipe_id ?? 0,
      swipes: clone(message.swipes || [message.mes ?? '']),
    })).filter(message => !filter.role || filter.role === 'all' || message.role === filter.role);
  };
  host.TavernHelper.setChatMessages = async updates => {
    if (!Array.isArray(updates)) throw new Error('合成助手消息更新格式无效');
    for (const update of updates) {
      const index = normalizeMessageIndex(update.message_id);
      const message = context.chat[index];
      if (!message) throw new Error('合成助手消息不存在');
      if (update.message !== undefined) message.mes = String(update.message);
      if (update.extra !== undefined) message.extra = clone(update.extra);
      helperCalls.push({ method: 'setChatMessages', chatId: context.chatId, messageId: index });
    }
    current().hostChat = clone(context.chat);
  };
  const sheetFor = (tableName, source = current().tables) => {
    const direct = source[String(tableName)];
    if (direct?.name) return [String(tableName), direct];
    return Object.entries(source).find(([, sheet]) => sheet?.name === tableName) || [];
  };
  const parseTableName = (arg, fallback) => typeof arg === 'object' && arg !== null
    ? arg.tableName ?? arg.table ?? arg.sheetName ?? arg.name
    : fallback;
  const notify = meta => {
    for (const callback of callbacks) callback(clone(current().tables), { persisted: meta?.persisted !== false });
  };
  const mutation = async () => {
    if (delayMs > 0) await new Promise(resolve => host.setTimeout(resolve, delayMs));
    if (!failNext) return true;
    failNext = false;
    return false;
  };
  const save = () => {
    current().history = clone(current().tables);
    current().hostChat = clone(context.chat);
  };

  const api = {
    exportTableAsJson: () => clone(current().tables),
    getTableTemplate: () => clone(template),
    getTableHistoryContext: () => ({
      version: 1,
      chatId: context.chatId,
      characterId: context.characterId ?? null,
      groupId: context.groupId ?? null,
      isolationKey: `synthetic:${context.chatId}`,
    }),
    getTableLockState: sheetKey => {
      const sheet = current().tables[sheetKey];
      if (!sheet) return null;
      const rowIndex = rowId => sheet.content.slice(1).findIndex(row => String(row[0]) === String(rowId));
      return {
        rows: [...lockedRows.values()].filter(lock => lock.chatId === context.chatId && lock.sheetKey === sheetKey).map(lock => rowIndex(lock.rowId)).filter(index => index >= 0),
        cols: [],
        cells: [...lockedCells.values()].filter(lock => lock.chatId === context.chatId && lock.sheetKey === sheetKey).map(lock => {
          const row = rowIndex(lock.rowId);
          const col = sheet.content[0].indexOf(lock.column) - 1;
          return row >= 0 && col >= 0 ? `${row}:${col}` : '';
        }).filter(Boolean),
      };
    },
    exportTableSnapshotsAtMessages: async indices => ({
      success: true,
      snapshots: indices.map(messageIndex => ({ messageIndex, data: clone(current().history) })),
    }),
    updateCell: async (arg, rowIndex, colIdentifier, value) => {
      const options = typeof arg === 'object' && arg !== null ? arg : { tableName: arg, rowIndex, colIdentifier, value };
      const name = parseTableName(options);
      const index = Number(options.rowIndex ?? options.row ?? options.index);
      const column = options.colIdentifier ?? options.column ?? options.colName ?? options.colIndex ?? options.columnIndex;
      record('updateCell', options);
      if (!(await mutation())) return false;
      const [key, sheet] = sheetFor(name);
      const numericColumn = typeof column === 'number' || (typeof column === 'string' && column.trim() !== '' && Number.isInteger(Number(column)));
      const col = numericColumn ? Number(column) : sheet?.content?.[0]?.indexOf(String(column));
      if (!sheet || !Number.isInteger(index) || index < 1 || index >= sheet.content.length || !Number.isInteger(col) || col <= 0 || col >= sheet.content[0].length) return false;
      if (lockedRows.has(JSON.stringify([context.chatId, key, String(sheet.content[index][0])])) ||
          lockedCells.has(JSON.stringify([context.chatId, key, String(sheet.content[index][0]), sheet.content[0][col]]))) return false;
      sheet.content[index][col] = options.value;
      if (!options.skipChatSave) save();
      if (!options.skipNotify) notify({ persisted: !options.skipChatSave });
      return true;
    },
    insertRow: async (arg, data) => {
      const options = typeof arg === 'object' && arg !== null ? arg : { tableName: arg, data };
      const name = parseTableName(options);
      const values = options.data ?? options.values ?? options.rowData;
      record('insertRow', options);
      if (!(await mutation()) || !values || typeof values !== 'object') return -1;
      const [, sheet] = sheetFor(name);
      if (!sheet) return -1;
      const header = sheet.content[0];
      const row = Array(header.length).fill('');
      for (const [column, cell] of Object.entries(values)) {
        if (column === 'row_id') continue;
        const index = header.indexOf(column);
        if (index < 1) return -1;
        row[index] = cell;
      }
      row[0] = String(Math.max(0, ...sheet.content.slice(1).map(item => Number(item[0]) || 0)) + 1);
      sheet.content.push(row);
      if (!options.skipChatSave) save();
      if (!options.skipNotify) notify({ persisted: !options.skipChatSave });
      return sheet.content.length - 1;
    },
    deleteRow: async (arg, rowIndex) => {
      const options = typeof arg === 'object' && arg !== null ? arg : { tableName: arg, rowIndex };
      record('deleteRow', options);
      if (!(await mutation())) return false;
      const [key, sheet] = sheetFor(parseTableName(options));
      const index = Number(options.rowIndex ?? options.row ?? options.index);
      if (!sheet || !Number.isInteger(index) || index < 1 || index >= sheet.content.length) return false;
      const rowId = String(sheet.content[index][0]);
      if (lockedRows.has(JSON.stringify([context.chatId, key, rowId])) ||
          [...lockedCells.values()].some(lock => lock.chatId === context.chatId && lock.sheetKey === key && String(lock.rowId) === rowId)) return false;
      sheet.content.splice(index, 1);
      if (!options.skipChatSave) save();
      if (!options.skipNotify) notify({ persisted: !options.skipChatSave });
      return true;
    },
    importTemplateFromData: async (_value, options) => {
      record('importTemplateFromData', options || {});
      return { success: false, message: '合成夹具禁止整模板导入' };
    },
    registerTableUpdateCallback: callback => callbacks.add(callback),
    unregisterTableUpdateCallback: callback => callbacks.delete(callback),
    _notifyTableUpdate: notify,
  };
  host.AutoCardUpdaterAPI = api;
  const originalFetch = host.fetch.bind(host);
  host.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, host.location.href);
    if (url.pathname === '/api/chats/get' || url.pathname === '/api/chats/group/get') {
      const payload = [{ chat_metadata: {} }, ...clone(current().hostChat)];
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return originalFetch(input, options);
  };

  host.__smoke.fixture = {
    variant,
    template: clone(template),
    initial: clone(initial),
    calls,
    helperCalls,
    snapshot: () => clone(current().tables),
    replay: () => clone(current().history),
    setFailNext: () => { failNext = true; },
    setDelay: milliseconds => { delayMs = Math.max(0, Number(milliseconds) || 0); },
    lockCell: (sheetKey, rowId, column) => lockedCells.set(JSON.stringify([context.chatId, sheetKey, String(rowId), column]), { chatId: context.chatId, sheetKey, rowId, column }),
    lockRow: (sheetKey, rowId) => lockedRows.set(JSON.stringify([context.chatId, sheetKey, String(rowId)]), { chatId: context.chatId, sheetKey, rowId }),
    unlockCells: () => { lockedCells.clear(); lockedRows.clear(); },
    sendUserMessage: async text => {
      const message = { mes: String(text), is_user: true, swipe_id: 0 };
      context.chat.push(message);
      current().hostChat = clone(context.chat);
      const messageId = context.chat.length - 1;
      await context.eventSource.emit(context.eventTypes.MESSAGE_SENT, messageId);
      return messageId;
    },
    switchChat: async chatId => {
      if (!chats.has(chatId)) chats.set(chatId, createChat(chatId));
      context.chatId = chatId;
      context.chat = clone(chats.get(chatId).hostChat);
      await context.eventSource.emit(context.eventTypes.CHAT_CHANGED, chatId);
    },
  };
}
