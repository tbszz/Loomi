# Loomi Desktop

**中文** | [English](README.en.md)

Loomi 是一个长期陪伴式的个人求职 Agent：为每位求职者建立可积累、可检索、可追溯来源的职业背景库，并在不同对话中复用这些真实信息，完成简历分析、JD 分析、定制简历和面试准备。

本仓库是 Loomi 的 Electron 桌面端（Windows 优先），2026-10-28 从网页端仓库 `tbszz/Resume-Protocol` 拆分而来。`server/`、`src/`、`skills/`、`knowledge/` 与网页端共用同一份代码的副本，两边都需要的修复要分别提交。

## 功能

- **候选人背景库**：上传 PDF / DOCX / TXT / Markdown，抽取成带出处的 Candidate Fact，跨对话长期复用。
- **四个求职 Skill**：`resume-analysis`、`jd-analysis`、`resume-tailoring`、`interview-prep`，工作区输入 `/` 可选择。
- **证据约束的定制简历**：每条事实性陈述都要能映射回候选人原始材料，导出 PDF / DOCX，支持项目型、工作型、简洁型版式。
- **岗位知识**：接入 14 条官方招聘接口（腾讯、字节、华为、小米等）、Hiring Radar 和国家大学生就业服务平台，带来源追踪与资格判断。
- **网申填表**：在本机浏览器里扫描企业校招页面，按本地申请资料填写空白字段，提交由本人完成。

## 快速开始

需要 Node.js 22.13 或更新版本。

```bash
npm ci
cp .env.example .env     # 按需填写模型配置
npm run desktop:dev      # 构建前端并启动 Electron
```

没有模型凭据时应用会如实报错，不会编造回答。只想在浏览器里跑网页版：

```bash
npm run app              # 构建并启动本地服务，默认 http://127.0.0.1:8787
```

开发时可分开运行 `npm run server` 和 `npm run dev`（Vite，默认 http://127.0.0.1:5173）。

打包 Windows 安装包（NSIS，输出到 `release/`，内置 Python 与导出依赖）：

```bash
npm run desktop:dist
```

## 模型配置

主 Agent 运行在 Claude Agent SDK 上（锁定 `@anthropic-ai/claude-agent-sdk@0.3.269`）。Claude、MiniMax、BigModel 都通过 SDK 执行主 Agent；OpenAI / Anthropic 兼容配置只用于辅助请求。所有选项见 [`.env.example`](.env.example)，密钥只放在本地 `.env`，不要提交。

语义检索（Ollama、千问或 Google embedding）是可选项，未配置时退回关键词 / BM25 检索，详见 [`docs/embedding.md`](docs/embedding.md)。

## 目录结构

```text
desktop/      Electron 主进程、preload、本地服务入口、打包配置
server/       Express 服务、Agent 运行时、候选人知识库、岗位源、网申、导出
src/          React 工作区；src/desktop/ 是桌面端专属 UI（开场动画、登录、账户同步）
skills/       第一方求职 Skill
knowledge/    Skill 迁移用的求职方法素材
scripts/      验收、联网检查、岗位同步和 UI 自动化脚本
docs/         专项技术说明
```

运行时数据（SQLite、上传附件、模型密钥加密材料）位于 `data/`，已被 Git 忽略。

## 测试

```bash
npm test                 # 单元与集成测试（离线，含 test:architecture 和 test:desktop）
npm run build
```

需要联网或真实凭据的检查单独运行，不在 `npm test` 中：

| 命令 | 用途 |
| --- | --- |
| `npm run test:live` | 真实模型 smoke test |
| `npm run test:real-embedding` | 真实 embedding 排名验收 |
| `npm run test:coverage` | 官方岗位源与接口自报总数对账 |
| `npm run test:acceptance` | 候选人完整流程验收 |
| `npm run test:workspace-ui` | 工作区 UI 自动化 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [`PRD.md`](PRD.md) | P0 范围与验收标准 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 系统边界，Claude Agent SDK 与 Loomi 的分工 |
| [`DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md) | 开发规则与反重复原则 |
| [`DESIGN.md`](DESIGN.md) | 工作区 UI / UX 约束 |
| [`AGENTS.md`](AGENTS.md) | 给 coding agent 的入口规则 |
| [`docs/desktop-cloud-sync.md`](docs/desktop-cloud-sync.md) | 桌面端云同步约定 |
| [`docs/job-sources.md`](docs/job-sources.md) | 官方岗位源适配与对账 |
| [`docs/job-ingestion.md`](docs/job-ingestion.md) | Hiring Radar 安装、同步与清理 |
| [`docs/eligibility.md`](docs/eligibility.md) | 岗位资格判断契约 |
| [`docs/pdf-reading.md`](docs/pdf-reading.md) | PDF 读取与 OCR |
| [`docs/resume-layout.md`](docs/resume-layout.md) | 简历版式与导出 |
| [`docs/cloud-deployment.md`](docs/cloud-deployment.md) | 网页版部署 |

## 安全原则

- 模型密钥只保存在服务端，原始附件访问需要鉴权和归属检查。
- 候选人数据一律按 `user_id + candidate_id` 隔离，由确定性代码保证，不依赖 Prompt。
- 上传材料、JD 和第三方网页文本都视为数据，不能覆盖系统规则。
- 工具执行失败不会被描述为成功；聚合站岗位文本不等同于完整官方 JD。
