# V1.0.1 验收记录

测试日期：2026-11-06。Windows、Node.js 24.16.0、pnpm 10.28.2；骰子源码基线 v6.32，数据库参考 `naiv1.3.6`。最终 `dice.js` SHA-256：`583197B7FA9A350D93B9849C9CEE95C87C778C5C3593189A36BA140B77441CDA`。

## 实际结果

| 项目 | 结果和范围 |
| --- | --- |
| Node 回归、兼容模块 ESLint 和 strict TypeScript | 69/69 通过，lint 和 typecheck 通过。模板合成回归内部包含 23 项；并发限制复现测试通过只表示风险被复现，不表示风险已修复。 |
| 合成 12 表检查 | v4.5 夹具的 12 张表显示名唯一、uid 等于 key；0 缺表、0 问题；重复修复计划零动作，原对象不变。未读取用户真实聊天；内置 v4.5 模板与用户授权原件哈希一致。 |
| 隔离浏览器 | 最终产物 15/15 通过。包含默认 8 表和 v4.5 12 表重复检查、正则只更新一格并在合成切回后回读、锁定和 API 失败提示、属性显示、商城及加载入口。浏览器为无头 Edge；数据库和宿主 API 都是合成夹具。 |
| 原数据库源码集成 | 42/42 测试按预期完成：36 项模板导入和 SQLite 校验、5 项公开 CRUD/V2 回放，以及 1 项跨聊风险复现。数据库 CRUD、SQLite、V2 回放使用 `naiv1.3.6` 原源码，宿主和聊天数据为合成数据。风险复现通过不表示切聊安全。 |

浏览器中的默认 8 表分别为主角和合成人物生成属性，重新加载后，仪表盘、人物预览和角色表卡片的数值与独立属性一致；旧 v4.5 属性列也正常显示，数据库表没有被这些属性操作改动。单次打开商城只有一个窗口，单抽只调用一次 `insertRow`，合成切回后可读取新增行。

原版数据库 CRUD 测试实际调用公开 `updateCell`，验证 SQLite、V2 帧和模拟宿主保存的聊天副本；丢弃运行态、从副本回放并重建 SQLite 后，目标单元格、其他行和表符合预期。宿主保存报错时 API 返回失败。这不能等同于真实客户端关闭并重新打开聊天。

## 未满足和未实测

- **在途切聊隔离未通过。** 隔离浏览器切聊专项为 0/1：`updateCell` 在途时切到另一聊天，另一聊天的同名表、同一 row_id 被写入。前端随后报告切聊错误且未显示成功，但不能撤销数据库已经发生的跨聊写入。原数据库 CRUD/SQLite/V2 的独立集成测试也复现了相同结果；该测试以复现风险为预期，因而显示通过。使用时须等待保存完成后再切换聊天或隔离环境。
- 原版公开 CRUD 在后续消息没有新表帧时，可能将更新追加到较早已有的帧，改变较早楼层的回放值；不能保证所有旧历史楼层不变。
- 未在真实 TauriTavern + 酒馆助手中安装或重新打开真实聊天。仍需在独立合成聊天实测模板检查、正则转换、数据库重新读取和关闭重开后的持久化，以及失败提示。未测试用户私人数据。
- 宿主副本核验会检查非目标单元格和其他表；同期编辑或宿主序列化差异可能使核验保守失败。失败不能视为已确认持久化。
- 全仓静态检查仍有上游已有问题；这里只报告兼容模块的 strict TypeScript 和 ESLint 结果。

## 复现

在本仓库安装依赖后运行：

```powershell
corepack pnpm@10.28.2 install --frozen-lockfile
corepack pnpm@10.28.2 test
corepack pnpm@10.28.2 lint
corepack pnpm@10.28.2 typecheck:compat
```

隔离浏览器测试先在本仓库的一个终端启动 `node tests/extension-browser-server.mjs`，记下输出地址；在另一个终端使用该地址运行。以下端口是本次测试值，运行时以服务器输出为准：

```powershell
npx --yes --package @playwright/cli@0.1.23 playwright-cli -s=dice-compat-test open 'http://127.0.0.1:60141/?case=all' --browser msedge
npx --yes --package @playwright/cli@0.1.23 playwright-cli -s=dice-compat-test run-code --filename tests/extension-browser-smoke.js --raw
```

检查结果中 `failed` 是否为 0。单独将地址的 `case=all` 改为 `case=chat-switch` 可复现切聊失败；当前预期结果是 `failed:1`。结束时用同一会话名执行 `close`，并停止测试服务器。

数据库源码集成须在干净的 `naiv1.3.6` checkout 中运行，勿将测试复制进正在使用的数据库安装。把本仓库 `tests/db-template-compatibility.test.ts`、`tests/db-public-replay.test.ts`、`tests/db-public-crud-persistence.test.ts` 和 `tests/db-inflight-chat-switch.test.ts` 复制到该 checkout 的 `tests/integration/`，将 `DICE_FRONTEND_ROOT` 指向本仓库绝对路径，然后执行：

```powershell
corepack pnpm@11.2.2 install --frozen-lockfile
.\node_modules\.bin\vitest.CMD run tests/integration/db-template-compatibility.test.ts tests/integration/db-public-replay.test.ts tests/integration/db-public-crud-persistence.test.ts tests/integration/db-inflight-chat-switch.test.ts --maxWorkers=1
```
