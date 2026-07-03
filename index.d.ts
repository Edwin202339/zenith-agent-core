// Tipos públicos de @zenith/agent-core. El paquete es JS puro (CommonJS); estas
// declaraciones cubren la superficie que consumen los agentes TypeScript (AURA,
// ZENITH_WEB). No pretenden tipar cada detalle interno — donde el consumidor no
// necesita precisión (Skills/Memory/Verifier hoy), se usa un tipo laxo pero presente
// (nunca `any` implícito) para no bloquear proyectos con `strict: true`.

// ─── Router ─────────────────────────────────────────────────────────────────

export type Provider = 'anthropic' | 'google' | 'openai' | 'groq' | 'ollama';

/** Bloque de contenido crudo (formato Anthropic) — turnos de tool-calling. */
export interface RawContentBlock {
  type: string;
  [key: string]: unknown;
}

/** Turno crudo para follow-ups de tool-calling (formato Anthropic). */
export interface RawMessage {
  role: 'user' | 'assistant';
  content: string | RawContentBlock[];
}

/** Turno crudo tal como lo entrega el SDK de Anthropic (`Anthropic.MessageParam`),
 *  con `role` incluyendo `'system'` y bloques de contenido con tipos nombrados sin
 *  index signature (`TextBlockParam`, etc.) — no estructuralmente asignable a
 *  RawMessage/RawContentBlock. `rawMessages` acepta ambas formas: el provider solo
 *  hace `JSON.stringify` de esto, es pass-through opaco, no lo interpreta agent-core. */
export type AnySdkMessage = { role: string; content: unknown };

export interface HistoryTurn {
  role: 'user' | 'model' | 'assistant';
  parts?: Array<{ text: string }>;
  content?: string;
}

