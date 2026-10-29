# Debrief 模板：practice → debrief 飞轮

T11 的可迁移机制：练习不是一次性文档，是**长期训练**。每一次 practice 之后必须 debrief，
debrief 的产出直接决定下一次 practice 练什么。没有 debrief 的练习不产生积累。

本文件是模板。每次练习后按本结构填写，落为绑定 conversation 的结构化数据。

## 输入来源标记（`input_source`）

两种输入的可信度不同，**必须标记**：

| 值 | 含义 | 事实性权重 |
|---|---|---|
| `transcript` | 有完整对话记录 | 正常 |
| `recall` | 凭记忆复述，无记录 | **降权**——复述会漏细节、会无意中美化，据此下的结论标 `[unverified]` |

面试后的 debrief 多半是 `recall`。这不影响记录，但影响结论强度：
recall 来源的"我当时答得不错"不能作为已掌握的证据。

## 模板

```yaml
debrief_id: <uuid>
session_id: <practice session id>
candidate_id: <候选人 id>          # 必填，scope 强制字段
role_family: backend-sw | database | ai-knowledge-eng
input_source: transcript | recall
practiced_at: <ISO 时间>

## 1. 本次练了什么
practiced:
  - question_id: <题库 id 或自出题>
    type: behavioral | system | technical | case
    evaluation_focus: [<参数表 evaluation_focus id>]

## 2. 逐题评估（更新问题库）
question_assessments:
  - question_id: <同上>
    status: solid | shaky | missed
    what_landed:               # 答得好的地方，具体到句子
      - "..."
    what_to_sharpen:           # 要改的地方，具体到改什么
      - "..."
    stronger_version:          # 更强的说法（不是范文，是改写后的结构）
      - "..."
    evidence_gap:              # 缺的证据，进待确认桶
      - "..."
    self_rating_basis: recall | transcript   # 自评的依据

## 3. 三类分栏（T6 Q3，不得合并）
buckets:
  known_facts:                 # 已知事实——有 fact_id 支撑
    - { claim: "...", fact_id: "..." }
  inferred:                    # 推断——无直接证据，标 [unverified]
    - { claim: "...", basis: "...", unverified: true }
  to_confirm:                  # 待确认——必须问用户，不得自行填补
    - { question: "...", changes_answer_by: "<回答它会改变哪个结论>" }

## 4. 下一轮预测（T11：预测下一轮且标记 [inferred]）
next_round_predictions:
  - { question_direction: "...", inferred: true }

## 5. 故事回填
stories:
  - new:                      # 本次新成型、可复用的故事
      - { story_id: "...", oversight_level: deep | working | oversight, fact_ids: [...] }
    revised:                  # 讲崩了需要重写的故事
      - { story_id: "...", reason: "..." }
    retracted:                # 撤回的主张——永不复提（T11 retracted-claims 硬门）
      - { story_id: "...", claim: "...", reason: "..." }

## 6. 诚实自评
honest_self_assessment:
  overall_status: 🟢 | 🟡 | 🔴
  strongest: "..."            # 今天最有说服力的一个点
  weakest: "..."              # 今天最可能被面试官打穿的一个点
  oversold:                   # 我讲过了头的部分——主动列出来
    - "..."
  confidence_basis: "..."     # 这个自评建立在什么证据上
```

## 填写规则

### 1. 一次只评一题

一次 practice 只问一问、只评一题。批量评估会让 `question_assessments` 退化成印象分，
而印象分不可复现（T11：*"a rating of 87 vs 84 will not reproduce itself"*）。

### 2. `status` 三档，没有"还行"

| 值 | 判据 |
|---|---|
| `solid` | 能在没有提示的情况下讲完，且每个事实主张有 `fact_id` |
| `shaky` | 能讲但卡顿、或关键数字要现想、或角色边界模糊 |
| `missed` | 讲不出来、讲错、或被发现是在编 |

`shaky` 是最高频也最有价值的状态——它精确指出了下一轮练什么。

### 3. `oversold` 必须填，可以为空但必须显式存在

主动列出"我讲过了头的部分"。这是反假大空机制在练习侧的自查对应物。
规则：**候选人无法佐证的故事不是"rework"而是重写或丢弃**（T11）。
一次 debrief 里 `oversold` 有内容而下一轮没有改进，说明练习在强化错误。

### 4. `retracted` 是硬门

撤回的主张**永不复提**。撤回不是因为"说得不好"，是因为"不成立"——
一旦某个故事被认定为无法佐证，它不能再出现在任何后续 practice、plan 或正式稿里。

### 5. 飞轮怎么转

```text
debrief.weakest + debrief.question_assessments[shaky|missed].what_to_sharpen
        ↓
下一轮 practice 的选题（已知弱点无库存问题时优先练它——real performance data
outranks inferred risk，T11）
        ↓
新的 debrief → 更新 question_assessments → ...
```

**选题优先级**：

1. 上一轮 `missed` 的题
2. 上一轮 `shaky` 的题
3. `to_confirm` 里有新答案后能改变结论的题
4. 参数表 `evaluation_focus` 里尚未覆盖的维度
5. 题库新题

### 6. 诚实自评的框架

自评不是打分（LLM/自评打分不可复现，T6/jd-analysis 同样禁止 X/10）。
用三问：

- **今天最有说服力的一个点是什么？** 说不出来就是没有。
- **今天最可能被面试官打穿的一个点是什么？** 答不上来的题、模糊的数字、边界不清的角色。
- **我的自评建立在什么证据上？** `transcript` 还是 `recall`？有 `fact_id` 还是印象？

🟢 的标准不是"全答对了"，而是**每个答案的角色边界和事实边界都清楚，且知道自己哪里虚**。
🔴 的信号是：自评说"感觉还行"但说不出具体哪里好。

### 7. debrief 的产出不进正式稿

debrief 是训练数据，不是简历内容。其中的推断一律 `status=needs_review`，
用户确认才升 `verified`（T6 Q2）。正式稿的出口仍由 当前求职工具的证据校验 校验。
