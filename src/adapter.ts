/** OpenCode Zen 免费档的 LlmAdapter 实现:请求节流、429/5xx 退避、流式翻译。 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmReasoningEffortInfo, LlmResolvedModelInfo, ReasoningEffortId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REASONING,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_ATTEMPTS,
  MODELS,
  OPENCODE_BASE,
  OPENCODE_UA,
  PROVIDER,
  REASONING_LEVELS,
} from './constants'
import { resolveApiKey } from './keys'
import { estimateInputTokens, serializeMessages, serializeTools } from './messages'
import { parseSse, translateStream } from './stream'
import type { WireRequest } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function aborted(): Error {
  const e = new Error('OpenCode Zen request aborted by caller')
  ;(e as Error & { code: string }).code = 'ABORTED'
  return e
}

export class OpenCodeZenAdapter extends LlmAdapter {
  /** 兼容原签名:`new OpenCodeZenAdapter(ctx)`。ctx 仅作占位,适配器本身无状态。 */
  constructor(_ctx?: unknown) {
    super()
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'OpenCode Zen' }
  }

  providerRetryPolicy(): ResolvedRetryPolicy {
    return {
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['RATE_LIMITED', 'TIMEOUT', 'TRANSPORT'],
      initialDelayMs: 800,
      maxDelayMs: 5000,
      jitterRatio: 0.1,
    }
  }

  async listModels(): Promise<readonly LlmModelInfo[]> {
    return MODELS.map((m) => ({
      provider: PROVIDER,
      id: m.id,
      name: m.name,
      description: m.description,
      inputModalities: ['text'] as const,
    }))
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const found = MODELS.find((m) => m.id === model)
    return {
      provider,
      id: model,
      name: found?.name ?? model,
      ...(found?.description ? { description: found.description } : {}),
      inputModalities: ['text'],
      context: { contextWindow: found?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
      reasoning: {
        efforts: REASONING_LEVELS as unknown as readonly LlmReasoningEffortInfo[],
        defaultEffort: DEFAULT_REASONING as ReasoningEffortId,
      },
    }
  }

  /**
   * dsh-llm >= 0.1.x 分发前必须先 prepareCall:
   * 绑定一次模型解析结果和一次性的 stream 入口(等价于基类 LlmAdapter 默认实现)。
   */
  async prepareCall(provider: string, model: string, _signal?: AbortSignal) {
    return {
      model: await this.resolveModel(provider, model),
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const { messages, system, tools, maxTokens, reasoningEffort, temperature, stop, signal } = options

    const effort = reasoningEffort && reasoningEffort !== 'off' ? reasoningEffort : undefined
    const wireMessages = serializeMessages(messages, system)
    const wireTools = serializeTools(tools)

    const body: WireRequest = {
      model: options.model,
      messages: wireMessages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      top_p: 0.95,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(wireTools ? { tools: wireTools, tool_choice: 'auto' } : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
      ...(stop?.length ? { stop } : {}),
    }

    let lastError: unknown = null
    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw aborted()
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)
        const onAbort = () => controller.abort()
        signal?.addEventListener('abort', onAbort)

        let response: Response
        try {
          response = await fetch(`${OPENCODE_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${resolveApiKey()}`,
              'User-Agent': OPENCODE_UA,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }

        if (!response.ok) {
          const raw = await response.text().catch(() => '')
          const code = response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'TRANSPORT' : 'PROVIDER_ERROR'
          lastError = new Error(`OpenCode Zen HTTP ${response.status}: ${raw.slice(0, 300)}`)
          ;(lastError as Error & { code: string }).code = code
          if (code !== 'RATE_LIMITED' && code !== 'TRANSPORT') throw lastError
          await sleep(400 * (attempt + 1))
          continue
        }

        yield* translateStream(parseSse(response), () => estimateInputTokens(wireMessages))
        return
      } catch (err) {
        if (signal?.aborted) throw aborted()
        if (err instanceof Error && err.name === 'AbortError') throw err
        lastError = err
        if (attempt < MAX_REQUEST_ATTEMPTS - 1) await sleep(400 * (attempt + 1))
      }
    }
    throw lastError ?? new Error('OpenCode Zen request failed')
  }
}
