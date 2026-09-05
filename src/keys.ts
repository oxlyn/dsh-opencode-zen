/**
 * API key 解析:pool-config.json → 环境变量 → "public" 官方免费档。
 * 同进程内缓存并轮询(round-robin),多账号额度叠加。
 */
import { existsSync, readFileSync } from 'node:fs'
import { POOL_FILE } from './constants'

let poolKeys: string[] | null = null
let poolIndex = 0

/**
 * 读取 key pool 里的 opencode 配置,解析出可用 key 列表;
 * 找不到则回退到 env OPENCODE_ZEN_API_KEY / OPENCODE_GO_API_KEY,最后是 "public"。
 */
export function loadPoolKeys(): string[] {
  if (poolKeys) return poolKeys
  const sources: string[] = []
  try {
    if (existsSync(POOL_FILE)) {
      const raw = JSON.parse(readFileSync(POOL_FILE, 'utf8')) as {
        pools?: Record<string, { keys?: unknown }>
      }
      const oc = raw.pools?.opencode ?? raw.pools?.['opencode-zen']
      if (oc && Array.isArray(oc.keys)) {
        sources.push(...(oc.keys as unknown[]).filter((k): k is string => typeof k === 'string' && k !== 'public' && k.length > 0))
      }
    }
  } catch {
    // pool 文件损坏或不可读时静默回退
  }
  const env = process.env.OPENCODE_ZEN_API_KEY || process.env.OPENCODE_GO_API_KEY
  if (env) sources.push(env)
  const deduped = [...new Set(sources)]
  poolKeys = deduped.length > 0 ? deduped : ['public']
  return poolKeys
}

/** 轮换取一个 key。 */
export function resolveApiKey(): string {
  const keys = loadPoolKeys()
  const key = keys[poolIndex % keys.length]!
  poolIndex = (poolIndex + 1) % keys.length
  return key
}
