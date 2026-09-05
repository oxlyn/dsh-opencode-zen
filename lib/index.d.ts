import { Context } from "@deepseek-ai/cordis";
import { GenerateOptions, LlmAdapter, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from "@deepseek-ai/dsh-llm";
//#region src/constants.d.ts
declare const PROVIDER = "opencode";
interface FreeModel {
  id: string;
  name: string;
  contextWindow: number;
  description: string;
}
declare const MODELS: readonly FreeModel[];
declare const REASONING_LEVELS: readonly [{
  readonly id: 'off';
  readonly name: 'Off';
  readonly description: '不思考,最快';
}, {
  readonly id: 'low';
  readonly name: 'Low';
  readonly description: '轻量思考';
}, {
  readonly id: 'high';
  readonly name: 'High';
  readonly description: '深度思考(默认)';
}, {
  readonly id: 'max';
  readonly name: 'Max';
  readonly description: '极限思考,最耗额度';
}];
//#endregion
//#region src/adapter.d.ts
declare class OpenCodeZenAdapter extends LlmAdapter {
  /** 兼容原签名:`new OpenCodeZenAdapter(ctx)`。ctx 仅作占位,适配器本身无状态。 */
  constructor(_ctx?: unknown);
  providerInfo(provider: string): LlmProviderInfo;
  providerRetryPolicy(): ResolvedRetryPolicy;
  listModels(): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
  /**
   * dsh-llm >= 0.1.x 分发前必须先 prepareCall:
   * 绑定一次模型解析结果和一次性的 stream 入口(等价于基类 LlmAdapter 默认实现)。
   */
  prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<{
    model: LlmResolvedModelInfo;
    stream: (options: GenerateOptions) => AsyncGenerator<StreamChunk, any, any>;
  }>;
  stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
}
//#endregion
//#region src/keys.d.ts
/**
 * 读取 key pool 里的 opencode 配置,解析出可用 key 列表;
 * 找不到则回退到 env OPENCODE_ZEN_API_KEY / OPENCODE_GO_API_KEY,最后是 "public"。
 */
declare function loadPoolKeys(): string[];
/** 轮换取一个 key。 */
declare function resolveApiKey(): string;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-opencode-zen";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { MODELS, OpenCodeZenAdapter, PROVIDER, REASONING_LEVELS, apply, inject, loadPoolKeys, name, resolveApiKey };