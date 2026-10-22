# Study Agent

以 Electron、React、TypeScript、Tailwind CSS 和 Playwright 实现的在线学习桌面助手。第一阶段面向超星学习通网页版：用户手动登录，Agent 观察当前页面，根据原生多模态模型的截图理解提出建议，通过逐次确认执行浏览器操作，并重新观察验证结果。

这是一个可运行的受控 MVP。它包含真实浏览器、真实多模态 HTTP 请求、状态机、持久化、桌面界面和测试；没有独立后端、OCR 引擎或重型 Agent 框架。当前已在 **macOS Apple Silicon** 实机完成开发环境、真实 Chromium、本地模拟模型闭环及打包产物验证。**Windows、Intel Mac、学习通账号页面与真实模型推理质量尚不能仅凭这些测试视为通过**；详见 [验收记录](docs/VALIDATION.md)。

## 安装与启动

开发环境：Node.js **24 LTS**（最低 22.12，依赖要求现代 Node）、npm、Git。macOS 构建需要 Xcode Command Line Tools；Windows 使用原生 Windows Node 和 PowerShell，不通过 WSL 打包桌面程序。

```sh
git clone <your-repository-url>
cd Study-Agent
npm ci
npm run browser:install
npm run dev
```

现有本地工程可以直接使用：

```sh
cd /Users/ylvsfver/Code/Study-Agent
npm run dev
```

第一次运行 Electron 可能下载其运行时；Playwright 的 Chromium 由 `browser:install` 显式下载。开发模式包含界面热更新；也可以 `npm run build` 后执行 `npm run preview`。仅用浏览器打开 Vite 页面会显示“需要桌面应用”，不能调用主进程能力。

## 第一次使用

1. 打开“模型与设置”，在左侧选择 DeepSeek、Kimi、GLM、OpenAI、Claude 或 Gemini。默认只需要核对模型、添加 API Key；地址和协议预填在“更多设置”中。自定义服务可手动填写。
2. 复制该厂商的 Key，点击“粘贴 API Key”，应用会保存并启用该配置。**主进程直接读取系统剪贴板**，Key 不经过 React。文件导入位于“更多设置”中。操作系统加密不可用时，界面会提示密钥仅在本次运行有效。
3. 点击“测试连接”。应用生成随机排列的三个色块，要求模型读图返回顺序；答案不放在请求文字里，回复不匹配会判定失败。该测试可以发现接口忽略图片等问题，**仍不能证明课程题目的识别准确性**。修改模型后直接测试，会先保存所见配置。
4. 打开学习浏览器，手动登录学习通、完成平台验证，进入课程、视频或章节练习。浏览器独立于日常浏览器，登录会话在后续运行中尽可能复用，失效时需要重新登录。
5. 新建任务，填写名称、课程 URL 和具体目标。可点击“使用当前浏览器页面”读取当前地址和标题，避免复制错误。
6. 点击“开始任务”会进入该任务保存的 URL；相同 URL 已打开时保留当前页面。暂停后的“恢复”继续观察当前页面。启动加载期间也可停止，取消后不会继续调用模型或执行操作。
7. 观察截图、状态和日志。点击、输入、按键、导航均需逐次批准。题目建议只展示并要求核对，不会自动填入或提交；如需操作答案，由用户在浏览器中完成。
8. 视频由用户正常开始播放。Agent 每两秒读取播放器状态，发现暂停、卡顿、网络/媒体异常或结束后需要核对的完成状态时请求接管。恢复前手动处理问题；恢复会重新截图，旧确认失效。

暂停停止 Agent 后续操作，浏览器可以由用户接管；已经派发给浏览器的单个动作不能撤回。停止保留浏览器供手动使用，设置页可关闭浏览器。关闭正在运行的应用会提示停止；重启后不会自动重放旧任务或确认。