export interface LLMRequest {
  system?: string;
  user: string;
  history?: HistoryTurn[];
  maxTokens?: number;
  temperature?: number;
  /** Tool-calling en formato Anthropic. Solo la reciben providers con supportsTools. */
  tools?: unknown[];
  toolChoice?: { type: string; name?: string };
  /** Turnos crudos (content blocks) para follow-ups de tools. Providers sin
   *  supportsRawMessages se saltan cuando esto viene presente. Acepta RawMessage
   *  propio o el MessageParam del SDK de Anthropic (AnySdkMessage) — pass-through
   *  opaco, agent-core no valida su forma más allá de role/content. */
  rawMessages?: Array<RawMessage | AnySdkMessage>;
  /** Validador de salida: falsy/throw = el proveedor "falló" → siguiente en la cadena. */
  validate?: (text: string, out: { toolUse: ToolUse | null; content: unknown; usage: Usage | null }) => unknown;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface RouterEvent {
  type: 'provider_skip' | 'provider_attempt' | 'provider_success' | 'provider_error';
  provider: string;
  model: string;
  ms?: number;
  error?: string;
  usage?: Usage | null;
  reason?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface RouterResult {
  text: string;
  toolUse: ToolUse | null;
  /** Bloques crudos de la respuesta (solo Anthropic) — úsalos para armar el turno
   *  assistant del siguiente rawMessages en un follow-up de tool-calling. */
  content: RawContentBlock[] | null;
  usage: Usage | null;
  provider: string;
  model: string;
  attempts: number;
  ms: number;
}

export interface RouterProvider {
  provider: string;
  model: string;
  supportsTools?: boolean;
  supportsRawMessages?: boolean;
  skip?: () => boolean;
  call: (request: LLMRequest) => Promise<string | Partial<RouterResult> & { text: string }>;
}

export interface RouterAttemptFailure {
  provider: string;
  model: string;
  error: string;
}

export class RouterError extends Error {
  attempts: RouterAttemptFailure[];
}

export interface CreateRouterOptions {
  providers: RouterProvider[];
  /** Hook de telemetría. Nunca debe lanzar — el router lo envuelve en try/catch igual. */
  onEvent?: (evt: RouterEvent) => void;
}

export interface Router {
  run(request: LLMRequest, meta?: Record<string, unknown>): Promise<RouterResult>;
}

export function createRouter(options: CreateRouterOptions): Router;

// ─── Provider factories ────────────────────────────────────────────────────

export interface AnthropicProviderConfig {
  model?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
}
export interface GeminiProviderConfig {
  model?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  /** Solo modelos 2.5: presupuesto de tokens de razonamiento interno ("thinking").
   *  Pasa 0 para desactivarlo en tareas de síntesis simple (evita que el thinking
   *  consuma el budget de maxTokens y corte la respuesta a mitad de frase).
   *  Sin especificar: comportamiento por defecto de la API (razonamiento dinámico). */
  thinkingBudget?: number;
}
export interface GroqProviderConfig {
  models?: string[];
  apiKeyEnv?: string;
  timeoutMs?: number;
}
export interface OllamaProviderConfig {
  model?: string;
  host?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

export const providers: {
  anthropic: (cfg?: AnthropicProviderConfig) => RouterProvider;
  gemini: (cfg?: GeminiProviderConfig) => RouterProvider;
  groq: (cfg?: GroqProviderConfig) => RouterProvider;
  ollama: (cfg?: OllamaProviderConfig) => RouterProvider;
};

// ─── Telemetría ZENITH Watch ────────────────────────────────────────────────

export interface WatchTelemetryConfig {
  ingestUrl?: string;
  apiKey?: string;
  clientId?: string;
  agentId?: string;
  fetchFn?: typeof fetch;
}

/** Handler para `onEvent` del router. Sin config completa (o env vars WATCH_*),
 *  devuelve un no-op — nunca intenta red, nunca lanza. */
export function createWatchTelemetry(config?: WatchTelemetryConfig): (evt: RouterEvent) => void;

// ─── Skills — determinismo primero ─────────────────────────────────────────

export interface Skill<TInput = unknown, TResult = unknown, TCtx = unknown> {
  name: string;
  match: (input: TInput, ctx?: TCtx) => boolean | number;
  run: (input: TInput, ctx?: TCtx) => TResult | Promise<TResult>;
}

export interface DispatchResult<TResult = unknown> {
  handled: boolean;
  result?: TResult;
}

export class SkillRegistry {
  register<TInput = unknown, TResult = unknown, TCtx = unknown>(skill: Skill<TInput, TResult, TCtx>): this;
  resolve(input: unknown, ctx?: unknown): Skill | undefined;
  dispatch<TResult = unknown>(input: unknown, ctx?: unknown): Promise<DispatchResult<TResult>>;
}

// ─── Memoria en capas ───────────────────────────────────────────────────────

export interface MemoryStore {
  [key: string]: unknown;
}

export class FileStore implements MemoryStore {
  constructor(path: string);
  [key: string]: unknown;
}

export class PostgresStore implements MemoryStore {
  constructor(config: Record<string, unknown>);
  [key: string]: unknown;
}

export class Memory {
  constructor(store: MemoryStore, opts?: { embedFn?: (text: string) => Promise<number[]> });
  remember(sessionId: string, key: string, value: unknown, ttlMs?: number): void;
  recall(sessionId: string, key: string): unknown;
  forget(sessionId: string): void;
  logEpisode(entry: { tags?: string[]; summary: string; [key: string]: unknown }): void;
  episodes(filter?: { tag?: string }): Array<Record<string, unknown>>;
  learn(text: string, metadata?: Record<string, unknown>): Promise<void>;
  search(query: string, opts?: { topK?: number }): Promise<Array<{ text: string; metadata: Record<string, unknown>; score: number }>>;
  relate(subject: string, predicate: string, object: string): void;
  relations(filter?: { subject?: string; predicate?: string; object?: string }): Array<{ subject: string; predicate: string; object: string }>;
}

export function cosineSimilarity(a: number[], b: number[]): number;

// ─── Verificador de acciones irreversibles ─────────────────────────────────

export class VerificationError extends Error {}

export interface ProposeVerifyApplyArgs<TProposal = unknown, TResult = unknown> {
  propose: () => Promise<TProposal>;
  verify: (proposal: TProposal) => Promise<boolean>;
  apply: (proposal: TProposal) => Promise<TResult>;
  onReject?: (proposal: TProposal) => Promise<unknown>;
}

export interface ProposeVerifyApplyResult<TResult = unknown> {
  applied: boolean;
  result?: TResult;
  rejected?: unknown;
}

export function proposeVerifyApply<TProposal = unknown, TResult = unknown>(
  args: ProposeVerifyApplyArgs<TProposal, TResult>,
): Promise<ProposeVerifyApplyResult<TResult>>;
