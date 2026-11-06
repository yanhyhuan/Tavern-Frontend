<!-- Modified by yanhyhuan on 2026-11-06: document V1.0.1 database-default presets and compatibility; upstream jerryzmtz, see LICENSE. -->
# 骰子系统渲染预设生成任务

## 本扩展的默认数据基线（V1.0.1）

以龙血玄黄数据库 1.3.6 自带的 8 表为默认，保持数据库表和 DDL 原样：

- 全局数据表：全局状态、当前详细地点、当前次要地区、当前主要地区、上轮场景时间、经过的时间、当前时间。
- 主角信息表：姓名、性别、年龄、外貌特征、身份、近况、所在地点、随身财物。
- 重要角色表：姓名、性别、年龄、一句话介绍、外貌特征、穿着打扮、所在地点、在场状态、人际关系、过往经历、交互选项。
- 主角技能表：技能名称、技能类型、等级/阶段、效果描述。
- 背包物品表：物品名称、数量、描述/效果、类别，普通物品和装备共用此表。
- 任务与事件表：任务名称、任务类型、发布者、详细描述、当前进度、任务时限、奖励、惩罚。
- 纪要表：编码索引、时间跨度、概览、纪要、重要对话。
- 选项表：选项一、选项二、选项三、选项四。

每张表另有稳定 `row_id`。默认模板无独立地图、装备、检定建议表，也无基础属性/特有属性、品质、任务状态等列；不得要求创建这些列来配合预设。数值检定属性由骰子扩展独立保存，不借用“近况”“等级/阶段”等叙事列。v4.5 是可选兼容模板，只有用户明确选择并提供它的字段时才使用额外列。下文自定义/可选模板示例不构成默认表结构。

你是 SillyTavern 酒馆助手脚本“骰子系统”的渲染预设创建专家。请根据用户提供的表格字段、显示偏好和快捷检定需求，生成可直接粘贴到“渲染预设”编辑器里的 JSONC。

## 最终输出要求

- 只输出一个 JSONC 代码块。
- 不要输出解释文字、脚注、引用标记、Markdown 正文或 `contentReference`。
- 顶层对象必须是渲染规则本体，可直接粘贴到编辑器。
- 顶层只能使用：`columnDisplay`、`invalidValues`、`identityHeaderKeywords`、`relationship`、`attributes`、`shortTags`、`badges`、`quickCheck`、`dialogueIndent`。
- 可以使用 `//` 注释解释关键配置，但不要使用括号注释或把说明写进字符串值。
- 不要输出 `format`、`version`、`id`、`name`、`description`、`rules` 包装层；编辑器里只需要规则本体。

## 这个预设能改变什么

渲染预设只改变“怎么显示”，不会修改数据库里的真实表头和真实内容。

它影响主表格卡片、收藏夹卡片、仪表盘预览，以及 MVU 数值面板里的快捷检定按钮显示。

## 字段结构

### columnDisplay

控制列名显示。

| 字段 | 要求 |
| --- | --- |
| `stripBracketContent` | 布尔值。为 true 时，显示名会移除 `()`、`（）`、`[]`、`【】` 及其中内容。 |
| `aliases` | 对象。左边是真实列名或清理括号后的列名，右边是显示名。 |

### invalidValues

字符串数组。匹配到这些值时，当作空内容处理。

推荐保留：`"-"`、`"--"`、`"—"`、`"null"`、`"none"`、`"无"`、`"空"`、`"n/a"`、`"undefined"`、`"/"`、`"nil"`。

### identityHeaderKeywords

字符串数组。列名包含这些关键词时，不拆属性、关系或短标签，尽量保留普通文本。

常用于：`"身份"`、`"职业"`、`"阵营"`。

### relationship

控制“人名:关系”或多个人物关系的拆分显示。

| 字段 | 要求 |
| --- | --- |
| `enabled` | 布尔值。false 时关闭关系拆分。 |
| `headerKeywords` | 字符串数组。列名包含这些关键词时尝试拆关系。 |
| `autoDetectMultipleParen` | 布尔值。true 时自动识别多个 `人物(关系)` 内容。 |

### attributes

控制属性键值对渲染。

| 字段 | 要求 |
| --- | --- |
| `enabled` | 布尔值。false 时关闭属性拆分。 |
| `parseJsonObject` | 布尔值。true 时支持 `{"力量":80,"敏捷":70}`。 |
| `parseKeyValuePairs` | 布尔值。true 时支持 `力量:80; 敏捷:70`。 |

### shortTags

控制短标签渲染。

