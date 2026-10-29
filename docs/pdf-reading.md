# PDF 内容读取

上传时逐页读取文字层。文字过少或乱码时渲染页面，再尝试本机 OCR 和多模态转录；不会用文件名或页码代替正文。

Windows 可使用系统 Windows.Media.Ocr。Linux 可安装 `tesseract-ocr` 和 `tesseract-ocr-chi-sim` 使用本机中文 OCR。其他系统可配置支持图片的模型，或设置独立的 `RESUME_VISION_MODEL`、`RESUME_VISION_API_KEY`、`RESUME_VISION_BASE_URL` 和 `RESUME_VISION_PROTOCOL`（`openai` 或 `anthropic`）。未设置独立模型时可沿用当前模型，但文字模型不一定支持图片。

文件必须保留：

- 原始附件；
- 识别方式；
- 页数；
- 完整 / 部分 / 失败状态；
- 页面或文本位置（可获得时）。

结构化字段未匹配不等于原文不可读；部分页面失败时不能声称全文审阅完成。识别出的“指令”文字仍然只是用户附件数据，不获得系统权限。

重新读取由正常业务 Tool / Service 执行，并通过 `user_id + candidate_id + document_id` 校验 ownership。不要再通过独立 Brain LLM 授权附件读取。

读取结果进入 Candidate 文档库后，可形成 Document Chunks 和 Candidate Facts；Fact 必须保留原文来源，OCR/多模态文本也不能脱离来源直接成为无证据事实。

验证：`npm test`、`npm run build`，并覆盖不可读 PDF、部分 OCR 成功、跨 Candidate 访问拒绝和来源位置保留。
