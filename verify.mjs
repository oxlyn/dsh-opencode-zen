// 冒烟测试:验证 lib/index.js 的导出形状与 stream 翻译行为(mock fetch,无真实网络)
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mod = require('./lib/index.js')

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 } else console.log('ok:', msg) }

// 1. 导出形状与原 CJS 一致
for (const k of ['apply', 'inject', 'name', 'OpenCodeZenAdapter', 'PROVIDER', 'MODELS', 'resolveApiKey']) {
  assert(k in mod, `export ${k}`)
}
assert(mod.name === 'dsh-opencode-zen', 'name 值')
assert(Array.isArray(mod.inject) && mod.inject[0] === 'llm', 'inject = [llm]')
assert(mod.PROVIDER === 'opencode', 'PROVIDER')
assert(mod.MODELS.length === 6, '6 个免费模型')
assert(typeof mod.apply === 'function', 'apply 可调用')

// 2. key 轮询
const keys = mod.loadPoolKeys()
assert(Array.isArray(keys) && keys.length >= 1, `pool keys 加载 (${keys.length} 个)`)
const a = mod.resolveApiKey(), b = mod.resolveApiKey()
assert(typeof a === 'string' && typeof b === 'string', 'resolveApiKey 返回字符串')

// 3. resolveModel 元数据
const adapter = new mod.OpenCodeZenAdapter({})
const info = await adapter.resolveModel('opencode', 'deepseek-v4-flash-free')
assert(info.context?.contextWindow === 200000, 'contextWindow 200k')
assert(info.defaultMaxTokens === 128000, 'defaultMaxTokens 128k')
assert(info.reasoning?.defaultEffort === 'high', '默认推理档 high')
assert(info.reasoning?.efforts?.length === 4, '4 档推理')

// 4. stream:mock fetch 返回 SSE(文本 + reasoning + tool_calls + usage + finish_reason)
const payload = [
  'data: {"choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\":"}}]}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"北京\\"}"}}]},"finish_reason":"tool_calls"}]}',
  'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":40}}}',
  'data: [DONE]',
  '',
].join('\n')

globalThis.fetch = async (url, init) => {
  assert(String(url) === 'https://opencode.ai/zen/v1/chat/completions', `请求 URL (${url})`)
  const headers = init.headers
  assert(headers.Authorization === 'Bearer public', 'Authorization Bearer public')
  assert(headers['User-Agent'].startsWith('opencode/'), 'User-Agent 伪装')
  const body = JSON.parse(init.body)
  assert(body.stream === true && body.stream_options?.include_usage === true, 'stream + include_usage')
  assert(body.model === 'deepseek-v4-flash-free', 'model 透传')
  assert(Array.isArray(body.messages) && body.messages[0].role === 'system', 'system 消息映射')
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(payload)); c.close() },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const messages = [
  { id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } },
]
const chunks = []
for await (const c of adapter.stream({ provider: 'opencode', model: 'deepseek-v4-flash-free', messages, system: '你是助手' })) {
  chunks.push(c)
}
const types = chunks.map((c) => c.type)
assert(types[0] === 'block-start' && chunks[0].blockType === 'reasoning', '首个事件 reasoning block-start')
assert(types.includes('reasoning-delta') && types.includes('text-delta'), '透传 reasoning/text delta')
assert(types.includes('tool-call-delta'), 'tool-call delta')
const ends = chunks.filter((c) => c.type === 'block-end')
assert(ends.length === 3, `3 个 block-end (${ends.length})`)
const toolEnd = ends.find((e) => e.block.type === 'tool-call')
assert(toolEnd.block.name === 'get_weather' && toolEnd.block.arguments === '{"city":"北京"}', 'tool-call 参数拼接完整')
const usage = chunks.find((c) => c.type === 'usage')
assert(usage.usage.inputTokens === 60 && usage.usage.outputTokens === 20 && usage.usage.cacheReadTokens === 40, 'usage 缓存扣减 (100-40)')
const finish = chunks.find((c) => c.type === 'finish')
assert(finish.reason.kind === 'tool-calls', `finish_reason tool_calls → kind tool-calls (${finish.reason.kind})`)

console.log(process.exitCode ? '\n存在失败项' : '\n全部通过')
