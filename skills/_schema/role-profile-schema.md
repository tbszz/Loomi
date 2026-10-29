# 岗位族参数表 schema v1.0.0

T4 定的维度集合 + T14 定的 frames 第四维度 + `skill_requirements` Truth Map 门槛。
Owner：`skills/jd-analysis/references/role-profiles/`（T8 §3 单一 owner）。
其余 skill 持**字段副本**，副本带 `source_version`，版本不匹配即报错（T5 §4，不静默降级）。

## 字段

| 字段 | 来源 | 说明 |
|---|---|---|
| `family_id` | T5 schema | 必填。`backend-sw` / `database` / `ai-knowledge-eng` |
| `version` | T5 §4 | 参数表语义版本 |
| `soc_code` | O*NET | 挂权威分类 |
| `job_zones` | O*NET | seniority 分化（5 级） |
| `hot_technology` | O*NET | 区分必备技术与新兴技术 |
| `required_skills` / `preferred_skills` | ESCO + jobstruct 二分 | 归一化后的差集即 gap |
| `critical_tasks` | BLS ORS | 岗位日常在做什么，支撑 situational 题设计 |
| `soft_skills` | ESCO transversal | behavioral 考察维度来源 |
| `success_factors` | **自研**（T4） | 这个岗位靠什么取胜 |
| `evaluation_focus` | **自研**（T4） | 面试真正考察什么 |
| `evidence_forms` | **自研**（T4） | 简历里什么形态的证据有说服力 |
| `frames` | **自研**（T14 Q2） | 第四维度，独立不从 `evaluation_focus` 派生 |
| `skill_requirements` | T14 Q5 | Truth Map 四级门槛（参数表侧） |
| `industry_params` | T4 行业参数层 | `language_style` / `education_bar` / `round_structure` / `portfolio_form` / `salary_band` |
| `keyword_dict` | T2 四层来源 | 关键词→意图词典 |
| `source_tier` | T5 | **必填**，缺它不得入库 |
| `license` | T5 | **必填**，缺它不得入库 |

## `frames[]`

```yaml
frames:
  - id: system-designer          # 机器可读 id，唯一
    label: 系统设计者              # 展示名
    signals: [architecture, ...] # 关键词列表，非唯一依据（T14 §3）
    emphasis:
      project_types: [...]        # 优先选这类项目
      skill_groups: [...]         # 优先突出这类技能
      bullet_weight:              # bullet 排序权重
        quantified-result: 1.5
        technical-depth: 1.3
        delivery-count: 0.6
    deemphasis: [...]             # 降权/压缩的类型
```

`signals` 是关键词，但**frame 识别必须在逐条资格匹配之后做**——不能只看 JD 标题含 "architect" 就框成系统设计者（T14 §3，shape rules are heuristics; the qualification list is evidence）。

## `skill_requirements`

```yaml
skill_requirements:
  postgresql: {min_level: working, preferred_level: deep}
  kafka: {min_level: working}
```

四级（T14 §5）：

| 级 | 含义 | 可否作 hands-on 证据 |
|---|---|---|
| `deep` | 独立做过生产环境关键决策 | ✅ strong |
| `working` | 生产中日常使用，能独立完成任务 | ✅ stated |
| `oversight` | 团队做、我 review/定方向 | ❌ 只能 led-not-performed |
| `historical` | 学过/用过但已过时或很浅 | ❌ Miss，不得声称 |

`min_level` 以下的匹配算 gap；`oversight` 证据永不作 hands-on 声称（T6 R1/R2 + T14 Q5）。

## 版本校验

运行时校验 `references/DATA_VERSION` ≥ SKILL.md frontmatter 的 `requires_data`。
低于 → 明确报错，**不静默降级**（"tool 失败不伪称成功"铁律）。
