# 岗位数据源审计与重构记录

日期：2026-10-12
范围：`server/officialJobSources.js`、`server/jobKnowledge.js` 的官方岗位源链路，以及 `server/knowledgeBase.js` 中重复的官方源注册表
审计方式：代码走查 + 对 12 家官网的实时实测（记录原始 HTTP 状态、字节数、解析结果、样例记录），不是读文档推断

---

## 1. 结论

**当前这套「官方岗位数据源」的工作逻辑不合理，已经彻底重构。**

不合理不是"细节没打磨好"，而是**基本假设错了**：它把 12 家不同厂商做的单页应用（SPA）当成一个通用 HTML 抓取问题。这些官网的 HTML 外壳里根本没有岗位，岗位由各自的前端调自己的 JSON 接口渲染出来。所以这套代码在结构上不可能拿到数据，同时又会把导航链接、公众号文章当岗位塞进库里。

实测数据（2026-10-12，对 12 个已登记源逐个请求并解析）：

| 指标 | 实测结果 |
|---|---|
| 12 个源合计产出 | 15 条 |
| 其中真实岗位 | 10 条（**全部来自百度**） |
| 假岗位 | 5 条 |
| 零产出的源 | 10 / 12 |
| 同步器上报的健康状态 | 12/12 全部"成功" |

---

## 2. 五个具体问题（附证据）

### 2.1 通用 HTML 抓取对 SPA 官网结构上无效

实测每个源拿到的 HTML 字节数与解析产出：

| 公司 | 最终 URL | HTTP | 字节 | `<a>` 数 | 解析出岗位 |
|---|---|---|---|---|---|
| 百度 | talent.baidu.com/jobs/social-list | 200 | 92 KB | 4 | **10** |
| 字节跳动 | jobs.bytedance.com/experienced/positions | 200 | 981 KB | 63 | 0 |
| 京东 | campus.jd.com | 200 | 31 KB | 0 | 0 |
| 美团（实为美图，见 2.2） | hr.meitu.com | 200 | 116 KB | 43 | 3（假） |
| 华为 | career.huawei.com/... | 200 | 44 KB | 61 | 2（假） |
| 阿里 | talent.alibaba.com/campus/position-list | 200 | 8.5 KB | 0 | 0 |
| 网易 | campus.163.com | 200 | 3.0 KB | 0 | 0 |
| 拼多多 | careers.pddglobalhr.com/jobs | 200 | 10 KB | 12 | 0 |
| 腾讯 | join.qq.com/post.html | 200 | 1.9 KB | 0 | 0 |
| 滴滴 | talent.didiglobal.com/home/ | 200 | 1.7 KB | 0 | 0 |
| 快手 | zhaopin.kuaishou.cn | 200 | 2.4 KB | 0 | 0 |
| 小米 | hr.xiaomi.com | 200 | 607 B | 0 | 0 |

腾讯 1.9 KB、小米 607 B 的响应就是 SPA 的空壳。字节 981 KB 里有 63 个链接但 0 条岗位——页面上唯一的 `application/ld+json` 块其实是一段 IE 兼容 polyfill，被误标成了 JSON-LD。

**这些站点不是没有数据，是不在 HTML 里。** 实测确认它们各自的 JSON 接口都可用：

- 腾讯：`GET careers.tencent.com/tencentcareer/api/post/Query` → `Data.Count = 2258`，含 `RecruitPostName / LocationName / Responsibility / PostURL`
- 字节：`POST jobs.bytedance.com/api/v1/search/job/posts` → `data.count = 10000`，含 `description + requirement + city_list + publish_time`

### 2.2 假岗位：3 条来自域名写错，2 条来自站外链接

- `美团` 的 `entryUrl` 写成 `https://campus.meitu.com/`，跳转到 `https://hr.meitu.com/` —— 这是**美图**，不是美团（美团官网是 `zhaopin.meituan.com`）。抓下来的「美图设计室 / 美图影像研究院 / 分析师列表」三条导航链接被当成岗位入库。
- `华为` 抓到的两条是 `mp.weixin.qq.com` 的招聘公告文章，被当成岗位入库。
- 根因是标题白名单太松：`JOB_TITLE_RE` 里包含 `招聘 / 职位 / 岗位 / 设计 / 分析 / 研究` 这些**导航词和通用词**，任何含这些字的链接都能通过；同时解析器完全不校验链接域名是否属于该官网。

反向的问题同样存在：公告过滤用的是裸词表（`活动 / 资讯 / 分享 / 故事 / 指南 / 直播 / 答疑`），这些词大量出现在**正常岗位名**里。改成"必须是公告句式"后才暴露出来——腾讯/字节的库里因此多回了 16 条真实岗位，例如：

> 微信视频号-高级推荐大模型算法工程师-直播方向（深圳/北京）
> 《三角洲行动》-国服活动运营（世界观衍生）
> 餐饮营销与活动运营（美国市场）-TikTok生活服务

### 2.3 「零岗位 = 同步成功」让监控失效

`sync()` 对官方源的特例是：产出为空不算失败，上报 `reachable`。结果是**12/12 全部绿色**，而库里只有 10 条岗位。用户看到的"已登记 12 家官网"，和"实际能搜到几家公司的岗位"完全是两件事，但系统没有把差别说出来。

这违反 `DEVELOPMENT_RULES.md` §3「Tool 失败不能伪称成功」的精神。

### 2.4 百度专属的解析器硬编码在通用模块里

`embeddedRows()` 直接写死 `'"listDetailData":'` 这个百度专有 marker。也就是说"通用解析器"里藏着某一家公司的私有格式，扩展第二家就得改这个通用函数——这是适配器层缺失的典型症状。

另外几个失效分支：`inferType()` 里 `source.types?.length === 1` 永远不成立（所有源都声明了 3 种类型），`source.defaultType` 从未被赋值，所以类型推断在关键词不命中时**恒为 null**。百度社招页 10 条岗位的 `job_type` 实测全是 `null`。

### 2.5 四套并存的岗位源，三套是死代码

| 模块 | 职责 | 是否在线上链路 |
|---|---|---|
| `jobKnowledge.js` + `officialJobSources.js` | 后台定时同步 + `search_jobs` 工具 | ✅ 线上（`app.js` → `careerAgent`） |
| `knowledgeBase.js#JOB_SOURCE_REGISTRY` + `refreshOfficialSources` | 另一份 34 家官网清单 + "岗位雷达" | ❌ 无任何引用 |
| `githubJobSources.js` | GitHub 聚合源 | ❌ 无任何引用 |
| `campusAggregator.js` | 校招聚合 | ❌ 无任何引用 |

最危险的是 `buildOfficialIntelligenceCards()`：它把「岗位角色库」（AI 工程师/后端/前端…）和官网清单**组合**成岗位卡片，打上 `source: "official-career-site"`、`applyStatus: "official-open"`。这些卡片**不是抓来的，是拼出来的**，一旦被接进链路就是成批的假岗位。违反 §12「修改架构前先做一次重复建设检查」。

---

## 3. 重构方案

核心原则一句话：**一家官网只有在代码知道它数据长什么样的时候，才允许产出岗位记录。**

### 3.1 按公司声明适配器（`server/officialJobSources.js`）

```js
adapter: {
  kind: 'json-api' | 'html' | 'unadapted',
  status: 'verified' | 'unadapted',
  request(page) -> { url, method, headers, body },  // json-api
  pick(payload) -> items,                            // json-api
  map(item, ctx) -> row,                             // 两者都要
  pageUrl, markers: ['"listDetailData":'],           // html
  defaultType: 'social'                              // 关键词不命中时的兜底类型
}
```

- `json-api`：直接打官网自己的接口。腾讯社招 3 页 × 100 条、字节社招 3 页 × 100 条。
- `html`：服务端渲染页面 + 源自己声明的 marker（百度社招）。marker 不再写死在解析器里。
- `unadapted`：**只登记官方入口，不抓取、不产出记录**。这是本次新增的诚实状态，覆盖另外 18 家公司。

### 3.2 记录准入校验（拒绝假岗位）

一条记录必须同时满足：标题长度 2–180；详情 URL 的 host 属于该源（或 `allowedHosts`）；标题不在导航词表；标题不匹配公告/资讯模式（`正式启动 / 招聘动态 / 应届生全球招聘 / 宣讲会 …`）。

同时**删掉了整条通用 `<a>` 抓取路径**——它正是假岗位的来源。JSON-LD 也只认 `@type: JobPosting`（旧版会接受任何"有 title + url + 长 description"的结构化数据）。

### 3.3 类型推断可信化