运行 AI 任务会向用户配置的服务商发送当前视口截图和有限页面元数据。请先完成登录，不要在密码、验证码或敏感个人信息页面启动分析。学习通登录页面的可见密码框会被确定性检测并转为人工处理。

## 模型配置与凭据

内置六家原生视觉模型预设，核验日期为 **2026-10-22**。新安装默认使用 OpenAI `gpt-6.1-sol`。支持实际的 Chat Completions、OpenAI Responses 与 Anthropic Messages 协议，各自使用对应的图像格式、认证头和响应解析。

| 厂商 | 默认模型 | 协议 |
| --- | --- | --- |
| DeepSeek | `deepseek-flash` | Chat Completions |
| Kimi | `kimi-k3` | Chat Completions |
| GLM | `glm-5.3-flash` | Chat Completions |
| OpenAI | `gpt-6.1-sol` | Responses |
| Claude | `claude-sonnet-5-5` | Anthropic Messages |
| Gemini | `gemini-3.8-flash` | 官方 OpenAI 兼容接口 |

模型名称仍可编辑，实际可用性取决于账户权限。地址、参数差异和官方来源见 [模型预设说明](docs/MODEL_PRESETS.md)。每家厂商分别保留一份配置，切换后可恢复自选模型和密钥。点击厂商仅切换编辑对象；“保存并使用”或“使用此配置”才改变当前连接。密钥按厂商与规范化服务地址隔离，不会发送给另一个地址。

开发时可复制 `.env.example` 为 `.env`，仅由主进程读取：

```dotenv
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-6.1-sol
MODEL_PROVIDER=openai
MODEL_PROTOCOL=responses
MODEL_API_KEY=
```

不要使用 `VITE_` 前缀放置密钥，不要提交 `.env`。图形界面不会读回 Key，只返回“是否存在”和加密方式。更改 Base URL 后使用新地址自己的密钥，旧密钥继续保留；切回原地址会恢复它。环境变量覆盖也使用同样的隔离范围。API 仅允许 HTTPS，明确的本机地址可用 HTTP 和空 Key，适合本地多模态服务。默认拒绝 API HTTP 重定向，避免将凭据转发到其他地址。

任务、最近 200 条脱敏日志、模型非敏感配置保存于 Electron `userData/state.json`；密钥按连接范围保存于 `keys/<scope-hash>.bin`，由 Electron `safeStorage` 使用系统保护；登录会话保存在 `browser-profile/`。截图和完整模型回答不会自动落盘。持久化采用有序写入与临时文件原子替换，损坏或未知版本状态会尝试保留备份并显示恢复提示。早期本地版本的温度字段会无损迁移并移除，不会因此重置现有地址、任务或密钥。旧版 `model-key.bin` 只有在能读取其原始配置时才迁移；缺失或损坏配置时不会把旧密钥绑定到默认厂商。应用设置页可以打开数据目录。可通过绝对路径环境变量 `STUDY_AGENT_DATA_DIR` 使用独立资料目录。

## 架构和目录

```text
Study-Agent/
├── src/
│   ├── main/
│   │   ├── index.ts                 # Electron 生命周期、受控 IPC、服务组装
│   │   ├── security.ts              # IPC URL 校验、日志脱敏、密钥输入检查
│   │   ├── store.ts                 # 原子 JSON 状态与系统加密密钥
│   │   ├── browser/
│   │   │   ├── controller.ts        # Playwright、截图、iframe、受控动作
│   │   │   ├── policy.ts            # 平台域名边界、截图坐标映射
│   │   │   └── video-monitor.ts     # 确定性视频状态检测
│   │   ├── model/provider.ts        # ModelProvider、多模态 HTTP 与 Prompt
│   │   ├── model/vision-probe.ts    # 无依赖的随机 PNG 视觉连接测试
│   │   └── agent/harness.ts         # 串行状态机、预算、确认、恢复、结果验证
│   ├── preload/index.ts            # contextBridge 的固定方法白名单
│   ├── shared/contracts.ts         # 共享类型、Zod 决策与 IPC 输入结构
│   ├── shared/providers.ts         # 六家视觉预设与官方文档/核验日期
│   └── renderer/
│       ├── index.html              # CSP
│       └── src/                    # App.tsx 工作台；ModelSettings.tsx 独立配置界面
├── tests/                          # 单元和真实浏览器集成测试
├── scripts/                        # 桌面测试、浏览器运行时准备、原生打包
├── docs/                           # 架构、安全边界和验收状态
├── .github/workflows/ci.yml         # Windows/macOS 验证流程（需推送后执行）
├── .env.example
└── package.json
```

