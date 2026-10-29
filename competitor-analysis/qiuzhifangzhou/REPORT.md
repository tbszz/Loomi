# 求职方舟AI（qiuzhifangzhou.com）逆向分析报告

- 分析日期：2026-10-10
- 分析工具：REA（rea-agents v6.3.0，CDP 被动观察 + 静态 JS 分析），辅以 curl 抓取静态资源
- 证据目录：本目录下 `inspect-*.json`（REA Evidence）、`scripts/`（前端全部 70 个 JS 分包 + 入口）、`js-app-graph.json.gz`（REA 静态模块图，49MB gz）、`doc-autofill.html`（官方使用手册快照）
- 边界说明：仅做了公开页面被动观察、公开分发的前端/插件静态分析；未登录、未调用任何写接口、未解密或重放插件网关流量、未逆向服务端。REA 不恢复原始源码，以下结论均有 Evidence/工件支撑。

## 1. 产品定位

面向应届生的「AI 求职工具集合站」：**一个 Vue 3 SPA 官网 + 一个浏览器插件（真正的执行端）+ 后端 API**。作者自述「工科男自己手搓」，LLM 用的是 DeepSeek。五大 AI 功能（填网申/找工作/改简历/笔面试/写论文）+ 数据表格（校招汇总/投递进展）+ 会员变现。

## 2. 技术栈

| 层 | 技术 | 证据 |
|---|---|---|
| 前端框架 | Vue 3（Composition API，`__name`/`__scopeId` 编译产物） | 分包编译特征 |
| 构建 | Vite（`name-HASH` 资源命名、`__vite__mapDeps`） | main.js |
| 状态/路由 | Pinia + vue-router（`requiresAuth`/`requiresSpecialPermission` 路由元信息） | main.js |
| HTTP | axios；AI 流式响应用 SSE | 分包 |
| 表格 | AG Grid（含自定义主题 `ag-theme-custom`、表格菜单、内推码复制单元格） | 分包 |
| 动效/背景 | GSAP + pmndrs/postprocessing（WebGL 背景页 BackgroundView） | 分包 |
| 简历渲染/导出 | marked（Markdown→HTML）+ html2pdf.js（从 bootcdn 引入） | 分包 |
| 图标/字体 | Font Awesome + 自定义 iconfont（darkarkai） | CSS |
| 部署 | 三域分工：`www.` SPA、`cdn.` 静态资源、`api.` 后端 | main.js |
| 统计 | 百度统计 + Microsoft Clarity | storage keys |
| 文档站 | VitePress（`/doc/manual/*.html`，与主 SPA 独立） | doc-autofill.html |
| LLM | DeepSeek（官网文案 + 分包引用）；响应走 SSE | homeContent 分包 |

## 3. 路由表（vue-router，21 条）

公开：`/`（首页）、`/autofill`（AI填网申）、`/job`（岗位表格）、`/position`（AI找工作对话）、`/resume`（AI改简历，`?mode=ui` 切在线模板）、`/interview`（AI笔面试）、`/paper`（AI写论文）、`/campus`（网申表格）、`/pricing`、`/install-guide`、`/friend`（求职服务）、`/exam`
登录后：`/history`（投递记录）、`/profile`
特殊权限：`/background`（后台管理）、`/noah`（「诺亚方舟」数据看板，iframe `/noah/index.html`）
运营页：`/a/group`（拼团）、`/a/coupon`（优惠券）+ confirm/orders/result 子路由、`/welcome`、`/admin`

## 4. 后端 API 全景（81 个端点，前缀 `https://api.qiuzhifangzhou.com`）