`inferJobType()` 先看列表文本，不命中再回落到适配器声明的 `defaultType`（"社招专用接口返回的就是社招岗位"），最后才是 null。`normalizeFeedJob()` 也改为优先信任适配器已经规范化的 `job_type`，不再靠 URL 里是否含 `social` 来猜。

### 3.4 来源状态语义（`server/jobKnowledge.js`）

- `syncStatus`：`synced` / `reachable` / **`unadapted`** / `failed` / `idle`
- 未适配的源**不参与同步**（不发请求、不占租约、不写运行日志）
- `sources` 改为「注册表元数据 + 运行状态」合并，所以**从未同步过的源也会出现**，不再从列表里消失
- 新增 `summary: { registered, synced, reachable, unadapted, failed }`
- `search_jobs` 在回复里主动说明覆盖情况，例如：「官方源覆盖：3 家公司的职位接口已接入，另有 18 家只登记了官方入口，需要手动打开官网查看。」
- 同步由串行改为 4 路并发（SQLite 事务内全是同步代码，不存在写交错），21 源同步 4.3 秒

### 3.5 消除重复建设

删除 `knowledgeBase.js` 中的 `JOB_SOURCE_REGISTRY`（34 家重复清单）、`careerSource`、`inspectSource`、`refreshOfficialSources`、`buildOfficialIntelligenceCards`、`buildRadarSummary`、`buildResumeAdvice` 等拼接式卡片生成代码（537 → 350 行）。保留 `JOB_ROLE_LIBRARY` / `buildJobLibrary`，因为它明确标注 `source: "role-library"`，是诚实的角色库而不是岗位。

---

## 4. 重构后结果

| 指标 | 重构前 | 重构后 |
|---|---|---|
| 登记公司 | 12 | 26 源 / 21 家（**14 源已适配** + 12 家仅入口） |
| 实际入库岗位 | 15（10 真 + 5 假） | **27902**（0 假） |
| 含完整 JD（职责 + 要求） | 10 | **26503**（首轮；详见 §4.6.5） |
| 校招 / 实习岗位 | 0 | **10457**（校招 3693 + 实习 6764） |
| 零产出源 | 10 / 12 | 0（未适配的源不参与，也不假装成功） |
| 同步耗时 | 串行 | 16 秒（源间 4 路并发 + 源内分页 4 路并发） |
| 来源状态可区分 | 否（全绿） | 是（synced / reachable / unadapted / failed） |
| 注册表份数 | 2 | 1 |

> 首轮不含完整 JD 的 1399 行，几乎全是腾讯社招——它的要求文本只在详情页，而详情补全有每轮预算（§4.6.5）。第二、三轮同步会把它们补齐。

单源产出（2026-10-12 实测）：

| 源 | 岗位数 | 完整 JD | 校招 | 实习 | 社招 |
|---|---|---|---|---|---|
| `bytedance-careers` 字节社招 | 10000 | 10000 | 0 | 0 | 10000 |
| `bytedance-campus` 字节校招 | 7468 | 7468 | 2354 | 5114 | 0 |
| `netease-careers` 网易 | 2698 | 2698 | 12 | 574 | 2112 |
| `xiaomi-careers` 小米社招 | 1987 | 1986 | 0 | 0 | 1987 |
| `tencent-careers` 腾讯社招 | 2242 | 900 | 1 | 87 | 2154 |
| `xiaomi-campus` 小米校招 | 782 | 782 | 782 | 0 | 0 |
| `iflytek-careers` 科大讯飞社招 | 721 | 721 | 0 | 0 | 721 |
| `xiaomi-internship` 小米实习 | 580 | 580 | 0 | 580 | 0 |
| `meituan-careers` 美团校招 | 563 | 563 | 196 | 367 | 0 |
| `huawei-careers` 华为社招 | 461 | 461 | 0 | 0 | 461 |
| `iflytek-campus` 科大讯飞校招 | 165 | 165 | 153 | 12 | 0 |
| `jd-careers` 京东校招 | 124 | 124 | 124 | 0 | 0 |
| `huawei-campus` 华为校招 | 102 | 46 | 71 | 31 | 0 |
| `baidu-social` 百度社招 | 10 | 10 | 0 | 0 | 10 |

回归测试重写为 `server/officialJobSources.test.js`，全部离线可跑（fixture 取自 2026-10-12 的真实字段结构），覆盖：注册表完整性、十二家适配器的字段映射、字节校招门户选择、华为双门户与并集陷阱、小米门户钉死与共享工厂、京东 hash 路由、分页不被截断且不重复、短页提前结束、类型以载荷为准、详情补全的增量与不降级、`unadapted` 源零产出且不发请求、以及**假岗位拒绝用例**（导航链接 / 公告标题 / 站外 JobPosting / 非 JobPosting 结构化数据 / 纯 `<a>` 链接）。

---

## 4.1 第二轮：校招覆盖 + 详情补全（同日）

第一轮之后剩下最大的缺口是**校招/实习覆盖为零**，以及腾讯只有 40/299 条有完整 JD。本轮把这两件事做掉了，过程中又发现两个真 bug。

### 4.1.1 字节校招：门户由**请求头**决定，不是 `portal_type`

第一轮在 backlog 里猜的是"字节校招是 `portal_type: 2`"，**这是错的**。用 CDP 抓 `jobs.bytedance.com/campus/position` 的真实请求后实测：

| 请求 | 结果 |
|---|---|
| 无门户请求头 | 社招，`count=10000` |
| `Cookie: channel=campus` | 社招，`count=10000`（**cookie 假设也被证伪**） |
| `Portal-Channel: campus` + `website-path: campus` + `Portal-Platform: pc` | **校招，`count=7466`** |
| 同上但 `portal_type: 6`（社招值） | 仍是校招 —— 请求头**覆盖** body 里的 `portal_type` |
| `Portal-Channel: social` | 空列表（所以社招源必须**不带**这个头） |

所以一个端点、两个源，区别只在请求头。校招集合里同时含「校招/正式」和「校招/实习」，并且带 `job_subject` 字段给出**毕业届次**（`2027届校园招聘` / `ByteIntern` / `日常实习` …），这个对在校生是最关键的信息，已写进 JD 首行「招聘批次：…」。

### 4.1.2 京东校招：hash 路由 + 列表即完整 JD

- 接口：`POST campus.jd.com/api/wx/position/page?type=present`，body `{pageSize, pageIndex, parameter:{...}}`，响应 `body.items`。
- 列表**已经带** `workContent` + `qualification`，不需要详情补全。
- 城市不在 `workCity`（实测恒为 `null`），而在 `requirementVoList[].workCity`，格式是 `上海市-上海市`，取最后一段。
- 详情地址是 hash 路由 `#/details?id=<publishId>`——从它的 umi bundle 路由表里读出来的，不是猜的。

### 4.1.3 顺带修掉的两个真 bug

**① `canonicalUrl` 会删掉 hash，导致京东每个详情链接都指向首页。**

原来的实现无条件 `url.hash = ""`。对京东这种 hash 路由站点，hash 就是路径，删掉之后 `#/details?id=9260` 变成 `https://campus.jd.com/`——用户点进去看到的是职位列表而不是那个岗位。改成：**只有不以 `/` 开头的 fragment 才当滚动锚点删掉**（`if (!/^#\//.test(url.hash)) url.hash = ""`）。`jobKnowledge.js` 里那份同样的实现一起改了。

**② 详情补全的"跳已抓过"设计会把已补全的 JD 降级。**

第一版实现是：把已抓过详情的 URL 记进库，下轮跳过。结果第二次同步时，列表接口（只有职责）重新构造了整行、覆盖了库里已经补全的 JD——实测 `fullDescriptionVerified` 从 1109 掉到 810，腾讯 299 → 0。

改成：**不再记录"抓过没"，而是记录"补全好的 JD 正文"**。每轮同步开始时按源查一次库里的完整 JD，交给加载器；加载器对已补全的行**从库里回填**（零请求），预算只花在还没补全的行上。这样：
- 预算每轮都在推进，不会卡在同一批；
- 不会降级；
- 自带自愈——某行详情请求失败就保持未补全，下一轮自动重试；
- 每行详情全生命周期只抓一次。

腾讯 `maxPerSync` 相应从 40 提到 300（覆盖整轮翻页），首轮就补全 299/299，后续同步只为新出现的岗位付费。

### 4.1.4 顺带修的一致性问题

`toIsoDate()` 对 epoch 毫秒输入返回完整时间戳（`2026-08-17T03:42:52.000Z`），对字符串输入返回日期（`2026-08-17`）——同一字段两种形状。已统一为日期。

### 4.1.5 本轮验证

