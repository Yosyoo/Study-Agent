import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Eye,
  Expand,
  FileQuestion,
  LayoutDashboard,
  LoaderCircle,
  Monitor,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Video,
  X,
  AlertCircle,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import {
  defaultModelConfig,
  initialAgent,
  type AppState,
  type AgentPhase,
  type BrowserAction,
  type Observation,
  type QuestionAnalysis,
  type StudyTask,
  type VideoState,
} from "../../shared/contracts";
import { ModelSettings } from "./ModelSettings";
import { ProviderIcon, StudyIllustration, StudyMark } from "./Visuals";

type View = "dashboard" | "tasks" | "analysis" | "activity" | "settings";
const phaseLabels: Record<AgentPhase, string> = {
  idle: "待命",
  observing: "观察页面",
  thinking: "AI 正在理解",
  awaiting_confirmation: "等待确认",
  executing: "执行操作",
  verifying: "验证结果",
  monitoring: "监测视频",
  paused: "已暂停",
  needs_user: "需要接管",
  completed: "已完成",
  stopped: "已停止",
  error: "发生异常",
};
const taskLabels: Record<StudyTask["status"], string> = {
  pending: "待开始",
  running: "进行中",
  paused: "已暂停",
  needs_user: "需要处理",
  completed: "已完成",
  stopped: "已停止",
  error: "异常",
};
const pageLabels: Record<Observation["pageType"], string> = {
  login: "登录页面",
  courses: "课程列表",
  chapters: "课程章节",
  video: "视频任务",
  exercise: "章节练习",
  unknown: "待识别页面",
};
const videoLabels: Record<VideoState["status"], string> = {
  playing: "正常播放",
  paused: "已暂停",
  buffering: "正在缓冲",
  stalled: "播放卡顿",
  error: "播放异常",
  ended: "播放结束",
};
const fallback: AppState = {
  tasks: [],
  agent: initialAgent,
  logs: [],
  model: { ...defaultModelConfig, hasKey: false, keyStorage: "none" },
  browserOpen: false,
  modelProfiles: [],
  version: "0.1.0",
};
const activePhases: AgentPhase[] = [
  "observing",
  "thinking",
  "awaiting_confirmation",
  "executing",
  "verifying",
  "monitoring",
];
const navItems: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "学习工作台", icon: LayoutDashboard },
  { id: "tasks", label: "课程与任务", icon: BookOpen },
  { id: "analysis", label: "AI 题目分析", icon: FileQuestion },
  { id: "activity", label: "运行日志", icon: Terminal },
];

