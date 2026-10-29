# Loomi Design

Updated: 2026-09-17
Scope: UI / UX contract only

`DESIGN.md` 只描述用户看到和操作到的界面。产品范围看 `PRD.md`，系统边界看 `ARCHITECTURE.md`，开发原则看 `DEVELOPMENT_RULES.md`。不要在这里重复 Agent、RAG、权限或事实规则。

## 1. Product experience

Loomi 的体验应像一个长期工作的个人 Career Workspace，而不是传统 Dashboard，也不是“填写表单 → 点生成”的一次性简历工具。

主入口保持 AI Conversation；Files、Jobs、Resume Preview、Settings 是辅助工作区。

用户应该自然感受到：

```text
这个 Agent 认识当前 Candidate
→ 能找到之前的材料
→ 能围绕当前 JD 工作
→ 生成结果有出处
→ 可以继续追问和修改
```

不要把 Vector DB、Embedding、RAG、同步任务、Crawler、Agent routing 等内部概念直接暴露给普通用户。

## 2. Workspace layout

桌面端使用普通左侧目录与居中对话区；资料、网申、旁聊各为一张独立辅助卡片，默认在右侧停靠，为聊天保留独立空间：

```text
Left
Candidate / Project / Conversations

Center
Conversation transcript + composer

Right (docked cards; opt-in floating)
Documents / Apply / Side chat
```

左下角保留账户、主题和模型设置等低频入口。

≥1440px 最多堆叠两张卡片，首次比例 60/40，可拖动分隔条，每张至少 200px；高度不足时只显示一张。第三张打开时将最久未使用的卡片收为标签。1200–1439px 只显示一张，其余收为顶部标签；<1200px 使用右侧遮罩抽屉，支持 Esc、点击遮罩关闭与焦点返回。

卡片列默认 448px，可调整到 360–640px，始终为主聊天保留至少 480px；聊天正文最大 720px 并居中。卡片沿用 12px 圆角、12px 间隔与工作区中性阴影。每张卡片均有仅图标的弹出/停靠按钮；主动弹出的浮窗支持拖动、缩放和最小化，限制在窗口内且避开主聊天标题和输入区。布局按用户保存并验证恢复。

左侧始终为固定宽度普通列，不浮动；保留 Ctrl+B 折叠与窄屏抽屉。标题栏提供「资料 / 网申 / 旁聊」开关，旁聊使用带加号气泡图标。新产物和实际网申结果可自动打开对应卡片；主输入框有焦点或文字时只提示小圆点。旁聊沿用相同候选人背景，在创建时复制主会话上下文；消息与主会话独立，侧栏不列出旁聊，每段主会话恢复最新旁聊。

## 3. Candidate context

当前 Candidate 必须在工作区中可识别，但不要把“数据隔离”做成复杂运维界面。

创建或切换另一个 Candidate 时应明确提示当前工作对象发生变化；P0 不在同一个 Conversation 中静默切人。

Candidate 的后台 Facts / Chunks 不需要全部展示成数据库表。用户只在需要时查看材料、来源或事实依据。

## 4. Conversation

Conversation 是产品主工作流。

要求：

- 支持流式 Agent 输出和真实执行状态。
- 支持取消正在进行的请求。
- 不持久化假的 loading message。
- Tool / Skill 的内部实现细节默认不直接展示。
- 用户需要知道的是“正在读取材料 / 分析 JD / 检索经历 / 生成简历 / 核验事实”等业务进度。
- 失败要显示真实失败状态，不能用成功文案兜底。

同一 Conversation 中的 follow-up 应像连续对话，不要求用户重复粘贴上一轮内容。

## 5. Files and evidence

上传材料至少包括 PDF、DOCX、TXT、Markdown、JSON。

上传有两种等价入口：点击回形针选择文件，或把文件直接拖入对话区；两者走同一套校验和状态提示。拖拽悬停时对话区给出可放置的视觉反馈，一次只接受一份材料。

右侧材料区应支持：

- 查看原始/提取文本；
- 查看解析状态；
- 在可定位时显示 evidence quote / page；
- 原 PDF 保留，不用批注结果覆盖原件。

扫描 PDF 或部分页面读取失败时，UI 要区分“完整读取 / 部分读取 / 无法读取”。

## 6. JD and job results

岗位展示优先回答：

- 这是什么岗位；
- 哪些是硬要求；
- Candidate 有什么证据；
- 哪些要求缺失或待核实；
- 原始岗位来源在哪里。

不要把关键词总分包装成录用概率。

`passed / verify / rejected` 的业务含义见 `docs/eligibility.md`。

岗位候选采用一个 12px 圆角容器内的无重叠紧凑列表，默认显示五行，内部底栏可展开全部；每行只展示状态、公司、岗位名、地点、真实参考分和选择状态。点击后以 420ms 无回弹缩放从行展开玻璃详情窗口，关闭时缩回当前岗位行；固定窗口框架内，各岗位作为相邻的横向空间，以约 520ms 同轨移动和轻微缩放完成 macOS Spaces 式切换。支持左右键、箭头按钮、空间圆点、触控板横滑及内容区拖拽；边缘阻尼回弹，各空间独立滚动并在激活时回到顶部，框架高度稳定。保留上下键浏览列表、Esc 关闭、焦点锁定与返回、背景滚动锁定；窄屏使用底部抽屉，减少动态效果时取消位移与缩放但保留手势阈值切换，明暗主题保持一致。

## 7. Resume workspace

针对一个 Target Job，可以有一个或多个 Resume Variant。

用户应能：

- 查看岗位版简历；
- 继续在聊天中提出修改要求；
- 查看关键 Claim 的来源；
- 下载 PDF / DOCX；
- 明确区分原始简历和生成版本。

没有生成成功时不要展示可点击的“下载成功产物”。

## 8. Visual direction

继续保持当前克制、编辑型 Workspace 视觉：

- 清晰的信息层级；
- 亮/暗主题均可读；
- 中性背景；
- 避免过度 Dashboard 化；
- 不使用大量彩色状态卡和无意义装饰；
- 长文本、中文、代码/JD、文件名均要安全换行；
- respect reduced motion。

首页和已登录 Workspace 可以有不同视觉语言，但不要让营销页视觉规则侵入工作区信息密度。

### Colour

- Workspace surfaces: light background `#fafafa`, surface `#ffffff`; dark background `#0A0B0C`, surface `#0F1011`, raised surfaces white at 2–5% opacity.
- Ink: light `#18181b` with muted `#71717a`; dark `#E2E2E2`, white headings, muted white at 40% and faint white at 30%.
- Hairlines are 0.5–1px: black at 8% in light, white at 8% in dark. Glass cards use 85% surface opacity and a 10% hairline.
- Primary actions are monochrome inverse: ink background with white text in light, white with near-black text in dark.
- Borders, links, focus rings and active plates use neutral workspace tokens.
- Status colour is information only: a small 6px dot and/or text, with neutral pill backgrounds and borders.
- Do not use coloured status fills, card borders, warm olive/beige surfaces or decorative background glows.
- Errors retain the red `--accent-reject` tone for text and accent bars.

## 9. P0 UI acceptance

至少验证：

- 登录 / 登出；
- Candidate/Conversation 切换；
- 上传和解析状态；
- 连续 Conversation；
- 取消 Agent 请求；
- JD / job 结果；
- Resume preview；
- PDF / DOCX 下载；
- Candidate Evidence 来源查看；
- 亮/暗桌面布局；
- 窄屏无横向溢出；
- 错误状态不伪装成成功。

UI 测试可以使用确定性模型 fixture；真实模型能力由 Agent / integration tests 另行验证。