| 检查 | 结果 |
|---|---|
| `node server/officialJobSources.test.js` | 通过 |
| `npm test` | 通过（除 6 节记录的既有失败项） |
| 全量同步（22 源，本轮当时口径） | 1233 条，0 假，全部含完整 JD，5.5 秒 |
| 连续两次同步 | 第二次 `fullDescriptionVerified` 不下降，详情请求 0 次 |

> 上表的 1233 条是**第二轮当时**的数字；第三轮接进美团与网易后总量为 4492 条（见 §4）。留在这里是为了让每轮的增量可对照。

---

## 4.2 第三轮：再适配美团与网易，并修掉两处静默失真

### 4.2.1 美团校招

`POST zhaopin.meituan.com/api/official/job/getJobList`，body 里 `jobType: [{code:"1"},{code:"2"}]` 就是校招页自己的默认筛选（1=校招、2=实习）。列表已带 `jobDuty` + `jobRequirement`，不需要详情补全。实测 **562 条（196 校招 + 366 实习）**，6 页。

详情地址 `/web/position/detail?jobUnionId=…` 是从 bundle 的 `path:"/position/detail"` 路由表读出来的；用 CDP 打开该地址确认它确实触发 `POST /api/official/job/getJobDetail`。

**弯路记录**：`/web/campus/position` 这个路由只发埋点请求、不加载任何页面分片。真正的路由是 `/web/campus`。这也是"先抓再判断"的价值——猜 URL 会得出"美团没有职位接口"的错误结论。

### 4.2.2 网易

真正的职位站不在 `campus.163.com`（那只是个落地页，正文只有"校园招聘 / 立即投递 / 了解更多公司信息"），而在 `hr.163.com`。

`POST hr.163.com/api/hr163/position/queryPage`，**分页参数是 `currentPage`**。这一条值得单独记：`pageIndex` / `pageNum` / `pageNo` / `page` 四个写法都被接口**静默忽略并返回第 1 页**，只有 `currentPage` 生效。如果只试一两个名字就下结论，会以为"这个接口没有分页"。

- 列表的 `description` + `requirement` 与详情接口 `position/query?id=` 返回的内容**逐字节相同**，所以不需要详情补全。
- `workType`：0 = 全职（2111 条）、1 = 实习（574 条）。
- 详情页 `/job-detail.html?id=<id>`（路由从 bundle 里读到的 `/job-detail.html`），CDP 打开确认渲染出岗位名。

实测 **2697 条**，是当前最大单源。

### 4.2.3 修掉的两处静默失真

**① 声明的页数被静默截断到 10 页。**

`loadJsonApiSource` 里有 `Math.min(Number(adapter.pages) || 1, 10)`。网易声明 27 页，实际只走 10 页 → 只入库 998 条，而真实库存是 2699 条。**表面上看不出任何异常**：接口全 200、没有报错、日志干净，只是数字少了一大截——正好和"这家公司岗位不多"长得一模一样。

这和 2.3 节的「零岗位 = 同步成功」是同一类错误：一个上限悄悄改写了事实。已改成显式常量 `MAX_PAGES = 50` 并写明理由，同时加了回归用例（声明 27 页就必须发 27 次请求）。

**② 类型判断让标题关键词盖过了载荷里的权威字段。**

`inferJobType` 的优先级是"先看列表文本里的关键词，再回落到 `defaultType`"。网易有 12 条被标成"校招"，而它们的 `workType` 明明是 0（全职）——只因为标题里带"校园招聘"三个字。**那些其实是做校招的社招 HR 岗。**

改成：适配器如果从载荷里读到了确定的类型字段，就以它为准（`officialRow` 优先用 `fields.job_type`），标题关键词只作兜底。字节（`recruit_type`）、美团（`jobType`）、网易（`workType`）、京东（整个端点就是校招门户）都改为显式声明类型。

### 4.2.4 阿里的结论（记录为可复现的事实）

阿里 `POST talent.alibaba.com/position/search?_csrf=<XSRF-TOKEN>` 的调用链已经跑通：先 GET 一次页面拿 `XSRF-TOKEN` cookie，把它作为 `_csrf` 查询参数带上即可，**接口返回 HTTP 200 且 JSON 合法**。

但 `content.totalCount` 恒为 0，`datas` 恒为 null，且**浏览器里页面自己也写着「在招职位共0个岗位」**——不是我的复现有问题，是未登录会话拿不到职位。所以阿里保持 `unadapted`，但 `reason` 写明了这条已验证的结论，而不是笼统的"尚未适配"。

---

## 4.3 第四轮：适配华为，以及一个会静默复制全部岗位的陷阱

### 4.3.1 华为：一个网关两个门户

华为招聘官网不是 SPA，是 hcomponent/AMD（require.js）架构，页面把组件配置以 JSON 内嵌在 `<script id="comData_*">` 里。岗位列表在 `/cn/campus-recruitment-job-list` 与 `/cn/social-recruitment-job-list` 两条路由，两个页面都打同一个网关接口：

```
POST https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/getJobPage
body: {"curPage":1,"pageSize":100,"jobType":"CR"}
```

**缺租户头时，网关返回 HTTP 200 + 一个成功形状的错误信封：**

```json
{"code":"TenantContextError","httpCode":200,"entity":null,"message":"missing tenant code!!!","friendly":true}
```

只看状态码会把它当成功。必需的头是 `x-jalor-tenantAlias: hcm`（站点自己发的值）与 `X-HW-ID: app_000000035886`。

### 4.3.2 最危险的一处：`jobType: "IR"` 是并集，且任何拼错的值都静默返回这个并集

实测三个门户代码（2026-10-12）：

| `jobType` | 行数 | 实际内容 |
|---|---|---|
| `"CR"` | 102 | 校招：应届生 71（`scenarioCode` 0）+ 实习生 31（`scenarioCode` 1） |
| `"SR"` | 462 | 社招 |
| `"IR"` | 564 | **不是实习**，是 `SR ∪ CR`（462 + 102 = 564，集合实测完全重合） |
| `"ZZ"`（乱填） | 564 | HTTP 200 + `status:"SUCCESS"`，返回的**还是那个并集** |

也就是说：一个拼错的门户代码，会长得和一个正常工作的适配器一模一样——接口 200、信封 SUCCESS、字段齐全、行数还挺大——代价只是把每个岗位**入库两遍**（一遍挂在社招源下、一遍挂在被误认为"实习"的源下）。

这和 §2.3「零岗位 = 同步成功」、§4.2.3①「页数被静默截断」是同一类错误：**接口的"宽容"把事实改写掉了，而日志上什么都看不出来。**

处理：适配器只允许请求 `"CR"` 与 `"SR"`，并在回归测试里断言二者是唯一允许的门户代码。

### 4.3.3 华为有一半校招岗位官方不公开 JD

华为校招 102 条里有 **56 条**，列表返回的 `mainBusiness` / `jobRequire` 就是一句：

> 请您详见岗位意向中的岗位职责 / 请您详见岗位意向中的岗位要求

去详情接口 `POST recruitmentPosition/pub/getRecruitmentPositionDetail`（body `{"advertisementId":"36384"}`）验证过：**返回的是同一句话**。这不是抓取失败，是官网设计——真实 JD 只在投递流程的"岗位意向"里出现。

所以做了两件事：
1. 那句占位符**不当作 JD 存**（存了就是轻度造假：用户会以为这是华为写的要求）。匹配到的行 `jd_text` 为空、`full_description_verified: false`，如实表示"官网没给"。
2. 这个门户**不声明 `detail` 路由**。既然详情接口只会重复列表里那句话，补全只会白花请求、并且永远不可能成功。

结果：`huawei-campus` 102 行（71 校招 + 31 实习，46 行有完整 JD），`huawei-careers` 461 行（462 行里 1 行因缺标题被准入校验拒掉，456 行 JD 完整）。合计 563 行。

### 4.3.4 方法论修正：同一个标签页连续导航会读到上一个页面的 DOM

本轮第一次读校招页时，把「共102条」读成了「共462条」。原因是同一个 CDP 标签页里连续 `Page.navigate` 两条 hash 路由，SPA 的客户端路由还没换完，第一次读拿到的是**上一个页面**的 DOM。

这类假观测比报错危险得多：**数字是合理的，只是属于另一个页面**，看上去完全正常。已改为每次评估开一个新标签页（`Target.createTarget` + `Target.attachToTarget` + `flatten: true`），脚本见技能 `spa-json-api-discovery/scripts/cdp_tab.py`。

### 4.3.5 本轮验证