function time(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "--:--";
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(value % 60)
    .toString()
    .padStart(2, "0")}`;
}
function stamp(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}
function displayUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}
function IconButton({
  label,
  children,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function ActionDescription({ action }: { action: BrowserAction }) {
  const descriptions: Record<BrowserAction["type"], string> = {
    click: "点击页面",
    type: "输入文本",
    press: "按下按键",
    scroll: "滚动页面",
    navigate: "前往页面",
    wait: "等待加载",
  };
  return (
    <div className="action-description">
      <MousePointer2 size={16} />
      <strong>{descriptions[action.type]}</strong>
      <code>
        {action.type === "click"
          ? `x ${action.x} · y ${action.y} / 1000`
          : action.type === "type"
            ? action.text
            : action.type === "press"
              ? action.key
              : action.type === "navigate"
                ? displayUrl(action.url)
                : action.type === "scroll"
                  ? `${action.deltaY}px`
                  : `${action.ms}ms`}
      </code>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(fallback);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [taskModal, setTaskModal] = useState(false);
  const [browserModal, setBrowserModal] = useState(false);
  const [preview, setPreview] = useState<Observation | null>(null);
  const modalOpener = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(Date.now());
  const main = useRef<HTMLElement>(null);
  const api = window.study;
  const desktop = Boolean(api);
  const agent = state.agent;
  const active = activePhases.includes(agent.phase);
  const currentTask = state.tasks.find((t) => t.id === agent.taskId);
  const selected =
    (active || agent.phase === "paused" || agent.phase === "needs_user"
      ? currentTask
      : undefined) ??
    state.tasks.find((t) => t.id === selectedId) ??
    state.tasks[0];
  const pending = agent.pending;
  const modalOpen = taskModal || browserModal || Boolean(preview);

  function openDialog(
    kind: "task" | "browser" | "preview",
    observation?: Observation,
  ) {
    modalOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setError(null);
    if (kind === "task") setTaskModal(true);
    else if (kind === "browser") setBrowserModal(true);
    else if (observation) setPreview(observation);
  }

  useEffect(() => {
    if (!modalOpen && modalOpener.current?.isConnected) {
      modalOpener.current.focus();
      modalOpener.current = null;
    }
  }, [modalOpen]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const unsubscribe = api.subscribe((next) => {
      if (alive) setState(next);
    });
    api
      .getState()
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((err) => {
        if (alive) setError(String(err.message ?? err));
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run(
    name: string,
    operation: () => Promise<AppState | string | void>,
  ) {
    if (!desktop || busy) return;
    setBusy(name);
    setError(null);
    try {
      const result = await operation();
      if (typeof result === "string") setNotice(result);
      else if (result) setState(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  // Pause and stop stay available while a confirmed action is being awaited.
  async function interrupt(operation: () => Promise<AppState>) {
    if (!desktop) return;
    try {
      setState(await operation());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  const blocked = !desktop || Boolean(busy);
  const completed = state.tasks.filter((t) => t.status === "completed").length;
  const elapsed = agent.startedAt
    ? Math.max(0, Math.round(((agent.endedAt ?? now) - agent.startedAt) / 1000))
    : 0;
  const heading = {
    dashboard: ["学习工作台", "打开课程，开始今天的学习。"],
    tasks: ["课程与任务", "管理课程页面与每次学习的具体目标。"],
    analysis: ["AI 题目分析", "对照原题，阅读思路，确认你的判断。"],
    activity: ["运行日志", "查看页面观察、操作结果和需要处理的问题。"],
    settings: ["模型与设置", "选择服务商，连接你的 AI。"],
  }[view];

  return (
    <div className="app-shell">
      <aside className="sidebar" inert={modalOpen}>
        <div className="brand">
          <StudyMark />
          <span>Study Agent</span>
        </div>
        <div className="workspace-label">我的学习空间</div>
        <nav aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "analysis" && pending && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-model"
            onClick={() => setView("settings")}
            aria-label="查看当前模型配置"
          >
            <ProviderIcon provider={state.model.provider} />
            <span>
              <strong title={state.model.model}>{state.model.model}</strong>
              <small>
                {state.model.hasKey ? "当前使用的模型" : "尚未添加密钥"}
              </small>
            </span>
            <ChevronRight size={14} />
          </button>
          <button
            className={`nav-item ${view === "settings" ? "selected" : ""}`}
            aria-label="模型与设置"
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            <Settings2 size={18} />
            <span>模型与设置</span>
            {!state.model.hasKey && <span className="setup-dot" />}
          </button>
          <div className="sidebar-footer">
            <ShieldCheck size={14} />
            <span>数据保存在本机</span>
            <span>v{state.version}</span>
          </div>
        </div>
      </aside>
      <main ref={main} className="main-shell" inert={modalOpen}>
        <header className="topbar">
          <div className="platform-context">
            <span className="platform-logo">学</span>
            <span>超星学习通</span>
            <span className="platform-edition">网页版</span>
          </div>
          <div className="topbar-right">
            {view !== "dashboard" &&
              currentTask &&
              (active ||
                agent.phase === "paused" ||
                agent.phase === "needs_user") && (
                <>
                  <Badge
                    tone={
                      agent.phase === "awaiting_confirmation" ||
                      agent.phase === "needs_user"
                        ? "amber"
                        : "blue"
                    }
                  >
                    {phaseLabels[agent.phase]}
                  </Badge>
                  <IconButton
                    label={active ? "暂停当前任务" : "恢复当前任务"}
                    disabled={!desktop}
                    onClick={() =>
                      active
                        ? interrupt(() => api!.pause())
                        : run("resume", () => api!.resume())
                    }
                  >
                    {active ? <Pause size={14} /> : <Play size={14} />}
                  </IconButton>
                  <IconButton
                    label="停止当前任务"
                    disabled={!desktop}
                    onClick={() => interrupt(() => api!.stop())}
                  >
                    <Square size={14} />
                  </IconButton>
                  <span className="topbar-divider" />
                </>
              )}
            <span
              className={`connection-dot ${state.browserOpen ? "connected" : ""}`}
            />
            {state.browserOpen ? "浏览器已连接" : "浏览器未连接"}
          </div>
        </header>
        <div className={`page-content page-${view}`}>
          {!desktop && (
            <div className="banner warning">
              <Monitor size={18} />
              <div>
                <strong>请在 Study Agent 桌面应用中使用</strong>
                <p>
                  当前为界面预览，浏览器自动化与模型连接需要 Electron
                  主进程。请运行 npm run dev 启动桌面应用。
                </p>
              </div>
            </div>
          )}
          {error && !modalOpen && (
            <div className="banner error" role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>操作未完成</strong>
                <p>{error}</p>
              </div>
              <IconButton label="关闭错误" onClick={() => setError(null)}>
                <X size={15} />
              </IconButton>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
              <IconButton label="关闭提示" onClick={() => setNotice(null)}>
                <X size={15} />
              </IconButton>
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>{heading[0]}</h1>
              <p>{heading[1]}</p>
            </div>
            <div className="heading-actions">
              {view === "dashboard" && (
                <button
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => openDialog("browser")}
                >
                  <ExternalLink size={16} />
                  {state.browserOpen ? "前往学习页面" : "打开学习浏览器"}
                </button>
              )}
              {(view === "dashboard" || view === "tasks") && (
                <button
                  className="button primary"
                  disabled={blocked}
                  onClick={() => openDialog("task")}
                >
                  <Plus size={16} />
                  新建任务
                </button>
              )}
            </div>
          </div>

          {view === "dashboard" && (
            <>
              {!!state.tasks.length && (
                <TaskControl
                  selected={selected}
                  agentPhase={agent.phase}
                  active={active}
                  tasks={state.tasks}
                  blocked={blocked}
                  controlsBlocked={!desktop}
                  busy={busy}
                  select={setSelectedId}
                  start={() =>
                    selected && run("start", () => api!.start(selected.id))
                  }
                  pause={() => interrupt(() => api!.pause())}
                  resume={() => run("resume", () => api!.resume())}
                  stop={() => interrupt(() => api!.stop())}
                  add={() => openDialog("task")}
                />
              )}
              <div className="dashboard-grid">
                <section className="panel observation-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Eye size={17} />
                      <h2>浏览器观察</h2>
                      {agent.observation && (
                        <Badge>{pageLabels[agent.observation.pageType]}</Badge>
                      )}
                    </div>
                    <button
                      className="text-button"
                      disabled={blocked || !state.browserOpen || active}
                      onClick={() => run("observe", () => api!.observe())}
                    >
                      <RefreshCw
                        size={14}
                        className={busy === "observe" ? "spinning" : ""}
                      />
                      重新观察
                    </button>
                  </div>
                  <ObservationView
                    browserOpen={state.browserOpen}
                    observation={agent.observation}
                    now={now}
                    open={() => openDialog("browser")}
                    blocked={blocked}
                    preview={() =>
                      agent.observation &&
                      openDialog("preview", agent.observation)
                    }
                  />
                </section>
                <aside className="right-stack">
                  {!state.tasks.length && (
                    <section className="getting-started">
                      <div className="setup-heading">
                        <h2>准备开始</h2>
                        <span>
                          {Number(state.model.hasKey) +
                            Number(state.browserOpen)}{" "}
                          / 3
                        </span>
                      </div>
                      <p>只需三步，开启学习辅助。</p>
                      <div className="getting-started-actions">
                        <button
                          disabled={blocked}
                          onClick={() => setView("settings")}
                        >
                          <span
                            className={
                              state.model.hasKey
                                ? "step-marker done"
                                : "step-marker"
                            }
                          >
                            {state.model.hasKey ? <Check size={14} /> : "1"}
                          </span>
                          <span className="setup-copy">
                            <strong>
                              {state.model.hasKey
                                ? "模型已配置"
                                : "连接 AI 模型"}
                            </strong>
                            <small>选择服务商，添加密钥</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                        <button
                          disabled={blocked}
                          onClick={() => openDialog("browser")}
                        >
                          <span
                            className={
                              state.browserOpen
                                ? "step-marker done"
                                : "step-marker"
                            }
                          >
                            {state.browserOpen ? <Check size={14} /> : "2"}
                          </span>
                          <span className="setup-copy">
                            <strong>
                              {state.browserOpen
                                ? "浏览器已打开"
                                : "登录学习通"}
                            </strong>
                            <small>在学习浏览器中手动登录</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                        <button
                          disabled={blocked}
                          onClick={() => openDialog("task")}
                        >
                          <span className="step-marker">3</span>
                          <span className="setup-copy">
                            <strong>创建学习任务</strong>
                            <small>添加课程，设定本次目标</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </section>
                  )}
                  <section className="panel agent-panel">
                    <div className="panel-header">
                      <div className="panel-title">
                        <Bot size={17} />
                        <h2>学习助手</h2>
                      </div>
                      <span className={`status-dot ${active ? "live" : ""}`} />
                    </div>
                    <div className="agent-body">
                      <div
                        className={`agent-status ${agent.phase === "error" ? "danger" : ""}`}
                      >
                        {active && agent.phase !== "awaiting_confirmation" ? (
                          <LoaderCircle size={19} className="spinning" />
                        ) : agent.phase === "needs_user" || pending ? (
                          <CircleHelp size={19} />
                        ) : (
                          <Bot size={19} />
                        )}
                        <strong>{phaseLabels[agent.phase]}</strong>
                      </div>
                      <p className="agent-message">{agent.message}</p>
                      {!!state.tasks.length && (
                        <>
                          <div
                            className="execution-track"
                            aria-label="执行流程"
                          >
                            {["观察", "理解", "操作", "验证"].map(
                              (label, i) => (
                                <span
                                  key={label}
                                  className={
                                    [
                                      "observing",
                                      "thinking",
                                      "executing",
                                      "verifying",
                                    ][i] === agent.phase
                                      ? "current"
                                      : ""
                                  }
                                >
                                  <span />
                                  {label}
                                </span>
                              ),
                            )}
                          </div>
                          <div className="agent-metrics">
                            <div>
                              <strong>{agent.step}</strong>
                              <span>执行步骤</span>
                            </div>
                            <div>
                              <strong>{agent.modelCalls}</strong>
                              <span>模型调用</span>
                            </div>
                            <div>
                              <strong>{time(elapsed)}</strong>
                              <span>运行时长</span>
                            </div>
                          </div>
                        </>
                      )}
                      {pending && (
                        <button
                          className="button soft full-width"
                          onClick={() => setView("analysis")}
                        >
                          <CircleHelp size={16} />
                          查看并确认 <ArrowRight size={15} />
                        </button>
                      )}
                      {(agent.phase === "needs_user" ||
                        agent.phase === "paused") && (
                        <p className="helper-text">
                          在浏览器中完成登录、验证或调整页面后，点击“恢复”重新观察。
                        </p>
                      )}
                    </div>
                  </section>
                  {(state.tasks.length > 0 || agent.observation) && (
                    <section className="panel video-panel">
                      <div className="panel-header">
                        <div className="panel-title">
                          <Video size={17} />
                          <h2>视频监测</h2>
                        </div>
                        <Badge tone={agent.videos.length ? "teal" : "neutral"}>
                          {agent.videos.length} 个播放器
                        </Badge>
                      </div>
                      <VideoMonitor
                        videos={agent.videos}
                        completion={agent.observation?.completion}
                      />
                    </section>
                  )}
                  <p className="session-note">
                    <ShieldCheck size={14} />
                    点击、输入和跳转前由你确认
                  </p>
                </aside>
              </div>
              {state.logs.length > 0 && (
                <section className="panel recent-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Terminal size={16} />
                      <h2>最近动态</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setView("activity")}
                    >
                      全部日志 <ArrowRight size={13} />
                    </button>
                  </div>
                  <div className="recent-logs">
                    {state.logs
                      .slice(-3)
                      .reverse()
                      .map((log) => (
                        <div className="recent-log" key={log.id}>
                          <span className={`log-indicator ${log.level}`} />
                          <span>{log.message}</span>
                          <time>{stamp(log.at)}</time>
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}

          {view === "tasks" && (
            <section className="panel tasks-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <BookOpen size={17} />
                  <h2>全部任务</h2>
                  <Badge>{state.tasks.length}</Badge>
                </div>
                <span className="subtle">{completed} 个已完成</span>
              </div>
              {state.tasks.length ? (
                <div className="task-list">
                  {state.tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`task-row ${selected?.id === task.id ? "task-selected" : ""}`}
                    >
                      <div className="task-row-icon">
                        <BookOpen size={20} />
                      </div>
                      <button
                        className="task-row-content"
                        onClick={() => {
                          setSelectedId(task.id);
                          setView("dashboard");
                        }}
                      >
                        <strong>{task.name}</strong>
                        <p>{task.goal}</p>
                        <span>{displayUrl(task.url)}</span>
                      </button>
                      <Badge
                        tone={
                          task.status === "completed"
                            ? "teal"
                            : task.status === "running"
                              ? "blue"
                              : task.status === "error"
                                ? "red"
                                : task.status === "needs_user"
                                  ? "amber"
                                  : "neutral"
                        }
                      >
                        {taskLabels[task.status]}
                      </Badge>
                      <IconButton
                        label={`打开 ${task.name}`}
                        onClick={() =>
                          run("open", () => api!.openBrowser(task.url))
                        }
                        disabled={blocked || active}
                      >
                        <ExternalLink size={16} />
                      </IconButton>
                      <IconButton
                        label={`删除 ${task.name}`}
                        className="danger-hover"
                        onClick={() =>
                          run("delete", () => api!.deleteTask(task.id))
                        }
                        disabled={
                          blocked ||
                          (task.id === agent.taskId &&
                            (active ||
                              agent.phase === "paused" ||
                              agent.phase === "needs_user"))
                        }
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={BookOpen}
                  title="创建你的第一个学习任务"
                  description="添加课程或章节地址，说明这次希望 Agent 帮你完成的学习目标。"
                  action={
                    <button
                      className="button primary"
                      disabled={blocked}
                      onClick={() => openDialog("task")}
                    >
                      <Plus size={16} />
                      新建任务
                    </button>
                  }
                />
              )}
            </section>
          )}

          {view === "analysis" && (
            <div className="analysis-layout">
              <div className="analysis-main">
                {pending && (
                  <section className="panel confirmation-panel">
                    <div className="confirmation-heading">
                      <span className="confirmation-icon">
                        <ShieldCheck size={22} />
                      </span>
                      <div>
                        <h2>
                          {pending.kind === "answers"
                            ? "请核对题目与答案建议"
                            : "一项操作等待你的确认"}
                        </h2>
                      </div>
                      <Badge tone="amber">等待确认</Badge>
                    </div>
                    <p>{pending.explanation}</p>
                    {pending.action && (
                      <ActionDescription action={pending.action} />
                    )}
                    <div className="confirmation-note">
                      <AlertTriangle size={15} />
                      {pending.kind === "answers"
                        ? "答案由 AI 根据截图生成，可能存在识别或推理偏差。确认仅记录核对结果，不会自动填写或提交。"
                        : "确认仅授权本次操作。执行前将检查观察是否仍然有效，页面变化时需要重新观察。"}
                    </div>
                    <div className="confirmation-actions">
                      <button
                        className="button secondary"
                        disabled={blocked}
                        onClick={() =>
                          run("reject", () => api!.confirm(pending.id, false))
                        }
                      >
                        <X size={15} />
                        拒绝并接管
                      </button>
                      <button
                        className="button primary"
                        disabled={blocked}
                        onClick={() =>
                          run("confirm", () => api!.confirm(pending.id, true))
                        }
                      >
                        <Check size={16} />
                        {pending.kind === "answers"
                          ? "已核对建议"
                          : "批准一次操作"}
                      </button>
                    </div>
                  </section>
                )}
                {(pending?.questions ?? agent.decision?.questions ?? []).map(
                  (question, i) => (
                    <QuestionCard
                      key={`${agent.observation?.id}-${i}`}
                      question={question}
                      index={i}
                    />
                  ),
                )}
                {!pending && !agent.decision?.questions.length && (
                  <section className="panel">
                    <Empty
                      icon={FileQuestion}
                      title="让 AI 阅读当前练习截图"
                      description="打开章节练习并创建分析任务。AI 会阅读页面截图，给出答案建议与解析。"
                      action={
                        <button
                          className="button secondary"
                          disabled={blocked}
                          onClick={() => openDialog("task")}
                        >
                          <Plus size={16} />
                          创建分析任务
                        </button>
                      }
                    />
                  </section>
                )}
                {agent.decision && (
                  <div className="analysis-summary">
                    <Bot size={17} />
                    <div>
                      <strong>模型观察</strong>
                      <p>{agent.decision.summary}</p>
                    </div>
                  </div>
                )}
              </div>
              <aside className="analysis-aside">
                <section className="panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Eye size={17} />
                      <h2>分析来源</h2>
                    </div>
                  </div>
                  {agent.observation ? (
                    <div className="source-preview">
                      <button
                        className="source-image-button"
                        aria-label="放大分析截图"
                        onClick={() =>
                          openDialog("preview", agent.observation!)
                        }
                      >
                        <img
                          src={agent.observation.screenshot}
                          alt="本次 AI 分析使用的网页截图"
                        />
                        <span>
                          <Expand size={13} />
                          放大查看
                        </span>
                      </button>
                      <strong>
                        {agent.observation.title ||
                          pageLabels[agent.observation.pageType]}
                      </strong>
                      <span>
                        {stamp(agent.observation.capturedAt)} ·{" "}
                        {agent.observation.viewport.width} ×{" "}
                        {agent.observation.viewport.height}
                      </span>
                      <p>请对照截图核对题干、选项和公式。</p>
                    </div>
                  ) : (
                    <div className="source-empty">
                      <Eye size={25} />
                      <p>尚未获取页面截图</p>
                    </div>
                  )}
                </section>
                <div className="reading-note">
                  <ShieldCheck size={19} />
                  <strong>你始终拥有最终决定权</strong>
                  <p>
                    请对照原题核对选项、公式和图片。页面信息不足或置信度较低时，在浏览器调整页面后重新运行。
                  </p>
                </div>
              </aside>
            </div>
          )}

          {view === "activity" && <Logs logs={state.logs} />}
          {view === "settings" && (
            <ModelSettings
              state={state}
              blocked={blocked}
              busy={busy}
              run={run}
            />
          )}
        </div>
      </main>
      {taskModal && (
        <TaskModal
          error={error}
          close={() => {
            setTaskModal(false);
            setError(null);
          }}
          blocked={blocked}
          initialUrl={agent.observation?.url}
          currentPage={
            state.browserOpen
              ? async () => {
                  const next = await api!.observe();
                  setState(next);
                  return next.agent.observation;
                }
              : undefined
          }
          submit={(input) =>
            run("addTask", async () => {
              const next = await api!.addTask(input);
              setTaskModal(false);
              const task = next.tasks[0];
              if (task) setSelectedId(task.id);
              return next;
            })
          }
        />
      )}
      {browserModal && (
        <BrowserModal
          error={error}
          initialUrl={selected?.url ?? "https://i.chaoxing.com/"}
          close={() => {
            setBrowserModal(false);
            setError(null);
          }}
          blocked={blocked || active}
          submit={(url) =>
            run("open", async () => {
              const next = await api!.openBrowser(url);
              setBrowserModal(false);
              return next;
            })
          }
        />
      )}
      {preview && (
        <ScreenshotModal observation={preview} close={() => setPreview(null)} />
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spinning" size={14} />
          正在处理…
        </div>
      )}
    </div>
  );
}

function TaskControl({
  selected,
  agentPhase,
  active,
  tasks,
  blocked,
  controlsBlocked,
  busy,
  select,
  start,
  pause,
  resume,
  stop,
  add,
}: {
  selected?: StudyTask;
  agentPhase: AgentPhase;
  active: boolean;
  tasks: StudyTask[];
  blocked: boolean;
  controlsBlocked: boolean;
  busy: string | null;
  select: (id: string) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  add: () => void;
}) {
  const resumable = agentPhase === "paused" || agentPhase === "needs_user";
  return (
    <section className="task-control">
      <div className="task-control-icon">
        <BookOpen size={21} />
      </div>
      <div className="task-control-content">
        <div className="control-label">当前学习任务</div>
        {selected ? (
          <>
            <select
              aria-label="选择当前任务"
              value={selected.id}
              disabled={active || resumable}
              onChange={(e) => select(e.target.value)}
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
            <p title={selected.goal}>{selected.goal}</p>
          </>
        ) : (
          <>
            <strong>还没有学习任务</strong>
            <p>添加课程或章节地址，设定本次学习目标。</p>
          </>
        )}
      </div>
      <div className="control-actions">
        {selected ? (
          <>
            <button
              className="button primary compact"
              disabled={active ? controlsBlocked : blocked}
              onClick={active ? pause : resumable ? resume : start}
            >
              {busy === "start" ? (
                <LoaderCircle size={15} className="spinning" />
              ) : active ? (
                <Pause size={15} />
              ) : (
                <Play size={15} />
              )}
              {active ? "暂停" : resumable ? "恢复" : "开始任务"}
            </button>
            <IconButton
              label="停止任务"
              disabled={controlsBlocked || (!active && !resumable)}
              onClick={stop}
            >
              <Square size={15} />
            </IconButton>
          </>
        ) : (
          <button
            className="button secondary compact"
            disabled={blocked}
            onClick={add}
          >
            <Plus size={15} />
            添加任务
          </button>
        )}
      </div>
    </section>
  );
}
function ObservationView({
  observation,
  now,
  browserOpen,
  open,
  blocked,
  preview,
}: {
  observation: Observation | null;
  now: number;
  browserOpen: boolean;
  open: () => void;
  blocked: boolean;
  preview: () => void;
}) {
  if (!observation)
    return (
      <div className="browser-empty">
        <StudyIllustration />
        <h3>{browserOpen ? "课程页面已就绪" : "把专注留给学习"}</h3>
        <p>
          {browserOpen
            ? "进入课程后，点击“重新观察”查看当前页面。"
            : "连接学习通，让 AI 协助理解题目、观察课程。"}
        </p>
        <button className="button primary" disabled={blocked} onClick={open}>
          <ExternalLink size={15} />
          {browserOpen ? "前往学习页面" : "打开学习浏览器"}
        </button>
        <span className="browser-empty-note">手动登录一次，下次继续学习</span>
      </div>
    );
  const age = Math.max(0, Math.floor((now - observation.capturedAt) / 1000));
  return (
    <>
      <div className="browser-address">
        <span className="browser-dots">
          <i />
          <i />
          <i />
        </span>
        <div>
          <ShieldCheck size={12} />
          <span>{displayUrl(observation.url)}</span>
        </div>
        <Badge tone={age > 30 ? "amber" : "neutral"}>
          {age < 60 ? `${age} 秒前` : `${Math.floor(age / 60)} 分钟前`}
        </Badge>
      </div>
      <button
        className="screenshot-wrap"
        onClick={preview}
        aria-label="放大浏览器截图"
      >
        <img
          src={observation.screenshot}
          alt={`浏览器观察截图：${observation.title || observation.url}`}
        />
        <span className="screenshot-expand">
          <Expand size={14} />
          放大查看
        </span>
      </button>
      <div className="observation-meta">
        <span>
          <Monitor size={12} />
          {observation.viewport.width} × {observation.viewport.height}
        </span>
        <span>{observation.frames.length} 个框架</span>
        <span>观察于 {stamp(observation.capturedAt)}</span>
      </div>
    </>
  );
}
function VideoMonitor({
  videos,
  completion,
}: {
  videos: VideoState[];
  completion?: Observation["completion"];
}) {
  if (!videos.length)
    return (
      <div className="video-empty">
        <div className="video-empty-icon">
          <Video size={24} strokeWidth={1.3} />
        </div>
        <strong>尚未检测到视频</strong>
        <p>
          进入课程视频页面后
          <br />
          自动读取真实播放状态
        </p>
      </div>
    );
  return (
    <div className="video-list">
      {videos.map((video, i) => (
        <div className="video-item" key={video.id}>
          <div className="video-item-heading">
            <strong>播放器 {i + 1}</strong>
            <Badge
              tone={
                video.status === "playing" || video.status === "ended"
                  ? "teal"
                  : video.status === "error" || video.status === "stalled"
                    ? "red"
                    : "neutral"
              }
            >
              {videoLabels[video.status]}
            </Badge>
          </div>
          <div className="video-timeline">
            <div
              style={{
                width: `${video.duration ? Math.max(0, Math.min(100, (video.currentTime / video.duration) * 100)) : 0}%`,
              }}
            />
          </div>
          <div className="video-timing">
            <span>
              {time(video.currentTime)} <span>/ {time(video.duration)}</span>
            </span>
            <span>{video.playbackRate}×</span>
          </div>
          {video.error && <p className="inline-error">{video.error}</p>}
          {video.status === "stalled" && (
            <p className="inline-error">
              播放位置已停滞 {Math.floor(video.stalledForMs / 1000)}{" "}
              秒，请检查网络或接管。
            </p>
          )}
        </div>
      ))}
      <div className="completion-evidence">
        <ShieldCheck size={14} />
        <div>
          <strong>
            平台任务点：
            {completion?.state === "complete"
              ? "检测到完成标记"
              : completion?.state === "incomplete"
                ? "检测到未完成标记"
                : "尚未确认"}
          </strong>
          <p>
            {completion?.evidence || "播放结束和平台任务点完成会分别记录。"}
          </p>
        </div>
      </div>
    </div>
  );
}
function QuestionCard({
  question,
  index,
}: {
  question: QuestionAnalysis;
  index: number;
}) {
  const labels: Record<QuestionAnalysis["type"], string> = {
    single: "单选题",
    multiple: "多选题",
    true_false: "判断题",
    fill_blank: "填空题",
    unknown: "题型待核对",
  };
  return (
    <section className="panel question-card">
      <div className="question-heading">
        <span className="question-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <Badge>{labels[question.type]}</Badge>
        <Badge
          tone={
            question.confidence < 0.8 || question.needsReview ? "amber" : "teal"
          }
        >
          {Math.round(question.confidence * 100)}% 置信度
        </Badge>
      </div>
      <h2>{question.stem || "题干未能可靠识别，请对照原页面核对。"}</h2>
      {question.options.length > 0 && (
        <div className="question-options">
          {question.options.map((option, i) => (
            <div key={i}>
              <span>{String.fromCharCode(65 + i)}</span>
              <p>{option}</p>
            </div>
          ))}
        </div>
      )}
      <div className="suggested-answer">
        <span>
          <Bot size={16} />
          答案建议
        </span>
        <strong>
          {question.suggestedAnswer.join("；") || "信息不足，请人工核对"}
        </strong>
      </div>
      <div className="question-explanation">
        <strong>解析与思路</strong>
        <p>{question.explanation}</p>
      </div>
      {question.needsReview && (
        <div className="review-warning">
          <AlertTriangle size={14} />
          模型建议人工复核，请特别检查题干、选项与视觉识别结果。
        </div>
      )}
    </section>
  );
}
function Logs({ logs }: { logs: AppState["logs"] }) {
  const [filter, setFilter] = useState("all");
  const filtered = logs.filter(
    (log) => filter === "all" || log.level === filter,
  );
  return (
    <section className="panel logs-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Terminal size={17} />
          <h2>运行记录</h2>
          <Badge>{logs.length}</Badge>
        </div>
        <div className="segmented-control">
          {[
            ["all", "全部"],
            ["warn", "警告"],
            ["error", "异常"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? "selected" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {filtered.length ? (
        <div className="log-table">
          <div className="log-table-head">
            <span>时间</span>
            <span>级别</span>
            <span>详细信息</span>
          </div>
          {[...filtered].reverse().map((log) => (
            <div className="log-table-row" key={log.id}>
              <time>{stamp(log.at)}</time>
              <Badge
                tone={
                  log.level === "error"
                    ? "red"
                    : log.level === "warn"
                      ? "amber"
                      : "neutral"
                }
              >
                {log.level === "error"
                  ? "异常"
                  : log.level === "warn"
                    ? "警告"
                    : "信息"}
              </Badge>
              <p>{log.message}</p>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={Terminal}
          title="暂无运行记录"
          description={
            filter === "all"
              ? "任务开始后，这里会记录观察、模型决策、受控操作和异常恢复情况。"
              : "当前筛选下没有匹配的日志。"
          }
        />
      )}
    </section>
  );
}
function Modal({
  title,
  subtitle,
  close,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const modal = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modal.current?.contains(document.activeElement))
      modal.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const elements = modal.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={modal}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <IconButton label="关闭弹窗" onClick={close}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}
function TaskModal({
  close,
  blocked,
  error,
  initialUrl,
  currentPage,
  submit,
}: {
  close: () => void;
  blocked: boolean;
  error: string | null;
  initialUrl?: string;
  currentPage?: () => Promise<Observation | null>;
  submit: (input: { name: string; url: string; goal: string }) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState(initialUrl ?? "https://i.chaoxing.com/");
  const [reading, setReading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [goal, setGoal] = useState(
    "观察当前课程页面，识别学习任务并提供下一步操作建议。",
  );
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit({ name: name.trim(), url: url.trim(), goal: goal.trim() });
  }
  return (
    <Modal
      title="新建学习任务"
      subtitle="添加一个具体目标，让 Agent 有序地协助学习。"
      close={close}
    >
      <form onSubmit={onSubmit}>
        <div className="modal-body">
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={16} />
              <p>
                {error.replace(
                  /^Error invoking remote method '[^']+': (?:Error: )?/,
                  "",
                )}
              </p>
            </div>
          )}
          <label className="field">
            任务名称
            <input
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：高等数学 · 第二章练习"
            />
          </label>
          <label className="field">
            学习页面地址
            <input
              type="url"
              required
              maxLength={2048}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…chaoxing.com/…"
            />
            <span>从学习通浏览器复制课程或章节地址。请先手动完成登录。</span>
          </label>
          {currentPage && (
            <button
              type="button"
              className="text-button"
              disabled={blocked || reading}
              onClick={async () => {
                setReading(true);
                setPageError("");
                try {
                  const page = await currentPage();
                  if (page) {
                    setUrl(page.url);
                    if (!name.trim()) setName(page.title.slice(0, 100));
                  }
                } catch (error) {
                  setPageError(
                    error instanceof Error
                      ? error.message
                      : "无法读取页面，请手动填写地址。",
                  );
                } finally {
                  setReading(false);
                }
              }}
            >
              {reading ? "正在读取当前页面…" : "使用当前浏览器页面"}
            </button>
          )}
          {pageError && <p role="alert">{pageError}</p>}
          <label className="field">
            本次学习目标
            <textarea
              required
              maxLength={2000}
              rows={4}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="例如：阅读当前章节练习，分析题目并给出答案建议与解析。"
            />
          </label>
          <div className="form-callout">
            <ShieldCheck size={16} />
            <p>
              Agent
              不会伪造观看时长或绕过验证。点击、输入和页面跳转由你逐次确认。
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close}>
            取消
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={blocked || !name.trim() || !goal.trim()}
          >
            <Plus size={16} />
            创建任务
          </button>
        </div>
      </form>
    </Modal>
  );
}
function BrowserModal({
  initialUrl,
  close,
  blocked,
  error,
  submit,
}: {
  initialUrl: string;
  close: () => void;
  blocked: boolean;
  error: string | null;
  submit: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  return (
    <Modal
      title="打开学习浏览器"
      subtitle="在独立窗口中登录学习通，登录状态保存在本机。"
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(url.trim());
        }}
      >
        <div className="modal-body">
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={16} />
              <p>
                {error.replace(
                  /^Error invoking remote method '[^']+': (?:Error: )?/,
                  "",
                )}
              </p>
            </div>
          )}
          <label className="field">
            学习页面地址
            <input
              type="url"
              autoFocus
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <div className="browser-steps">
            <div>
              <span>1</span>
              <p>在浏览器中手动登录学习通</p>
            </div>
            <div>
              <span>2</span>
              <p>打开课程、视频或章节练习</p>
            </div>
            <div>
              <span>3</span>
              <p>回到 Study Agent，观察页面并开始任务</p>
            </div>
          </div>
          {blocked && (
            <div className="form-callout">
              <AlertTriangle size={16} />
              <p>任务运行时请先暂停或停止，再手动导航。</p>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={blocked}>
            <ExternalLink size={15} />
            打开浏览器
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ScreenshotModal({
  observation,
  close,
}: {
  observation: Observation;
  close: () => void;
}) {
  const [original, setOriginal] = useState(false);
  return (
    <Modal
      title="页面截图"
      subtitle={observation.title || displayUrl(observation.url)}
      close={close}
      className="screenshot-modal"
    >
      <div
        className={`screenshot-viewer ${original ? "original-size" : ""}`}
        tabIndex={0}
        aria-label="截图查看区域，可滚动查看原始尺寸图片"
      >
        <img
          src={observation.screenshot}
          alt={`页面截图：${observation.title || displayUrl(observation.url)}`}
          style={original ? { width: observation.viewport.width } : undefined}
        />
      </div>
      <div className="screenshot-tools">
        <span>截图于 {stamp(observation.capturedAt)}</span>
        <button
          className="button secondary compact"
          aria-pressed={original}
          onClick={() => setOriginal(!original)}
        >
          <Expand size={14} />
          {original ? "适应窗口" : "原始尺寸"}
        </button>
      </div>
    </Modal>
  );
}
