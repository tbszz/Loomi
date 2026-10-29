# 简历排版使用说明

适用国内校招／实习和国内社招。内容由现有 Career Agent 确认并持久化，通过 Claim→Evidence 校验后，布局只调整呈现，不重写事实。

## 调用

聊天输入 `/resume-layout 把已确认简历排成校招项目优先的投递版，导出 PDF`，或直接说明“把工作经历放前面，按社招版排版”。SDK 会发现新的第一方 Skill；斜杠菜单“简历排版”也可选。没有已保存并核验的版本时，仍须走原有内容生成流程。

右侧优化稿选择“按内容选择／校招实习／社招／简洁”后下载 PDF 或 DOCX，展开“查看实际 PDF 分页”查看真正导出页面。下方原有文字区是内容摘要，模块顺序和分页以 PDF 为准。浏览器没有内嵌 PDF 支持时使用“打开 PDF 预览”。

现有 `export_resume` 参数示例：

```json
{"format":"pdf","template":"experienced","section_order":["experience","projects","skills","education","awards"]}
```

支持 auto / campus-project / experienced / minimal。模块仅允许 education / skills / projects / experience / awards；重复或未知模块拒绝，未列出的模块补齐，空模块不展示。返回 layout 与真实 downloadUrl。下载链接含 variantId/template/sectionOrder，复现相同布局；布局不写入 Candidate Facts。

HTTP 沿用 `/api/conversations/:id/resume.pdf` 与 `.docx`。可选 query：`variantId`、`template`、`sectionOrder=experience,projects,skills,education,awards`；PDF的 `inline=1` 用于预览。每次鉴权、校验当前候选人所有权、会话归属及最新证据状态；失效证据阻止导出。聊天最近导出布局在当前会话 export 记录保存，换新 Variant 不沿用旧布局；UI 模板选择为当前视图状态，下载链接带明示配置。

## 维护与限制

方法：[SKILL.md](../.claude/skills/resume-layout/SKILL.md)。来源/授权：[template-sources.md](../.claude/skills/resume-layout/references/template-sources.md)。样式唯一资源：`server/resume_layouts.json`，确定性选择/校验：`server/resumeLayout.js`，渲染：`server/export_resume.py`。

复用 reportlab / python-docx；不新增 npm/Python 依赖。Python路径优先环境变量 `RESUME_PROTOCOL_PYTHON`，默认沿用项目已有环境；PDF中文字体优先 `RESUME_PROTOCOL_FONT`，Windows默认 Microsoft YaHei，无字体时沿用 reportlab 的 STSong-Light CID fallback。Linux/CID fallback 字形与 PDF viewer 支持需部署环境实测。

正文最低10.5pt，A4单栏。短内容可一页，多内容自动两页，极长保留三页或更多，不强制裁剪或删经历。用户坚持一页时须先确认内容取舍。DOCX可编辑，分页由 Word/LibreOffice 和字体环境决定，不保证与 PDF 相同。视觉展示版暂未实现。现有简历数据为模块字符串数组，本次没有新增公司/项目标题与日期的结构化解析，以免擅自重写确认内容。

## 可重复验证

`node --test server/resumeLayout.test.js` 验证合成校招短内容/项目丰富/社招两页/超长中文单段及长链接、PDF可选择文本、模块顺序、全部文字保留、DOCX文字。`server/careerClosedLoop.test.js` 验证已保存版本→布局参数→鉴权导出、inline和非法参数；`server/claudeAgent.test.js` 验证SDK枚举数组schema。`npm test` / `npm run build` 为完整项目回归。

设置 `RESUME_LAYOUT_OUTPUT` 后运行布局测试，可保存合成 PDF/DOCX与逐页PNG；不要使用真实个人材料作为公共测试样例。合成样例与SDK fixture不证明真实模型已成功调用新增Skill。