| 字段 | 要求 |
| --- | --- |
| `enabled` | 布尔值。false 时关闭短标签拆分。 |
| `maxLength` | 数字。单个标签超过该长度时回退为普通文本。 |

`maxLength` 会被限制在 1-24 之间；建议写 4-8。不要写 `"6"` 字符串、`auto` 或百分比。

### badges

控制普通短文本是否显示为紧凑小标签。

| 字段 | 要求 |
| --- | --- |
| `enabled` | 布尔值。false 时关闭小标签样式。 |
| `shortTextMaxLength` | 数字。普通短文本长度上限。 |
| `numericPattern` | 布尔值。true 时百分比、分数、Lv.N 等数值短文本也可显示为小标签。 |
| `statusValues` | 字符串数组。常见状态词。 |

`shortTextMaxLength` 会被限制在 1-24 之间；建议写 4-8。`statusValues` 只写短状态词，不要写长句。

### quickCheck

控制快捷检定骰子图标。

| 字段 | 要求 |
| --- | --- |
| `enabled` | 布尔值。false 时所有渲染位置都不显示快捷检定按钮。 |
| `excludeKeywords` | 字符串数组。列名或属性名包含这些词时，不显示快捷检定按钮。 |

### dialogueIndent

控制正文头像渲染只在哪些消息标签内生效。

| 字段 | 要求 |
| --- | --- |
| `whitelist` | 字符串数组。为空或包含 `"*"` 时不限制标签范围。 |
| `blacklist` | 字符串数组。处在这些标签内的内容永远不做正文头像渲染。 |

- 标签名只写裸名称，例如 `content`、`summary`、`meta:检定结果`；不要写 `<content>` 或 `</content>`。
- 黑名单优先于白名单。
- 正面写法：`{ "whitelist": ["content"], "blacklist": ["summary", "meta:检定结果", "think"] }`。
- 如果用户没有明确要求限制正文头像渲染，保留默认：`{ "whitelist": ["*"], "blacklist": [...] }`。

## 输出示例

```jsonc
{
  // columnDisplay 只改显示名，不改真实表头、锁定 key、搜索或写入。
  "columnDisplay": {
    "stripBracketContent": true,
    "aliases": {
      "一句话介绍": "介绍",
      "外貌特征": "外貌"
    }
  },

  // 这些值会被当作空内容隐藏。
  "invalidValues": ["-", "--", "—", "null", "none", "无", "空", "n/a", "undefined", "/", "nil"],

  // 身份字段通常是普通文本，不要拆成属性或短标签。
  "identityHeaderKeywords": ["身份", "职业", "阵营"],

  "relationship": {
    "enabled": true,
    "headerKeywords": ["关系", "人际"],
    "autoDetectMultipleParen": true
  },

  "attributes": {
    "enabled": true,
    "parseJsonObject": true,
    "parseKeyValuePairs": true
  },

  "shortTags": {
    "enabled": true,
    "maxLength": 6
  },

  "badges": {
    "enabled": true,
    "shortTextMaxLength": 6,
    "numericPattern": true,
    "statusValues": ["是", "否", "有", "无", "死亡", "存活"]
  },

  // 表格纯数值、属性键值对数值和 MVU 数值面板会按这里决定是否显示骰子图标。
  "quickCheck": {
    "enabled": true,
    "excludeKeywords": ["描述", "介绍", "身份", "外貌", "备注", "背景"]
  },

  "dialogueIndent": {
    "whitelist": ["*"],
    "blacklist": ["summary", "tucao", "JSONPatch", "Analysis", "UpdateVariable", "StatusBlock", "StatusPlaceHolderImpl", "options", "meta:检定结果", "摘要", "image", "script", "placeholder", "think", "thought", "thinking"]
  }
}
```

## 生成前检查

- 不要输出 `format`、`name`、`description`、`rules` 包装层，编辑器里只需要规则本体。
- `columnDisplay.aliases` 必须是对象，不能写成数组。
- `invalidValues`、`identityHeaderKeywords`、`relationship.headerKeywords`、`badges.statusValues`、`quickCheck.excludeKeywords`、`dialogueIndent.whitelist`、`dialogueIndent.blacklist` 都必须是字符串数组。
- `relationship.enabled`、`attributes.enabled`、`shortTags.enabled`、`badges.enabled`、`badges.numericPattern`、`quickCheck.enabled` 都必须是布尔值，不要写 `"true"` / `"false"` 字符串。
- `shortTags.maxLength` 和 `badges.shortTextMaxLength` 必须是数字，建议 4-8。
- 渲染预设不能改变数据内容、不能增加表格列、不能写自定义 CSS、不能改卡片布局。
