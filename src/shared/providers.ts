import type { ModelConfig } from './contracts'

export type PresetProviderId = Exclude<ModelConfig['provider'], 'custom'>

export interface ProviderPreset {
  id: PresetProviderId
  label: string
  description: string
  model: string
  baseUrl: string
  protocol: ModelConfig['protocol']
  tokenParameter: ModelConfig['tokenParameter']
  jsonMode: boolean
  vision: true
  documentationUrl: string
  verifiedAt: string
}

/** Official native-vision defaults, checked against provider documentation on this date. */
export const providerPresets: readonly ProviderPreset[] = [
  {
    id: 'deepseek', label: 'DeepSeek', description: 'DeepSeek Flash · 原生视觉',
    model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com',
    protocol: 'chat_completions', tokenParameter: 'max_tokens', jsonMode: true, vision: true,
    documentationUrl: 'https://api-docs.deepseek.com/guides/vision/', verifiedAt: '2026-10-20',
  },
  {
    id: 'kimi', label: 'Kimi', description: 'Kimi K3 · 原生视觉',
    model: 'kimi-k3', baseUrl: 'https://api.moonshot.ai/v1',
    protocol: 'chat_completions', tokenParameter: 'max_completion_tokens', jsonMode: true, vision: true,
    documentationUrl: 'https://platform.kimi.ai/docs/guide/kimi-k3-quickstart', verifiedAt: '2026-10-20',
  },
  {
    id: 'glm', label: 'GLM', description: '智谱 GLM 5.3 Flash · 原生视觉',
    model: 'glm-5.3-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'chat_completions', tokenParameter: 'max_tokens', jsonMode: true, vision: true,
    documentationUrl: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash', verifiedAt: '2026-10-20',
  },
  {
    id: 'openai', label: 'OpenAI', description: 'GPT 6.1 Sol · 原生视觉',
    model: 'gpt-6.1-sol', baseUrl: 'https://api.openai.com/v1',
    protocol: 'responses', tokenParameter: 'max_completion_tokens', jsonMode: true, vision: true,
    documentationUrl: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol', verifiedAt: '2026-10-20',
  },
  {
    id: 'claude', label: 'Claude', description: 'Claude Sonnet 5.5 · 原生视觉',
    model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1',
    protocol: 'anthropic', tokenParameter: 'max_tokens', jsonMode: false, vision: true,
    documentationUrl: 'https://platform.claude.com/docs/en/models/overview', verifiedAt: '2026-10-20',
  },
  {
    id: 'gemini', label: 'Gemini', description: 'Gemini 3.8 Flash · 原生视觉',
    model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'chat_completions', tokenParameter: 'max_tokens', jsonMode: true, vision: true,
    documentationUrl: 'https://ai.google.dev/gemini-api/docs/openai', verifiedAt: '2026-10-20',
  },
]

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return providerPresets.find(preset => preset.id === id)
}

/** Presets fill connection details; a user's execution/output limits remain their own. */
export function applyProviderPreset(config: ModelConfig, id: PresetProviderId): ModelConfig {
  const preset = getProviderPreset(id)
  if (!preset) throw new Error('未知的模型厂商预设。')
  return {
    ...config, provider: preset.id, baseUrl: preset.baseUrl, model: preset.model,
    protocol: preset.protocol, tokenParameter: preset.tokenParameter, jsonMode: preset.jsonMode,
  }
}
