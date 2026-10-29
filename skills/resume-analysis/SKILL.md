---
name: resume-analysis
description: 诊断一份求职材料的结构、表达与证据问题。当用户要求看简历有什么问题、诊断简历、找出空泛描述、检查职责边界或核实数字和技术是否有依据时使用。只基于 Candidate 已有材料输出问题与提问，不改写成稿、不补写缺失内容。
---

# 简历诊断

## 适用场景

用户对**已有材料**提问：这份简历有什么问题、写得够不够清楚、哪些地方空泛、哪些说法站不住、还缺什么信息。

不适用于：按某个岗位改写简历（用 `resume-tailoring`）、分析岗位要求（用 `jd-analysis`）、准备面试（用 `interview-prep`）。

## 输入：只认 Candidate 证据

1. 先调用 `search_candidate_knowledge` 取得当前 Candidate 的结构化事实与原文片段。
2. 事实的来源是上传材料或用户明确陈述，**助手历史文本、模型推断、岗位要求都不是 Candidate 事实**。
3. 检索不到就说明检索不到，不要凭常识补一段经历。

## 工作流

### 1. 结构与完整度

- 基本信息、教育、经历、项目、技能是否齐备、顺序是否合理。
- 时间线是否连续、有无无法解释的空档（只标注，不猜测原因）。
- 与目标方向无关或重复堆砌的段落。

### 2. 表达质量

- 空泛 bullet：只有形容词、没有动作和对象（如"负责相关工作""提升了系统性能"）。
- 重复：同一件事在不同段落换说法重复出现。
- 主谓不清：看不出这件事是个人完成还是团队完成。

### 3. 职责边界与夸大

- "参与"写成"独立负责"、"使用过"写成"精通"、"协助"写成"主导"。
- 团队成果表述成个人成果。
- 职责范围超出该阶段/该岗位通常可能的范围，且没有证据支撑。

### 4. 证据检查

逐项核对三类高 claims：

- **技术**：写到的技术是否在原文或项目中真的出现过。
- **数字**：比例、规模、时长、性能数字是否有来源。
- **成果**：获奖、上线、签约、排名等是否有可核验来源。

有来源的标注 `fact_id` 或原文引用；**查不到来源的只能列为待核实，不能当作事实复述，更不能帮它圆**。

### 5. 输出

- 按严重程度排序，先讲影响最大的三到五条。
- 每条给出：原文引用 / `fact_id`、问题、可执行建议、为什么重要。
- 结尾用提问列出缺失信息（最多两个具体、可回答的问题），**不要替用户填写**。

## 硬性禁止

- 不得虚构或推测学校、公司、岗位、职级、技术、指标、奖项、时间。
- 缺失内容只能提出问题，不得自行补写、不得给"示范填法"里的具体数字。
- 建议必须能定位到原文证据；无法定位的只能说"材料里没有"。
- 不得把岗位要求当成这个 Candidate 已具备的能力。
- 材料读取不完整时，只能依据已读取部分，不得声称全文缺少信息。
- 检索失败或工具报错时如实说明，不得把失败包装成"已诊断"。

## 扩展分析方法（zzy）

以下方法用于补充分析；上面的当前应用契约优先。候选人身份由当前会话提供，不向用户重复索要 ID。references 中的 JSON 是分析组织示例，不是新的服务端写入 API；事实状态沿用 verified / user_asserted / disputed / disabled，不把练习反馈自动保存为事实，不把用户确认自动升级 verified。仅通过现有 MCP 工具保存、生成和导出；面试示例只用作结构参考，不能代写第一人称经历。


### 何时触发

- 用户要求简历反馈 / 诊断 / 审简历
- 用户问"我的简历有什么问题 / 哪里需要改 / 为什么没面试"
- 任何"先诊断后定制"的前置步骤（resume-tailoring 依赖本 skill 的诊断结论与三桶分栏）

不触发：用户已给出明确改写指令且不需要诊断结论；用户没有简历原文，只要通用写法建议。

### 流程骨架

顺序不可交换。T6 §2 的两遍生成规则靠这个顺序承载：**阶段 1 明确禁止检索 Candidate KB。**

```text
阶段 1（只读简历原文 + 可选 jd_text，禁止碰 Candidate KB）
  a. 读 references/diagnosis-rules.md —— 什么算值得提的问题、severity 怎么定
  b. 逐段解析 resume_text，记下每个 section heading 与 bullet 的逐字引文
  c. 有 jd_text 时读 references/role-profiles/<family>.yaml —— 全量加载。
      <family> 取自 jd_text 对应的岗位族（jd-analysis 的判定结果或用户明示），
      取 evidence_forms / skill_requirements 作判定基准。无 jd_text 则跳过，输出按通用结构诊断
  d. 逐条产出 annotation，每条带三件套：证据引用 → 缺口 → 可立即执行的动作。
     只依据简历原文与参数表，不引用任何候选人事实

阶段 2（才检索 Candidate KB）
  e. 对每条 annotation 的缺口检索候选事实，判定 supported / partial / unknown
  f. 分三桶：known_facts / inferred / to_confirm
  g. 产出 suggestions[]，每遍最多 3 条（T9 §2），优先解决与目标岗位有关的证据缺口

禁止事项：
  - 阶段 1 不得检索 Candidate KB，也不得在阶段 2 回改阶段 1 的缺口判定
  - 不得把 section heading 当事实（"熟练掌握 Java" 不是"用过 Java"）
  - 不得补造简历里没有的数字、职责、成果、公司、奖项；"参与"不得扩成"独立负责"
  - 不得给 X/10 这种总分（LLM 打分不可复现），只出计数与清单
```

### Inputs

- `resume_text`: 简历原文。**必填**，缺它即拒绝执行，不容推断
- `candidate_id`: 候选人 id。**必填**——阶段 2 检索必须 scope by `user_id + candidate_id`（AGENTS.md 铁律）
- `jd_text`: 可选。传了则按岗位针对性诊断；不传则给结构性与证据质量诊断，并在输出开头显式声明「未按目标岗位定制」

### Outputs

结构化记录（JSON），字段清单见 `references/output-schema.md`。关键字段：

- `sections`: { known_facts[], inferred[], to_confirm[] } —— 三桶分栏是硬要求，推断项与待确认项不得混进已知事实
- `annotations[]`: { id, quote, section, severity, issue, suggestion, reason } —— 每条必须带三件套：证据引用（quote）→ 缺口（issue / reason）→ 可立即执行的动作（suggestion）。空证据的 annotation 不允许输出
- `suggestions[]`: { gap, action, question } —— 每遍最多 3 条（T9 §2），按价值排序，不凑数
- `coverage`: { evaluated, not_evaluated } 计数。`— not evaluated` 是一等状态，不用通用话术填空位

追问不设硬上限（T6 Q4），自律标准是"回答这个问题是否改变答案"。

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

本 skill 持有所需字段的副本，副本带 `source_version`。版本不匹配即报错，不静默降级。