主进程中，`BrowserPort` 执行动作并返回观察，`ModelProvider` 读取截图并返回经过验证的决策，`AgentHarness` 管理状态、上下文和工具执行。React 只调用 `StudyAPI`，无法访问 Node、IPC 原始通道、浏览器 profile 或密钥。隔离设置遵循 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security/)，持久化浏览器使用 [Playwright persistent context](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)。更多职责与流程见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 已实现的功能与边界

- Electron + React + TypeScript + Tailwind 工程，工作台、任务新增/删除、实时状态、截图、播放器状态、题目分析、日志、模型设置。
- Playwright 独立持久会话；手动登录复用；截图、导航、归一化坐标点击、输入、有限按键、滚动、等待；iframe 观察和操作定位。
- 截图直接进入原生多模态 API；单选、多选、判断、填空的结构化建议与解析；严格输出校验，低置信度人工核对。
- 状态机闭环：观察 → 模型理解/确定性监测 → 用户确认 → 单次执行 → 新截图验证；上下文限最近 8 条执行摘要。
- 逐次确认、暂停、恢复、停止；AbortSignal 与代际检查丢弃失效结果；重复动作和无进展终止；有界重试与运行预算。
- 真实播放器时间、总时长、暂停/结束、缓冲、停滞、媒体错误；只读取状态，不快进、改倍速或改平台记录。
- 基于 URL、导航语义和播放器/表单结构的保守页面识别；未可靠识别时重新观察或人工接管。
- 与当前播放器对应的显式平台完成标记读取；未知仍记未知。**学习通完成标记和页面适配规则仍需实站校准。**
- 操作前检查观察 ID、URL、滚动、焦点与内部布局指纹；超过 30 秒的截图需重新截图并同时比对控件和图像，超过 5 分钟拒绝；CSS 像素截图避免 Retina 缩放坐标混淆。
- 模型没有任意 JavaScript、shell、任意选择器、文件读写或凭据工具。提交、支付、文件选择、平台验证和常见视频进度/倍速控件由确定性代码拒绝，留给用户处理。

第一版不含课程批量自动导入、无人值守全课程排程、自动填写/交卷、系统级桌面控制、跨设备同步、自动更新和正式签名发布。完成一次辅助分析不等于完成学习通任务点；平台状态只能根据明确证据记录，不能从播放结束或模型判断中推定。

## 默认执行限制

| 项目 | 默认值 |
| --- | --- |
| 任务操作/观察轮数 | 30 |
| 模型决策次数 | 12（单次至多 3 个 HTTP 尝试，总计至多 36 次） |
| 墙钟运行时间 | 2 小时，包含暂停和等待确认 |
| 模型整体超时 | 新安装 90 秒，包含重试，可设 5–180 秒；已有用户配置保留 |
| 视频采样 | 2 秒；连续 15 秒不推进请求接管 |
| 确认截图时效 | 30 秒后必须重新截图核验控件与像素一致；硬上限 5 分钟 |
| 连续无进展 | 两次即接管 |
| 同页面相同动作 | 第三次建议时阻断执行 |

视频正常播放时不重复请求模型，也不要求 API Key。可见练习与视频共存时优先分析练习。网络重试仅适用于模型 429/5xx/传输异常以及可重复的观察/GET 导航；不自动重复点击或输入，因为超时的动作可能已经发生。

