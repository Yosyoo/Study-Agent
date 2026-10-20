import { z } from 'zod'

export const pageTypeSchema = z.enum(['login', 'courses', 'chapters', 'video', 'exercise', 'unknown'])
export type PageType = z.infer<typeof pageTypeSchema>
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: z.number().min(0).max(1000), y: z.number().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('type'), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('press'), key: z.enum(['Enter', 'Tab', 'Escape', 'Space', 'ArrowDown', 'ArrowUp']) }).strict(),
  z.object({ type: z.literal('scroll'), deltaY: z.number().int().min(-900).max(900) }).strict(),
  z.object({ type: z.literal('navigate'), url: z.string().url().max(2048) }).strict(),
  z.object({ type: z.literal('wait'), ms: z.number().int().min(250).max(5000) }).strict(),
])
export type BrowserAction = z.infer<typeof actionSchema>
export const questionSchema = z.object({
  type: z.enum(['single', 'multiple', 'true_false', 'fill_blank', 'unknown']),
  stem: z.string().max(6000), options: z.array(z.string().max(2000)).max(20),
  suggestedAnswer: z.array(z.string().max(3000)).max(20), explanation: z.string().max(6000),
  confidence: z.number().min(0).max(1), needsReview: z.boolean(),
}).strict()
export type QuestionAnalysis = z.infer<typeof questionSchema>
export const decisionSchema = z.object({
  summary: z.string().min(1).max(3000), confidence: z.number().min(0).max(1),
  pageType: pageTypeSchema, questions: z.array(questionSchema).max(30),
  action: actionSchema.nullable(), needsHuman: z.boolean(), done: z.boolean(),
}).strict()
export type ModelDecision = z.infer<typeof decisionSchema>

export interface VideoSample {
  id: string; frameId: string; currentTime: number; duration: number | null;
  paused: boolean; ended: boolean; readyState: number; networkState: number;
  playbackRate: number; bufferedEnd: number; error: string | null; sampledAt: number
}
export type VideoStatus = 'playing' | 'paused' | 'buffering' | 'stalled' | 'error' | 'ended'
export interface VideoState extends VideoSample { status: VideoStatus; stalledForMs: number }
export interface CompletionEvidence { state: 'complete' | 'incomplete' | 'unknown'; evidence: string }
export interface Observation {
  id: string; capturedAt: number; url: string; title: string; pageType: PageType;
  confidence: number; screenshot: string; viewport: { width: number; height: number };
  fingerprint: string; frames: { id: string; url: string }[];
  videos: VideoSample[]; completion: CompletionEvidence
}
export interface ActionResult { changed: boolean; message: string; observation: Observation }
export interface BrowserPort {
  open(url: string): Promise<void>;
  observe(): Promise<Observation>;
  execute(action: BrowserAction, basedOn: Observation, signal?: AbortSignal): Promise<ActionResult>;
  sampleVideos(): Promise<VideoSample[]>;
  close(): Promise<void>;
}
export interface ModelInput { goal: string; observation: Observation; history: string[]; signal: AbortSignal }
export interface ModelProvider { decide(input: ModelInput): Promise<ModelDecision> }
export const providerIdSchema = z.enum(['custom', 'deepseek', 'kimi', 'glm', 'openai', 'claude', 'gemini'])
export const modelProtocolSchema = z.enum(['chat_completions', 'responses', 'anthropic'])
export const modelConfigSchema = z.object({
  provider: providerIdSchema.default('custom'),
  protocol: modelProtocolSchema.default('chat_completions'),
  tokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
  baseUrl: z.string().url().max(2048), model: z.string().min(1).max(200),
  maxTokens: z.number().int().min(256).max(16000),
  timeoutMs: z.number().int().min(5000).max(180000), jsonMode: z.boolean(),
}).strict()
export type ModelConfig = z.infer<typeof modelConfigSchema>
export interface PublicModelConfig extends ModelConfig { hasKey: boolean; keyStorage: 'encrypted' | 'session' | 'none' }
export const taskInputSchema = z.object({ name: z.string().min(1).max(100), url: z.string().url().max(2048), goal: z.string().min(1).max(2000) }).strict()
export type TaskInput = z.infer<typeof taskInputSchema>
export interface StudyTask extends TaskInput {
  id: string; status: 'pending' | 'running' | 'paused' | 'needs_user' | 'completed' | 'stopped' | 'error';
  createdAt: number; updatedAt: number; lastMessage: string
}
export type AgentPhase = 'idle' | 'observing' | 'thinking' | 'awaiting_confirmation' | 'executing' | 'verifying' | 'monitoring' | 'paused' | 'needs_user' | 'completed' | 'stopped' | 'error'
export interface PendingConfirmation {
  id: string; kind: 'action' | 'answers'; explanation: string; observationId: string;
  action?: BrowserAction; questions?: QuestionAnalysis[]
}
export interface AgentSnapshot {
  phase: AgentPhase; taskId: string | null; step: number; modelCalls: number;
  startedAt: number | null; message: string; observation: Observation | null;
  decision: ModelDecision | null; pending: PendingConfirmation | null; videos: VideoState[]
}
export interface LogEntry { id: string; at: number; level: 'info' | 'warn' | 'error'; message: string }
export interface AppState {
  tasks: StudyTask[]; agent: AgentSnapshot; logs: LogEntry[]; model: PublicModelConfig;
  browserOpen: boolean; version: string
}
export interface StudyAPI {
  getState(): Promise<AppState>;
  subscribe(callback: (state: AppState) => void): () => void;
  addTask(input: TaskInput): Promise<AppState>;
  deleteTask(id: string): Promise<AppState>;
  openBrowser(url: string): Promise<AppState>;
  closeBrowser(): Promise<AppState>;
  observe(): Promise<AppState>;
  start(taskId: string): Promise<AppState>;
  pause(): Promise<AppState>;
  resume(): Promise<AppState>;
  stop(): Promise<AppState>;
  confirm(id: string, approved: boolean): Promise<AppState>;
  saveModel(config: ModelConfig): Promise<AppState>;
  setApiKey(): Promise<AppState>;
  pasteApiKey(): Promise<AppState>;
  clearApiKey(): Promise<AppState>;
  testModel(): Promise<string>;
  openDataFolder(): Promise<void>;
}
export const initialAgent: AgentSnapshot = {
  phase: 'idle', taskId: null, step: 0, modelCalls: 0, startedAt: null,
  message: '准备就绪，打开浏览器并手动登录后开始任务。', observation: null, decision: null, pending: null, videos: [],
}
export const defaultModelConfig: ModelConfig = {
  provider: 'openai', protocol: 'responses', tokenParameter: 'max_completion_tokens',
  baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol',
  maxTokens: 8000, timeoutMs: 90000, jsonMode: true,
}
