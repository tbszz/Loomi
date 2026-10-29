# 简历布局接入方案

用户已授权本地实现。使用 brainstorming 比较了现有 renderer 增强、独立 HTML/CSS 导出、第三方模板引擎三个方向。选择精选模板原则 + 原创布局规则 + 现有 PDF/DOCX renderer：已有 reportlab/python-docx 与持久化证据出口，增加另一渲染栈或依赖没有必要。

新增 resume-layout 第一方 SDK Skill，不新增 Agent、Router 或 planner。现有 export_resume 增加 template / section_order 可选参数。确定性校验模板和排序枚举并补齐省略模块，任何布局均保留已确认文字。真实 PDF 通过原鉴权下载路由 inline 预览；下载 URL 包含布局选项，绑定已保存 Variant，并继续重新校验证据与 ownership。

三套原创单栏 A4 布局覆盖项目丰富、工作丰富、内容较少。默认正文不低于 10.5pt，内容自动流式分页；短内容一页、中长两页、极长允许更多页。标题与首段绑定，超长段落可跨页。DOCX 使用对应字号、中文样式、模块顺序与段落分页偏好；不同编辑器分页不作同页保证。

验证：Skill 发现和 SDK allowlist、模板/排序拒绝非法输入、不丢字段、短校招/社招及两页/长中文和长 ASCII、PDF 文本提取和页面边界、DOCX 文本与 XML样式、真实 PDF 渲染截图、HTTP ownership/撤销证据/inline/配置链接；npm test 与 npm run build。保留工作区现有变更。不把合成例子作为候选人事实或真实模型能力证据。
