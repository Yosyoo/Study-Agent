# 开发与构建

[返回应用首页](../README.md)

## 从源码运行

需要 Node.js **24 LTS**（最低 22.12）、npm 和 Git。下载或克隆本仓库后，在项目根目录运行：

```sh
npm ci
npm run browser:install
npm run dev
```

`browser:install` 下载 Playwright Chromium。`dev` 启动 Electron 和支持热更新的前端；仅在普通浏览器中打开前端页面无法使用桌面能力。

也可以运行构建后的界面：

```sh
npm run build
npm run preview
```

macOS 构建需要 Xcode Command Line Tools。Windows 请使用原生 Windows Node 环境和 PowerShell。


## 实现方式

```text
React 界面
   │ 固定方法白名单
Electron preload
   │ 校验后的 IPC
Electron 主进程
   ├── Agent Harness：状态、上下文、预算、确认和恢复
   ├── ModelProvider：多模态请求、协议适配和结构校验
   └── BrowserController：Playwright、截图、动作和视频检测
```

执行流程为：**观察 → 模型理解或确定性监测 → 用户确认 → 执行动作 → 重新观察验证**。正常播放的视频使用确定性代码监测，无需反复调用模型。

模型输出经过结构校验，仅能提出受限动作，无法执行任意 JavaScript、Shell 或文件操作。操作前检查截图时效与页面变化；低置信度、重复操作或无进展时转交用户。默认每任务最多 30 轮、12 次模型决策、2 小时实际运行时间（暂停和人工等待不计入），另设 24 小时总保留上限；网络重试有上限，不自动重复点击或输入。

```text
src/main/       主进程、浏览器、模型、Agent 和持久化
src/preload/    安全的桌面 API 桥接
src/renderer/   React 界面与本地视觉资源
src/shared/     共享类型、校验结构与模型预设
tests/          单元测试与浏览器集成测试
scripts/        桌面回归、视觉检查、图标生成与打包
docs/           架构、设计、模型配置和验收记录
```

详细职责和保护边界见 [架构说明](ARCHITECTURE.md)。这些措施降低错误操作和网页提示注入风险，不保证抵御所有恶意页面或页面竞态。


## 测试与验证

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:desktop
npm run test:visual
```

桌面与视觉检查前需完成构建并安装 Playwright Chromium。测试使用独立临时数据，不使用真实账号或调用付费模型。

截至 2026-10-23（0.1.1），本地验证结果：

| 检查 | 结果 |
| --- | --- |
| TypeScript 类型检查、生产构建 | 通过 |
| 单元测试 | 116 项通过 |
| 真实 Chromium 集成测试 | 24 项通过 |
| Electron 桌面配置与任务工作流 | 通过 |
| 视觉状态检查 | 26 个状态通过，覆盖 1440×940 和 1100×720 窗口 |
| macOS Apple Silicon 应用目录打包 | 通过；打包产物再次通过桌面与视觉检查 |

浏览器与模型闭环测试使用本地页面和脚本响应；视觉检查中的课程和题目为明确标识的测试资料。**这些结果不等于真实学习通适配或真实模型推理效果通过验收。** Windows 与 Intel Mac 尚未实测，仓库中的 CI 配置也不代表已经执行通过。

完整证据、依赖审计日期与已知问题见 [验收记录](VALIDATION.md)。


## 构建应用

```sh
npm run package      # 生成当前平台、当前架构的应用目录
npm run dist:mac     # 在 macOS 构建 DMG
npm run dist:win     # 在 Windows x64 构建 NSIS 安装包
```

产物位于 `release/`，包含 Chromium，不复制用户登录会话、任务记录或 API Key。必须分别在对应平台和架构上构建。

当前本地 macOS 应用未经正式签名或公证；macOS DMG 可以在本机构建；Windows 和 Intel Mac 安装包需在对应机器或 GitHub Actions 中生成并验证。签名、公证与自动更新仍待完善。


## 发布安装包

`.github/workflows/release.yml` 可手动构建三个目标平台并保存安装包附件。推送与 `package.json` 版本一致的 `v*` 标签时，全部平台成功后创建 **GitHub Release 草稿**，附上 DMG、EXE 和 SHA-256 校验文件；核对后再发布草稿。v0.1.0 的三个平台构建均已在 GitHub 成功执行；首次发布因已有公开 Release 而中止草稿上传。0.1.1 已将该情况改为保留 Actions 附件并正常退出，不覆盖公开附件。

本地安装包输出至 `release/`；该目录保持 Git 忽略，安装包通过 Releases 附件分发。

