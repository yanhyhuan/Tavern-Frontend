# 来源与修改

Tavern Frontend / 数据库 骰子系统 V1.0.1 基于 jerryzmtz 的
my-tavern-scripts v6.32，原始提交：
`0b8bf2498d066a20d26e0418e3eec50d8bb04368`。

修改者：yanhyhuan；修改日期：2026-11-06。修改用于 V1.0.1 的酒馆扩展封装、
默认模板预设适配、逻辑表检查、公开 CRUD 保存及独立聊天属性；已改源码文件附有对应声明。

保留原骰子前端界面、功能实现、预设、作者署名及根目录 LICENSE 原文。
原许可证为 Aladdin Free Public License Version 9。

本版增加酒馆扩展入口、逻辑表兼容检查、公开 CRUD 正则保存、保存回读核验、
本地模板下载及配套测试。数据库接口参考 AlbusKen/shujuku 的 naiv1.3.6，提交
`0814f5a2fba925315654d66f4e534cecb98bce63`；不包含对数据库的修改。

内置 runtime SQL v4.5 模板由本项目维护者提供；原骰子内置预设经本版适配。
数据库默认模板由 AlbusKen/shujuku 固定提交的 buildDefaultTableTemplateString_ACU()
解码生成，署名 AlbusKen；数据库仓库未声明许可证，本项来源材料不归入骰子项目的 AFPL。
旧 v4.3 仅作为合成兼容回归的固定历史夹具，不供运行时选择。模板文件不包含聊天数据行；扩展不会自动导入模板或替换已有表。

模板候选的拼音名称冲突检查使用 pinyin-pro 3.28.2，作者 zh-lx，采用 MIT 许可证；
许可证与版权声明原文见 `docs/licenses/pinyin-pro-MIT.txt`。兼容算法参考数据库 1.3.6，未复制其模块。