| 检查 | 结果 |
|---|---|
| `node server/officialJobSources.test.js` | 通过 |
| `npm test` | 通过（exit 0，241 断言，0 失败） |
| `npm run build` | 通过 |
| 全量同步（23 源） | 5055 条，0 假，4999 条含完整 JD，7.1 秒 |
| 连续两次同步 | 两次均为 5055 / 4999，不降级、无重复 |

---

## 4.4 第五轮：适配小米，躲开一个 2017 年的假库

### 4.4.1 先说没做的那件事：`hr.xiaomi.com/job/list` 是 2017 年冻结的旧库

登记表里小米的入口原本是 `https://hr.xiaomi.com/`。顺着官网找职位页时，首页导航的「浏览全部职位」指向 `opportunities.html`，**该路径返回 404**；而 404 页的页脚里写着真正的「社会招聘」链接是 `https://hr.xiaomi.com/job/list`。

那个页面看起来完美：HTTP 200、79 KB 服务端渲染 HTML、表格列是「职位名称 / 职位类别 / 工作地点 / 发布时间」、有分页控件、每页 10 条、`/job/view/<id>` 详情链接齐全。**很容易就此写一个 HTML 适配器。**

但把发布日期摊开看：

| 页 | 发布日期分布 |
|---|---|
| 1 | 2017-08-31 × 9、2017-09-07 × 1 |
| 2 | 2017-07-26 × 6、2017-08-31 × 2、2017-07-07 × 2 |
| 5 | 2017-08-31 × 10 |
| 20 | 2017-07-07 × 10 |

四个筛选段（`0-0-0-0-1` / `0-0-1-0-1` / `0-0-2-0-1` / `0-0-3-0-1`）抽出来也全是 2017。**整棵树是九年前的冻结数据。**

如果按"官方域名 + 有职位链接 + 有分页"就接进来，会把几百个 2017 年的岗位灌进库，而且每条都长得完全正常——有标题、有城市、有日期、有详情页。这是本轮最有价值的一次"没做的事"。

真正的岗位站在 **`xiaomi.jobs.f.mioffice.cn`**，入口是从 `hr.xiaomi.com/website/campus.html` 的「立即加入」按钮上读到的（`/campus/`、`/internship/`、`/newretailing/` 三个门户）。

### 4.4.2 小米跑的是和字节同一套招聘 SaaS

抓 `xiaomi.jobs.f.mioffice.cn` 的请求时，基础设施一眼就认出来了：`vcs.snssdk.com`、`mcs.snssdk.com`、`mon.zijieapi.com`、`verify.snssdk.com`，埋点事件名是 `atsx_official_referral_positions_pageload`，接口是**和字节一模一样的** `POST /api/v1/search/job/posts`。

也就是说，这是 ATSX / 飞书招聘这套**多租户 SaaS**：字节在 `jobs.bytedance.com` 上跑一个租户，小米在 `xiaomi.jobs.f.mioffice.cn` 上跑另一个。

所以没有抄第二份映射，而是把 `bytedanceAdapter` 提升成共享的 `atsxAdapter({ origin, entryPath, detailPath, portalType, portalEntrance, defaultType, headers, pages })`，租户只提供自己的域名、门户选择器和详情路由前缀。**顺带证明了 §4.1.1 那个「门户由请求头决定」不是字节的特例**——同一套平台，两家都用请求头选门户，只是头名不同。

（`use_default_distance` 是字节会发的字段，小米不带也能正常返回，所以做成 opt-in，不往每个租户身上发。）

### 4.4.3 门户选择器：只有 `website-path` 算数，而且有两处静默失败

实测矩阵（2026-10-12，`POST /api/v1/search/job/posts`）：

| `website-path` | 行数 | 内容 |
|---|---|---|
| `index` | 1987 | 社招 / 全职 |
| `campus` | 782 | 校招 / 正式 |
| `internship` | 580 | 校招 / 实习 |
| `newretailing` | 97 | 校招 / 正式（新零售项目，与 `campus` 只有 1 条重叠） |
| `social` | — | **HTTP 200 + `msg:"site not exist"` + 0 条** |
| `zzz`（乱填） | — | 同 `social` |
| 不带这个头 | 2188 | 一个**比 `index` 更大的、站点自己从不展示的集合** |

三个门户互不相交（实测 `campus ∩ internship ∩ social = ∅`）。而 `portal_type`（试了 1/2/6/7/99）、`portal_entrance`（1/2/3）、`Portal-Channel`（saas-career/campus/social）**全部被接受然后忽略**——一律返回同样的 782 条校招。这点和字节正好相反：字节是请求头**覆盖** body 里的 `portal_type`，小米是 body 里的 `portal_type` **完全没用**。

两处静默失败，都是 §4.3.2 那一类：

1. **按最直觉的名字猜社招门户会得到 0 条。** `website-path: social` 返回 HTTP 200、`msg:"site not exist"`、没有数据。如果只看状态码，结论会是"小米没有社招岗位"——而实际有 1987 条。真正的值是 `index`。
2. **不带头会多出 201 条。** 不传 `website-path` 返回 2188 条，而站点自己的社招页显示「开启新的工作（1987）」。2188 这个数字**看起来完全正常**，只有和页面上自己写的数字对一遍才发现不对。所以社招源把 `website-path: index` 显式钉死，而不是"反正不带头也能拿到数据"。

第四个门户 `newretailing`（97 条）**暂不登记**：它是校招下的一个子项目，为 97 条再开第四家小米源不划算。记在这里，需要时再补。

### 4.4.4 顺带修掉一个自己引入的性能回归

小米社招 20 页。原来的分页是**逐页串行**，这一个源就花了 22 秒，把整轮同步从 7 秒拖到 **24.2 秒**。

分页之间是彼此独立的读，改成批内并发（4 路），**但第一页单独发**——它用 1 个请求就回答了"这个源小不小"，所以 10 条的源不会为此付 4 个请求的代价；深源再按批推进。

| | 改前 | 改后 |
|---|---|---|
| 小米社招（20 页） | 22.2 秒 | ~5 秒 |
| 整轮同步（25 源） | 24.2 秒 | **10.1 秒** |

### 4.4.5 本轮验证

| 检查 | 结果 |
|---|---|
| `node server/officialJobSources.test.js` | 通过 |
| `npm test` | 通过（exit 0，0 失败） |
| `npm run build` | 通过 |
| 全量同步（25 源） | 8405 条，0 假，8348 条含完整 JD，10.1 秒 |
| 连续两次同步 | 两次均为 8405 / 8348，不降级、无重复 |
| 小米三源 | 1987 + 782 + 580 = 3349 条，0 条外域 URL |

---

## 4.5 第六轮：适配科大讯飞，以及「北森」这个第二批共享平台

小米之后，§5 里第 3 条留了一句判断依据：**先看是不是共享平台，再决定要不要重写映射**。讯飞就是这句话的直接受益者——它跑在**北森（zhiye.com）**上，是继 ATSX / 飞书招聘之后发现的**第二套多租户招聘 SaaS**。这一轮没有新写一个解析器，只是又写了一个工厂。

### 4.5.1 入口是个 301，不能直接登记

`campus.iflytek.com`（登记表里的旧 `entryUrl`）**301 到 `iflytek.zhiye.com`**。这不只是"入口不够新"的问题：`hostAllowed()` 用 `hostOf(source.entryUrl)` 当作白名单根，入口 host 是 `campus.iflytek.com` 而岗位 URL 在 `iflytek.zhiye.com` 上，**该源的每一行都会被准入校验丢掉**——表现为「源同步成功、0 个岗位」，正是 §2.3 那类让监控失效的假成功。所以 `entryUrl` 必须指向数据实际所在的 host。

### 4.5.2 门户由请求体 `Category` 决定，且 id 的含义是**每租户一套**

```
POST https://iflytek.zhiye.com/api/Jobad/GetJobAdPageList
{ PageIndex, PageSize, KeyWords, SpecialType, PortalId, Category: [..], DisplayFields: [..] }
```

讯飞的门户映射（实测）：

| Category | 门户 | 条数 |
|---|---|---|
| `1` | 社会招聘 | 721 |
| `2` | 校园招聘 | 119 |
| `4` | 飞星计划 | 11 |
| `5` | 飞凡计划 | 3 |
| `6` | 校园大使 | 1 |
| `7` | 星火X顶尖AI人才计划 | 31 |

**`Category` 接受数组**，所以一个源可以跨多个门户：`iflytek-campus` 用 `["2","4","5","6","7"]` 一次拿全 165 条。而且**多值请求的并集严格等于各单值之和**（165 = 119+11+3+1+31，实测），所以这样合并**不是**静默失真——这一点是特意验证的，因为「省略参数拿并集」在华为那边就是坑（§4.3.2）。

