# jd-analysis references 索引

唯一索引。引用任何条目前必须先读本文件，确认条目存在与用途。未读到的内容不得引用。

## markdown 条目（按需读）

| 条目 | 用途 | 何时读 |
|---|---|---|
| [decode-patterns.md](decode-patterns.md) | 关键词 → 真实意图词典。把 JD 的黑话翻译成可判定的要求 | 阶段 1a，每次解析 JD 前 |
| [output-schema.md](output-schema.md) | 输出契约的完整字段清单与取值约束 | 阶段 1g，产出前 |

## 参数表（全量加载）

| 文件 | 岗位族 |
|---|---|
| [role-profiles/backend-sw.yaml](role-profiles/backend-sw.yaml) | 软件开发-后端 |
| [role-profiles/database.yaml](role-profiles/database.yaml) | 数据库 / DBA |
| [role-profiles/ai-knowledge-eng.yaml](role-profiles/ai-knowledge-eng.yaml) | AI 与知识库工程 |

字段定义见 [../../_schema/role-profile-schema.md](../../_schema/role-profile-schema.md)。

## JD 语料（jd-bank/）

按 T5 许可分级存放。L1 官方 ATS 只存结构化拆分 + URL + 抓取时间，原文只存 CC0/明确允许者；L3/L4 只存链接 + 标题 + 新鲜度，或人工提炼的方法论摘要 + `unverified` 标记。

**当前为空**——中文岗位无合规第一方 API，用户提供具体 JD 时走实时输入，不依赖预置语料库（T5 附带决策）。
