<!-- Modified by yanhyhuan on 2026-11-06: document V1.0.1 database-default presets and compatibility; upstream jerryzmtz, see LICENSE. -->
# 骰子系统模板检验预设生成任务

请根据用户需求生成可导入的 JSONC。最终只输出一个 JSONC 代码块，不附解释。

## 格式

- 顶层只使用 `format`、`version`、`preset`；分别填写 `acu_table_template_requirement_preset_v1`、`1` 和预设对象。
- `preset` 只使用 `name`、`description`、`requirementLevels`、`template`。不要输出 `id`、`builtin` 或 `order`。
- `template` 中每张表用 `sheet_` 开头的 key，包含非空 `name` 和二维数组 `content`；第一行只列出需要检查的列。
- `requirementLevels` 的叶子只能是 `error`、`warning` 或 `info`。可在 `defaults` 或 `sheets.<表key>` 中设置 `sheet`、`header`、`ddl`、`sourceData`、`config`，也可在 `headers` 中为单列设置严重度。
- `error` 用于缺失会导致核心读取或写入失败的列，`warning` 用于功能降级，`info` 用于说明和配置建议。

## 数据库默认基线

龙血玄黄数据库 1.3.6 默认模板有以下 8 张表。默认按真实表名和列名描述；用户明确选择其他模板或自定义玩法时，按照用户给出的真实结构调整。

| 表名 | 业务列 |
| --- | --- |
| 全局数据表 | 全局状态、当前详细地点、当前次要地区、当前主要地区、上轮场景时间、经过的时间、当前时间 |
| 主角信息表 | 姓名、性别、年龄、外貌特征、身份、近况、所在地点、随身财物 |
| 重要角色表 | 姓名、性别、年龄、一句话介绍、外貌特征、穿着打扮、所在地点、在场状态、人际关系、过往经历、交互选项 |
| 主角技能表 | 技能名称、技能类型、等级/阶段、效果描述 |
| 背包物品表 | 物品名称、数量、描述/效果、类别 |
| 任务与事件表 | 任务名称、任务类型、发布者、详细描述、当前进度、任务时限、奖励、惩罚 |
| 纪要表 | 编码索引、时间跨度、概览、纪要、重要对话 |
| 选项表 | 选项一、选项二、选项三、选项四 |

完整数据库表的首列必须是 `row_id`（或数据库支持的 `null` 占位）。检验预设只列业务字段即可；不要伪造属性列、世界地图点、装备表、检定建议表、品质列或 `<属性规则>`，因为数据库默认模板并不包含它们。需要这些玩法时明确说明缺口并按用户实际模板配置。

## 匹配与修复

- key 是稳定身份，但不要求与另一模板相同；显示名或 `sourceData.tableAliases` 中明确声明的别名唯一时，可以匹配不同 key 的表。不要因为 SQL 物理表名不同就判缺表。
- 名称或别名多重匹配、真实缺列或 DDL 约束不兼容都需要报告；不要把未验证的近义表名和列名当作兼容。
- 检验不修改已有表。内置缺表可导出候选片段；自定义预设的缺表需在数据库中手动添加并校验，不要宣称会自动修复。
- 仅在用户明确需要检查时加入 `sourceData.ddl`、`note`、`initNode`、`insertNode`、`updateNode`、`deleteNode` 或配置；不要虚构 DDL 和规则。

## 示例

以下展示 JSONC 结构；按用户需要增加或删除真实业务列。

```jsonc
{
  "format": "acu_table_template_requirement_preset_v1",
  "version": 1,
  "preset": {
    "name": "数据库角色与背包检验",
    "description": "检查实际使用的角色、关系和背包字段。",
    "requirementLevels": {
      "defaults": { "sheet": "warning", "header": "warning", "ddl": "warning" },
      "sheets": {
        "sheet_DpKcVGqg": { "sheet": "error", "headers": { "姓名": "error" } },
        "sheet_in05z9vz": { "sheet": "error", "headers": { "物品名称": "error", "数量": "error" } }
      }
    },
    "template": {
      "sheet_DpKcVGqg": { "name": "主角信息表", "content": [["姓名", "所在地点", "近况"]] },
      "sheet_NcBlYRH5": { "name": "重要角色表", "content": [["姓名", "所在地点", "在场状态", "人际关系"]] },
      "sheet_in05z9vz": { "name": "背包物品表", "content": [["物品名称", "数量", "描述/效果", "类别"]] }
    }
  }
}
```

交付前确认：所有列真实存在；预设名称非空；没有示例数据行；用户未要求的地图、装备、数值属性或虚构 DDL 未被加为默认必需项。