**但这个 id 映射不能跨租户假设。** 同一平台上 `vivo.zhiye.com` 的校园门户用的是 `Category: [5]`，而且那套站点是**员工内部门户**（24 条，分类名「员工校招」），不是公开招聘页，所以**故意不登记**。这正是 §5 第 3 条要表达的意思：共享的是**协议**，不是**取值**。

### 4.5.3 四个陷阱，全都长得像能跑的代码

**(1) `PostDate` 是空值哨兵，不是日期。** 全量 886 行里，`PostDate` **886/886** 都是字符串 `"0001-01-01T00:00:00"`。`toIsoDate()` 会把它规规矩矩变成 `"0001-01-01"`——**整个库的发布日期变成公元 1 年，而且这个值看起来是个完全合法的日期**，不会报错、不会为空、不会被 `isUsableRow` 拦下。真正有值的是 `ChangeDate`（886/886 都有）。适配器只读 `ChangeDate`，并用 `BEISEN_NULL_DATE_RE` 显式挡掉哨兵；回归测试里专门放了一行 **`PostDate` 是真日期、`ChangeDate` 是哨兵** 的用例，断言结果是空字符串——**证明 `PostDate` 根本没被读**。

**(2) 详情路由的参数名是错的。** 路由是 `/job/detail?jobAdId=<id>`，但参数**只认 GUID 的 `Id`**：

| 传入 | 结果 |
|---|---|
| `jobAdId=247b87c5-020b-458b-8c39-66a85dd04c5f`（GUID `Id`） | 正常渲染岗位，正文 832 字符 |
| `jobAdId=190832627`（整数 `JobAdId`） | 只剩 40 字符的空壳 |
| `jobAdId=00000000-0000-0000-0000-000000000000`（伪造） | 只剩 40 字符的空壳，**与上一行完全一致** |

第三行是关键：**伪造 id 也是 HTTP 200、无 404、无错误文案**。所以「这个 URL 返回 200」在这个平台上完全不构成证据——和 §4.3.1 华为那个「HTTP 200 的成功信封」是同一族问题，这是第 7 例。验证方法仍是**开新标签页**（§4.3.4 / skill §2.5）。

**(3) 「实习生招聘」是个真门户，但它是空的。** 导航栏的 `/intern/jobs` 确实存在，它请求 `Category: ["3"]`——平台返回 **Count=0**。讯飞真实的 12 条实习岗**混在校园分类里**（星火X 的 `Kind=实习`）。所以：

- **不注册**独立的实习源。注册一个永远 0 行的源只是「一个总是找不到东西的页面」，比不登记更差。
- `iflytek-campus` 用 `resolveType` 读 `Kind` 分流：`/实习/` → `internship`，否则 `campus`。实测 165 条 = 153 校招 + 12 实习，**比官网自己的实习页还全**。

顺带一个正面结论：**北森在枚举上是安全失败**。`Category: ["999"]` 返回 **0 条**（不像华为的 `jobType` 拼错就返回全量并集）；`Category` 传字符串 `"1"` 或数组 `["1"]` 都能正常返回。同一个 `Category` 字段，两个方向的容忍度完全不同——**每个新平台都得自己测一遍非法值**。

**(4) `DisplayFields` 是真正的字段选择器，漏写就静默清零。** 这条是**我自己的探针先踩了，然后写下了错误结论**，值得单独记一笔。

第一轮探针用的 `DisplayFields` 是手挑的 `["Category","Kind"]`，于是量到 `LocNames` **886/886 全是空数组**，据此在文档和 README 里写下了「这个平台没有任何地点信息」。换成**站点自己发的那个 5 字段列表**（含 `LocId`、`ClassificationOne`）再量，结论直接反过来：

| `DisplayFields` | `LocNames` | `ClassificationOne` |
|---|---|---|
| `["Category","Kind"]`（手挑的子集） | `[]` | `null` |
| 完全不带 | `[]` | `null` |
| 站点自己的 5 字段（含 `LocId` / `ClassificationOne`） | `["安徽省·合肥市"]` | `"政府公共事务序列"` |

**关键是它不报错、也不缺字段**：`LocNames` 照样存在，只是值变成 `[]`；`ClassificationOne` 照样存在，只是 `null`。响应结构完全合法，HTTP 200，行数一条不少。这是「接口宽容」的第 8 例，也是最难自查的一例——**因为出错的不是接口，是我请求时少要了一个字段**。

做法：**`DisplayFields` 照抄站点自己发的那一份，不要手挑**。适配器里的 `BEISEN_FIELDS` 就是站点原样的 5 个字段，回归测试里专门断言 `LocId` 与 `ClassificationOne` 必须在列表里。

修完之后：**886/886 行都有地点**（社招 79 个不同地点串、校招 35 个），0 条回落默认值。格式是平台自己的 `省份·城市`，多城市岗位形如 `安徽省·合肥市；陕西省·西安市；上海市`。

### 4.5.4 详情页不值得抓

列表里 `Duty` / `Require` **886/886 都有**，而详情页（新标签页实读全文）只有「工作职责 / 任职资格 / 立即投递 / 收藏」加页脚 `Powered by Beisen`——**详情页确实不提供地点，也不提供发布日期**。所以适配器**不声明 `detail` 路由**，`enrichRows()` 直接返回原行。这是继京东（§4.1.2）之后第二个「胖列表」平台。

注意这里有个容易混的地方：**地点在列表接口里（靠 `DisplayFields` 拿到），不在详情页里**。我第一轮之所以认为"全平台无地点"，一半是因为探针漏了 `LocId`，另一半是因为只看了详情页、没回去核对列表。**两处都要看，不能因为一处没有就下全称结论。**

### 4.5.5 本轮验证

| 检查 | 结果 |
|---|---|
| `node server/officialJobSources.test.js` | 通过 |
| `npm test` | 通过（exit 0，0 失败） |
| `npm run build` | 通过（346ms） |
| 全量同步（26 源） | **9291 条**，0 假，**9234 条含完整 JD**，10.1 秒 |
| 连续两次同步 | 两次均为 9291 / 9234，不降级、无重复 |
| 讯飞两源 | 721 + 165 = **886 条**，0 条外域 URL，0 条 `0001-01-01` 日期，886/886 含完整 JD，914ms |
| 讯飞类型分流 | 721 社招 + 153 校招 + 12 实习（实习来自 `Kind`，不是那个空门户） |
| 讯飞地点覆盖 | **886/886 行都有地点**（社招 79 个不同地点串、校招 35 个），0 条回落默认值 |
| 注册表 | 26 源 / 21 家：14 源已适配，12 家仅入口 |

> 注：上一轮记录里的「25 源 / 8405 条」是**加讯飞之前**的实测值；本轮新增 886 条后为 9291 条，差值与讯飞两源之和精确相符。

---

## 4.6 第七轮：发现并修掉「静默截断」——三个源只抓到了零头

这一轮不是加新公司，是回头量了一遍**已有 14 个源各自抓到了多少**。方法是把每个源实际抓到的行数，和接口**自己报出来的总数**对账。

结论很难看：**三个大源的覆盖率是个位数百分比，而且日志上完全看不出来。**

### 4.6.1 对账结果

| 源 | 抓到 | 接口自报总数 | 覆盖率 |
|---|---|---|---|
| `bytedance-careers` 字节社招 | 300 | **10000** | **3%** |
| `bytedance-campus` 字节校招 | 500 | **7468** | **7%** |
| `tencent-careers` 腾讯社招 | 299 | **2253** | **13%** |
| `netease-careers` 网易 | 2697 | 2699 | ~100% |
| `meituan-careers` 美团 | 563 | 563 | 100% |
| `xiaomi-*` / `iflytek-*` / `huawei-*` / `jd-careers` | — | — | 100% |

**为什么以前没发现**：走查结束的条件是「某一页比声明的 `pageSize` 短」。这三个源都是**把声明的页数用完了**才停的，最后一页是满的——也就是说，它们不是"抓完了"，而是"抓到了我自己设的上限"。日志上这和一个正常结束的源长得一模一样。

这正是 §4.1.3 那条「声明了参数却被实现悄悄截断」的同一族问题，只是这次截断不在代码里，在**我填的页数**里。而 `bytedance-careers` 更离谱：它**根本没传 `pages`**，直接落到工厂默认的 3。

### 4.6.2 真正的杠杆是每页条数，不是页数

修法不是把页数从 3 改到 100（那要 100 次请求），而是**先把每页条数顶到接口允许的上限**。实测三个源都远比预期宽松：

