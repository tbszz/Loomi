---
name: jd-analysis
description: 把一份岗位说明拆成透明的要求清单。当用户粘贴或选中岗位、问这个岗位要什么、问硬条件是什么、问自己是否符合、想了解岗位职责与偏好时使用。输出的是岗位要求，不是 Candidate 的能力，也不输出录用概率。
---

# 岗位（JD）分析

## 适用场景

用户给出一段岗位描述、一个职位链接或一条岗位记录，想知道：这到底是什么岗位、硬性要求是什么、哪些是加分项、有哪些限制条件、这份信息可不可信。

不适用于：改写简历（用 `resume-tailoring`）、诊断简历（用 `resume-analysis`）。

## 工作流

### 1. 先记录来源

- 来源类型：用户粘贴的官方 JD / 平台抓取的聚合文本 / 岗位库记录。
- 抓取或观察到的时间、原始链接或来源 ID。
- **聚合站文本不等于完整官方 JD**：缺失或无法确认的要求一律标记 `unverified`，不得脑补。

### 2. 拆成四类要求

- **岗位基本信息**：岗位名称、所属团队或业务方向、工作地点、雇佣形式。
- **must-have 硬要求**：不满足就无法推进的条件（学历、专业、年限、必备技术、资质、工作许可）。
- **核心技能**：岗位日常真正要用的能力。
- **preferred 偏好**：属于加分，不满足不构成硬伤。

### 3. 资格与限制条件

学历、专业、经验年限、地点、出差、语言、工作许可/签证、是否接受应届或转行。

### 4. 有效性判断

- 信息完整度：哪些字段有原文依据，哪些是推断。
- 时效性：抓取时间距今多久，是否存在过期风险。
- 矛盾点：JD 内部或不同来源之间冲突的地方。

### 5. 与 Candidate 的对照（只在用户要求时）

对照时**必须显式区分三栏**：

| 岗位要求 | Candidate 证据 | 结论 |
| --- | --- | --- |
| 来自 JD 原文 | 来自 `search_candidate_knowledge`，附 `fact_id` 或引用 | 已满足 / 部分满足 / 无证据 / 待核实 |

- 没有检索到证据就写"无证据"，**不得默认满足，也不得默认不满足**。
- 这一步只是对照，不等于录用判断。

## 硬性禁止

- **不得把 JD 要求写成 Candidate 已具备的能力**（这是最常见的污染）。
- **不得把关键词匹配分数包装成录用概率、竞争力评分或通过率**。
- 不得为满足 JD 而暗示 Candidate 补一段没做过的经历。
- 聚合信息不完整必须标 `unverified`，不得当作官方要求陈述。
- 不得虚构或编造岗位要求、年限、薪资、资质等内容来凑齐清单；没有依据就写 `unverified`。
- 工具失败或抓取失败要如实说明，不得把失败写成"该岗位无特殊要求"。

## 扩展分析方法（zzy）

以下方法用于补充分析；上面的当前应用契约优先。候选人身份由当前会话提供，不向用户重复索要 ID。references 中的 JSON 是分析组织示例，不是新的服务端写入 API；事实状态沿用 verified / user_asserted / disputed / disabled，不把练习反馈自动保存为事实，不把用户确认自动升级 verified。仅通过现有 MCP 工具保存、生成和导出；面试示例只用作结构参考，不能代写第一人称经历。


### 何时触发

- 用户粘贴了一段 JD 文本或给了 JD 链接
- 用户问"这个岗位我合适吗 / 能不能投 / 缺什么"
- 任何需要"按岗位定制"的前置步骤（resume-tailoring 依赖本 skill 的输出）

不触发：用户只要通用简历建议、没有目标 JD。

### 流程骨架

顺序不可交换。T6 §2 的两遍生成规则靠这个顺序承载：**阶段 1 明确禁止检索 Candidate KB。**

```text
阶段 1（只读 JD，禁止碰 Candidate KB）
  a. 读 references/decode-patterns.md —— 关键词 → 真实意图
  b. 从 JD 逐句提取 requirements，每条带 sourceQuote（逐字引文）
  c. 读 references/role-profiles/<family>.yaml —— 全量加载
  d. 识别 persona frame（在 c 之后做，不能只看 JD 标题）

阶段 2（才检索 Candidate KB）
  e. 逐条 requirement 检索候选人事实，判定 Strong / Adjacent / Miss / Unknown
  f. 计算 proficiency gap（参数表门槛 vs KB 实际级别）
  g. 产出输出契约（见下）

禁止事项：
  - 阶段 1 不得检索 Candidate KB，也不得把 importance 在阶段 2 回改
  - 不得从 JD 措辞推断候选人能力（"要求熟悉 Kafka" ≠ "候选人会 Kafka"）
  - 不得给 X/10 这种总分（LLM 打分不可复现）
```

### Inputs

- `jd_ref`: JD 引用（id 或原文）。必填，`jd_text` 与 `jd_ref` 二选一
- `candidate_id`: 候选人 id。**必填**——检索必须 scope by `user_id + candidate_id`（AGENTS.md 铁律）。缺它即拒绝执行，不容推断
- `target`: { role_family, region, seniority, industry }。role_family 必填，合法值 `backend-sw` / `database` / `ai-knowledge-eng`
- `frame`: 可选，用户自选定位。不传则用 JD 识别结果

### Outputs

结构化记录（JSON），字段清单见 `references/output-schema.md`。关键字段：

- `requirements[]`: { id, text, required, status, sourceQuote, hardStop, importance, verdict, evidence, proficiency, note }
- `persona`: { frame, frame_label, frame_source, jd_suggested_frame, frame_note, matched_signals }
- `summary`: { Strong, Adjacent, Miss, Unknown } 计数，**不是分数**

### 服务端契约
本分支的方法与输出结构仅用于组织分析；正式保存、生成和导出仍通过当前应用的求职工具及证据校验。不得声称 careerPolicy.js 已校验此分析 JSON。

### 怎么读 references

`references/_index.md` 是扩展方法 markdown 条目的索引。引用任何条目前必须先读它。未读到的内容不得引用。

参数表（`references/role-profiles/*.yaml`）**全量加载**——要按字段取值做判断，部分加载无意义。markdown 方法论**按需读**。

### 数据来源

```text
参数表 owner：skills/jd-analysis/references/role-profiles/<family>.yaml
最低版本：见 references/DATA_VERSION
```

其他 skill（resume-tailoring / interview-prep）持有所需字段的副本，副本带 `source_version`。版本不匹配即报错，不静默降级。