## 检查与测试

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:desktop
npm run test:visual
```

`npm test` 测试模型输出、重试、取消、预算、状态机、视频分类、域名和坐标边界、持久化与日志脱敏。`test:browser` 启动真实 headless Chromium，使用本地页面和明确模拟的 HTTP 模型响应，验证截图→模型请求→确认→真实点击/导航→新截图→答案核对。它还验证 iframe 视频真实时间推进、敏感控件拒绝、隐藏播放器过滤及过期截图保护。**这些测试不能验证真实模型的视觉推理质量。**

`test:desktop` 包含界面和工作流两个脚本：验证 preload 隔离、任务增删、六家配置与密钥切换/恢复、最小窗口布局，以及通过真实本地 HTTP 服务验证读图挑战、401 错误、旧密钥迁移和重启恢复。开发版还验证任务地址、加载中停止和无 Key 视频监测。使用独立临时 profile 与端口 4178；不会使用真实账号或调用付费端点。构建后的应用可指定 `STUDY_AGENT_SMOKE_EXECUTABLE` 运行；本地课程 fixture 分支替换为打包版禁用该调试入口的验证。截图保存于 `.local/desktop-*.png`。

`test:visual` 在真实 Electron 的独立测试配置中检查 24 个界面状态，截图与检查清单保存在 `.local/ui-review/`。它覆盖首页、六家模型、任务列表、视频状态、题目确认、错误提示、截图放大和最小窗口，并验证导航滚动复位、弹窗焦点返回、背景不可交互、图片加载和横向溢出。展示数据是明确标识的本地视觉测试资料；不访问真实平台，不调用模型，也不写入用户配置。运行前需要 `npm run build` 和已安装的 Playwright Chromium。

界面采用浅色导航和学习蓝强调色，模型页只展开常用设置；浏览器截图与题目来源图均可放大并切换原始尺寸。视觉约定和设计自审见 [UI-DESIGN.md](docs/UI-DESIGN.md)。本地厂商标识来自 [Lobe Icons](https://github.com/lobehub/lobe-icons)，MIT 许可随构建输出保存在 `out/renderer/licenses/lobe-icons.txt`。

应用图标源文件为 `build/icon.svg`；修改后运行 `npm run icons:generate`，由本地 Chromium 生成 `build/icon.png`。打包工具将 PNG 转为目标平台图标。

## 打包与分发

```sh
npm run package      # 本机平台/架构，生成可运行目录，包含 Chromium
npm run dist:mac     # 在 macOS 构建原生架构 DMG
npm run dist:win     # 在 Windows x64 构建 NSIS 安装包
```

打包先将已安装的 Chromium 发行文件复制到忽略 Git 的 `.local/browser-runtime`，附上平台、架构和相对可执行路径清单，然后复制为应用资源。**不复制用户的浏览器 profile、模型 Key 或任务记录。** 已打包应用从资源目录启动浏览器，不依赖开发者缓存。为避免错误的浏览器架构混入产物，脚本只接受本机平台与架构：分别在 macOS arm64、macOS x64、Windows x64 构建。

当前本机产物为 `release/mac-arm64/Study Agent.app`。本地构建默认不自动寻找签名身份；现有产物未经正式代码签名或公证，也没有 Windows 签名。公开分发前需要准备图标、证书、签名/公证与对应平台验收，不要将当前本地包称为已发布的跨平台正式版本。

安全审计与实测结果以 [VALIDATION.md](docs/VALIDATION.md) 为准。当前生产依赖审计为零告警；开发期打包依赖保留了一个未获上游兼容修复的 `sprintf-js` 问题传播出的 8 条中危记录，未使用强制降级来掩盖它。

本轮问题复审、复现条件、修复与限制见 [REVIEW-2026-10-22.md](docs/REVIEW-2026-10-22.md)。
