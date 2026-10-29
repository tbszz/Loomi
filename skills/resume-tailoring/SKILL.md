---
name: resume-tailoring
description: 针对一个具体岗位改写或生成简历版本。当用户要求按某个 JD 定制简历、针对这个岗位优化、生成岗位版简历时使用。只能挑选、排序、压缩和改写 Candidate 已有证据，每条事实性 Claim 必须映射到 fact_id 或原文依据，无证据的内容进 gaps。
---

# 简历定制

## 适用场景

已有目标岗位，需要把 Candidate 的已有材料组织成针对该岗位的简历版本。

不适用于：先诊断简历问题（用 `resume-analysis`）、还没定岗位就想改简历（先用 `jd-analysis` 定要求）。

## 工作流

### 1. 先分析岗位

先按 `jd-analysis` 的方法得到：must-have、核心技能、preferred、限制条件、unverified 字段。

**没有 JD 就没有定制依据**，此时应说明需要岗位信息，或只做通用整理。

### 2. 再检索 Candidate 证据

调用 `search_candidate_knowledge`，按 JD 的关键维度分别检索（教育、经历、项目、技能、成果、指标、求职偏好）。

### 3. 只做四种操作

对已有证据只允许：

- **选择**：挑与岗位相关的，舍弃无关的。
- **排序**：把最相关的放在最前面。
- **压缩**：删掉冗余表述，保留事实。
- **澄清**：把含糊的说法写清楚（但不得扩大事实范围）。

### 4. 逐条建立 Claim → Evidence

每条写进正文的事实性内容都要能对上：

```text
Claim：……
依据：fact_id = ……（或原文引用 + 位置）
来源文档：……
```

**没有 `fact_id` 也没有原文依据的，一律进 gaps，不能进正文。**

### 5. 输出

- 按岗位重排后的简历正文（只含可映射的内容）。
- 变更说明：改了什么、为什么改、依据哪条证据。
- gaps：想写但无证据的内容，作为待补充项列出，并给出需要用户确认的具体问题。

## 硬性禁止

- 不得虚构或编造材料里没有的经历、职责、数字和成果。
- 不得新增材料里没有的技术、职责、数字、成果。
- **"参与"不能改成"独立负责"；"使用过"不能改成"精通"；"协助"不能改成"主导"。**
- **JD 里的技能不能直接复制成 Candidate 的技能。**
- 不得把团队成果改成个人成果，不得扩大职责范围与量级。
- 无证据内容只能进 gaps，绝不能进入正式简历正文。
- 材料读取不完整时只能依据已读取部分，并在输出中说明。
- 检索或生成失败要如实说明，不得把失败包装成"已生成"。

## 扩展分析方法（zzy）

以下方法用于补充分析；上面的当前应用契约优先。候选人身份由当前会话提供，不向用户重复索要 ID。references 中的 JSON 是分析组织示例，不是新的服务端写入 API；事实状态沿用 verified / user_asserted / disputed / disabled，不把练习反馈自动保存为事实，不把用户确认自动升级 verified。仅通过现有 MCP 工具保存、生成和导出；面试示例只用作结构参考，不能代写第一人称经历。


### 何时触发

- 用户要"按这个岗位改简历 / 定制一份简历 / 把这简历投这个 JD"
- jd-analysis 已产出逐条资格匹配表，需要落到可投递的稿子上
- 用户要求换一个定位重排同一份经历（frame 切换）

不触发：用户只要通用简历建议（resume-analysis）；没有目标 JD 的润色；面试准备。

### 流程骨架

顺序不可交换。T6 §2 的两遍生成规则靠这个顺序承载：**阶段 1 明确禁止检索 Candidate KB。**

