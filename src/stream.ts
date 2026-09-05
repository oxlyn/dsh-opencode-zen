/** SSE 解析与 OpenAI 流式 chunk → DSH StreamChunk 的翻译。 */
import type { CallId, StreamChunk, TokenUsage } from './types'
import type { WireChunk, WireUsage } from './types'

/** SSE 解析:一行行拿 data,拼出 OpenAI 流式 chunks。 */
export async function* parseSse(response: Response): AsyncGenerator<WireChunk> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') return
        try {
          yield JSON.parse(data) as WireChunk
        } catch {
          // 忽略坏行
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId?: string
  name?: string
}

/** 把 OpenAI 流式 chunk 翻译成 DSH 需要的块事件。 */
export async function* translateStream(
  rawChunks: AsyncIterable<WireChunk>,
  estimateInput: () => number,
): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | null = null
  let reasoningBlock: OpenBlock | null = null
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let maxTokens = false
  let toolCallsFinish = false
  let usage: TokenUsage | null = null

  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const chunk of rawChunks) {
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}

      const reasoning = delta.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta.content
      if (typeof content === 'string' && content.length > 0) {
        if (!textBlock) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }

      for (const call of delta.tool_calls ?? []) {
        const callIndex = call.index ?? 0
        let block = toolBlocks.get(callIndex)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(callIndex, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (call.id) block.callId = call.id
        if (call.function?.name) block.name = call.function.name
        if (call.function?.arguments) {
          block.text += call.function.arguments
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: (block.callId ?? '') as CallId,
            name: block.name ?? '',
            argumentsDelta: call.function.arguments,
          }
        }
      }

      if (choice.finish_reason === 'length') maxTokens = true
      if (choice.finish_reason === 'tool_calls') toolCallsFinish = true
    }
    if (chunk.usage) usage = mapUsage(chunk.usage)
  }

  // 收尾:按开块顺序补全
  for (const block of order) {
    switch (block.kind) {
      case 'text':
        yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
        break
      case 'reasoning':
        yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
        break
      case 'tool-call':
        yield {
          type: 'block-end',
          index: block.index,
          block: { type: 'tool-call', id: (block.callId ?? '') as CallId, name: block.name ?? '', arguments: block.text },
        }
        break
    }
  }

  if (!usage) {
    const textLen = (textBlock?.text ?? '').length
    usage = { inputTokens: estimateInput(), outputTokens: textLen > 0 ? Math.ceil(textLen / 4) : 0 }
  }
  yield { type: 'usage', usage }
  yield { type: 'finish', reason: maxTokens ? { kind: 'max-tokens' } : toolCallsFinish ? { kind: 'tool-calls' } : { kind: 'stop' } }
}

function mapUsage(usage: NonNullable<WireChunk['usage']>): WireUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? 0
  const promptTokens = usage.prompt_tokens ?? 0
  const mapped: WireUsage = {
    inputTokens: promptTokens - cacheRead,
    outputTokens: usage.completion_tokens ?? 0,
  }
  if (cacheRead) mapped.cacheReadTokens = cacheRead
  return mapped
}
