import { useState, type FormEvent } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Settings2,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  defaultModelConfig,
  type AppState,
  type ModelConfig,
  type PublicModelConfig,
} from "../../shared/contracts";
import { applyProviderPreset, providerPresets } from "../../shared/providers";

type Props = {
  state: AppState;
  blocked: boolean;
  busy: string | null;
  run: (
    name: string,
    operation: () => Promise<AppState | string | void>,
  ) => Promise<void>;
};
const vendors = [
  ...providerPresets.map((preset) => ({
    id: preset.id as ModelConfig["provider"],
    label: preset.label,
  })),
  { id: "custom" as const, label: "自定义服务" },
];

function configOnly(model: PublicModelConfig | ModelConfig): ModelConfig {
  return {
    provider: model.provider,
    baseUrl: model.baseUrl,
    model: model.model,
    protocol: model.protocol,
    tokenParameter: model.tokenParameter,
    maxTokens: model.maxTokens,
    timeoutMs: model.timeoutMs,
    jsonMode: model.jsonMode,
  };
}
function sameEndpoint(a: ModelConfig, b: ModelConfig): boolean {
  return (
    a.provider === b.provider &&
    a.baseUrl.replace(/\/+$/, "") === b.baseUrl.replace(/\/+$/, "")
  );
}

