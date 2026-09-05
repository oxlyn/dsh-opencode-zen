/**
 * dsh-opencode-zen — OpenCode Zen 免费模型接入插件(服务端)
 *
 * 原理:通过 ctx.llm.registerAdapter(['opencode'], adapter) 注册一个
 * provider 路由,让 OpenCode Zen 的免费模型出现在 DSH 模型选择器里。
 *
 * - 免费模型用字面量 key "public" 认证(服务商官方免费档,无需注册)
 * - 若在 key pool (pool-config.json) 里为 opencode 配置了多个 key,
 *   自动轮换使用(多账号额度叠加)
 * - 支持流式输出、reasoning_content(推理内容)透传、tool calls
 * - 内置简易 429/5xx 退避与请求节流,防止打爆免费额度
 *
 * 注入:llm(注册 adapter)
 *
 * 工程:TypeScript 源码,tsdown 打包为 CJS 单文件(lib/index.js);
 * tsconfig 开启 JSX(经典工厂 h,见 ./jsx),需要 UI/DSL 时写 .tsx 即可。
 */
import type { Context } from '@deepseek-ai/cordis'
import { OpenCodeZenAdapter } from './adapter'
import { MODELS, PROVIDER } from './constants'
import { loadPoolKeys, resolveApiKey } from './keys'

export const name = 'dsh-opencode-zen'
export const inject = ['llm']

function log(ctx: Context, level: 'info' | 'warn' | 'error', msg: string): void {
  try {
    ctx.logger[level](`[dsh-opencode-zen] ${msg}`)
  } catch {
    // logger 不可用时静默
  }
}

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PROVIDER], new OpenCodeZenAdapter(ctx))
  const keys = loadPoolKeys()
  log(ctx, 'info', `provider "${PROVIDER}" registered, ${MODELS.length} free models, ${keys.length} key(s) in rotation`)
}

export { MODELS, PROVIDER, REASONING_LEVELS } from './constants'
export { OpenCodeZenAdapter } from './adapter'
export { loadPoolKeys, resolveApiKey } from './keys'