| 源 | 参数 | 实测上限 |
|---|---|---|
| 字节 / 小米（ATSX） | `limit` | **≥ 2000**（1000 时响应 3.8 MB） |
| 腾讯 | `pageSize` | **≥ 500** |
| 网易 | `pageSize` | **正好 200**，250 起返回 0 条 |

于是覆盖是**用更少的请求**买到的：

| 源 | 改前 | 改后 |
|---|---|---|
| 字节社招 | 3 页 × 100 = 300 行 | **12 页 × 1000 = 10000 行**（覆盖满） |
| 字节校招 | 5 页 × 100 = 500 行 | **9 页 × 1000 = 7468 行**（覆盖满） |
| 腾讯社招 | 3 页 × 100 = 299 行 | **6 页 × 500 = 2242 行**（自报 2243，见 §4.6.4） |
| 小米社招 | 22 页 × 100 | **3 页 × 1000**（请求数 22 → 3，行数不变） |
| 小米校招 / 实习 | 10 / 8 页 × 100 | **2 / 2 页 × 1000**（请求数 18 → 4，行数不变） |
| 网易 | 27 页 × 100 | **15 页 × 200**（请求数 27 → 15，行数不变） |

全量同步耗时只从 10.1 秒升到 16 秒，而行数从 9291 涨到 **27902**。

### 4.6.3 顺带修掉一个自己埋的雷：`limit` 是写死的

`atsxAdapter` 里 `limit: 100` 和 `offset: (page - 1) * 100` 是**硬编码**的，而 `pageSize` 是另一个独立字段。这两个值一旦不一致，短页判断就会拿新 `pageSize` 去比请求里的 100 条 → **第 1 页就被判定为"短页"→ 整个源 0 条**，而状态显示同步成功。

也就是说：**改 `pageSize` 本身就会触发 §2.3 那个假成功**。现在 `limit` / `offset` 都从 `pageSize` 派生，并加了一条通用回归断言：**每个源请求里带的每页条数，必须等于它声明的 `pageSize`**（覆盖 `body.limit` / `body.pageSize` / `body.PageSize` / `body.page.pageSize` / URL 查询参数五种位置）。

网易那个 200 的天花板则是相反方向的坑：**超限返回 0 条**，同样会被当成"抓完了"。所以它的 `pageSize` 被断言钉在 ≤ 200。

### 4.6.4 扩大走查之后才暴露的第三处丢行：腾讯其实有**两套投递系统**

把腾讯的走查从 3 页扩到 6 页后，抓到 1929 行，但接口自报 **2243**。差了 314 行，而准入校验的每一条规则（标题过短/过长/公告句式/通用词/无 URL）都**一条都没命中**。

原因不在规则，在**域名白名单**：

| PostURL 的 host | 行数 |
|---|---|
| `careers.tencent.com` | 1929 |
| `tencent.wd1.myworkdayjobs.com` | **314** |

腾讯**同时跑着两套投递系统**：大部分岗位在自家站上，另有 314 个直接链到腾讯自己的 Workday 租户（`tencent.wd1.myworkdayjobs.com/Tencent_Careers/...`，抽查 HTTP 200、页面含职位标题、含 Tencent）。

`hostAllowed()` 用 `entryUrl` 的 host 当白名单根，于是把这 314 行当"站外链接"**静默剔除了**——这正是 §2.2 那条防「假岗位」的规则在起作用，但它分不清两种站外链接：

- **聚合站**（`lagou.com` / `zhipin.com` / 公众号文章）→ 该拒，这是 §2.2 要防的
- **企业自己的第三方 ATS 实例**（腾讯的 Workday、可能的 `*.myworkdayjobs.com` / `*.icims.com` / `*.taleo.net`）→ **是真岗位，该收**

修法就是 `allowedHosts` 这个机制本身：把腾讯的 Workday 租户显式列进去。修完 **1929 → 2242 行**，而且其中**实习岗从 1 条变成 87 条**——被误杀的那批里恰好有一批实习岗位，对目标用户（学生）来说这是最值钱的一类。

> 顺带记一条通用教训：**「站外链接一律拒绝」这条规则本身是对的，但它需要一个「企业自有 ATS 实例」的例外清单，而且这个清单只能靠人看出来。** 发现它的唯一线索就是「抓到多少 vs 接口说有多少」这个对账——规则不会报错，只会安静地少数据。

### 4.6.5 覆盖变大之后，详情预算必须跟着调

腾讯的要求文本只在详情页，所以走 `detail` 补全，预算是每轮 900 条。原来预算是 300，正好等于旧的 3 页走查量——**「一轮走完」这个前提被扩大覆盖打破了**。不调的话会变成 2242 行里只有 300 行有完整 JD（13%）。

调成 900 之后（详情接口很快，约 22 ms/次，并发 4）：

| 轮次 | 总行数 | 含完整 JD | 腾讯 |
|---|---|---|---|
| 第 1 轮 | 27902 | 26503 | 900 / 2242 |
| 第 2 轮 | 27902 | 27403（**+900**） | 1800 / 2242 |
| 第 3 轮 | — | 收敛 | 2242 / 2242 |

**每轮恰好推进一个预算量，行数不增不减、不降级**——详情补全的「速率上限而非覆盖上限」设计在扩大覆盖后依然成立，第三轮收敛。这也顺带验证了：**扩大走查量不会让同步退化**。

### 4.6.6 本轮验证

| 检查 | 结果 |
|---|---|
| `node server/officialJobSources.test.js` | 通过 |
| `npm test` | 通过（exit 0，0 失败） |
| `npm run build` | 通过（349ms） |
| 全量同步（26 源） | **27902 条**，0 假，首轮 26503 条含完整 JD，16.0 秒 |
| 连续两次同步 | 两次均为 27902；含 JD 26503 → 27403（+900，即腾讯预算） |
| 校招 / 实习 | **10457 条**（校招 3693 + 实习 6764），此前 3401 |
| 字节两源 | 10000 + 7468 = **17468 条**，此前 800 |
| 腾讯社招 | **2242 条**（自报 2243，差 1 个重复 URL）；其中实习 87 条，此前只有 1 条；3 轮补齐 JD |
| 请求数（小米/网易） | 小米 22+10+8 → 3+2+2；网易 27 → 15，行数均不变 |

---

## 4.7 第八轮：把「对账」从一次性动作变成可复跑的检查

### 4.7.1 第七轮留下的问题：那个救命的手法只存在于对话里

第七轮修掉三个静默截断（字节 3%、字节校招 7%、腾讯 13%），靠的全是「把『我抓到多少』和『接口说它有多少』放在一起看」。但这件事当时**是手工做的**——临时写几行探针、看一眼、然后删掉。也就是说：

- 它没有任何自动化形式，下一个人不会知道要做；
- 它不产生任何断言，四个问题**没有一个是现有测试能发现的**（§5 第 9 条里 12 例「接口宽容」，测试只覆盖到其中两例）；
- 结论只留在本次对话和文档里，代码层面零痕迹。

这是「验证」和「检查」的区别：一次性验证证明了今天是对的，检查才能保证明天还是对的。所以本轮把对账写成 `scripts/check-source-coverage.mjs`。

### 4.7.2 设计：两个独立信号，且总数不写死

脚本对每个 `json-api` 源只发 **2 次请求**：第 1 页，以及「声明的最后一页」。

**信号 A：接口自报的总数。** 但**字段名由脚本自己发现**，不写死一张表——因为写死的表恰恰是这类问题会静默腐烂的地方。做法是遍历响应里所有标量，留下 ≥ 当前页条数的数值，并优先选名字含 `count`/`total` 的。实跑一次就把六家的字段名全暴露出来了：

| 平台 | 总数所在路径 |
|---|---|
| ATSX（字节 / 小米） | `data.count` |
| 北森（讯飞） | `Count` |
| 腾讯 | `Data.Count` |
| 网易 | `data.total` |
| 美团 | `data.page.totalCount` |
| 京东 | `body.totalNumber` |

**信号 B：声明的最后一页是否返回满页。** 满页意味着板块在我们停下的地方还在继续——这正是 loader 眼里「继续翻」的条件，只不过它已经没有下一页可翻了。信号 B 覆盖「接口不报总数」的源，信号 A 覆盖「最后一页恰好不满但总数仍超出」的情况。

### 4.7.3 判定分四档，`tight` 是最有用的一档

| 判定 | 含义 | 是否失败 |
|---|---|---|
| `truncated` | 接口自报数 > 可达数，或最后一页满页 | **是**（退出码非零） |
| `tight` | 可达数够，但**余量不足一页** | 否，但要修 |
| `unreconciled` | 找不到自报总数，无法证明覆盖率 | 否，但等于没检查 |
| `slack` | 声明的页数超出实际板块（多声明的页基本免费） | 否 |
| `ok` | 最后一页不满且非空 | 否 |

