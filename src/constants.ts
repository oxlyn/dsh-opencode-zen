/** OpenCode Zen 免费档的静态目录与请求常量。 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROVIDER = 'opencode'
export const OPENCODE_BASE = 'https://opencode.ai/zen/v1'
export const OPENCODE_UA = 'opencode/1.18.18 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14'
export const POOL_FILE = join(homedir(), '.dsh', 'profiles', 'web', 'plugins', 'dsh-api-key-pool', 'pool-config.json')

export interface FreeModel {
  id: string
  name: string
  contextWindow: number
  description: string
}

export const MODELS: readonly FreeModel[] = [
  { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash (Free)', contextWindow: 200000, description: 'OpenCode Zen 免费档:推理 + 工具调用,日常主力' },
  { id: 'mimo-v2.5-free', name: 'MiMo 2.5 (Free)', contextWindow: 200000, description: 'OpenCode Zen 免费档' },
  { id: 'hy3-free', name: 'Hunyuan 3 (Free)', contextWindow: 200000, description: 'OpenCode Zen 免费档(腾讯混元)' },
  { id: 'nemotron-3-ultra-free', name: 'Nemotron 3 Ultra (Free)', contextWindow: 131072, description: 'OpenCode Zen 免费档(NVIDIA)' },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning (Free)', contextWindow: 131072, description: 'OpenCode Zen 免费档(NVIDIA)' },
  { id: 'laguna-s-2.1-free', name: 'Laguna S 2.1 (Free)', contextWindow: 200000, description: 'OpenCode Zen 免费档' },
]

export const REASONING_LEVELS = [
  { id: 'off', name: 'Off', description: '不思考,最快' },
  { id: 'low', name: 'Low', description: '轻量思考' },
  { id: 'high', name: 'High', description: '深度思考(默认)' },
  { id: 'max', name: 'Max', description: '极限思考,最耗额度' },
] as const

export const DEFAULT_REASONING = 'high'
export const DEFAULT_MAX_TOKENS = 128000
export const DEFAULT_CONTEXT_WINDOW = 200000
export const DEFAULT_REQUEST_TIMEOUT_MS = 60000
export const MAX_REQUEST_ATTEMPTS = 2
