Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _deepseek_ai_dsh_llm = require("@deepseek-ai/dsh-llm");
let node_os = require("node:os");
let node_path = require("node:path");
let node_fs = require("node:fs");
//#region src/constants.ts
/** OpenCode Zen 免费档的静态目录与请求常量。 */
const PROVIDER = "opencode";
const OPENCODE_BASE = "https://opencode.ai/zen/v1";
const OPENCODE_UA = "opencode/1.18.18 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14";
const POOL_FILE = (0, node_path.join)((0, node_os.homedir)(), ".dsh", "profiles", "web", "plugins", "dsh-api-key-pool", "pool-config.json");
const MODELS = [
	{
		id: "deepseek-v4-flash-free",
		name: "DeepSeek V4 Flash (Free)",
		contextWindow: 2e5,
		description: "OpenCode Zen 免费档:推理 + 工具调用,日常主力"
	},
	{
		id: "mimo-v2.5-free",
		name: "MiMo 2.5 (Free)",
		contextWindow: 2e5,
		description: "OpenCode Zen 免费档"
	},
	{
		id: "hy3-free",
		name: "Hunyuan 3 (Free)",
		contextWindow: 2e5,
		description: "OpenCode Zen 免费档(腾讯混元)"
	},
	{
		id: "nemotron-3-ultra-free",
		name: "Nemotron 3 Ultra (Free)",
		contextWindow: 131072,
		description: "OpenCode Zen 免费档(NVIDIA)"
	},
	{
		id: "nemotron-3.5-lightning-free",
		name: "Nemotron 3.5 Lightning (Free)",
		contextWindow: 131072,
		description: "OpenCode Zen 免费档(NVIDIA)"
	},
	{
		id: "laguna-s-2.1-free",
		name: "Laguna S 2.1 (Free)",
		contextWindow: 2e5,
		description: "OpenCode Zen 免费档"
	}
];
const REASONING_LEVELS = [
	{
		id: "off",
		name: "Off",
		description: "不思考,最快"
	},
	{
		id: "low",
		name: "Low",
		description: "轻量思考"
	},
	{
		id: "high",
		name: "High",
		description: "深度思考(默认)"
	},
	{
		id: "max",
		name: "Max",
		description: "极限思考,最耗额度"
	}
];
const DEFAULT_REASONING = "high";
const DEFAULT_MAX_TOKENS = 128e3;
const DEFAULT_REQUEST_TIMEOUT_MS = 6e4;
//#endregion
//#region src/keys.ts
/**
* API key 解析:pool-config.json → 环境变量 → "public" 官方免费档。
* 同进程内缓存并轮询(round-robin),多账号额度叠加。
*/
let poolKeys = null;
let poolIndex = 0;
/**
* 读取 key pool 里的 opencode 配置,解析出可用 key 列表;
* 找不到则回退到 env OPENCODE_ZEN_API_KEY / OPENCODE_GO_API_KEY,最后是 "public"。
*/
function loadPoolKeys() {
	if (poolKeys) return poolKeys;
	const sources = [];
	try {
		if ((0, node_fs.existsSync)(POOL_FILE)) {
			const raw = JSON.parse((0, node_fs.readFileSync)(POOL_FILE, "utf8"));
			const oc = raw.pools?.opencode ?? raw.pools?.["opencode-zen"];
			if (oc && Array.isArray(oc.keys)) sources.push(...oc.keys.filter((k) => typeof k === "string" && k !== "public" && k.length > 0));
		}
	} catch {}
	const env = process.env.OPENCODE_ZEN_API_KEY || process.env.OPENCODE_GO_API_KEY;
	if (env) sources.push(env);
	const deduped = [...new Set(sources)];
	poolKeys = deduped.length > 0 ? deduped : ["public"];
	return poolKeys;
}
/** 轮换取一个 key。 */
function resolveApiKey() {
	const keys = loadPoolKeys();
	const key = keys[poolIndex % keys.length];
	poolIndex = (poolIndex + 1) % keys.length;
	return key;
}
//#endregion
//#region src/messages.ts
function flattenText(content) {
	if (Array.isArray(content)) return content.filter((b) => b.type === "text").map((b) => b.text).join("");
	return typeof content === "string" ? content : "";
}
function blocksOf(content, type) {
	return (content ?? []).filter((b) => b.type === type);
}
/** 将 Harness 消息列表转成 wire 消息,system 提示词映射为首条 system 消息。 */
function serializeMessages(messages, systemPrompt) {
	const wire = [];
	if (systemPrompt) wire.push({
		role: "system",
		content: systemPrompt
	});
	for (const m of messages ?? []) {
		if (m.role === "system") {
			wire.push({
				role: "system",
				content: flattenText(m.content)
			});
			continue;
		}
		if (m.role === "assistant") {
			const text = flattenText(m.content);
			const reasoning = blocksOf(m.content, "reasoning").map((b) => b.text).join("");
			const toolCalls = blocksOf(m.content, "tool-call").map((b) => ({
				id: b.id,
				type: "function",
				function: {
					name: b.name,
					arguments: b.arguments
				}
			}));
			const msg = {
				role: "assistant",
				content: text
			};
			if (reasoning) msg.reasoning_content = reasoning;
			if (toolCalls.length) msg.tool_calls = toolCalls;
			wire.push(msg);
			continue;
		}
		const toolResults = blocksOf(m.content, "tool-result");
		const text = flattenText(m.content);
		if (text || toolResults.length === 0) wire.push({
			role: "user",
			content: text
		});
		for (const r of toolResults) wire.push({
			role: "tool",
			tool_call_id: r.toolCallId,
			content: flattenText(r.content) || "(no output)"
		});
	}
	return wire;
}
function serializeTools(tools) {
	if (!tools || tools.length === 0) return void 0;
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters
		}
	}));
}
/** 供 usage 估算:请求侧文本的近似 token 量。 */
function estimateInputTokens(messages) {
	return Math.ceil(JSON.stringify(messages).length / 4);
}
//#endregion
//#region src/stream.ts
/** SSE 解析:一行行拿 data,拼出 OpenAI 流式 chunks。 */
async function* parseSse(response) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx;
			while ((idx = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				if (!line.startsWith("data:")) continue;
				const data = line.slice(5).trim();
				if (!data) continue;
				if (data === "[DONE]") return;
				try {
					yield JSON.parse(data);
				} catch {}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
/** 把 OpenAI 流式 chunk 翻译成 DSH 需要的块事件。 */
async function* translateStream(rawChunks, estimateInput) {
	let nextIndex = 0;
	let textBlock = null;
	let reasoningBlock = null;
	const toolBlocks = /* @__PURE__ */ new Map();
	const order = [];
	let maxTokens = false;
	let toolCallsFinish = false;
	let usage = null;
	const open = (kind) => {
		const block = {
			index: nextIndex++,
			kind,
			text: ""
		};
		order.push(block);
		return block;
	};
	for await (const chunk of rawChunks) {
		for (const choice of chunk.choices ?? []) {
			const delta = choice.delta ?? {};
			const reasoning = delta.reasoning_content;
			if (typeof reasoning === "string" && reasoning.length > 0) {
				if (!reasoningBlock) {
					reasoningBlock = open("reasoning");
					yield {
						type: "block-start",
						index: reasoningBlock.index,
						blockType: "reasoning"
					};
				}
				reasoningBlock.text += reasoning;
				yield {
					type: "reasoning-delta",
					index: reasoningBlock.index,
					text: reasoning
				};
			}
			const content = delta.content;
			if (typeof content === "string" && content.length > 0) {
				if (!textBlock) {
					textBlock = open("text");
					yield {
						type: "block-start",
						index: textBlock.index,
						blockType: "text"
					};
				}
				textBlock.text += content;
				yield {
					type: "text-delta",
					index: textBlock.index,
					text: content
				};
			}
			for (const call of delta.tool_calls ?? []) {
				const callIndex = call.index ?? 0;
				let block = toolBlocks.get(callIndex);
				if (!block) {
					block = open("tool-call");
					toolBlocks.set(callIndex, block);
					yield {
						type: "block-start",
						index: block.index,
						blockType: "tool-call"
					};
				}
				if (call.id) block.callId = call.id;
				if (call.function?.name) block.name = call.function.name;
				if (call.function?.arguments) {
					block.text += call.function.arguments;
					yield {
						type: "tool-call-delta",
						index: block.index,
						id: block.callId ?? "",
						name: block.name ?? "",
						argumentsDelta: call.function.arguments
					};
				}
			}
			if (choice.finish_reason === "length") maxTokens = true;
			if (choice.finish_reason === "tool_calls") toolCallsFinish = true;
		}
		if (chunk.usage) usage = mapUsage(chunk.usage);
	}
	for (const block of order) switch (block.kind) {
		case "text":
			yield {
				type: "block-end",
				index: block.index,
				block: {
					type: "text",
					text: block.text
				}
			};
			break;
		case "reasoning":
			yield {
				type: "block-end",
				index: block.index,
				block: {
					type: "reasoning",
					text: block.text
				}
			};
			break;
		case "tool-call": yield {
			type: "block-end",
			index: block.index,
			block: {
				type: "tool-call",
				id: block.callId ?? "",
				name: block.name ?? "",
				arguments: block.text
			}
		};
	}
	if (!usage) {
		const textLen = (textBlock?.text ?? "").length;
		usage = {
			inputTokens: estimateInput(),
			outputTokens: textLen > 0 ? Math.ceil(textLen / 4) : 0
		};
	}
	yield {
		type: "usage",
		usage
	};
	yield {
		type: "finish",
		reason: maxTokens ? { kind: "max-tokens" } : toolCallsFinish ? { kind: "tool-calls" } : { kind: "stop" }
	};
}
function mapUsage(usage) {
	const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? 0;
	const mapped = {
		inputTokens: (usage.prompt_tokens ?? 0) - cacheRead,
		outputTokens: usage.completion_tokens ?? 0
	};
	if (cacheRead) mapped.cacheReadTokens = cacheRead;
	return mapped;
}
//#endregion
//#region src/adapter.ts
/** OpenCode Zen 免费档的 LlmAdapter 实现:请求节流、429/5xx 退避、流式翻译。 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function aborted() {
	const e = /* @__PURE__ */ new Error("OpenCode Zen request aborted by caller");
	e.code = "ABORTED";
	return e;
}
var OpenCodeZenAdapter = class extends _deepseek_ai_dsh_llm.LlmAdapter {
	/** 兼容原签名:`new OpenCodeZenAdapter(ctx)`。ctx 仅作占位,适配器本身无状态。 */
	constructor(_ctx) {
		super();
	}
	providerInfo(provider) {
		return {
			id: provider,
			name: "OpenCode Zen"
		};
	}
	providerRetryPolicy() {
		return {
			mode: "normal",
			maxRetries: 2,
			retryableCodes: [
				"RATE_LIMITED",
				"TIMEOUT",
				"TRANSPORT"
			],
			initialDelayMs: 800,
			maxDelayMs: 5e3,
			jitterRatio: .1
		};
	}
	async listModels() {
		return MODELS.map((m) => ({
			provider: PROVIDER,
			id: m.id,
			name: m.name,
			description: m.description,
			inputModalities: ["text"]
		}));
	}
	async resolveModel(provider, model) {
		const found = MODELS.find((m) => m.id === model);
		return {
			provider,
			id: model,
			name: found?.name ?? model,
			...found?.description ? { description: found.description } : {},
			inputModalities: ["text"],
			context: { contextWindow: found?.contextWindow ?? 2e5 },
			defaultMaxTokens: DEFAULT_MAX_TOKENS,
			reasoning: {
				efforts: REASONING_LEVELS,
				defaultEffort: DEFAULT_REASONING
			}
		};
	}
	/**
	* dsh-llm >= 0.1.x 分发前必须先 prepareCall:
	* 绑定一次模型解析结果和一次性的 stream 入口(等价于基类 LlmAdapter 默认实现)。
	*/
	async prepareCall(provider, model, _signal) {
		return {
			model: await this.resolveModel(provider, model),
			stream: (options) => this.stream(options)
		};
	}
	async *stream(options) {
		const { messages, system, tools, maxTokens, reasoningEffort, temperature, stop, signal } = options;
		const effort = reasoningEffort && reasoningEffort !== "off" ? reasoningEffort : void 0;
		const wireMessages = serializeMessages(messages, system);
		const wireTools = serializeTools(tools);
		const body = {
			model: options.model,
			messages: wireMessages,
			stream: true,
			stream_options: { include_usage: true },
			max_tokens: maxTokens ?? 128e3,
			top_p: .95,
			...temperature !== void 0 ? { temperature } : {},
			...wireTools ? {
				tools: wireTools,
				tool_choice: "auto"
			} : {},
			...effort ? { reasoning_effort: effort } : {},
			...stop?.length ? { stop } : {}
		};
		let lastError = null;
		for (let attempt = 0; attempt < 2; attempt++) {
			if (signal?.aborted) throw aborted();
			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
				const onAbort = () => controller.abort();
				signal?.addEventListener("abort", onAbort);
				let response;
				try {
					response = await fetch(`${OPENCODE_BASE}/chat/completions`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${resolveApiKey()}`,
							"User-Agent": OPENCODE_UA
						},
						body: JSON.stringify(body),
						signal: controller.signal
					});
				} finally {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
				}
				if (!response.ok) {
					const raw = await response.text().catch(() => "");
					const code = response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "TRANSPORT" : "PROVIDER_ERROR";
					lastError = /* @__PURE__ */ new Error(`OpenCode Zen HTTP ${response.status}: ${raw.slice(0, 300)}`);
					lastError.code = code;
					if (code !== "RATE_LIMITED" && code !== "TRANSPORT") throw lastError;
					await sleep(400 * (attempt + 1));
					continue;
				}
				yield* translateStream(parseSse(response), () => estimateInputTokens(wireMessages));
				return;
			} catch (err) {
				if (signal?.aborted) throw aborted();
				if (err instanceof Error && err.name === "AbortError") throw err;
				lastError = err;
				if (attempt < 1) await sleep(400 * (attempt + 1));
			}
		}
		throw lastError ?? /* @__PURE__ */ new Error("OpenCode Zen request failed");
	}
};
//#endregion
//#region src/index.ts
const name = "dsh-opencode-zen";
const inject = ["llm"];
function log(ctx, level, msg) {
	try {
		ctx.logger[level](`[dsh-opencode-zen] ${msg}`);
	} catch {}
}
function apply(ctx) {
	ctx.llm.registerAdapter([PROVIDER], new OpenCodeZenAdapter(ctx));
	const keys = loadPoolKeys();
	log(ctx, "info", `provider "${PROVIDER}" registered, ${MODELS.length} free models, ${keys.length} key(s) in rotation`);
}
//#endregion
exports.MODELS = MODELS;
exports.OpenCodeZenAdapter = OpenCodeZenAdapter;
exports.PROVIDER = PROVIDER;
exports.REASONING_LEVELS = REASONING_LEVELS;
exports.apply = apply;
exports.inject = inject;
exports.loadPoolKeys = loadPoolKeys;
exports.name = name;
exports.resolveApiKey = resolveApiKey;
