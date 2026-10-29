# Job Eligibility Contract

岗位匹配必须先判断硬条件，再谈相关度。匹配分不能抵消明确不满足的资格要求。

## Decision order

1. 明确不符合硬条件 → `rejected`。
2. 信息不足、聚合 JD 不完整或条件无法确认 → `verify` / `uncertainties`。
3. 硬条件未发现冲突 → `passed`，再进行相关度排序和 Candidate Evidence 匹配。

## Checked dimensions

至少检查：

```text
source_completeness
freshness
job_type
location
education
major
experience
work_authorization
required_skills
```

输出可使用：

```json
{
  "status": "passed | verify | rejected",
  "reason": "中文原因",
  "checks": [
    {
      "dimension": "education",
      "status": "pass | unknown | fail",
      "message": "判断说明",
      "job_evidence": "JD 或岗位来源原文",
      "candidate_evidence": "Candidate Fact / 原文证据"
    }
  ]
}
```

## Evidence rules

- 每项资格结论都应分别保留岗位要求证据和 Candidate Evidence。
- “优先”不能自动变成“必须”。
- 未知不能当作通过，也不能当作失败；应标记待核实。
- 聚合摘要不等于完整官方 JD。
- 抓取时间不等于岗位发布时间。
- 近期官方在招列表的观察时间可作为开放状态线索，不能改写成发布日期；校园项目介绍、聚合摘要不提供这项证据。
- JD 中出现某项技能不能证明 Candidate 掌握该技能。
- 关键词相似度或总分不能覆盖学历、届别、工作授权等明确硬门槛。

## Search result contract

`search_jobs` 可以返回：

```json
{
  "jobs": [],
  "uncertainties": [],
  "rejected": [],
  "sources": [],
  "query": "React frontend"
}
```

`jobs` 包含资格未发现硬冲突的岗位：`passed` 排在前面；`verify`（要求未读取或部分条件待核实）随后，带标签留在主列表，用户可点原文查看，选中后自动读取官方 JD 再对照，核实前不称为推荐或匹配。`uncertainties` 保留为空数组以兼容旧消息；只有 `rejected`（明确不符合）单独折叠展示。

资格核验也作用于分页前的整个查询结果池，避免第一页先被硬条件冲突的岗位占满。查询服务优先保留标题相关、正文完整的具体岗位；同一相关性、完整性和招聘类型层级内，检查通过的岗位排在待核实岗位之前，再轮流展示不同公司。已拒绝的记录排在末尾，`total` 仍表示完整检索池大小。候选人的 `profile / material / exclude` 在预分页和聊天展示阶段保持一致；这些判断只属于当前响应，不写进共享岗位源记录。

同一个毕业届别在正文和结构化要求中重复出现只算一次；`27届` 等短写会识别为届别，多个届别或多条教育记录仍需核对。中文“本科/硕士及以上”用于学历检查；明确允许优秀本科等例外的岗位保留待核实。“优先”和兴趣描述不直接成为技能硬门槛。技能条件保留“任选一门/至少两种”的含义，含混的“及/或”组合不自动通过；个人项目年限不充当工作年限。开发、测试、芯片等领域年限按同一条要求分别核验，多个允许路径可以择一，作用范围不明则待核实。

岗位默认 7 天未再出现即归档（保留为历史，不删除）；校招汇总类来源（hu-eun-campus、campus-radar）按 60 天，因为其更新时间是收录时间而非下线时间；写明且已过的截止日期会提前归档。岗位检索在首次使用或来源到期时等待同步；已有新鲜快照不因翻页重复抓取。用户要求刷新时可显式刷新，失败的来源沿用未过期缓存并报告失败，不能显示为抓取成功。

招聘公告或批次（`recruitment_batch`）始终保持具体岗位要求待核实，不能仅凭汇总正文较长而通过来源完整性检查。截止日期仅在单个完整、有效且无延期歧义的日期已过时用于下线；旧发布日期本身只作提示，仍在官网列表中被观察到的岗位不会因此自动移除。

`query` 支持技术方向别名（如 AI、机器学习、大模型）和 `|` 分隔的多个可选方向；空格分隔的词仍须同时匹配。`location` 独立筛选地点；`company_scale`（`any` / `small_mid` / `large`）按大厂名单筛选，`largeCompany=false` 只表示不在名单内，不代表已知公司规模。检索先走 SQLite FTS5 全文索引（中文按双字切分）缩小候选，再用同一套精确匹配规则判定；单个汉字的查询退回全量扫描。结果按岗位标题相关度排序后轮流展示不同公司，提供 `total / offset / hasMore / nextOffset` 供“换一批”使用。总数表示检索池大小，不表示资格已通过的岗位数。

同一轮多次检索合并到同一张岗位卡片；不同用户轮次保留独立结果。待核实岗位直接展示公司、岗位、地点和原文入口，详细核验原因折叠，不重复整段风险说明。

## Resume relationship

岗位资格和简历生成共享 Evidence-first 原则，但两者是不同判断：

```text
Job requirement evidence
+
Candidate evidence
→ eligibility / gap

Candidate evidence
+
Target JD
→ resume tailoring
```

能力缺口只能展示为 gap 或追问，不能直接写进 Candidate 简历。
