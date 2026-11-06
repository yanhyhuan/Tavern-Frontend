/* Modified by yanhyhuan on 2026-11-06: Tavern Frontend V1.0.1 database-template, public-CRUD and extension compatibility. Upstream: jerryzmtz/my-tavern-scripts v6.32; see LICENSE. */
// 数值属性属于前端本机数据，不写入数据库的叙事列或私有聊天结构。
export type ChatAttributeScope = {
  version: 1;
  chatId: string | number;
  characterId: string | number | null;
  groupId: string | number | null;
  isolationKey: string;
};

export type ChatAttributeIdentity = { sheetKey: string; uid: string; rowId: string };
export type ChatAttributeEntry = { name: string; value: number; source: 'base' | 'special' | 'generic' };
export type ChatAttributeBinding = { scope: ChatAttributeScope; assertCurrent: () => void };
type AttributeCharacter = ChatAttributeIdentity & { attributes: ChatAttributeEntry[] };
type AttributeDocument = { format: 'acu_chat_attributes_v1'; scope: ChatAttributeScope; characters: AttributeCharacter[] };
type AttributeStorage = Pick<Storage, 'getItem' | 'setItem'>;

const PREFIX = 'acu_chat_attributes_v1:';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const validId = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.trim().length > 0) || (typeof value === 'number' && Number.isFinite(value));

export const normalizeChatAttributeScope = (value: unknown): ChatAttributeScope => {
  const scope = value as Partial<ChatAttributeScope> | null;
  if (!scope || scope.version !== 1 || !validId(scope.chatId) || typeof scope.isolationKey !== 'string' ||
      !(scope.characterId == null || validId(scope.characterId)) || !(scope.groupId == null || validId(scope.groupId))) {
    throw new Error('无法确认当前聊天和数据库隔离环境，不能读取或保存独立属性。');
  }
  return { version: 1, chatId: scope.chatId, characterId: scope.characterId ?? null,
    groupId: scope.groupId ?? null, isolationKey: scope.isolationKey };
};

const identityKey = (identity: ChatAttributeIdentity): string => JSON.stringify([identity.sheetKey, identity.uid, identity.rowId]);

const normalizeIdentity = (value: unknown): ChatAttributeIdentity => {
  const item = value as Partial<ChatAttributeIdentity> | null;
  if (!item || typeof item.sheetKey !== 'string' || !item.sheetKey.startsWith('sheet_') ||
      item.uid !== item.sheetKey || typeof item.rowId !== 'string' || !item.rowId.trim()) {
    throw new Error('角色表的 key、uid 或 row_id 无效，不能保存独立属性。');
  }
  return { sheetKey: item.sheetKey, uid: item.uid, rowId: item.rowId };
};

export const getChatAttributeIdentity = (sheetKey: string, sheet: any, rowIndex: number): ChatAttributeIdentity => {
  const content = sheet?.content;
  const row = Array.isArray(content) ? content[rowIndex] : null;
  if (!Array.isArray(content?.[0]) || String(content[0][0]).trim().toLowerCase() !== 'row_id' ||
      !Array.isArray(row) || !validId(row[0])) {
    throw new Error('角色缺少稳定 row_id，不能保存独立属性。');
  }
  const rowId = String(row[0]).trim();
  if (content.slice(1).filter((candidate: unknown) => Array.isArray(candidate) && String(candidate[0] ?? '').trim() === rowId).length !== 1) {
    throw new Error(`角色表存在重复 row_id=${rowId}，不能保存独立属性。`);
  }
  return normalizeIdentity({ sheetKey, uid: sheet.uid, rowId });
};

const normalizeAttributes = (value: unknown): ChatAttributeEntry[] => {
  if (!Array.isArray(value)) throw new Error('独立属性数据损坏：属性列表不是数组。');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim() ||
        typeof item.value !== 'number' || !Number.isFinite(item.value) ||
        !['base', 'special', 'generic'].includes(item.source) || seen.has(item.name)) {
      throw new Error('独立属性数据损坏：属性名、数值或分类无效。');
    }
    seen.add(item.name);
    return { name: item.name, value: item.value, source: item.source };
  });
};