- **job**（岗位库，~13 个）：`getTable`/`getPosition`/`getPositionCount`、收藏/已投递（add/del Favorite/Applied）、`getPreference`/`setPreference`、`analyzeResume`、`getDemoTable`
- **position**（AI 找工作对话）：`initSearch` → `search` → `chat`（SSE 流式）
- **resume**（~15 个）：`initResume`/`addResumeText`/`addResumeAttachment`、`getResumeMd`/`saveResumeMd`/`setVersion`/`setResumeTitle`、`overhaulResume`（魔改）、`atsAnalyzeResume`/`atsOptimizeResume`/`getAtsOptimizeDetail`、`getResumeUiList`/`deleteResumeUi`
- **history**：`getHistoryGrid`/`setHistoryGrid`/`addHistoryByCampus`（把汇总表条目加入自己的投递进展）
- **campus**：`getCampusList`、`recordLinkView`（链接点击埋点）
- **auth**：`sendCode`/`loginByCode`（验证码登录）、`captchaRotate`/`captchaVerify`（自研旋转验证码）、`refreshToken`/`logout`、`inviteCodeClick`（邀请裂变）
- **vip**：`getVipStatus`/`getUpgradeOptions`/`getSwapVipOptions`/`swapVip`、`createPayment`/`checkPaymentStatus`（轮询支付结果）、`useRedeemCode`
- **activity**：拼团（`group/createOrder`、`getOauthUrl`/`getOpenid` 微信 OAuth）、优惠券（`coupon/claim`/`getList`）、活动日期（`date/getCurrent`）
- **profile**：`getProfile`/`getAutofillUsage`/`getVipHistory`/`deleteAccount`
- **stat**：`linkJump`（外链跳转统计）
- **admin**（同域暴露在主包里，靠路由守卫挡）：`createActivityDate`、`getVerificationCodeList`、`refundOrder`、`setExcelList` 等

## 5. 核心功能架构（按逆向到的细节）

### 5.1 AI填网申（浏览器插件，产品核心）
- 分发：Chrome 商店（id `ohjbldefcgdafflncjpnlajjnbkebjap`）、Edge 商店（id `fhefgbbghlmmedjppiglmfkgeggaikno`）+ 官网手动 crx；插件约 2MB，要求 Chrome/Edge 88+。
- 工作流（官方手册）：官网传简历（PDF/Word/TXT）→ 服务端解析成 Markdown 简历 → 打开任意企业招聘官网表单页 → 插件自动识别、右下角浮窗弹出 → 选简历版本（默认选「最接近当前岗位」的）→ 可选「专岗简历美化」（填公司名+职位名，AI 按 JD 改写）→ 点播放，AI 扫描页面识别字段自动填充 → **人工补漏、人工复核、人工点提交**。
- 官方指标：「简历信息充足时，平均能识别 70% 的公司官网，填写 80% 的字段」；未填字段可从简历文本框直接复制。
- 「智能学习」：用户手填的字段会被记住，下次自动填。
- 简历中间格式是 Markdown（「任何模板格式 AI 都能读懂」）；官网下载的 PDF 刻意做得「格式简约」，理由是**适配企业招聘 SaaS 的解析器、防止误筛**。

### 5.2 AI找工作（/position 对话 + /job 岗位库）
- 自有岗位库：官网公示「全年收录 1,160,237，今日可投 656,793，最后更新 1 分钟内」（数字含营销水分，但量级在）。
- 表格筛选：届别（27届）、学历（可投/只看本科）、**专业三档**（可投/推荐/明确要求）、城市、公司类型（央国企/大厂/高信用/高科技）。
- AI 对话（公测版）：人设「小风学长」；公司评级 =「靠谱度」（企业背景/资质/经营/履约/诉讼）+「科创力」（专利/论文/软著的数量与质量），数据源为上市财报、法律诉讼、知识产权库。`initSearch → search → chat` 三段 API，SSE 流式。
- 差异化：上传简历后「持续监控全网职位」+ 按个人情况推荐。