`tight` 是这一轮真正有价值的一档。**「能覆盖今天的板块」不等于「安全」**：声明 6 页 × 100 而接口自报 563 条，余量只剩 37 条——下一轮招聘多挂 38 个岗位就会静默截断，和字节当年卡在 3% 是**同一种形状**，只是还没发作。

### 4.7.4 第一次跑就抓到两个

```
source             verdict   declared        reported  page1  last
jd-careers         tight     2×100=200       124       100    24
meituan-careers    tight     6×100=600       563       100    63

TIGHT jd-careers
  - only 76 rows of headroom: reach 200 vs reported 124 (body.totalNumber)
TIGHT meituan-careers
  - only 37 rows of headroom: reach 600 vs reported 563 (data.page.totalCount)
```

两个都修了（京东 2→4 页，美团 6→8 页），修完 13 个源全部对得上、余量都超过一页。**注意这两个源此前在文档里的状态是「已适配、正常」**——它们行数没少、JD 没缺、类型没串，从任何其他角度看都是健康的。

### 4.7.5 一处自我纠正：过冲不是零，上限是 3 个请求

我最初在代码注释里写「多声明的页在真实同步里不会被请求，所以是免费的」。**不准确。** 页是 4 个一批抓的（首页单独抓），短页出现后该批里剩下的页**已经发出去了**，所以过冲上限是 `PAGE_CONCURRENCY - 1 = 3` 个请求，不是零。注释已改成实话。

这个差别不影响结论（3 个请求的代价可以忽略），但**「免费」和「很便宜」是两句话**，写错会让后来的人基于错误前提做取舍。

### 4.7.6 一个准确的更正：这个仓库目前没有 CI

我之前把这条待办写成「应该进 CI」。实际上仓库里**没有 `.github/workflows`**，没有 CI 可进。落地形式是 `npm run test:coverage`（联网检查，因此**不放在** `npm test` 里，与 `test:live` / `test:real-model` 同级），可以手动跑，也可以将来挂到夜间任务。

同时把 `tight` 这条不变量**离线**钉进了 `server/officialJobSources.test.js`：用记录下来的总数断言 `reach - total >= pageSize`。离线测试没法发现总数，但可以钉住已记录的，这样美团/京东这一类回归不需要联网就会被拦住。

### 4.7.7 本轮验证

| 检查 | 结果 |
|---|---|
| `npm run test:coverage` | 13 个 `json-api` 源全部对账：0 truncated / 0 tight / 0 errored / 0 unreconciled / 13 slack，退出码 0 |
| 修复前后对比 | 修复前 2 tight（京东 76 行余量、美团 37 行余量）→ 修复后 0 tight |
| `node server/officialJobSources.test.js` | 通过（含新增的余量断言） |
| `npm test` | 通过（exit 0，241 tests / 241 pass / 0 fail） |
| `npm run build` | 通过 |

**一处顺带的观察（不是问题）**：自报总数与入库行数偶尔差 1（华为社招自报 462 / 入库 461，网易 2699 / 2698，美团 563 / 562）。这是预期内的——自报数是记录数，入库行数是过了准入校验（`isUsableRow`）并去重之后的行数，差 1 说明恰好有一条记录没有可用的详情链接或被判重。对账用的是自报数，方向上是偏严的，安全。

---

## 5. 还没做的

1. **继续适配剩余 12 家**。26 源里 14 源已适配（见 §4 表），剩下 12 家的入口与已有线索：

   | 公司 | 官方入口 | 已有线索 |
   |---|---|---|
   | 阿里巴巴 | `talent.alibaba.com/campus/position-list` | 调用链已跑通，但**需要登录态**（§4.2.4）——不是技术难点，是账号问题 |
   | 拼多多 | `careers.pinduoduo.com/jobs` | 未抓 |
   | 滴滴 | `talent.didiglobal.com` | 未抓 |
   | 快手 | `zhaopin.kuaishou.cn` | 未抓 |
   | 荣耀 | `career.hihonor.com` | 未抓 |
   | OPPO | `careers.oppo.com` | 未抓 |
   | vivo | `hr.vivo.com` | 未抓。另：`vivo.zhiye.com` 是北森租户，但那是**员工内部门户**（24 条，分类「员工校招」），不是公开校招页，不能用 |
   | 大疆 | `we.dji.com` | 未抓。`dji.zhiye.com` 探过，返回 `Not Found` |
   | 比亚迪 | `job.byd.com` | 未抓。`byd.zhiye.com` 探过，返回 `Not Found` |
   | 宁德时代 | `www.catl.com/careers/` | 未抓。**入口当前 302 到 `www.catl.com/404/`**，登记前必须换掉 |
   | 商汤科技 | `www.sensetime.com/cn/careers` | 未抓。**入口当前 404**，登记前必须换掉 |
   | 深信服 | `hr.sangfor.com` | 未抓 |

   **每家都必须先在浏览器里抓一次真实请求**——本轮六次成功（字节靠请求头、京东靠 bundle 路由表、美团靠 bundle 路由表、华为靠组件数据里的路由表 + 租户头、小米靠页脚链接 + 门户头、讯飞靠 301 后的域名 + 导航 href）全是抓出来的，猜路径一次都没对过。方法已固化成 `~/.workbuddy-ai/skills/spa-json-api-discovery`（含 `cdp_tab.py` / `xhr_all.py` / `capture_full.py`）。

2. **剩下的公司要先排除"假库"再动手**。小米那次说明：**官方域名上的职位页也可能是死的**。接任何 HTML 源之前，先把它的发布日期摊开看一眼——如果全是几年前，那不是"这家公司岗位少"，是页面早就没人维护了。同理，登记表里的 `entryUrl` 也值得逐个复核：小米原来的入口指向营销站，讯飞的入口是个 301（换 host 会静默丢光所有行，见 §4.5.1），宁德时代和商汤的入口当前是 404。

3. **同平台租户可以批量接，但只能批量接「协议」，不能批量抄「取值」**。已经确认两套多租户招聘 SaaS：
   - **ATSX / 飞书招聘**：`<tenant>.jobs.f.mioffice.cn` 或自建域名，同一套 `POST /api/v1/search/job/posts`（字节、小米）。
   - **北森 / zhiye.com**：`<tenant>.zhiye.com`，同一套 `POST /api/Jobad/GetJobAdPageList`（讯飞；vivo 那个是员工门户）。

   两套都已经是「一个工厂函数 + 每租户一组参数」。但**门户选择器的名字和取值都是每租户一套**：字节用请求头 `Portal-Channel`（缺省即社招），小米用请求头 `website-path`（社招的值是 `index` 而不是 `social`），讯飞用请求体 `Category` 数组。**每接一个租户都要重跑一遍门户矩阵**，否则就是 §4.4.3 那类「HTTP 200 + 空列表」的静默失败。判断平台归属的特征：`snssdk.com` / `zijieapi.com` 的基础设施请求（ATSX），或页脚 `Powered by Beisen`（北森）。Moka（`app.mokahr.com/<company>`）、大易同理。

