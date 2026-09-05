/**
 * 插件本地 wire 协议类型(OpenAI chat.completions 兼容),以及
 * DSH 词汇类型的再导出 —— 上游类型来自 @deepseek-ai/dsh-llm。
 */
export type {
  CallId,
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  Message,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'

/** OpenAI wire 侧 assistant/user/tool 消息体。 */
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  reasoning_content?: string
  tool_calls?: WireToolCall[]
  tool_call_id?: string
}

export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface WireTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  max_tokens: number
  top_p: number
  temperature?: number
  tools?: WireTool[]
  tool_choice?: 'auto'
  reasoning_effort?: string
  stop?: string[]
}

/** OpenAI 流式 chunk(仅声明本插件实际读取的字段)。 */
export interface WireChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number } | null
  } | null
}

export interface WireUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
}