### 5.3 AI改简历（/resume「简历魔改」）
- 三档力度重写：STAR 法则改写 / 适度拔高 / 按 HR 口味魔改（做通用简历）。
- 「过机筛 AI」（ATS）：贴入目标岗位 JD → AI「对着 JD 反向优化关键词、深度改简历」，做专岗简历（与用户 Resume Protocol 的 jd-analysis + resume-tailoring 同位）。
- 在线简历模板：6+ 套所见即所得模板（简约单栏/几何排版/时间轴/标题色条/顶部色块/居中留白），`?mode=ui`；Markdown 为源，导出 PDF 用 html2pdf.js，文件名自动从 `# xxx的简历` 提取。
- 简历多版本管理（setVersion/版本列表），插件端会按岗位挑版本。

### 5.4 网申表格（/campus，AG Grid 在线 Excel）
- 「来源只认公司官网」为卖点；5,000 行 × 25 页；tab：24h最新网申 / 27届热门秋招 / 国企央企汇总 / 大厂实习汇总 / 笔试真题汇总 / 专属备考资料 / 投递进展表。
- 列含「内推码」（点击复制）、截止日期（自带 tooltip：「截止日期一般不靠谱，HR 经常直接设置到招聘结束，所以还是尽快投递」）；筛选：城市（14 个）/来源（公众号/官网/政府）。
- 汇总表条目可一键加入个人「投递进展」（history API），形成 获取线索 → 记录进展 的闭环。

### 5.5 AI笔面试 / AI写论文
- 路由与导航存在（/interview、/paper），分包内有 interview 示例 URL 与论文相关文案（「从选题到答辩一站式」）；本次未深挖（需登录）。

### 5.6 变现体系
- 四种会员 scope：`super`（全站大会员）/`autofill`/`job`/`resume`，可单买可升级可互换（swap）。
- 免费额度：AI填网申每月 5 次试用、AI找工作每月 20 次查看（`getAutofillUsage` 计量）。
- 周期：月卡/季卡（标「购买最多」）/年卡（标「折」）；支付后轮询 `checkPaymentStatus`。
- 微信拼团：OAuth 拿 openid → createOrder → confirm/result 流程；优惠券领取 + 兑换码 + 邀请码点击统计，完整增长闭环。

### 5.7 账号与安全
- 验证码登录（sendCode/loginByCode）+ 自研旋转验证码（captchaRotate/captchaVerify）+ refreshToken；账户注销（deleteAccount）。
- 前端路由守卫 `requiresAuth`/`requiresSpecialPermission`；admin API 与普通 API 同域同包（安全性依赖服务端鉴权，前端仅作入口隐藏）。

## 6. 对 Resume Protocol 的对照与启示

1. **半自动填表是市场共识**：竞品的插件也是「AI 填 80% → 人工补漏 → 人工提交」，与我们 JEV P1「半自动、禁止自动提交」的约束一致，说明这条产品红线不影响竞争力，可以放心作为宣传点（可控、安全）。
2. **可对比的真实指标**：竞品公开「识别 70% 官网 / 填写 80% 字段」。我们的 JEV 验收也可以定义同口径指标（表单字段覆盖率 × 网站兼容率），比「通过 0 个」的核验器口径更面向用户。
3. **它的护城河不是 AI，是数据和闭环**：116 万岗位库、5000 条官网公告、内推码、公司财报/诉讼/知识产权评分——这些是运营资产。我们的对应资产是 Candidate Facts（结构化、带 provenance 的候选人事实），方向不同但同样正确：AI 功能可以被抄，事实库 + 证据链抄不走。
4. **JD 反向优化简历 = 我们已做的 jd-analysis + resume-tailoring**：竞品的「3 档力度」「专岗版本管理」「对着 JD 调关键词」值得抄进我们的 resume-tailoring Skill 的输出分级设计。
5. **简历中间格式之争**：竞品用 Markdown（LLM 友好、可流式渲染、可导 PDF）；我们用结构化 Candidate Facts + 证据。竞品还要「AI 读懂任意模板格式」，恰好说明自由文本格式的不可控——我们的结构化路线在网申自动化上上限更高。
6. **免费额度 + 计量 API**（`getAutofillUsage`）+ 功能级订阅：若未来商业化可直接参考其 scope（按功能拆分会员）与计量粒度。
7. **形态差异**：竞品是「官网 SPA + 浏览器插件」双端；我们 P0 是本地优先的单 agent。插件是他们执行表单填写的天然载体；我们的 JEV 未来若做浏览器侧，也需要类似的「页面表单识别 + 浮窗 + 版本选择」交互（手册里的交互细节可直接作为我们 P1 的 UX 参考）。

