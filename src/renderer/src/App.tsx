import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Eye,
  FileQuestion,
  FolderOpen,
  GraduationCap,
  KeyRound,
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
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import {
  defaultModelConfig,
  initialAgent,
  type AppState,
  type AgentPhase,
  type BrowserAction,
  type ModelConfig,
  type Observation,
  type QuestionAnalysis,
  type StudyTask,
  type VideoState,
} from "../../shared/contracts";

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
  const [now, setNow] = useState(Date.now());
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
    ? Math.max(0, Math.round((now - agent.startedAt) / 1000))
    : 0;
  const heading = {
    dashboard: ["学习工作台", "观察、理解与操作，每一步都在掌握之中。"],
    tasks: ["课程与任务", "为每一段学习设定清晰的目标。"],
    analysis: ["AI 题目分析", "从页面截图理解题目，结合解析自主判断。"],
    activity: ["运行日志", "追踪 Agent 的每一步决策与执行结果。"],
    settings: ["模型与设置", "连接你的多模态模型，保持凭据安全。"],
  }[view];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={24} />
          </div>
          <div>
            Study Agent<span>YOUR LEARNING COPILOT</span>
          </div>
        </div>
        <div className="workspace-label">
          个人工作空间 <ChevronDown size={13} />
        </div>
        <nav aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
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
        <div className="sidebar-section-label">当前平台</div>
        <div className="platform-item">
          <span className="platform-logo">学</span>
          <div>
            超星学习通<span>网页版 · 第一阶段适配</span>
          </div>
          <span className="small-dot" />
        </div>
        <div className="sidebar-bottom">
          <div className="safety-note">
            <ShieldCheck size={18} />
            <div>
              <strong>保持真实，保持可控</strong>
              <p>
                遵循平台正常学习流程
                <br />
                关键操作由你确认
              </p>
            </div>
          </div>
          <button
            className={`nav-item ${view === "settings" ? "selected" : ""}`}
            onClick={() => setView("settings")}
          >
            <Settings2 size={18} />
            <span>模型与设置</span>
            {!state.model.hasKey && <span className="setup-dot" />}
          </button>
          <div className="sidebar-footer">
            <span className="avatar">S</span>
            <div>
              本地工作空间<span>Study Agent v{state.version}</span>
            </div>
            <span className="local-indicator" />
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <ChevronRight size={13} />
            <span>{heading[0]}</span>
          </div>
          <div className="topbar-right">
            {view !== "dashboard" &&
              currentTask &&
              (active ||
                agent.phase === "paused" ||
                agent.phase === "needs_user") && (
                <>
                  <Badge tone="teal">{phaseLabels[agent.phase]}</Badge>
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
            <span className="topbar-divider" />
            <ShieldCheck size={14} />
            <span>本地运行</span>
          </div>
        </header>
        <div className="page-content">
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
          {error && (
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
              <div className="eyebrow">STUDY WORKSPACE</div>
              <h1>{heading[0]}</h1>
              <p>{heading[1]}</p>
            </div>
            <div className="heading-actions">
              {view === "dashboard" && (
                <button
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => setBrowserModal(true)}
                >
                  <ExternalLink size={16} />
                  {state.browserOpen ? "前往学习页面" : "打开学习浏览器"}
                </button>
              )}
              {view !== "settings" && (
                <button
                  className="button primary"
                  disabled={blocked}
                  onClick={() => setTaskModal(true)}
                >
                  <Plus size={16} />
                  新建任务
                </button>
              )}
            </div>
          </div>

          {view === "dashboard" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="学习任务"
                  value={state.tasks.length.toString()}
                  note={`${completed} 个已完成`}
                  icon={BookOpen}
                />
                <Stat
                  label="Agent 状态"
                  value={phaseLabels[agent.phase]}
                  note={currentTask?.name ?? "等待开始学习任务"}
                  icon={Bot}
                  accent
                />
                <Stat
                  label="视频监测"
                  value={agent.videos.length.toString()}
                  note={
                    agent.videos.some((v) => v.status === "playing")
                      ? "正在读取真实播放状态"
                      : "等待页面中的播放器"
                  }
                  icon={Video}
                />
                <Stat
                  label="本次模型调用"
                  value={agent.modelCalls.toString()}
                  note={
                    agent.startedAt
                      ? `已运行 ${time(elapsed)}`
                      : "按需调用，减少重复理解"
                  }
                  icon={Activity}
                />
              </div>
              <TaskControl
                selected={selected}
                browserOpen={state.browserOpen}
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
                add={() => setTaskModal(true)}
              />
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
                    observation={agent.observation}
                    now={now}
                    browserOpen={state.browserOpen}
                    open={() => setBrowserModal(true)}
                    blocked={blocked}
                  />
                </section>
                <aside className="right-stack">
                  <section className="panel agent-panel">
                    <div className="panel-header">
                      <div className="panel-title">
                        <Bot size={17} />
                        <h2>Agent 实时状态</h2>
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
                      <div className="agent-step">
                        <span>已执行步骤</span>
                        <strong>{agent.step}</strong>
                      </div>
                      <div className="execution-track">
                        {["观察", "理解", "操作", "验证"].map((label, i) => (
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
                            <span>{i + 1}</span>
                            {label}
                          </span>
                        ))}
                      </div>
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
                </aside>
              </div>
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
                {state.logs.length ? (
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
                ) : (
                  <div className="quiet-empty">
                    <span className="log-indicator" />
                    运行记录会显示在这里。从打开浏览器开始你的学习。
                  </div>
                )}
              </section>
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
                <span className="subtle">任务与最近状态保存在本机</span>
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
                      onClick={() => setTaskModal(true)}
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
                        <div className="eyebrow">HUMAN IN THE LOOP</div>
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
                      description="在浏览器中打开章节练习，创建“分析当前页面题目”的任务并开始。题干与选项由多模态模型直接阅读截图。"
                      action={
                        <button
                          className="button secondary"
                          disabled={blocked}
                          onClick={() => setTaskModal(true)}
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
                      <img
                        src={agent.observation.screenshot}
                        alt="本次 AI 分析使用的网页截图"
                      />
                      <strong>
                        {agent.observation.title ||
                          pageLabels[agent.observation.pageType]}
                      </strong>
                      <span>
                        {stamp(agent.observation.capturedAt)} ·{" "}
                        {agent.observation.viewport.width} ×{" "}
                        {agent.observation.viewport.height}
                      </span>
                      <p>
                        截图是题目识别的主要来源，DOM
                        仅辅助导航和播放器状态检测。
                      </p>
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
          <footer className="content-footer">
            <span>
              <ShieldCheck size={12} />
              真实学习 · 受控执行 · 人工确认
            </span>
            <span>STUDY AGENT / LOCAL FIRST</span>
          </footer>
        </div>
      </main>
      {taskModal && (
        <TaskModal
          close={() => setTaskModal(false)}
          blocked={blocked}
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
          initialUrl={selected?.url ?? "https://i.chaoxing.com/"}
          close={() => setBrowserModal(false)}
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
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spinning" size={14} />
          正在处理…
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <section className={`stat-card ${accent ? "stat-accent" : ""}`}>
      <div className="stat-label">
        {label}
        <Icon size={17} strokeWidth={1.5} />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">
        {accent && <span className="small-dot" />}
        {note}
      </div>
    </section>
  );
}
function TaskControl({
  selected,
  browserOpen,
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
  browserOpen: boolean;
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
            <span className="task-entry-note">
              任务 URL 是浏览器入口；已打开时从当前页面执行，请核对课程。
            </span>
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
              {active
                ? "暂停"
                : resumable
                  ? "恢复"
                  : browserOpen
                    ? "从当前页面开始"
                    : "打开并开始"}
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
}: {
  observation: Observation | null;
  now: number;
  browserOpen: boolean;
  open: () => void;
  blocked: boolean;
}) {
  if (!observation)
    return (
      <div className="browser-empty">
        <div className="browser-illustration">
          <div className="illustration-bar">
            <i />
            <i />
            <i />
            <span />
          </div>
          <div className="illustration-content">
            <Monitor size={31} strokeWidth={1.2} />
            <span />
            <span />
          </div>
          <div className="illustration-bot">
            <Bot size={21} />
          </div>
        </div>
        <h3>{browserOpen ? "浏览器已就绪，等待观察" : "连接你的学习页面"}</h3>
        <p>
          {browserOpen
            ? "手动登录并打开课程后，点击“重新观察”获取当前截图。"
            : "打开独立学习浏览器，手动登录学习通。合法会话会保存在本机，供下次使用。"}
        </p>
        <button className="button secondary" disabled={blocked} onClick={open}>
          <ExternalLink size={15} />
          {browserOpen ? "前往学习页面" : "打开学习浏览器"}
        </button>
        <div className="empty-capabilities">
          <span>
            <Check size={12} />
            会话复用
          </span>
          <span>
            <Check size={12} />
            多模态理解
          </span>
          <span>
            <Check size={12} />
            受控操作
          </span>
        </div>
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
      <div className="screenshot-wrap">
        <img
          src={observation.screenshot}
          alt={`浏览器观察截图：${observation.title || observation.url}`}
        />
      </div>
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
function ModelSettings({
  state,
  blocked,
  busy,
  run,
}: {
  state: AppState;
  blocked: boolean;
  busy: string | null;
  run: (
    name: string,
    operation: () => Promise<AppState | string | void>,
  ) => Promise<void>;
}) {
  const savedConfig = (): ModelConfig => ({
    baseUrl: state.model.baseUrl,
    model: state.model.model,
    maxTokens: state.model.maxTokens,
    timeoutMs: state.model.timeoutMs,
    jsonMode: state.model.jsonMode,
  });
  const [config, setConfig] = useState<ModelConfig>(savedConfig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setConfig(savedConfig());
  }, [state.model, dirty]);
  const set = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setDirty(true);
    setConfig((previous) => ({ ...previous, [key]: value }));
  };
  const api = window.study;
  const host = (() => {
    try {
      return new URL(state.model.baseUrl).host;
    } catch {
      return state.model.baseUrl;
    }
  })();
  function save(e: FormEvent) {
    e.preventDefault();
    void run("saveModel", async () => {
      const result = await api!.saveModel(config);
      setDirty(false);
      return result;
    });
  }
  function configureKey(source: "clipboard" | "file") {
    void run(source === "clipboard" ? "pasteKey" : "setKey", async () => {
      // Bind a new credential to the edited endpoint, after clearing its old key.
      if (dirty) {
        await api!.saveModel(config);
        setDirty(false);
      }
      return source === "clipboard" ? api!.pasteApiKey() : api!.setApiKey();
    });
  }
  return (
    <div className="connection-settings">
      <form className="panel connection-card" onSubmit={save}>
        <div className="connection-overview">
          <div className="connection-provider-icon">
            <Bot size={24} />
          </div>
          <div className="connection-current">
            <span>当前模型</span>
            <h2>{state.model.model}</h2>
            <p>{host}</p>
          </div>
          <Badge tone={state.model.hasKey ? "teal" : "neutral"}>
            {state.model.hasKey ? "密钥已保存" : "未设置密钥"}
          </Badge>
        </div>
        <div className="connection-body">
          <div className="connection-fields">
            <label className="field">
              服务地址 <span className="field-label-english">API Base URL</span>
              <input
                type="url"
                required
                value={config.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="field">
              模型名称 <span className="field-label-english">Model Name</span>
              <input
                required
                value={config.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="输入支持视觉的模型名称"
              />
            </label>
          </div>
          <div className="connection-key-row">
            <KeyRound size={17} />
            <div className="connection-key-copy">
              <strong>
                API Key <span>{state.model.hasKey ? "已配置" : "未配置"}</span>
              </strong>
              <p>
                {state.model.keyStorage === "encrypted"
                  ? "已在本机加密保存"
                  : state.model.keyStorage === "session"
                    ? "仅当前会话有效"
                    : "复制密钥后点击粘贴，应用会安全保存"}
              </p>
            </div>
            <div className="connection-key-actions">
              <button
                className="button secondary compact"
                type="button"
                disabled={blocked}
                onClick={() => configureKey("clipboard")}
              >
                {state.model.hasKey ? "更换 API Key" : "粘贴 API Key"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={blocked}
                onClick={() => configureKey("file")}
              >
                从文件导入
              </button>
              {state.model.hasKey && (
                <IconButton
                  label="移除密钥"
                  disabled={blocked}
                  onClick={() => run("clearKey", () => api!.clearApiKey())}
                >
                  <Trash2 size={15} />
                </IconButton>
              )}
            </div>
          </div>
          <details className="connection-advanced">
            <summary>
              <Settings2 size={14} />
              <span>高级设置</span>
              <ChevronDown size={13} />
            </summary>
            <div className="connection-advanced-fields">
              <label className="field">
                最大输出 Token
                <input
                  type="number"
                  step="1"
                  min="256"
                  max="16000"
                  required
                  value={config.maxTokens}
                  onChange={(e) => set("maxTokens", Number(e.target.value))}
                />
              </label>
              <label className="field">
                请求超时（秒）
                <input
                  type="number"
                  min="5"
                  max="180"
                  required
                  value={config.timeoutMs / 1000}
                  onChange={(e) =>
                    set("timeoutMs", Number(e.target.value) * 1000)
                  }
                />
              </label>
              <label className="connection-json-toggle">
                <input
                  type="checkbox"
                  checked={config.jsonMode}
                  onChange={(e) => set("jsonMode", e.target.checked)}
                />
                <span>JSON 输出模式</span>
              </label>
            </div>
          </details>
        </div>
        <div className="connection-actions">
          <span>{dirty ? "有未保存的修改" : "使用支持图片输入的模型"}</span>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={blocked || dirty}
              onClick={() => run("testModel", () => api!.testModel())}
            >
              {busy === "testModel" ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Activity size={15} />
              )}
              测试连接
            </button>
            <button
              className="button primary"
              type="submit"
              disabled={blocked || !dirty}
            >
              <Check size={15} />
              保存配置
            </button>
          </div>
        </div>
      </form>
      <div className="connection-privacy">
        <ShieldCheck size={14} />
        <p>页面截图会发送到你配置的模型服务，请在登录完成后使用。</p>
      </div>
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
              <p>任务与登录会话保存在本机。</p>
            </div>
            <button
              className="button secondary compact"
              disabled={blocked}
              onClick={() => run("dataFolder", () => api!.openDataFolder())}
            >
              <FolderOpen size={14} />
              打开目录
            </button>
          </div>
          <div className="local-settings-row">
            <div>
              <strong>学习浏览器</strong>
              <p>
                {state.browserOpen
                  ? "关闭后保留合法登录会话。"
                  : "浏览器尚未打开。"}
              </p>
            </div>
            <button
              className="button secondary compact"
              disabled={
                blocked ||
                !state.browserOpen ||
                activePhases.includes(state.agent.phase)
              }
              onClick={() => run("closeBrowser", () => api!.closeBrowser())}
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
function Modal({
  title,
  subtitle,
  close,
  children,
}: {
  title: string;
  subtitle: string;
  close: () => void;
  children: ReactNode;
}) {
  const modal = useRef<HTMLElement>(null);
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
        className="modal"
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
  submit,
}: {
  close: () => void;
  blocked: boolean;
  submit: (input: { name: string; url: string; goal: string }) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://i.chaoxing.com/");
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
  submit,
}: {
  initialUrl: string;
  close: () => void;
  blocked: boolean;
  submit: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  return (
    <Modal
      title="打开学习浏览器"
      subtitle="使用独立 Chromium 浏览器，保留你的合法登录会话。"
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(url.trim());
        }}
      >
        <div className="modal-body">
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