```text
阶段 1（只读 JD，禁止碰 Candidate KB）
  a. 读 references/rewrite-rules.md —— frame 如何驱动 bullet 选择与排序
  b. 读 references/role-profiles/<family>.yaml —— 全量加载，取 frames[].emphasis.bullet_weight
  c. 确定 frame：传入的 frame > JD 识别结果（signals 关键词 + responsibilities 语义）
     不传 frame 就用 JD 识别结果，不追问（T14 §8）
  d. 读 jd-analysis 的 requirements[] 判定 Strong / Adjacent / Miss / Unknown

阶段 2（才检索 Candidate KB）
  e. 按 requirement 逐条检索候选人事实，facts 带 status（verified / needs_review）
     与 proficiency（deep / working / oversight / historical）
  f. 逐条判定证据形态：evidence_forms 里的哪一类、证据是否支持 stated
  g. 按 bullet_weight 给候选 bullet 排序，选择、压缩、合并

阶段 3（产出）
  h. 组装 bullets[]：每条必须带 fact_ids，缺 fact_id 不得进正式稿
  i. 组装 omitted[]：记录被 strip / 压缩 / 未采用的条目与原因
  j. 输出分三类列：已知事实 / 推断 / 待确认（T6 Q3），不得合并
```

禁止事项：

- 阶段 1 不得检索 Candidate KB，也不得把 JD 的要求抄成候选人能力
- frame 是排序与措辞层，**不是事实层**：换 frame 不得把 `inferred` 变 `stated`，
  不得把"参与"变"独立负责"（T14 §7）
- 不设追问硬上限；自律标准是"回答它是否改变答案"（T6 Q4）

### Inputs

- `candidate_id`: 候选人 id。**必填**——检索必须 scope by `user_id + candidate_id`。缺它即拒绝执行，不容推断
- `jd_text` 或 `jd_ref`: JD 原文或引用。**二选一必填**。`jd_text` 为空且 `jd_ref` 不可解析即拒绝
- `frame`: 可选，用户自选定位（合法值见 `references/output-schema.md`）。不传则用 JD 识别结果，**不追问**（T14 §8）
- `resume_text`: 可选，用户粘贴的简历原文。给了就以它为主要事实来源，缺的部分才检索 KB
- `target`: { role_family, region, seniority }。role_family 缺省从 JD 推断，合法值 `backend-sw` / `database` / `ai-knowledge-eng`

### Outputs

结构化记录（JSON），字段清单见 `references/output-schema.md`。关键字段：

- `frame` / `frame_source` / `jd_suggested_frame` / `frame_note`: frame 决策。`frame_source` ∈ `candidate` / `jd`；候选人不选即 `jd` 且 `frame_note` 说明用了识别结果（T14 §6/§8）
- `bullets[]`: { id, text, fact_ids[], section, weight, weight_keys, claim_type, provenance }。**每条必须带 fact_ids**——无 fact_ids 的 bullet 不得进正式稿（T9 §3 出口门禁）
- `omitted[]`: { text, reason, rule }——被摘除/压缩的条目与原因。正式稿摘除必须在响应里说明摘掉了哪几条
- `fact_buckets`: { stated, inferred, needs_review } 三类分栏（T6 Q3）
- `questions[]`: 追问，每条带 `changes_answer`（T6 Q4）

### 服务端契约
本分支的方法与输出结构仅用于组织分析；正式保存、生成和导出仍通过当前应用的求职工具及证据校验。不得声称 careerPolicy.js 已校验此分析 JSON。

### 怎么读 references

`references/_index.md` 是扩展方法 markdown 条目的索引。引用任何条目前必须先读它。未读到的内容不得引用。

参数表（`references/role-profiles/*.yaml`）**全量加载**——要按字段取值做判断，部分加载无意义。markdown 方法论与案例**按需读**。

案例（`references/cases.md`）是结构示范，不是成功实证：全部标 `synthetic: true`，JD 原文为真实 ATS 发布内容，候选人画像虚构。反例标它违反的 R1–R4 规则 id。

### 数据来源

```text
参数表 owner：skills/jd-analysis/references/role-profiles/<family>.yaml
本 skill 持字段副本，副本带 source_version。版本不匹配即报错，不静默降级。
最低版本：见 references/DATA_VERSION
```