## 8. 浏览器插件逆向（核心能力，2026-10-10 第二轮）

> 证据：`extension/unpacked/`（Edge 商店 crx v2026.10.6 解包，与官网 `crx/version.txt` 实时一致）、`extension/deobfuscated/`（字符串表回填后的全部源码）、`extension/string-table.json`（1060 条还原字符串）、`extension/deobfuscate.mjs` / `substitute.mjs`（复现脚本）。混淆方式是自定义字符串池（`globalThis.__z(N)`），vm 倾倒字符串表即可完全还原，无控制流混淆。

### 8.1 架构总览

```
┌─ content script（全站注入，Shadow DOM #ark-ai）
│   arkContent.js      136KB  表单采集/骨架化/字段映射/填充执行/平台适配器
│   resumeInterface.js  28KB  悬浮简历窗（SimpleMDE 编辑器/版本选择/状态机/好评引导）
│   apiCodec.js          3KB  DAK1 加密信封协议
│   zhPack.js           35KB  字符串池（混淆载体）+ 中文数据字典（民族/省份/字段正则）
├─ service worker（background.js，10KB）
│   JWT 刷新队列 / 加密网关转发 / 智能学习回传 / 投递记录回传 / 错误遥测 / 好评截图上传
└─ 权限极小：tabs + storage + webNavigation，host 仅 api.qiuzhifangzhou.com
```

### 8.2 通信协议（完整还原）

- 插件 API 前缀 `https://api.qiuzhifangzhou.com/api/chrome/`；网站↔插件通过 `externally_connectable` 传 JWT（login/logout/ping 三种消息）。
- **加密网关**：除 auth 外所有请求被 `apiCodec.packRequest` 重写为对 `api/chrome/x` 的单个 POST。协议：payload = magic `DAK1` + act + extId + 4 字节长度 + JSON body，随机填充至 ≥2048 字节（防流量画像）；AES-GCM 加密，密钥 = SHA-256(`www.qiuzhifangzhou.com|{chrome.runtime.id}|dak-gw-v1`)；外层 `{a:密文b64, b:随机垃圾b64, c:随机数, d:时间戳}`。响应校验 extId 与 act=`_response` 后解包。
- act 清单：`initResume`、`getQuota`、`getResumeMd`、`saveResumeMd`、`getNeedField`/`getBlockNeedField`/`getRefillNeedField`、`fillResumeValue`/`fillBlockResumeValue`/`fillRefillResumeValue`、`beautifyResumeMd`、`learningField`、`addHistoryByChrome`、`logError`、`isStarRatingUploaded`/`uploadStarRating`。
- JWT 401 → refreshToken 刷新 + 订阅队列重放；502 → 5 秒后重试一次。服务端可返回「插件版本太低」强制升级；本地另有 `crx/version.txt` 每小时检查 + 语义化版本比较。

### 8.3 表单识别管线（arkContent.js 核心）

