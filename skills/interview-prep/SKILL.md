---
name: interview-prep
description: 针对目标岗位准备面试。当用户要求准备面试、预测会被问什么、练项目追问、整理 STAR 素材、做七天复习计划时使用。使用目标 JD 与 Candidate 证据，提供框架与追问，不替 Candidate 编造没有做过的经历或答案。
---

# 面试准备

## 适用场景

已有目标岗位（或明确的方向），要做面试前的准备：技术问题、项目追问、职责边界追问、数字追问、复习主题、准备计划。

不适用于：改简历（用 `resume-tailoring`）、判断岗位要求（用 `jd-analysis`）。

## 输入

1. 目标 JD：按 `jd-analysis` 得到的 must-have、核心技能、preferred。
2. Candidate 证据：调用 `search_candidate_knowledge` 取得事实与原文，**每条都要带 `fact_id` 或引用**。
3. 没有 JD 时：明确说明只能做通用准备，岗位针对性会下降。

## 工作流

### 1. 岗位相关技术问题

围绕 JD 的核心技能出技术题，难度匹配岗位层级。每题标注它对应 JD 的哪一条要求。

### 2. 项目追问

针对 Candidate 的真实项目出追问：

- 为什么这么做、有没有别的方案、代价是什么；
- 遇到的具体问题与排查过程；
- 个人贡献与他人贡献的分界。

### 3. 职责边界与数字追问

**这是最容易被问穿的地方，必须主动标记风险：**

- 简历里"参与/协助"的地方，被追问"你具体做了哪部分"时怎么答；
- 每个数字（性能、规模、时长、增长）被追问"怎么测的/怎么算的"时是否有依据；
- 没有依据的数字 → 标为高风险，建议准备"说明来源"或"改写为可解释的说法"，**不能编一个来源**。

### 4. STAR 素材

给框架（Situation / Task / Action / Result），并按 Candidate 的真实事实把每个项目整理成骨架：

- **可以**帮用户组织已发生的事；
- **不可以**虚构 Action 细节、补一个 Result 数字、编造没做过的项目。

填空式输出：

```text
S：……（依据 fact_id）
T：……（依据 fact_id）
A：待补充（材料中未找到具体动作，请补充）
R：待补充（材料中未找到可核验结果）
```

### 5. 角色相关复习主题

按岗位技术栈列出复习主题与优先级（高/中/低），并说明为什么。

### 6. 七天计划（可选）

每天一个主题 + 具体练习 + 可验收产出。练习必须是"能自己做出来的"，不是"背一段答案"。

## 硬性禁止

- **不得让 Candidate 背诵没有做过的经历。**
- 不得虚构 STAR 的具体动作、结果数字或项目背景。
- 不得为弱证据补一个看似合理的解释。
- 不得把 JD 要求当成 Candidate 已掌握的内容来出题。
- 工具失败或检索为空要如实说明，不得把失败写成"已准备完毕"。

## 扩展分析方法（zzy）

以下方法用于补充分析；上面的当前应用契约优先。候选人身份由当前会话提供，不向用户重复索要 ID。references 中的 JSON 是分析组织示例，不是新的服务端写入 API；事实状态沿用 verified / user_asserted / disputed / disabled，不把练习反馈自动保存为事实，不把用户确认自动升级 verified。仅通过现有 MCP 工具保存、生成和导出；面试示例只用作结构参考，不能代写第一人称经历。


### 何时触发

- 用户说"要准备面试 / 下周面试 / 怎么突击"
- 用户要模拟面试题、追问预测、项目深挖题
- 用户要一份按天排的面试学习计划
- 作为 practice / debrief 的承接 skill（每次练习后必须 debrief）

不触发：用户只要通用简历建议、没有面试目标。

### 流程骨架

顺序不可交换。阶段 1 只读 JD 与参数表，**明确禁止检索 Candidate KB**；阶段 2 才检索。
pass 1 的结论（考察什么）不得在 pass 2 被改写成"候选人会什么"。

