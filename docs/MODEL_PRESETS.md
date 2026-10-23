# 模型厂商预设

核验日期：2026-10-22。下列默认均面向本项目的截图理解和题目分析，使用官方明确支持的原生视觉模型。实际可用性仍取决于厂商、地区、账户权限和额度；本地工程回归测试没有调用这些付费端点。

| 厂商 | 默认模型 | Base URL | 实际协议与输出字段 | 官方来源 |
| --- | --- | --- | --- | --- |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com` | Chat Completions / `max_tokens` | [Vision](https://api-docs.deepseek.com/guides/vision/)、[JSON](https://api-docs.deepseek.com/guides/json_mode/) |
| Kimi | `kimi-k3` | `https://api.moonshot.ai/v1` | Chat Completions / `max_completion_tokens` | [K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)、[Chat API](https://platform.kimi.ai/docs/api/chat) |
| GLM | `glm-5.3-flash` | `https://open.bigmodel.cn/api/paas/v4` | Chat Completions / `max_tokens` | [GLM-5.3-Flash](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)、[兼容接口](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) |
| OpenAI | `gpt-6.1-sol` | `https://api.openai.com/v1` | Responses / `max_output_tokens` | [模型](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[图像输入](https://developers.openai.com/api/docs/guides/images-vision) |
| Claude | `claude-sonnet-5-5` | `https://api.anthropic.com/v1` | Anthropic Messages / `max_tokens` | [模型列表](https://platform.claude.com/docs/en/models/overview)、[Vision](https://platform.claude.com/docs/en/build-with-claude/vision) |
| Gemini | `gemini-3.8-flash` | `https://generativelanguage.googleapis.com/v1beta` | 原生 generateContent / `maxOutputTokens` | [原生 API](https://ai.google.dev/api/generate-content) |

OpenAI 新安装默认选用当前兼顾能力与成本的 Sol。六家地址和模型会由预设自动填入，用户不用选择协议或手填认证头。模型名称仍可编辑；需要第三方服务或不同协议时选择“自定义”，在折叠的更多设置中调整。

程序不发送 `temperature`，也不强制关闭思考模式。Kimi K3 的 token 字段与常见兼容服务不同，已由预设单独处理。GLM 与 Kimi 的推理内容、Claude thinking 和 OpenAI reasoning 均不会被当作最终工具决策。响应中的实际工具调用会被拒绝；本项目只接受自己的严格 JSON 决策结构。

OpenAI 使用 Responses 原生 input_image，并设置 store:false；Claude 使用 Messages 原生 base64 image/source、x-api-key 和版本头，不伪装成 OpenAI 接口。Claude 不发送 OpenAI 的 response_format，题目 JSON 由 Prompt 与本地严格 schema 校验控制。

六家厂商分别保存模型、地址与协议，切换不会删除其他家的配置或密钥。密钥按厂商 ID 与规范化的 Base URL 计算存储范围，改变地址不会向新端点发送旧 Key，恢复原地址后可重新取用。当前仅提供一个自定义配置槽，不支持同一厂商多个具名配置。

选厂商只切换编辑对象。测试连接使用当前可见草稿，不保存或启用；导入密钥保存该厂商草稿及独立凭据，不切换当前模型。只有“保存并使用”或“使用此配置”明确启用配置。官方预设不显示协议、token 字段名称或 JSON 模式；这些兼容性选项仅对自定义服务显示，自定义服务默认 Responses。

早期未设置 provider/protocol 的自定义配置按原 Chat Completions 协议迁移。只有旧出厂官方默认才升级为新默认，任务记录、用户预算和密钥文件保留。自定义模型、第三方端点和已明确选择的模型不会被擅自替换。

连接测试发送应用生成的随机色块 PNG，模型需返回实际颜色顺序；固定回复成功 JSON 不会通过。这是图像输入通路的轻量检查，不是学习通题目识别效果测试。

## 0.1.1 协议适配

2026-10-23 对照 [Gemini 原生生成接口](https://ai.google.dev/api/generate-content) 实现 `systemInstruction`、`inlineData` 图像、`generationConfig` 和 `x-goog-api-key`；只使用正常结束的候选结果，忽略 thought 文本，拒绝截断、阻断及未经授权的工具调用。旧版 Gemini 官方 `/v1beta/openai` 配置在请求时转换为原生接口，凭据存储范围保持原值，已有 Key 不会丢失或转发到其他域名。第三方自定义端点保留用户选定的协议。

本次使用 HTTP mock 验证请求和异常解析，没有调用真实付费 Gemini 端点。模型预设名称沿用此前记录，本次未重新核验其他厂商模型目录。
