/* Modified by yanhyhuan on 2026-11-06: Tavern Frontend V1.0.1 database-template, public-CRUD and extension compatibility. Upstream: jerryzmtz/my-tavern-scripts v6.32; see LICENSE. */
type HostContext = Record<string, unknown>;

export type HostPersistenceVerifierOptions = {
  getHostContext: () => unknown;
  assertCurrent: () => void;
  verifyReplay?: () => Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasIdentifier = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.trim().length > 0) || (typeof value === 'number' && Number.isFinite(value));

const getContext = (read: () => unknown): HostContext => {
  const context = read();
  if (!isRecord(context)) throw new Error('宿主聊天接口不可用');
  return context;
};

const getCharacter = (context: HostContext): { name: string; avatar: string } => {
  const characterId = context.characterId;
  if (!hasIdentifier(characterId) || !Number.isInteger(Number(characterId)) || Number(characterId) < 0) {
    throw new Error('当前角色身份不可用');
  }
  const characters = context.characters;
  if (!Array.isArray(characters) && !isRecord(characters)) throw new Error('当前角色列表不可用');
  const rawCharacter: unknown = Array.isArray(characters)
    ? characters[Number(characterId)]
    : characters[String(Number(characterId))];
  const character = isRecord(rawCharacter) ? rawCharacter : null;
  if (
    !character ||
    typeof character.name !== 'string' ||
    !character.name ||
    typeof character.avatar !== 'string' ||
    !character.avatar
  ) {
    throw new Error('当前角色名称或头像不可用');
  }
  return { name: character.name, avatar: character.avatar };
};

// 数据来自 JSON；对象字段顺序不是持久化语义，数组顺序和每个值必须完全一致。
const sameJsonValue = (left: unknown, right: unknown): boolean => {
  const pending: Array<[unknown, unknown]> = [[left, right]];
  while (pending.length > 0) {
    const pair = pending.pop()!;
    const [a, b] = pair;
    if (a === b) continue;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) pending.push([a[i], b[i]]);
      continue;
    }
    if (!isRecord(a) || !isRecord(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false;
    for (const key of aKeys) pending.push([a[key], b[key]]);
  }
  return true;
};

/**
 * 只读已固定聊天的宿主副本，确认它与本次回放所依赖的完整内存聊天一致。
 * 不调用保存接口，不写入或解释数据库私有存储字段。
 */
export const verifyHostChatPersistence = async ({
  getHostContext,
  assertCurrent,
  verifyReplay,
  fetchImpl,
  timeoutMs = 15000,
}: HostPersistenceVerifierOptions): Promise<void> => {
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('回读超时设置无效');
    assertCurrent();
    const context = getContext(getHostContext);
    const { chat, chatId, characterId, groupId } = context;
    if (!Array.isArray(chat) || chat.length === 0 || !hasIdentifier(chatId)) {
      throw new Error('当前聊天或聊天身份不可用');
    }
    const isGroup = groupId !== undefined && groupId !== null && groupId !== '';
    if (isGroup && !hasIdentifier(groupId)) throw new Error('当前群聊身份不可用');
    const character = isGroup ? null : getCharacter(context);
    if (typeof context.getRequestHeaders !== 'function') throw new Error('宿主请求头接口不可用');
    const requestHeaders = context.getRequestHeaders();
    if (!isRecord(requestHeaders)) throw new Error('宿主请求头无效');
    const json = JSON.stringify(chat);
    if (typeof json !== 'string') throw new Error('当前聊天无法序列化');
    const capturedMessages: unknown = JSON.parse(json);
    if (!Array.isArray(capturedMessages) || capturedMessages.some(message => !isRecord(message))) {
      throw new Error('当前聊天消息格式无效');
    }

    const assertCaptured = (): void => {
      assertCurrent();
      const current = getContext(getHostContext);
      if (
        current.chat !== chat ||
        current.chatId !== chatId ||
        current.characterId !== characterId ||
        current.groupId !== groupId
      ) {
        throw new Error('回读期间聊天已切换');
      }
      if (character) {
        const currentCharacter = getCharacter(current);
        if (currentCharacter.name !== character.name || currentCharacter.avatar !== character.avatar) {
          throw new Error('回读期间角色身份已变化');
        }
      }
      if (JSON.stringify(current.chat) !== json) throw new Error('回读期间聊天内容已变化');
    };

    const request = fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
    if (!request) throw new Error('宿主只读请求接口不可用');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('宿主聊天回读超时'));
      }, timeoutMs);
    });
    const readPersisted = (async (): Promise<void> => {
      assertCaptured();
      if (verifyReplay) {
        await verifyReplay();
        assertCaptured();
      }
      if (controller.signal.aborted) throw new Error('宿主聊天回读超时');
      const response = await request(isGroup ? '/api/chats/group/get' : '/api/chats/get', {
        method: 'POST',
        cache: 'no-cache',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' } as Record<string, string>,
        body: JSON.stringify(
          isGroup
            ? { id: chatId }
            : {
                ch_name: character!.name,
                file_name: chatId,
                avatar_url: character!.avatar,
              },
        ),
        signal: controller.signal,
      });
      assertCaptured();
      if (!response.ok) throw new Error(`宿主聊天回读失败（HTTP ${response.status}）`);
      const payload: unknown = await response.json();
      assertCaptured();
      if (!Array.isArray(payload) || payload.length === 0) throw new Error('宿主聊天回读格式无效');
      // 个人聊天有文件头；群聊旧格式可能无头，新格式以 chat_metadata 标识文件头。
      const hasGroupHeader =
        isGroup && isRecord(payload[0]) && Object.prototype.hasOwnProperty.call(payload[0], 'chat_metadata');
      const messages = !isGroup || hasGroupHeader ? payload.slice(1) : payload;
      if (messages.some(message => !isRecord(message))) throw new Error('宿主聊天回读包含无效消息');
      if (!sameJsonValue(capturedMessages, messages)) throw new Error('宿主聊天副本与当前聊天不一致');
      assertCaptured();
    })();
    try {
      await Promise.race([readPersisted, timedOut]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`宿主持久化无法确认：${message}`);
  }
};
