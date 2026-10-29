# 精选模板来源与借鉴边界

核实日期：2026-10-14。通过 agent-reach 的 GitHub CLI/API 与上游原始文件核实。只借鉴布局原则，本项目模板和渲染样式为原创；没有复制模板源码、字体、个人数据或示例经历。下列授权指上游代码授权，不是对招聘效果的保证。

| 参照 | 来源与授权证据 | 场景与可借鉴原则 | 本项目取舍 |
| --- | --- | --- | --- |
| Sourabh Bajaj 单栏软件简历（Jake 风格） | [README](https://github.com/sb2nov/resume/blob/master/README.md)、[MIT LICENSE](https://github.com/sb2nov/resume/blob/master/LICENSE)、[模板](https://github.com/sb2nov/resume/blob/master/sourabh_bajaj_resume.tex) | 教育、经历和项目，统一条目格式、单栏连续阅读、Unicode文字映射 | campus-project 的项目型层级参考；不采用“一页硬限制”；README说明个人数据归作者所有，不复用 |
| Bill Ryan 中文简历 | [中文 README](https://github.com/billryan/resume/blob/zh_CN/README.md)、[MIT LICENSE](https://github.com/billryan/resume/blob/master/LICENSE) | Unicode/CJK 支持、中文版、清晰模块、紧凑信息区 | 中文字体与 minimal 短内容层级参考；无头像、不引入 LaTeX或仓库字体 |
| moderncv | [README](https://github.com/moderncv/moderncv/blob/master/README.md)、[LPPL-1.3c LICENSE](https://github.com/moderncv/moderncv/blob/master/LICENSE.txt)、[template.tex](https://github.com/moderncv/moderncv/blob/master/template.tex) | 多样式 CV，经历条目承载时间、岗位、雇主、地点、职责；适合经历丰富社招 | experienced 的经历层级参考；模块顺序按用户目标选择，不搬LaTeX类或图标。上游类核实为2026-06-24 v2.6.1 |
| Deedy Resume（视觉密度参照） | [README](https://github.com/deedy/Deedy-Resume/blob/master/README.md)、[Apache-2.0 LICENSE](https://github.com/deedy/Deedy-Resume/blob/master/LICENSE)、[OpenFonts 模板](https://github.com/deedy/Deedy-Resume/blob/master/OpenFonts/deedy_resume-openfont.xtx) | 本科 CS，一页非对称双栏，技能/教育与经历有主次；源码注明列高溢出问题 | 只研究层级与溢出反例；默认拒绝双栏和固定列高，不照搬版式 |

MIT 要求复制实质代码时保留版权与许可；Apache-2.0 的复制/再分发需保留许可及适用NOTICE和变更说明；moderncv代码受LPPL-1.3c约束，修改/分发需按其条件处理。本项目未复制实质源码。如果后续引入源模板或字体，须另行核实具体文件与字体许可，不能把代码许可证当作字体许可。

## BaoCut 方法参考

固定版本：[JimLiu/baocut commit 7aa049e8 中 design/SKILL.md](https://github.com/JimLiu/baocut/blob/7aa049e8/skills/baocut/built-in-skills/design/SKILL.md)。这是 BaoCut 项目自带 Skill，并非 Claude 官方 Design 功能。

借鉴：先读设计约束、确立信息层级和可读性规则；按需读取资源；明确输入/输出契约；缺事实不凭空补写；在产物上验证。落实到本项目：已确认 Variant → 模板/顺序选择 → 确定性 renderer → 中文文本/分页/溢出/导出检查。

不移植 BaoCut 的 canvas.json、.dc.html、画布工具、检查器或工具调用协议。简历里的事实缺失直接回内容确认阶段，不把 placeholder 混入正式简历。现有 SDK Skill + export_resume 已足够，不新增工作流引擎。
