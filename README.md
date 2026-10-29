# Loomi Desktop

Loomi 的 Electron 桌面端（Windows 优先）。本仓库从网页端仓库 `tbszz/Resume-Protocol` 拆分而来（2026-10-28，基于 `feat/workspace-motion` 的 d3ccae1 及当时未提交的动效改动）。`server/`、`src/`、`skills/`、`knowledge/` 等与网页端共用的代码是复制过来的副本，两边需要的修复要分别提交到两个仓库。

```text
desktop/       Electron main / preload / 本地服务入口 / 打包配置
src/desktop/   桌面端专属 UI：账户与同步状态、Loomi 开场动画、登录页
```

```bash
npm ci
npm run desktop:dev      # 构建前端并启动 Electron
npm test                 # 含 npm run test:desktop
npm run desktop:dist     # 打包 Windows NSIS 安装包到 release/
```

登录页和开场动画组件已就位，但尚未挂进 Electron 外壳；`desktop-preview.html` 可单独预览。云同步约定见 [`docs/desktop-cloud-sync.md`](docs/desktop-cloud-sync.md)。

---

## 原项目说明（Loomi，原名 Resume Protocol）

Loomi 是一个长期陪伴式 Personal Career Agent：围绕每个求职者建立可持续积累、可检索、可追溯的个人职业背景库，并在不同 Conversation 中复用这些真实信息完成简历分析、JD 分析、岗位判断、定制简历和面试准备。

当前仓库处于 P0 架构迁移阶段。目标架构以 Claude Agent SDK 作为 Primary Career Agent Runtime，以 Candidate Knowledge Base 作为长期个人背景，以第一方 Career Skills 提供垂直求职能力。

## Canonical docs

项目只长期维护少量核心文档：

