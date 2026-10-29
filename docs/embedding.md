# 语义检索与 Embedding

> 从 README 移出的 embedding 配置与验收说明（2026-10-29）。配置项见 `.env.example`。

长期个人背景使用 Candidate / CandidateFact / DocumentChunk；检索支持结构化事实、SQLite FTS5/BM25 和中文分词回退，另有可选语义向量融合检索。按 `.env.example` 显式选择本机 Ollama（已安装模型与完整 digest）或云端 embedding（千问 `qwen3.7-text-embedding-flash`，或 Google `gemini-embedding-001`）。不会自动下载模型，也不借用聊天/JEV 密钥。未配置或失败时保留词面检索并如实返回状态。

真实模型验收入口：`npm run test:real-embedding` 使用当前进程配置；`npm run test:configured-embedding` 显式加载忽略于 Git 的 `.env.embedding`。只使用独立临时数据库和合成材料，不读取通用 `.env`、聊天密钥或真实候选人资料。未配置、连接失败或检索质量不合格都以非零退出，不算验收通过。`npm test` 中的回归测试仍使用模拟向量，只证明验收规则，不证明真实模型效果。2026-10-10 实测：`gemini-embedding-001`（768 维）通过全部六条双语排名/边距验收（千问同门仅 2/6，3072 维一条边距未达标），`test:configured-embedding` 以退出码 0 通过。

云端适配均为显式白名单：千问限 `https://maas.qianwenaiapi.com/compatible-mode/v1` + `qwen3.7-text-embedding-flash`（1024 维）；Google 限 `https://generativelanguage.googleapis.com/v1beta` + `gemini-embedding-001`（768/1536/3072 维，单文本请求带 `RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT` task type），均使用独立 `RESUME_EMBEDDING_API_KEY`（Google 走 `x-goog-api-key` 头部）。直连不可达的网络下，embedding 传输自动使用 `HTTPS_PROXY`/`HTTP_PROXY`（undici ProxyAgent，仅作用于 embedding，不影响聊天路由）。服务端启动命令自动加载可选 `.env.embedding`；已有进程需重启后生效。云端检索会发送当前候选人的待索引材料文本和查询，不发送网申加密资料或附件字节。缓存按地址、模型、维度和显式 `REVISION` 隔离；云端模型别名不是不可变版本，服务商更新后需修改 revision 重建缓存。建议配置文件仅授予当前用户与系统读取权限，不要提交或公开密钥。
