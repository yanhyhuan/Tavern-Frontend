const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

const modulePath = path.join(__dirname, '../src/骰子系统/host-persistence-verifier.ts');
const loaded = new Module(modulePath, module);
loaded._compile(
  ts.transpileModule(fs.readFileSync(modulePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  modulePath,
);
const { verifyHostChatPersistence } = loaded.exports;
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(group = false) {
  const chat = [
    { mes: '合成消息', is_user: true },
    {
      mes: '合成回复',
      TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, opaque: 'data' } } },
    },
  ];
  const context = {
    chat,
    chatId: 'synthetic-chat-A',
    characterId: 0,
    groupId: group ? 'synthetic-group' : null,
    characters: [{ name: '合成角色', avatar: 'synthetic.png' }],
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'synthetic-token' }),
  };
  let epoch = 0;
  const initialEpoch = epoch;
  const requests = [];
  const response = data => ({ ok: true, status: 200, json: async () => data });
  const options = {
    getHostContext: () => context,
    assertCurrent: () => {
      if (epoch !== initialEpoch) throw new Error('隔离环境已切换');
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response(group ? clone(chat) : [{ chat_metadata: {} }, ...clone(chat)]);
    },
  };
  return {
    chat,
    context,
    requests,
    options,
    response,
    bumpEpoch: () => {
      epoch++;
    },
  };
}

test('个人聊天按宿主真实请求形状只读，并确认全部消息', async () => {
  const f = fixture();
  await verifyHostChatPersistence(f.options);
  assert.equal(f.requests.length, 1);
  const { url, init } = f.requests[0];
  assert.equal(url, '/api/chats/get');
  assert.equal(init.method, 'POST');
  assert.equal(init.cache, 'no-cache');
  assert.deepEqual(JSON.parse(init.body), {
    ch_name: '合成角色',
    file_name: 'synthetic-chat-A',
    avatar_url: 'synthetic.png',
  });
  assert.equal(init.headers['X-CSRF-Token'], 'synthetic-token');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(f.chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.opaque, 'data');
});

test('群聊按宿主真实请求形状读取，并支持有头与无头文件', async () => {
  for (const withHeader of [false, true]) {
    const f = fixture(true);
    f.options.fetchImpl = async (url, init) => {
      f.requests.push({ url, init });
      return f.response(withHeader ? [{ chat_metadata: {} }, ...clone(f.chat)] : clone(f.chat));
    };
    await verifyHostChatPersistence(f.options);
    assert.equal(f.requests[0].url, '/api/chats/group/get');
    assert.deepEqual(JSON.parse(f.requests[0].init.body), { id: 'synthetic-chat-A' });
  }
});

test('对象字段顺序不同仍能确认，数组顺序或任一持久值不同则失败', async () => {
  const f = fixture();
  const reordered = clone(f.chat).map(item => Object.fromEntries(Object.entries(item).reverse()));
  f.options.fetchImpl = async () => f.response([{ chat_metadata: {} }, ...reordered]);
  await verifyHostChatPersistence(f.options);

  const oldDisk = clone(f.chat);
  oldDisk[1].TavernDB_ACU_IsolatedData[''].storageFrame.opaque = 'old';
  f.options.fetchImpl = async () => f.response([{ chat_metadata: {} }, ...oldDisk]);
  await assert.rejects(verifyHostChatPersistence(f.options), /宿主聊天副本与当前聊天不一致/);
  f.options.fetchImpl = async () => f.response([{ chat_metadata: {} }, ...clone(f.chat).reverse()]);
  await assert.rejects(verifyHostChatPersistence(f.options), /宿主聊天副本与当前聊天不一致/);
});

test('数据库隔离环境或宿主聊天在途切换时不能确认成功', async () => {
  for (const mutate of [
    f => {
      f.context.chatId = 'synthetic-chat-B';
    },
    f => {
      f.context.groupId = 'other-group';
    },
    f => {
      f.context.chat = clone(f.chat);
    },
    f => {
      f.chat[0].mes = '并发编辑';
    },
    f => {
      f.context.characters[0].avatar = 'other.png';
    },
    f => {
      f.bumpEpoch();
    },
  ]) {
    const f = fixture();
    const persisted = [{ chat_metadata: {} }, ...clone(f.chat)];
    f.options.fetchImpl = async () => {
      mutate(f);
      return f.response(persisted);
    };
    await assert.rejects(verifyHostChatPersistence(f.options), /宿主持久化无法确认/);
  }
});

test('读取响应正文时发生聊天变更也会拒绝确认', async () => {
  const f = fixture();
  const persisted = [{ chat_metadata: {} }, ...clone(f.chat)];
  f.options.fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      f.chat[0].mes = '正文读取期间变化';
      return persisted;
    },
  });
  await assert.rejects(verifyHostChatPersistence(f.options), /聊天内容已变化/);
});

test('先确认公开回放，再读取对应的完整宿主副本', async () => {
  const f = fixture();
  const events = [];
  f.options.verifyReplay = async () => {
    events.push('replay');
  };
  const originalFetch = f.options.fetchImpl;
  f.options.fetchImpl = async (...args) => {
    events.push('fetch');
    return originalFetch(...args);
  };
  await verifyHostChatPersistence(f.options);
  assert.deepEqual(events, ['replay', 'fetch']);
});

test('回放出错或回放期间消息变化均拒绝持久化确认', async () => {
  for (const verifyReplay of [
    async () => {
      throw new Error('模拟回放失败');
    },
    async f => {
      f.chat[1].mes = '回放期间变化';
    },
    async f => {
      f.bumpEpoch();
    },
  ]) {
    const f = fixture();
    f.options.verifyReplay = () => verifyReplay(f);
    await assert.rejects(verifyHostChatPersistence(f.options), /宿主持久化无法确认/);
    assert.equal(f.requests.length, 0);
  }
});

test('HTTP、非法响应、缺少宿主身份及网络错误均明确失败', async () => {
  const inputs = [
    async f => {
      f.options.fetchImpl = async () => ({ ok: false, status: 500 });
    },
    async f => {
      f.options.fetchImpl = async () => f.response({ error: true });
    },
    async f => {
      f.options.fetchImpl = async () => f.response([]);
    },
    async f => {
      f.options.fetchImpl = async () => f.response([{ chat_metadata: {} }, null]);
    },
    async f => {
      f.options.fetchImpl = async () => {
        throw new Error('模拟网络错误');
      };
    },
    async f => {
      f.context.getRequestHeaders = null;
    },
    async f => {
      f.context.characters = [];
    },
    async f => {
      f.context.chatId = '';
    },
  ];
  for (const setup of inputs) {
    const f = fixture();
    await setup(f);
    await assert.rejects(verifyHostChatPersistence(f.options), /宿主持久化无法确认/);
  }
});

test('超时即使请求忽略 abort 也必须失败', async () => {
  const f = fixture();
  let signal;
  f.options.timeoutMs = 10;
  f.options.fetchImpl = async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  };
  await assert.rejects(verifyHostChatPersistence(f.options), /回读超时/);
  assert.equal(signal.aborted, true);
});