1. **页面采集 `k.i()`——「语义骨架」**：克隆 DOM（快照每元素的 display/visibility/opacity）→ 删插件自身节点 → 删不可见元素 → 删 noscript/script/style/img/canvas/svg → 压缩空白 → **`<input>/<textarea>` 替换为含当前值的 `<span>`、`<select>` 替换为选中项文本的 `<span>`**（AI 能看到用户已填内容）→ **剥除全部属性** → 递归展开同源 iframe。产出纯「结构+文本」骨架，无 id/class，省 token、跨改版稳定。
2. **可填控件枚举 `k.k()/k.Wl()`**：原生 input(text/search)/select/textarea + 自定义下拉（`.ant-select` 等类名特征、「请选择」伪下拉、父级上溯找可点击容器）；过滤搜索框（`^\s*(搜索|查找)`）、视口 top≤150px 的头部区域；radio 单列。
3. **三段式服务端协同**（AI 全在服务端，插件本地无 prompt）：
   - `get*NeedField {scene, sessionId, url, browser, version, html(骨架), skipCache}` → 返回 `{fields:[{name, blanks?}], sessionId}`：AI 从骨架中判断本页/本栏有哪些待填字段；
   - 插件把返回的字段名与本地枚举的 DOM 控件做映射高亮（CSS 变量 `--highlight-enabled`）；
   - `fill*ResumeValue {scene, sessionId, url, browser, version, fields, company, position, resumeId, webType}` → 返回 `{values:[{name, blanks:[{name,value}]}]}`。
   - `webType` 是适配分派键：`onestep:1`（单页表单）/ `multistep:1`（通用向导）/ `{platform}:{version}`（命中已知平台适配器）。
4. **本地值修正 `k.P()`**：手机号去 `+86`；身高体重去单位（cm/kg/厘米/公斤）；`YYYY-MM` 日期补 `-01`。
5. **分块向导模式（block）**：服务端按骨架把页面切成栏目（工作经历/教育经历等），逐栏「采集→判字段→标记→生成值→逐个填充→提示人工补漏→等用户保存→下一栏」；重复段落（多段经历）由 `k.Do` 在两个栏目标题之间定位范围、滚动展开后二次采集映射。
6. **平台适配器**（每个实现 分块/取字段/翻栏 三个原语）：国聘 guopin v1（iguopin.com）、智联 zhilian v1（xiaoyuan.zhaopin.com/scrd/）、zhilian v2（i.zhaopin.com/resume）、51job v1（xyz.51job.com/External/MyResume/）、51job v2；另有站点特判（如 c.iguopin.com 跳过「资格证书」、51job v1 填写时 scrollIntoView）。
7. **浮窗出现启发式**：自身站点常驻；简历页白名单（51job 两处 + 智联一处）常驻；约 70 个域名黑名单（各家 AI 助手、搜索引擎、社交视频、云文档、邮箱、竞品 offerin/givemeoc/nowcoder 等）永不出现；兜底：每 2 秒轮询正文（含 iframe），命中 `(简历|姓名)` 即显示。
8. **zhPack 数据字典**：民族（56 个）、省份、行业等标准值清单 + 字段语义正则（`(时间|日期)`、`(手机号|电话号码)`、`^(提示|警告|提醒|注意|温馨提示|系统提示|信息)$` 用于剔除弹窗文本等），用于 select 选项归一化与降噪。

### 8.4 悬浮简历窗（resumeInterface.js）

- Shadow DOM 隔离；公司名+职位名输入、专岗美化开关（默认开）、简历版本下拉（**类型徽章：原始/魔改v1-3/机筛/专岗**，与服务端版本体系一致）、SimpleMDE Markdown 编辑器（1s 自动保存 + 失焦即 `saveResumeMd` 回传）、启动/暂停状态机（ready/running/pause/success/error/quota/learning）、打字机状态文案。
- 启动流程：`initResume`（服务端返回简历列表 + **自动挑选最贴近当前站点的版本** + 记住上次的公司/职位；汇总表跳转来源会自动带入公司名）→ `getQuota` 校验月度免费额度（用完 → 弹窗引去 /pricing）→ 保存编辑后的简历 → `runFillResume`。
- 专岗美化流程：勾选时要求填公司+职位 → 「上网搜索该公司的岗位要求...」（服务端抓取）→ `beautifyResumeMd {url, company, position, resumeId}` → 返回新简历（服务端新建 special 版本）→ 编辑器逐字打字机流式展示。

### 8.5 数据回传（合规敏感点）