const normalizeDocument = (value: unknown, scope: ChatAttributeScope): AttributeDocument => {
  const raw = value as Partial<AttributeDocument> | null;
  if (!raw || raw.format !== 'acu_chat_attributes_v1' || !Array.isArray(raw.characters) ||
      JSON.stringify(normalizeChatAttributeScope(raw.scope)) !== JSON.stringify(scope)) {
    throw new Error('独立属性备份的聊天/隔离环境与当前环境不一致或数据无效。');
  }
  const seen = new Set<string>();
  const characters = raw.characters.map(item => {
    const identity = normalizeIdentity(item);
    const key = identityKey(identity);
    if (seen.has(key)) throw new Error('独立属性数据包含重复角色身份。');
    seen.add(key);
    return { ...identity, attributes: normalizeAttributes(item.attributes) };
  });
  return { format: 'acu_chat_attributes_v1', scope, characters };
};

export const createChatAttributeStore = (storage: AttributeStorage, binding: ChatAttributeBinding) => {
  const scope = normalizeChatAttributeScope(binding.scope);
  const key = PREFIX + encodeURIComponent(JSON.stringify(scope));
  const readRaw = (): string | null => {
    binding.assertCurrent();
    try { return storage.getItem(key); } catch (error) {
      throw new Error(`读取独立聊天属性失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const parseRaw = (raw: string | null): AttributeDocument => {
    if (raw === null) return { format: 'acu_chat_attributes_v1', scope, characters: [] };
    try { return normalizeDocument(JSON.parse(raw), scope); } catch (error) {
      throw new Error(`读取独立聊天属性失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const begin = () => {
    const original = readRaw();
    const doc = parseRaw(original);
    let changed = false;
    const touched = new Map<string, ChatAttributeIdentity>();
    return {
      get(identity: ChatAttributeIdentity): ChatAttributeEntry[] {
        binding.assertCurrent();
        const normalized = normalizeIdentity(identity);
        const found = doc.characters.find(item => identityKey(item) === identityKey(normalized));
        return copy(found?.attributes || []);
      },
      set(identity: ChatAttributeIdentity, attributes: ChatAttributeEntry[]): void {
        binding.assertCurrent();
        const normalized = normalizeIdentity(identity);
        const normalizedAttributes = normalizeAttributes(attributes);
        const index = doc.characters.findIndex(item => identityKey(item) === identityKey(normalized));
        const existing = index < 0 ? [] : doc.characters[index].attributes;
        if (JSON.stringify(existing) === JSON.stringify(normalizedAttributes)) return;
        if (normalizedAttributes.length === 0) {
          if (index >= 0) doc.characters.splice(index, 1);
        } else if (index >= 0) {
          doc.characters[index] = { ...normalized, attributes: normalizedAttributes };
        } else {
          doc.characters.push({ ...normalized, attributes: normalizedAttributes });
        }
        changed = true;
        touched.set(identityKey(normalized), normalized);
      },
      get changed(): boolean { return changed; },
      get touched(): ChatAttributeIdentity[] { return [...touched.values()].map(copy); },
      commit(): void {
        binding.assertCurrent();
        if (!changed) return;
        if (readRaw() !== original) throw new Error('独立属性已被其他操作修改，请重新执行。');
        const serialized = JSON.stringify(doc);
        try { storage.setItem(key, serialized); } catch (error) {
          throw new Error(`保存独立聊天属性失败：${error instanceof Error ? error.message : String(error)}`);
        }
        if (readRaw() !== serialized) throw new Error('独立属性写入后读取不一致，不能确认保存成功。');
        binding.assertCurrent();
        changed = false;
      },
    };
  };
  return {
    begin,
    read(identity: ChatAttributeIdentity): ChatAttributeEntry[] { return begin().get(identity); },
    export(): AttributeDocument { return copy(parseRaw(readRaw())); },
    import(value: unknown, validate: (identity: ChatAttributeIdentity) => void): void {
      const incoming = normalizeDocument(value, scope);
      const tx = begin();
      for (const character of incoming.characters) {
        validate(normalizeIdentity(character));
        tx.set(character, character.attributes);
      }
      tx.commit();
    },
  };
};
