/** Harness 消息 → OpenAI chat.completions wire 协议的序列化。 */
import type { ContentBlock, Message, ToolSchema } from './types'
import type { WireMessage, WireTool, WireToolCall } from './types'

export function flattenText(content: readonly ContentBlock[] | string | undefined): string {
  if (Array.isArray(content)) {
    return content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  return typeof content === 'string' ? content : ''
}

function blocksOf<T extends ContentBlock['type']>(content: readonly ContentBlock[] | undefined, type: T) {
  return (content ?? []).filter((b): b is Extract<ContentBlock, { type: T }> => b.type === type)
}

/** 将 Harness 消息列表转成 wire 消息,system 提示词映射为首条 system 消息。 */
export function serializeMessages(messages: readonly Message[], systemPrompt?: string): WireMessage[] {
  const wire: WireMessage[] = []
  if (systemPrompt) wire.push({ role: 'system', content: systemPrompt })
  for (const m of messages ?? []) {
    if (m.role === 'system') {
      wire.push({ role: 'system', content: flattenText(m.content) })
      continue
    }
    if (m.role === 'assistant') {
      const text = flattenText(m.content)
      const reasoning = blocksOf(m.content, 'reasoning').map((b) => b.text).join('')
      const toolCalls: WireToolCall[] = blocksOf(m.content, 'tool-call').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: b.arguments },
      }))
      const msg: WireMessage = { role: 'assistant', content: text }
      if (reasoning) msg.reasoning_content = reasoning
      if (toolCalls.length) msg.tool_calls = toolCalls
      wire.push(msg)
      continue
    }
    // user 消息:正文作为 user role,内嵌的工具结果逐条展开为 tool role
    const toolResults = blocksOf(m.content, 'tool-result')
    const text = flattenText(m.content)
    if (text || toolResults.length === 0) wire.push({ role: 'user', content: text })
    for (const r of toolResults) {
      wire.push({ role: 'tool', tool_call_id: r.toolCallId, content: flattenText(r.content) || '(no output)' })
    }
  }
  return wire
}

export function serializeTools(tools: readonly ToolSchema[] | undefined): WireTool[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

/** 供 usage 估算:请求侧文本的近似 token 量。 */
export function estimateInputTokens(messages: readonly WireMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}