export function ModelSettings({ state, blocked, busy, run }: Props) {
  const api = window.study!;
  const [selected, setSelected] = useState<ModelConfig["provider"]>(
    state.model.provider,
  );
  const [drafts, setDrafts] = useState<
    Partial<Record<ModelConfig["provider"], ModelConfig>>
  >({});
  const [feedback, setFeedback] = useState<{
    config: string;
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const profile = state.modelProfiles.find(
    (item) => item.provider === selected,
  );
  const config =
    drafts[selected] ??
    (profile
      ? configOnly(profile)
      : selected === "custom"
        ? {
            ...defaultModelConfig,
            provider: "custom",
            protocol: "chat_completions",
            tokenParameter: "max_tokens",
            model: "",
            baseUrl: "",
          }
        : applyProviderPreset(defaultModelConfig, selected));
  const signature = JSON.stringify(config);
  const dirty = !profile || signature !== JSON.stringify(configOnly(profile));
  const isCurrent =
    !dirty && signature === JSON.stringify(configOnly(state.model));
  const keyConfigured = !!profile?.hasKey && sameEndpoint(config, profile);
  const localService =
    /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(config.baseUrl);
  const lockedByTask = !["idle", "completed", "stopped", "error"].includes(
    state.agent.phase,
  );
  const disabled = blocked || lockedByTask;
  const vendor = vendors.find((item) => item.id === selected)!;
  const preset = providerPresets.find((item) => item.id === selected);
  const update = <K extends keyof ModelConfig>(
    key: K,
    value: ModelConfig[K],
  ) => {
    setDrafts((previous) => ({
      ...previous,
      [selected]: { ...config, [key]: value },
    }));
  };
  async function persist() {
    if (isCurrent) return configOnly(state.model);
    const saved = await api.saveModel(config);
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[selected];
      return next;
    });
    return configOnly(saved.model);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const test =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "test";
    void run(test ? "testModel" : "saveModel", async () => {
      const savedConfig = await persist();
      if (test) {
        setFeedback(null);
        try {
          const message = await api.testModel();
          setFeedback({
            config: JSON.stringify(savedConfig),
            kind: "success",
            message,
          });
        } catch (error) {
          setFeedback({
            config: JSON.stringify(savedConfig),
            kind: "error",
            message:
              error instanceof Error
                ? error.message.replace(
                    /^Error invoking remote method '[^']+': (?:Error: )?/,
                    "",
                  )
                : "连接失败，请重试。",
          });
        }
      }
    });
  }
  function importKey(source: "clipboard" | "file") {
    void run(source === "clipboard" ? "pasteKey" : "setKey", async () => {
      await persist();
      setFeedback(null);
      return source === "clipboard" ? api.pasteApiKey() : api.setApiKey();
    });
  }
  return (
    <div className="model-settings">
      <div className="model-active-summary">
        <span className="small-dot" />
        当前使用{" "}
        <strong>
          {vendors.find((item) => item.id === state.model.provider)?.label}
        </strong>
        <span className="model-active-name">{state.model.model}</span>
      </div>
      {lockedByTask && (
        <div className="model-task-notice" role="status">
          当前任务尚未结束。停止任务后可以修改模型配置。
        </div>
      )}
      <div className="model-layout">
        <nav className="model-vendors" aria-label="选择模型厂商">
          {vendors.map((item) => {
            const saved = state.modelProfiles.find(
              (profile) => profile.provider === item.id,
            );
            const active = state.model.provider === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`model-vendor ${selected === item.id ? "selected" : ""}`}
                aria-label={item.label}
                aria-pressed={selected === item.id}
                disabled={blocked}
                onClick={() => setSelected(item.id)}
              >
                <span
                  className={`vendor-symbol vendor-${item.id}`}
                  aria-hidden="true"
                >
                  {item.id === "custom"
                    ? "+"
                    : item.label.slice(0, item.id === "deepseek" ? 2 : 1)}
                </span>
                <span className="vendor-copy">
                  <strong>{item.label}</strong>
                  <span>{saved?.hasKey ? "已配置密钥" : "待配置"}</span>
                </span>
                {active && (
                  <Check
                    size={15}
                    className="vendor-active"
                    aria-label="当前使用"
                  />
                )}
              </button>
            );
          })}
          <p className="vendor-footnote">
            每家配置独立保存，切换后可随时回来。
          </p>
        </nav>
        <form className="panel model-editor" onSubmit={save}>
          <div className="model-editor-heading">
            <div>
              <h2>{vendor.label}</h2>
              <p>
                {preset
                  ? "已预填官方接口和视觉模型，添加密钥即可使用。"
                  : "连接支持图片输入的模型服务。"}
              </p>
            </div>
            {isCurrent && <span className="badge badge-teal">当前使用</span>}
          </div>
          <fieldset disabled={disabled} className="model-editor-fields">
            {selected === "custom" && (
              <label className="field">
                服务地址{" "}
                <span className="field-label-english">API Base URL</span>
                <input
                  required
                  type="url"
                  value={config.baseUrl}
                  onChange={(event) => update("baseUrl", event.target.value)}
                  placeholder="https://your-provider.com/v1"
                />
              </label>
            )}
            <label className="field">
              模型 <span className="field-label-english">Model Name</span>
              <input
                required
                value={config.model}
                onChange={(event) => update("model", event.target.value)}
                placeholder="输入支持图片的模型名称"
              />
            </label>
            <div className="model-key">
              <div className="model-key-title">
                <KeyRound size={15} />
                <strong>API Key</strong>
                <span
                  className={`key-status ${keyConfigured ? "configured" : ""}`}
                >
                  {keyConfigured ? "已配置" : "未配置"}
                </span>
              </div>
              <div className="model-key-value">
                <span>
                  {keyConfigured
                    ? "•••• •••• •••• ••••"
                    : "复制密钥，然后点击右侧按钮"}
                </span>
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => importKey("clipboard")}
                >
                  {keyConfigured ? "更换密钥" : "粘贴 API Key"}
                </button>
              </div>
              <p>
                {keyConfigured
                  ? profile?.keyStorage === "encrypted"
                    ? "已加密保存在本机。切换厂商时保留。"
                    : "当前密钥仅在本次应用运行期间有效。"
                  : "请使用当前服务商的 API 密钥。"}
              </p>
            </div>
            <details
              className="model-advanced"
              key={selected}
              open={selected === "custom" || undefined}
            >
              <summary>
                <Settings2 size={14} />
                更多设置
                <ChevronDown size={14} />
              </summary>
              <div className="model-advanced-content">
                {selected !== "custom" && (
                  <label className="field full">
                    服务地址{" "}
                    <span className="field-label-english">API Base URL</span>
                    <input
                      required
                      type="url"
                      value={config.baseUrl}
                      onChange={(event) =>
                        update("baseUrl", event.target.value)
                      }
                    />
                  </label>
                )}
                <label className="field">
                  接口协议
                  <select
                    value={config.protocol}
                    onChange={(event) =>
                      update(
                        "protocol",
                        event.target.value as ModelConfig["protocol"],
                      )
                    }
                  >
                    <option value="chat_completions">Chat Completions</option>
                    <option value="responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic Messages</option>
                  </select>
                </label>
                {config.protocol === "chat_completions" && (
                  <label className="field">
                    输出参数
                    <select
                      value={config.tokenParameter}
                      onChange={(event) =>
                        update(
                          "tokenParameter",
                          event.target.value as ModelConfig["tokenParameter"],
                        )
                      }
                    >
                      <option value="max_tokens">max_tokens</option>
                      <option value="max_completion_tokens">
                        max_completion_tokens
                      </option>
                    </select>
                  </label>
                )}
                <label className="field">
                  最大输出 Token
                  <input
                    type="number"
                    required
                    min={256}
                    max={16000}
                    step={1}
                    value={config.maxTokens}
                    onChange={(event) =>
                      update("maxTokens", Number(event.target.value))
                    }
                  />
                </label>
                <label className="field">
                  请求超时（秒）
                  <input
                    type="number"
                    required
                    min={5}
                    max={180}
                    value={config.timeoutMs / 1000}
                    onChange={(event) =>
                      update("timeoutMs", Number(event.target.value) * 1000)
                    }
                  />
                </label>
                {config.protocol !== "anthropic" && (
                  <label className="model-json-toggle">
                    <input
                      type="checkbox"
                      checked={config.jsonMode}
                      onChange={(event) =>
                        update("jsonMode", event.target.checked)
                      }
                    />
                    JSON 输出
                  </label>
                )}
                <div className="model-key-tools">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => importKey("file")}
                  >
                    从文件导入密钥
                  </button>
                  {keyConfigured && (
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() =>
                        run("clearKey", async () => {
                          await persist();
                          setFeedback(null);
                          return api.clearApiKey();
                        })
                      }
                    >
                      移除该服务的密钥
                    </button>
                  )}
                </div>
              </div>
            </details>
          </fieldset>
          {feedback?.config === signature && (
            <div
              className={`model-feedback ${feedback.kind}`}
              role={feedback.kind === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </div>
          )}
          <div className="model-editor-actions">
            <span>
              {dirty
                ? "修改尚未保存"
                : isCurrent
                  ? "已启用此配置"
                  : "可切换到此配置"}
            </span>
            <div>
              <button
                type="submit"
                value="test"
                className="button secondary"
                disabled={disabled || (!keyConfigured && !localService)}
              >
                {busy === "testModel" ? (
                  <LoaderCircle size={15} className="spinning" />
                ) : (
                  <Activity size={15} />
                )}
                测试连接
              </button>
              <button
                type="submit"
                value="save"
                className="button primary"
                disabled={disabled || isCurrent}
              >
                <Check size={15} />
                {isCurrent ? "正在使用" : dirty ? "保存并使用" : "使用此配置"}
              </button>
            </div>
          </div>
        </form>
      </div>
      <p className="model-privacy">
        <ShieldCheck size={14} />
        课程截图会发送至所选服务。连接测试只发送应用生成的随机图片。
      </p>
      <details className="panel connection-local">
        <summary>
          <FolderOpen size={16} />
          <span>本地数据与浏览器</span>
          <ChevronDown size={14} />
        </summary>
        <div className="connection-local-body">
          <div className="local-settings-row">
            <div>
              <strong>应用数据</strong>
              <p>任务、加密密钥和登录会话保存在本机。</p>
            </div>
            <button
              type="button"
              className="button secondary compact"
              disabled={blocked}
              onClick={() => run("dataFolder", () => api.openDataFolder())}
            >
              <FolderOpen size={14} />
              打开目录
            </button>
          </div>
          <div className="local-settings-row">
            <div>
              <strong>学习浏览器</strong>
              <p>{state.browserOpen ? "关闭后保留登录会话。" : "尚未打开。"}</p>
            </div>
            <button
              type="button"
              className="button secondary compact"
              disabled={disabled || !state.browserOpen}
              onClick={() => run("closeBrowser", () => api.closeBrowser())}
            >
              <Square size={14} />
              关闭浏览器
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