- **智能学习 = 表单页 HTML 上传**：默认开启（`learningResume` 未显式关闭即开）。填充结束后每 5 秒对比页面骨架哈希，变化即 `learnField {url, version, html}` 暂存，导航离开或手动停止时 POST `api/chrome/learningField`（10 秒限流）。官方话术「正在智能学习你新填写的内容~」——实际回传的是**页面骨架 + URL**，属于把第三方网站页面内容传到自己服务器，是他家站点适配数据的来源之一。
- **投递记录回传**：从汇总表链接跳转（点击时捕获 `data-campusId`/`data-company`）→ 在企业官网完成投递 → 导航结束时 POST `api/history/addHistoryByChrome` → 把 historyId 回推给官网页面同步「投递进展」。
- **错误遥测**：`logError {functionName, duration, errorStack, company, resumeId, browser, version, url}`——含填写耗时与公司维度，支撑官方「识别70%/填80%」指标。
- **好评增长闭环**：填充次数（websiteCount/fieldCount，本地存储）达阈值弹窗「已帮你填 X 个网站 Y 个字段」→ 引导商店评分 → 粘贴/上传评分截图（base64 PNG → `uploadStarRating`）→ 服务端记录 `starRatingUploaded`，取消次数也被记忆（减少打扰）。

### 8.6 值得借鉴到 Resume Protocol JEV 的设计

1. **「语义骨架」表示法**：无属性、含当前值的结构化 HTML 是 LLM 理解第三方表单的极优中间表示（token 效率高、对改版鲁棒、天然脱敏属性层）。JEV 做表单理解时可直接采用，比原始 HTML/截图更适合文本 LLM。
2. **字段判定与取值分成两个服务端调用**：先「这一页有什么字段」（页面级，可缓存，sessionId 复用），再「每个字段填什么」（值级，按 resumeId）。中间靠插件本地做字段名↔DOM 映射，LLM 不接触真实 DOM id，边界干净。
3. **webType 三分派**：单页/通用向导/已知平台适配器，适配器版本号进请求体，服务端可按站点灰度迭代策略——对我们 P1 的「网站兼容率」运营是个直接可抄的工程结构。
4. **本地确定性值修正层**：AI 输出后仍有一层正则修正（+86、单位、日期格式）——「AI 生成 + 确定性代码校验修正」双层结构与我们「ownership/授权由确定性代码执行」的项目原则一致。
5. **半自动红线的产品化**：每栏填完即暂停提示人工补漏/保存，全部字段有值才继续——自动化止步于提交按钮之前，且把「补漏」做成显式交互步骤，值得我们 JEV 的 UX 直接参考。
6. **悬浮窗 = 简历上下文载体**：编辑器改动即回传版本库、版本徽章（原始/魔改/机筛/专岗）随选随切——「简历版本」贯穿官网与插件两端，是我们 Candidate Knowledge Base + Skills 体系做简历多版本时的对端参照。


## 9. 证据清单

### 网站（第一轮）
- `inspect-home/position/job/campus.json` — REA CDP 被动观察 Evidence（含 a11y 树、storage、console）
- `scripts/` — www 站全部前端 JS（Vite 入口 + 70 个分包，2.3MB），API/路由/文案证据来源
- `js-app-graph.json.gz` — REA `analyze-javascript-application` 静态应用图（graph_id `jsrg_cf60f0…21182`）
- `home.html`、`doc-autofill.html` — SPA 壳与官方手册快照
- `analyze-static.mjs`、`analyze-deep.mjs`、`navigate.mjs` — 复现脚本（CDP 导航 + 特征提取）

### 浏览器插件（第二轮，本目录 `extension/` 下）
- `edge.crx` / `edge.zip` / `unpacked/` — Edge 商店 v2026.10.6 原始包与解包（与官网 `crx/version.txt` 实时一致）
- `string-table.json` — vm 倾倒的完整混淆字符串表（1060 条）
- `deobfuscated/` — 字符串表回填后的全部插件源码 + js-beautify 美化版（arkContent 5284 行）
- `deobfuscate.mjs`、`substitute.mjs` — 解混淆复现脚本