- [`PRD.md`](PRD.md)：P0 要做什么、如何验收。
- [`ARCHITECTURE.md`](ARCHITECTURE.md)：整体架构、Claude Agent SDK 与 Loomi 的边界。
- [`DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md)：开发和规划必须遵守的中心规则。
- [`DESIGN.md`](DESIGN.md)：当前工作区 UI / UX 约束。
- [`AGENTS.md`](AGENTS.md)：给 coding agent 的项目入口规则。
- `docs/`：少量专项技术说明。

历史 dated plans / 旧 PRD 不作为当前设计依据；Git 历史保留它们的演进记录。

## P0 mental model

```text
User
  ↓
Workspace / API
  ↓
Primary Career Agent
Powered by Claude Agent SDK
  ├─ Session / Agent Loop / Planning
  ├─ Skill use
  └─ Tool / MCP use
       ↓
Career Skills + Career Tools
       ↓
Candidate Knowledge Base / Job Knowledge
       ↓
Evidence Grounding / Verification
```

关键边界：

```text
Claude Agent SDK
= 通用 Agent Runtime：会话、Agent Loop、规划、Skills、Tools/MCP、权限/Hook 等

Loomi
= 求职领域：Candidate KB、RAG、Career Skills、业务 Tools、Job Knowledge、事实校验
```

不要在 SDK 上方再造一个 Brain / Router Agent / Agent Loop。

## P0 Career Skills

第一轮建立四个第一方 Skill：

```text
skills/
├── resume-analysis/
├── jd-analysis/
├── resume-tailoring/
└── interview-prep/
```

具体候选人资料不存进 Skill；通过 Candidate Knowledge Base / RAG 获取。

## Session 与长期记忆

只区分两种记忆：

```text
Agent Session / Conversation History
= 当前 Conversation 的连续上下文

Candidate Knowledge Base
= 跨 Conversation 的长期个人背景
```

Candidate Fact 自带 Evidence / Provenance，用来回答“这条事实来自哪里”；它不是第三套 Memory。

## 当前迁移状态

2026-10-08 已验证：默认主 Agent 使用 Claude Agent SDK 的会话续接、四个第一方 Skills、受控 MCP 业务工具和取消机制。四个 Skills 的真实模型调用及新会话检索、证据核验、PDF/DOCX 导出均通过验收。主请求路径不再导入 Brain；Plugins 和 Agent/Task 仍关闭。

P0 迁移方向：

```text
1. 建立四个 Career Skill 目录与隔离加载                    ✅ 地基完成（真实路由待验收）
2. 从主请求链路移除 Brain LLM                              ⏳ 下一步
3. 建立 Candidate + candidate_id                         ✅ 已完成
4. 建立 CandidateFact + DocumentChunk                    ✅ 已完成
5. 实现 search_candidate_knowledge / Hybrid RAG          ⏳ 部分（关键词检索，无 BM25/向量）
6. 启用 Conversation / SDK Session 连续性                 ⏳ 未开始
7. 打通 JD → RAG → resume-tailoring → verification → export  ⏳ 未开始
8. 通过回归测试后删除 legacy Brain 代码                     ⏳ 未开始
```

### Career Skills（四个第一方 Skill 已就位，真实路由已验证）

`skills/` 下有四个第一方 Skill：`resume-analysis`、`jd-analysis`、`resume-tailoring`、`interview-prep`。它们只描述**如何完成求职任务**，不保存任何 Candidate 的个人事实；Candidate 资料一律通过 `search_candidate_knowledge` 获取，并按 `user_id + candidate_id` 由服务端确定性隔离。

SDK 版本锁定在 `@anthropic-ai/claude-agent-sdk@0.3.269`。每次请求都会创建隔离临时目录，服务端只把这四个 Skill 复制进该目录，并把 `skills` 选项固定为这四个名称（不使用 `"all"`）：

- 不加载用户主目录、`~/.claude`、local 设置或同步 Skills（`settingSources: []`）；
- 不启用第三方 Plugin（`plugins: []`）；
- Skill 之外的工具（Bash / Read / Write / Agent / Task 等）继续禁用；
- SDK 的 `skills` 精确名单只暴露这四个名称，隔离目录中也只安装这四个 Skill；
- `permissionMode: "dontAsk"` 与 `permissionPrompts: "none"` 不提供人工放行入口，未预授权工具直接拒绝；
- 本轮 Career MCP 工具由 `allowedTools` 精确列出，危险内置工具由 `disallowedTools` 显式禁用；
- 请求结束、失败、超时或取消后临时目录都会被清理；
- Skill 装载失败会明确报错，不会静默跳过并声称已使用 Skill。

**2026-10-08 已验证：四个 Skill 的真实模型调用均已通过验收**，运行时把 assistant event 中观察到的 Skill 工具请求记为 `observedToolRequests`——它是运行轨迹记录，不是执行成功证明，模型实际是否按 Skill 方法执行仍由验收用例另行判定。

主请求路径不再导入 Brain；迁移完成前 `server/brain.js`、`knowledge/brain.md` 等仍可能被现有代码读取，但不应继续扩展。

上述清单保留为迁移方向；当前验收状态和剩余工作见 [架构验收记录](docs/architecture-verification-2026-10-08.md)，不要将通过一条 Golden Case 视为所有架构要求已完成。

## 启动

需要 Node.js 22.13 或更新版本。

验证 Candidate 长期档案需要真实模型凭据：把 `.env.example` 复制成 `.env` 并填写模型配置，
默认主 Agent 需要 SDK 支持的服务端模型配置。自定义 OpenAI/Anthropic 兼容配置仅保留辅助调用，不能替代主 SDK 运行时。没有凭据时应用会诚实报错，不会编造回答。

```powershell
npm install
# 复制 .env.example 为 .env，并按需要填写模型配置
npm run app
```

默认应用地址为：

```text
http://127.0.0.1:8787
```

开发模式可分别运行：

```powershell
npm run server
npm run dev
```

Vite 开发地址默认：

```text
http://127.0.0.1:5173
```

## Agent Runtime

仓库当前锁定：

```text
@anthropic-ai/claude-agent-sdk 0.3.269
```

Claude 和 MiniMax 默认配置均通过 Claude Agent SDK 执行主 Agent；兼容模型只用于辅助请求。修改 SDK 集成时，应先以当前锁定版本做能力验证，再决定是否升级。

P0 的目标不是开放 Claude Code 的所有系统能力，而是：

- 使用 SDK 的 Agent Runtime、Session、Skills、MCP/Tool 和权限机制；
- 只暴露 Loomi 明确注册的业务 Tool；
- Candidate 文件和数据库访问继续通过受控业务 Tool / Service；
- 默认不开放任意 Bash、任意文件写入和不受控外网动作。

## Data

当前持久化主要位于本地 `data/` 目录（已 Git ignore）：

- SQLite：账户、会话、业务状态和生成结果。
- uploads：私有原始附件。
- model settings key：自定义模型密钥的本地加密材料。

长期个人背景使用 Candidate / CandidateFact / DocumentChunk；检索支持结构化事实、SQLite FTS5/BM25 和中文分词回退，另有可选语义向量融合检索。按 `.env.example` 显式选择本机 Ollama（已安装模型与完整 digest）或云端 embedding（千问 `qwen3.7-text-embedding-flash`，或 Google `gemini-embedding-001`）。不会自动下载模型，也不借用聊天/JEV 密钥。未配置或失败时保留词面检索并如实返回状态。

真实模型验收入口：`npm run test:real-embedding` 使用当前进程配置；`npm run test:configured-embedding` 显式加载忽略于 Git 的 `.env.embedding`。只使用独立临时数据库和合成材料，不读取通用 `.env`、聊天密钥或真实候选人资料。未配置、连接失败或检索质量不合格都以非零退出，不算验收通过。`npm test` 中的回归测试仍使用模拟向量，只证明验收规则，不证明真实模型效果。2026-10-10 实测：`gemini-embedding-001`（768 维）通过全部六条双语排名/边距验收（千问同门仅 2/6，3072 维一条边距未达标），`test:configured-embedding` 以退出码 0 通过。

云端适配均为显式白名单：千问限 `https://maas.qianwenaiapi.com/compatible-mode/v1` + `qwen3.7-text-embedding-flash`（1024 维）；Google 限 `https://generativelanguage.googleapis.com/v1beta` + `gemini-embedding-001`（768/1536/3072 维，单文本请求带 `RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT` task type），均使用独立 `RESUME_EMBEDDING_API_KEY`（Google 走 `x-goog-api-key` 头部）。直连不可达的网络下，embedding 传输自动使用 `HTTPS_PROXY`/`HTTP_PROXY`（undici ProxyAgent，仅作用于 embedding，不影响聊天路由）。服务端启动命令自动加载可选 `.env.embedding`；已有进程需重启后生效。云端检索会发送当前候选人的待索引材料文本和查询，不发送网申加密资料或附件字节。缓存按地址、模型、维度和显式 `REVISION` 隔离；云端模型别名不是不可变版本，服务商更新后需修改 revision 重建缓存。建议配置文件仅授予当前用户与系统读取权限，不要提交或公开密钥。

## 按需网申填表

工作区右侧面板 →「网申填表」：保存本地申请资料，连接企业校招网页，在专用本机浏览器里自行登录，再扫描并填写空白字段。默认保留已输入内容，未知项留空，由本人检查和提交。敏感资料单独加密保存，不通过聊天录入。网页可能在输入时自动保存。

现支持原生输入、日期、下拉、已有多条经历字段，以及逐字段明确选择当前求职者的原始附件（PDF/DOCX/TXT/Markdown，总量最多8MB）。未选就不上传，已有或刚选的附件不替换，来源失效或网页格式限制变化则跳过；选择本身不会上传，点击填写后网页可能立即接收文件。不会由模型挑选附件或静默替换成生成版简历。扫描会列出可识别的自定义控件；有明确空白态及 ARIA 绑定的单选下拉会在填写时展开，二次读取所属选项并精确匹配。已有内容保留，未知或重复选项不猜。日期面板、级联、多选、未支持的自定义控件、跨页和新增经历行仍需手动处理。JEV 可对非标准字段的固定公开用途词做 Choice 判断，个人信息仍在本机映射；常规字段不需要调用。凭据读取 `TYPESAFE_API_KEY` 或当前 Windows 用户的 Credential Manager，缺凭据、判断失败或置信度低时留给人工。只按真实调用结果报告是否使用 JEV，不增加第二个 Agent。新增 provider 和集成测试已纳入 `npm run test:architecture` 与 `npm test`。

Candidate 数据访问必须按 `user_id + candidate_id` 隔离。

## Documents and export

上传支持 PDF、DOCX、TXT、Markdown 等材料。PDF 读取与 OCR 规则见 [`docs/pdf-reading.md`](docs/pdf-reading.md)。

定制简历支持 PDF / DOCX 导出。事实性 Resume Claim 必须能映射回 Candidate Evidence；无来源技术、数字、职责或成果不能进入正式生成稿。

## Job knowledge

岗位知识与 Candidate Knowledge 分开维护。当前后台岗位服务继续使用本地快照、来源追踪、时效和资格判断。

Hiring Radar 的国内企业采集已接入同一个 `search_jobs` 岗位服务，采用固定上游版本和逐源失败状态，不嵌入第三方工作台。支持公司名称清洗、招聘活动隔离、招聘批次标记和保留出处的跨源去重。安装、同步、备份与清理命令见 [`docs/job-ingestion.md`](docs/job-ingestion.md)。

`server/officialJobSources.js` 是官方岗位源的唯一注册表，覆盖 21 家国内主流公司（26 条源），其中 **14 条源已适配接口**、12 家只登记官方入口。**每家官网声明自己的适配器**，而不是用一套通用 HTML 抓取去猜：

- `json-api`：直接调用官网自己的职位接口（腾讯社招、字节社招 / 校招、京东校招、美团校招、网易、华为社招 / 校招、小米社招 / 校招 / 实习、科大讯飞社招 / 校招），字段级映射。一次全量同步实测 **27902 条**真实岗位，其中 **26503 条**带完整 JD（职责 + 要求）、**10457 条**是校招 / 实习，耗时约 16 秒。
- `html`：服务端渲染页面内嵌 JSON（百度社招），按源声明的 marker 抽取。
- `unadapted`：只登记官方入口，尚未适配接口。这类源**不抓取、不产出记录**，在 `search()` 的 `sources` 里以 `syncStatus: 'unadapted'` 如实上报，绝不伪造岗位。

同一家公司可以有多个源。字节的社招与校招共用同一个接口，门户由请求头（`Portal-Channel`）决定；华为由 body 里的 `jobType` 决定（`CR` 校招 / `SR` 社招）；小米由请求头（`website-path`）决定（`index` 社招 / `campus` 校招 / `internship` 实习）；科大讯飞由 body 里的 `Category` 数组决定（`1` 社招 / `2,4,5,6,7` 校招）。四家都拆成了多条源。

**覆盖是按「每页条数」买的，不是按「页数」。** 每个适配器声明自己的 `pageSize`，走查结束的条件是「某一页比它短」。声明值必须和请求里实际发出去的一致——两者不一致会让第 1 页就被判成"短页"，整个源静默变成 0 条，而状态显示同步成功。回归测试里有一条通用断言把这件事钉死。各家的每页上限差异很大：ATSX（字节 / 小米）的 `limit` 能到 1000 以上，腾讯的 `pageSize` 能到 500，网易的**正好 200，再多就返回 0 条**。

目前确认了**两套多租户招聘 SaaS**，各自共用一个工厂函数、租户只提供自己的域名与门户选择器——不是抄两份：

- **ATSX / 飞书招聘**（`atsxAdapter`）：字节、小米。同一套 `POST /api/v1/search/job/posts`。
- **北森 / zhiye.com**（`beisenAdapter`）：科大讯飞。同一套 `POST /api/Jobad/GetJobAdPageList`。

但要小心：共享的是**协议**，不是**取值**。同一个平台里，门户选择器的名字和取值都是每租户一套，而且错值往往静默失败——字节用 `Portal-Channel`，小米用 `website-path`（它的社招值叫 `index`，不叫 `social`，写 `social` 会返回 200 + `site not exist` + 0 条）。每接一个租户都要重新验证一遍门户矩阵。

单源产出（2026-10-12 实测）：字节社招 10000、字节校招 7468、网易 2698、腾讯社招 2242、小米社招 1987、小米校招 782、科大讯飞社招 721、小米实习 580、美团校招 562、华为社招 461、科大讯飞校招 165、京东校招 124、华为校招 102、百度社招 10。

**不公开的信息就留空，不编。** 华为对约一半校招岗位不公开 JD（列表和详情接口都只返回「请您详见岗位意向中的岗位职责」），这些行就以「无 JD」入库、`fullDescriptionVerified` 为 false，而不是把占位符当成岗位要求存下来。

**请求要照抄站点自己发的那一份，不要手挑字段。** 北森的 `DisplayFields` 是一个真正的字段选择器：少写一个 `LocId`，`LocNames` 就静默变成空数组——HTTP 200、结构合法、行数一条不少，只是地点全没了。这一条曾经让一次探针得出「该平台没有地点数据」的错误结论，而真相是 886/886 行都有地点。所以 `BEISEN_FIELDS` 逐字照抄站点自己的请求，回归测试里断言关键字段必须在列表内。

**每个源都要和接口自报的总数对账。** 「站外链接一律拒绝」这条规则是对的，但它需要一个例外清单：腾讯把 314 个岗位放在自己的 Workday 租户（`tencent.wd1.myworkdayjobs.com`）上，那不是聚合站而是腾讯自有的投递系统，被白名单误杀后表现为「源同步成功、行数偏少」。发现它的唯一线索就是把「我抓到多少」和「接口说它有多少」放在一起看。

这条对账已经写成脚本：`npm run test:coverage`（需要联网，因此**不在** `npm test` 里）。它对每个 `json-api` 源只发两次请求——第 1 页和第「声明的最后一页」——然后给出判定。**总数的字段名由脚本自己发现**，不写死：ATSX 用 `data.count`、北森用 `Count`、腾讯用 `Data.Count`、网易用 `data.total`、美团用 `data.page.totalCount`、京东用 `body.totalNumber`。写死一张表恰恰是这类问题会静默腐烂的原因。判定有四档：`truncated`（接口说它有的比我们能抓到的多，或声明的最后一页返回满页——说明板块还没走完）、`tight`、`slack`（声明的页数超出实际，无害）、`ok`。有任何源 `truncated` 或报错则退出码非零。

**「能覆盖今天的板块」不等于「安全」。** 判定里最有用的一档是 `tight`：**余量不足一页**。声明 6 页 × 100 而接口自报 563 条，余量只剩 37 条——下一轮招聘多挂 38 个岗位就会静默截断，和字节当年卡在 3% 是同一种形状。这个脚本第一次跑就抓出两个：美团（37 条余量）、京东（76 条余量），都已提高声明页数修掉。这条不变量也离线钉在测试里（用记录下来的总数断言 `reach - total >= pageSize`），所以不联网也能拦住这一类回归。

**死掉的数据源不接。** 小米官网链接的 `hr.xiaomi.com/job/list` 看起来完全正常（服务端渲染、有分页、有详情链接），但发布日期全是 2017 年——那是九年前的冻结库。接进来会灌进几百条早已失效的岗位。真正的岗位站在另一个域名上。所以适配任何 HTML 源之前，先看一眼它的发布日期分布。登记表的 `entryUrl` 也要逐个复核：科大讯飞的入口是个 301，如果沿用旧 host，准入校验会把该源的每一行都丢掉，表现为「同步成功、0 个岗位」。

列表接口只给职责时，适配器可以声明 `detail` 做详情补全；补全预算是**每轮的速率上限而不是覆盖上限**——已补全的 JD 从库里回填（零请求），预算只花在还没补全的行上，所以每轮都在推进、不会降级、失败的行下轮自动重试。

只有已适配的源参与同步；`search()` 返回的 `sources` 同时包含注册表元数据（`adapterKind` / `adapterStatus` / `reason` / `officialUrl`）和运行状态，因此"某公司没搜到岗位"和"这家公司还没接接口"能被区分开。岗位记录只有在标题、详情 URL 与官网域名都对得上时才入库，导航链接、招聘公告和站外文章链接一律拒绝。

国家大学生就业服务平台（ncss.cn）按 16 个计算机/AI 关键词 × 校招/实习读取匿名可见的前 5 页，补充中小企业岗位；平台规模字段用于大厂筛选（5000 人以上计为大厂），选中岗位时读取平台正文，但它是转载文本，不标记为官方完整 JD。超过匿名页数需登录，不做绕过。

聚合岗位文本不自动等于完整官方 JD；缺失信息必须保持待核实。P0 不做自动投递、复杂岗位监控 UI 或通知系统。

岗位资格契约见 [`docs/eligibility.md`](docs/eligibility.md)（迁移后路径）。

## Security

- 模型密钥只保存在服务端。
- 原始附件需要鉴权和 ownership 检查。
- Candidate 隔离由确定性代码保证，不能只依赖 Prompt。
- 用户上传材料、JD、第三方仓库文本都视为数据，不能覆盖系统规则。
- Tool 执行失败不能被 Agent 描述为成功。

## Validation

```powershell
npm test
npm run build

# 可选：真实模型 smoke test
npm run test:live
```

P0 新增/重构还需要覆盖：Candidate 隔离、RAG 检索、Fact provenance、Skill 使用、Session continuity、Claim → Evidence 和 Tool failure truthfulness。

## 本地 Skill 菜单

工作区输入 `/` 可列出四个第一方 Career Skills，支持方向键、Enter/Tab 和点击选择。选择后补充任务再发送。目录等待登录确认后加载，加载失败可重试。

BigModel 可通过 `RESUME_PROTOCOL_AGENT_RUNTIME=bigmodel`、`BIGMODEL_API_KEY` 和 `BIGMODEL_MODEL` 配置。默认模型为 `glm-5.3`，调用官方 Anthropic 兼容端点，继续使用 Claude Agent SDK。密钥只放在忽略的本地 `.env`，不要写入前端或提交到 Git。

PDF 简历分析会将原页面渲染为图片直接交给主 Agent，文本层是否可读不影响看图。BigModel 的图片请求使用 `BIGMODEL_VISION_MODEL`（默认 `glm-4.6v`）；纯文本请求仍使用 `BIGMODEL_MODEL`。一次最多查看八页，超出时明确标记范围。图片不写入候选人事实或应用会话消息；页面阅读失败时布局保持未核验，不能根据抽取文本顺序指责原文件排版。

对话不按总运行时长自动中断。SDK 的文本、思考、工具参数和工具完成事件更新进展；嵌套模型调用也会通知当前任务。连续三分钟没有可观察执行进展才停止等待，并保留已完成结果。浏览器只检查流连接是否持续收到数据，普通连接心跳不会更新服务端任务进展。仍可随时手动停止；工具次数和 SDK 轮次限制继续保留。

zzy 分支的方法资料已整合到 `.claude/skills/`，保留现有 SDK session、候选人隔离和生成结果核验。运行 `npm run app` 使用本地 `.env` 和 `data/`；端口以 `.env` 为准。

`npm run test:skill-menu-ui` 在临时数据库验证菜单与登录加载时序，不写入本地账号资料。

## Deployment

部署说明见 [`docs/cloud-deployment.md`](docs/cloud-deployment.md)。生产环境应使用 HTTPS、持久化数据目录，并完整备份 SQLite、uploads 和模型设置加密材料。

## 简历布局

已确认岗位版可通过 `/resume-layout` 或右侧版式选择导出项目型、工作型、简洁型单栏 PDF／DOCX，并查看实际 PDF 分页。方法、来源授权与验证说明见 [docs/resume-layout.md](docs/resume-layout.md)。