4. **岗位过期判定**。`status` 只在接口显式返回 `IsValid: false` / `isValid: false` 时才标 `closed`，其余靠 7 天新鲜度窗口。官网下线的岗位会在库里多留 7 天。字节、网易、华为、小米的列表接口都没有失效标志，这条对它们无效。
5. **`githubJobSources.js` / `campusAggregator.js` 两个死模块**：确认无用后应删除（本次未动，避免与队友分支冲突）。
6. **`search_jobs` 的覆盖提示可以更具体**。现在只说"另有 N 家只登记了官方入口"，可以列出公司名，让用户知道该去手动开哪几家。
7. **`html` 适配器只剩百度一家**（10 条）。如果后续确认百度也有 JSON 接口，`markers` 抽取这条路径可以整个删掉，适配器种类收敛为 `json-api` + `unadapted` 两种。
8. **小米 `newretailing` 门户待决定**（97 条，与校招 782 条只重叠 1 条）。本轮没登记，理由是它是校招下的子项目、为 97 条再开第四家小米源不划算；如果觉得覆盖更重要，加一个 `xiaomiAdapter({ websitePath: "newretailing" })` 即可。
9. **「接口宽容」这一类错误值得再搜一遍**。目前已经集齐十二例同源问题，特征是**接口返回 200 且结构合法，但语义不是请求的那个**：

   | # | 现象 | 出处 |
   |---|---|---|
   | 1 | 零产出被算成同步成功 | §2.3 |
   | 2 | 声明的页数被静默截断到 10 页 | §4.1.3 |
   | 3 | 华为 `jobType` 拼错 → 静默返回 `SR ∪ CR` 并集 | §4.3.2 |
   | 4 | 小米 `website-path: social` → HTTP 200 + `msg:"site not exist"` + 0 条 | §4.4.3 |
   | 5 | 小米不带头 → 返回**另一个更大**的集合（2188 vs 页面自称的 1987） | §4.4.3 |
   | 6 | 华为缺租户头 → HTTP 200 + `code:"TenantContextError"` 的成功信封 | §4.3.1 |
   | 7 | 北森详情路由参数名写错 → 伪造 id 也 HTTP 200、无 404、只剩空壳 | §4.5.3 |
   | 8 | 北森 `DisplayFields` 少写一个字段 → 该字段静默变空，响应结构依然完全合法 | §4.5.3 |
   | 9 | 每页条数超过接口上限 → 返回 0 条，被当成"这一页是最后一页" | §4.6.3 网易 `pageSize` ≥ 250 |
   | 10 | 请求里的每页条数与声明的 `pageSize` 不一致 → 第 1 页即被判"短页"，**整个源 0 条** | §4.6.3 自己代码里的硬编码 `limit: 100` |
   | 11 | 声明的页数用完了但最后一页是满的 → 不是"抓完了"，是"抓到了我设的上限" | §4.6.1 字节 3%、腾讯 13% |
   | 12 | 站外链接白名单把**企业自己的第三方 ATS** 当聚合站一起拒了 → 静默少 314 行 | §4.6.4 腾讯的 Workday 租户 |

   第 8、10 例和前七例有个重要区别：**前七例错在接口，这两例错在我自己发的请求**。所以自查方式也不同——不能只对着响应挑毛病，还要**把请求体和站点自己发的那一份逐字段对照**。少了字段不会报错，只会安静地少数据。

   第 11 例则是**唯一一个只能靠"和接口自报的总数对账"发现的**：它的日志、状态码、行数全都正常，唯一异常之处就是覆盖率低。所以每接一个源，都要把「我抓到多少」和「接口说它有多少」写在一起看一遍。

   剩余 12 家适配时，每家都要先确认「我请求的东西 = 我拿到的东西」，特别是分页参数名、门户代码、字段选择器这类枚举型入参——它们往往不校验、静默回落。**并且要故意试一个非法值**：同一个平台的两个字段，容忍方向可能完全相反（华为的 `jobType` 错值→全量并集，北森的 `Category` 错值→0 条，后者是安全的那个）。

10. ~~**把「抓到多少 vs 接口自报多少」做成常态化对账**~~ **已在第八轮完成，见 §4.7。** 落地为 `npm run test:coverage`（`scripts/check-source-coverage.mjs`，联网、不在 `npm test` 里）。第七轮那一整轮的问题（字节 3%、腾讯 13%、腾讯 Workday 314 行被误杀）**全都只能靠这一个动作发现**：它们的日志、状态码、行数、类型分布全都正常，唯一异常之处是覆盖率低。总数不必给每个适配器手写小函数——脚本遍历响应自己发现字段名（实测六家的路径见 §4.7.2），因为写死的表正是会静默腐烂的东西。

    **剩下的**：这个仓库目前没有 CI（无 `.github/workflows`），所以它现在是手动检查。将来若要挂夜间任务，直接跑 `npm run test:coverage` 即可——有任何源 `truncated` 或报错时退出码非零。另外新增的 `tight` 判定（余量不足一页）**已经离线钉进测试**，不联网也能拦住这一类回归。

11. **站外链接白名单需要一份「企业自有第三方 ATS」清单**。腾讯的 Workday 租户（`tencent.wd1.myworkdayjobs.com`）说明：企业完全可能把一部分岗位放在 Workday / iCIMS / Taleo 上。这类 host 是真岗位，不能和 `lagou.com` 那种聚合站一起拒。剩下 12 家适配时，如果某家行数对不上，**先看是不是这个原因**再怀疑解析逻辑。已知会用到 Workday 的还有一批外企与出海公司。

12. **腾讯那 1 个重复 URL 值得看一眼**。2243 条原始记录里只有 2242 个不同的详情 URL，说明有两条岗位共用一个投递链接（很可能是同一岗位的两个发布批次）。目前 `dedupeRows` 保留 JD 更长的那条，行为正确，但如果这种情况变多，应该考虑按 `PostId` 而不是 URL 去重。

---

## 6. 本次顺带发现、与本次重构无关的既有问题

### 6.1 `src/workspaceRuntime.test.js` 里那个冻结值从来就是错的（已修）

第一轮报告里把它记成"HEAD 上已有的不一致，需要有人确认是有意改动还是回退"。第二轮查清了，结论比"不一致"更简单：**这个期望值从来没有对应过任何一版代码。**

`d740863b…` 在仓库全部 78 个提交里**一次都没有出现过**。把 `main.jsx` 的 `LandingPage → MobileBar` 切片在每个提交上算一遍，历史上只有过一个值：

```
61fa7c912158c411…   66 个提交（自最早同时定义 LandingPage 与 MobileBar 的提交起）
d740863b9648f1d0…   0 个提交
```

所以不是"队友改了落地页忘了重新冻结"，是常量本身写错了。它之所以一直没被发现，是因为 `29f465f fix(test): make npm test actually run its whole chain` 才第一次把这个文件接进 `npm test` 链——在此之前这个守卫**根本没跑过**。

已把常量改为真实值 `61fa7c91…`，注释里写明了来源，断言强度不变。

### 6.2 网申相关的 6 个测试在 macOS 上必然失败（已修）

`src/workspaceRuntime.test.js` 修好后，`npm test` 终于能跑到 `test:architecture` 段，随即暴露下一批：

```
not ok 18 - explicit attachment selections traverse the owned API into blank native file fields only
not ok 24 - real DOM filling preserves existing values and never submits
not ok 25 - real existing repeat rows, dates and scoped attachment buffers are filled
not ok 26 - writes preserve intervening user input and keep same-name radio groups inside their form
not ok 27 - disabled experience rows keep their original profile slot
not ok 28 - same-URL step changes reject hidden stale fields and explicit rescan fills only the current step
```

报错是 `A real local browser is required` / `Actual native file controls require a local browser`。原因不是没装浏览器（`~/Library/Caches/ms-playwright/chromium-1243` 在），而是测试里的候选路径是**写死的 Windows 路径**：

```js
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
                        'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
```

在 macOS 上这两个都不存在，于是 `executablePath` 为 `undefined`、断言直接失败。**生产代码 `server/applicationForms.js` 里的列表早就是跨平台的**（含 `/Applications/Google Chrome.app/...`、`/usr/bin/google-chrome`、`/usr/bin/chromium`）——是测试抄了一份短的、只留 Windows 的副本，两边从此各走各的。

修法是把候选列表提成一个导出常量，生产和测试共用，消除这份重复：

```js
export const BROWSER_CANDIDATES = [/* windows + macOS + linux */];
export const findLocalBrowser = () => BROWSER_CANDIDATES.find(existsSync);
```

改动点：`server/applicationForms.js`（提取 + 导出）、`server/applicationForms.test.js`（5 处）、`server/applicationAttachments.test.js`（1 处）、`scripts/test-workspace-ui.mjs`、`scripts/acceptance-candidate-flow.mjs`（后两个是 `npm run test:workspace-ui` / `test:acceptance`，同样是 Windows 硬编码）。顺手补了 macOS 的 Edge 路径。

修完这 8 个网申用例在 macOS 上全部通过。

### 6.3 导出链路的 Python 依赖（本机环境，非代码问题）

`server/resumeExport.js` 通过 `python3` 调用导出脚本，而本机 `python3` 里没有 `reportlab` / `python-docx` / `pdfplumber` → `server/resumeExport.test.js` 与 `server/careerClosedLoop.test.js` 都会失败（后者最后一步要导出简历）。已在隔离虚拟环境 `/Users/mychanging/.workbuddy-ai/binaries/python/envs/default` 按 `server/requirements-export.txt` 装好（reportlab 4.4.9 / python-docx 1.2.0 / pdfplumber 0.11.9 / pypdf 6.10.0），跑测试时用：

```bash
RESUME_PROTOCOL_PYTHON=/Users/mychanging/.workbuddy-ai/binaries/python/envs/default/bin/python npm test
```

这只修了本机运行环境；如果 CI 或队友机器也缺依赖，应该在文档里写清 `requirements-export.txt` 的安装步骤。