```text
阶段 1（只读 JD + 参数表，禁止碰 Candidate KB）
  a. 读 references/role-profiles/<family>.yaml —— 全量加载
  b. 从 JD 提取面试轮次与考察侧重（industry_params.round_structure + evaluation_focus）
  c. 读 references/question-banks/<family>.yaml —— 取考察维度匹配的题
  d. 读 references/star-examples.md —— 只在需要写项目深挖题或故事时

阶段 2（才检索 Candidate KB）
  e. 按 candidate_id + user_id scope 检索候选人事实
  f. 生成 project_questions[]——每题的 based_on 必须带 fact_id
  g. 生成 technical_review[]——来源必须是参数表 evaluation_focus，不是猜测
  h. 生成 plan[]——按 days 排天，focus 取自参数表维度

阶段 3（产出）
  i. 产出输出契约（见下），三类分栏不得合并
  j. 调用当前工具保存产出；不得伪称未执行的校验成功

禁止事项：
  - 阶段 1 不得检索 Candidate KB，也不得把"JD 要求考察"回改成"候选人会"
  - technical_review 不得来自通用技术榜单或个人猜测，只能来自参数表 evaluation_focus
  - historical 级技能不得出复习项也不得声称（参数表四级门槛）
  - 不得给总分或 X/10（LLM 打分不可复现）
```

### Inputs

- `candidate_id`: 候选人 id。**必填**——检索必须 scope by `user_id + candidate_id`。缺它即拒绝执行，不容推断
- `jd_text`: JD 原文。可选。不传则输出通用框架，并在开头显式声明「以下未按你的目标岗位定制」
- `days`: 计划天数。可选，默认 7。取值 clamp 到 1–30，越界时在 `meta.note` 声明被 clamp
- `role_family`: 岗位族。可选，合法值 `backend-sw` / `database` / `ai-knowledge-eng`。缺省从 JD 推断；JD 也没有则拒绝执行并说明

### Outputs

结构化记录（JSON），字段清单见 `references/output-schema.md`。关键字段：

- `plan[]`: { day, focus, tasks[] }——focus 必须来自参数表 `evaluation_focus` / `critical_tasks` / `skill_requirements`
- `project_questions[]`: { question, based_on, evaluation_focus }——based_on 必带 `fact_id`
- `technical_review[]`: { id, title, why, priority }——**来源是参数表 `evaluation_focus`**，即 profile 侧对"面试真正考察什么"的答案
- `buckets`: 已知事实 / 推断 / 待确认 三类分栏，永不合并

### practice → debrief 飞轮

plan 是起点不是终点。每次练习后必须 debrief，模板见 `references/debrief-template.md`：

```text
practice（一次只练一题）
  → debrief（逐题评估 + 三类分栏 + oversold 自查 + 下一轮预测）
  → 下一轮 practice 的选题 = 上一轮 missed > shaky > 待确认 > 未覆盖维度 > 新题
```

已知弱点无库存题时优先练它——真实表现数据优于推断风险。debrief 的产出是训练数据，
不进正式稿；其中的推断一律 `needs_review`，用户确认才升 `verified`。

### 服务端契约
本分支的方法与输出结构仅用于组织分析；正式保存、生成和导出仍通过当前应用的求职工具及证据校验。不得声称 careerPolicy.js 已校验此分析 JSON。

### 怎么读 references

`references/_index.md` 是扩展方法 markdown 条目的索引。引用任何条目前必须先读它。未读到的内容不得引用。

参数表与题库（`references/role-profiles/*.yaml`、`references/question-banks/*.yaml`）**全量加载**。
markdown 方法论**按需读**。

### 数据来源

```text
参数表 owner：skills/jd-analysis/references/role-profiles/<family>.yaml
最低版本：见 references/DATA_VERSION
```

本 skill 持有所需字段的副本，副本带 `source_version`。版本不匹配即报错，不静默降级。

题库为 L4 人工提炼方法论，`unverified: true`，只作练习选题与考察维度参考，
不得作为可断言语料引用。
