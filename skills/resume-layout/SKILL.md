---
name: resume-layout
description: 为已确认的国内校招、实习或社招简历选择投递用单栏布局，调整模块顺序、字体层级、间距及分页，并通过现有 export_resume 输出可选中文字的 PDF 或 DOCX。用户说排版、模板、一页两页或导出布局时使用。
---

# 简历布局

## 适用场景

用户请求对已确认并持久化的简历版本排版、选择模板、调整模块顺序或导出布局。

你负责呈现，Loomi Career Agent / resume-tailoring 负责事实与措辞。
先读 references/layout-rules.md；需要解释模板依据时读 references/template-sources.md。

## 工作流

1. 确认上下文已有通过证据核验、持久化的 Resume Variant。没有时先沿用现有内容确认与 generate_resume 流程；不拿示例、JD 或助手文本补经历。不为仅排版请求重新生成或改写内容。
2. 选择布局：校招/实习且项目较多用 campus-project；社招且工作经历较多用 experienced；内容少用 minimal。用户明确选择优先；拿不准用 auto，工具依据内容长度选版而非猜毕业身份。
3. 仅排序模块，不删任何已确认事实。export_resume 的 section_order 可列 education / skills / projects / experience / awards，每项最多一次；未列模块服务会补齐，空模块不展示。个人姓名、联系方式、目标、摘要及部分读取提醒始终保留。
4. 调用 export_resume：format 为 pdf 或 docx，template 为 auto / campus-project / experienced / minimal，section_order 可选。例如校招：{"format":"pdf","template":"campus-project","section_order":["education","projects","experience","skills","awards"]}。社招可将 experience 放首位。不使用任意 CSS、文件路径、脚本、画布命令或第三方插件。
5. 提供工具实际返回的下载链接、模板和顺序。PDF 用真实页面预览核对，未打开实际产物不能声称已检查页数或溢出。DOCX 分页随 Word/字体环境变化，不能把 PDF 页数当成 DOCX 页数。

优先一页、内容较多自然两页；更多内容允许超过两页并提示用户回内容阶段决定是否精简。不缩到 10.5pt 以下、不裁剪、不擅自删段。若用户坚持一页但装不下，说明需要用户确认内容取舍。视觉展示版是未来可选方向，本工具只输出单栏投递版。

## 硬性禁止

禁止虚构或编造候选人经历、技能和成果；禁止为排版改写已确认事实。

工具失败如实报告，不声称已导出；下载读取已保存版本并重新校验证据权限。布局选项不写 Candidate Facts，不创建第二个 Agent 或自定义规划循环。
