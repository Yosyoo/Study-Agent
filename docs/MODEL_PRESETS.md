# 模型厂商预设

核验日期：2026-10-20。下列默认均面向本项目的截图理解和题目分析，使用官方明确支持的原生视觉模型。实际可用性仍取决于厂商、地区、账户权限和额度；本地工程回归测试没有调用这些付费端点。

| 厂商 | 默认模型 | Base URL | 实际协议与输出字段 | 官方来源 |
| --- | --- | --- | --- | --- |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com` | Chat Completions / `max_tokens` | [Vision](https://api-docs.deepseek.com/guides/vision/)、[JSON](https://api-docs.deepseek.com/guides/json_mode/) |
| Kimi | `kimi-k3` | `https://api.moonshot.ai/v1` | Chat Completions / `max_completion_tokens` | [K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)、[Chat API](https://platform.kimi.ai/docs/api/chat) |
| GLM | `glm-5.3-flash` | `https://open.bigmodel.cn/api/paas/v4` | Chat Completions / `max_tokens` | [GLM-5.3-Flash](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)、[兼容接口](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) |
| OpenAI | `gpt-6.1-sol` | `https://api.openai.com/v1` | Responses / `max_output_tokens` | [模型](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[图像输入](https://developers.openai.com/api/docs/guides/images-vision) |
| Claude | `claude-sonnet-5-5` | `https://api.anthropic.com/v1` | Anthropic Messages / `max_tokens` | [模型列表](https://platform.claude.com/docs/en/models/overview)、[Vision](https://platform.claude.com/docs/en/build-with-claude/vision) |
| Gemini | `gemini-3.8-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` | 官方 Chat Completions 兼容接口 / `max_tokens` | [官方兼容接口](https://ai.google.dev/gemini-api/docs/openai) |

OpenAI 新安装默认选用当前兼顾能力与成本的 Sol。六家地址和模型会由预设自动填入，用户不用选择协议或手填认证头。模型名称仍可编辑；需要第三方服务或不同协议时选择“自定义”，在折叠的高级设置中调整。

程序不发送 `temperature`，也不强制关闭思考模式。Kimi K3 的 token 字段与常见兼容服务不同，已由预设单独处理。GLM 与 Kimi 的推理内容、Claude thinking 和 OpenAI reasoning 均不会被当作最终工具决策。响应中的实际工具调用会被拒绝；本项目只接受自己的严格 JSON 决策结构。

OpenAI 使用 Responses 原生 input_image，并设置 store:false；Claude 使用 Messages 原生 base64 image/source、x-api-key 和版本头，不伪装成 OpenAI 接口。Claude 不发送 OpenAI 的 response_format，题目 JSON 由 Prompt 与本地严格 schema 校验控制。

当前版本保存一份当前模型连接与对应密钥，切换厂商/地址并保存后需要配置新厂商 Key。选预设但尚未保存时只是草稿，不会改变正在使用的连接，也不会把旧 Key 误显示为新厂商已配置。用户修改地址后直接粘贴 Key，会先保存新连接再导入密钥。

早期未设置 provider/protocol 的自定义配置按原 Chat Completions 协议迁移。只有旧出厂官方默认才升级为新默认，任务记录、用户预算和密钥文件保留。自定义模型、第三方端点和已明确选择的模型不会被擅自替换。
