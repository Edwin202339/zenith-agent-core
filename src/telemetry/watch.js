'use strict';

// Adaptador agent-core → ZENITH Watch (02_DESARROLLO/ZENITH_WATCH).
// Convierte los eventos del router (provider_success / provider_error) al formato
// AgentEvent del ingest de Watch (POST /api/v1/agent-events) y los envía
// fire-and-forget. Con esto, todo agente construido sobre agent-core queda
// observado (latencia, errores, fallback) con UNA línea:
//
//   const { createRouter, createWatchTelemetry } = require('@zenith/agent-core');
//   const router = createRouter({ providers: [...], onEvent: createWatchTelemetry() });
//
// REGLA INVIOLABLE (la misma del router): la telemetría jamás rompe al agente.
//   - Sin config completa (env vars WATCH_* o argumentos) → no-op inmediato, cero red.
//   - Cualquier fallo de red hacia Watch se traga en silencio, con timeout corto.
//   - El handler que devolvemos nunca lanza (y además el router lo envuelve en try).
//
// Tokens: desde v1.1 los providers anthropic/gemini exponen usage real y el router lo
// emite en provider_success → aquí se propaga a Watch. cost_usd va en 0 (el catálogo de
// precios vive en Watch/@zenith/pricing; calcularlo aquí duplicaría la tabla).

const TIMEOUT_MS = 3000;

// El ingest de Watch solo acepta estos providers; los del router se traducen aquí.
// groq/ollama no existen en el enum de Watch → sus eventos se omiten (no-op).
const PROVIDER_MAP = { anthropic: 'anthropic', gemini: 'google', google: 'google', openai: 'openai' };

/**
 * Crea el hook onEvent para createRouter que reporta a ZENITH Watch.
 *
 * @param {Object} [config]
 * @param {string} [config.ingestUrl]  Default: process.env.WATCH_INGEST_URL
 * @param {string} [config.apiKey]     Default: process.env.WATCH_API_KEY
 * @param {string} [config.clientId]   Default: process.env.WATCH_CLIENT_ID  (client_...)
 * @param {string} [config.agentId]    Default: process.env.WATCH_AGENT_ID   (agent_...)
 * @param {Function} [config.fetchFn]  Solo para tests: reemplaza el fetch global.
 * @returns {Function} onEvent compatible con createRouter. Nunca lanza.
 */
function createWatchTelemetry(config = {}) {
  const ingestUrl = config.ingestUrl || process.env.WATCH_INGEST_URL;
  const apiKey = config.apiKey || process.env.WATCH_API_KEY;
  const clientId = config.clientId || process.env.WATCH_CLIENT_ID;
  const agentId = config.agentId || process.env.WATCH_AGENT_ID;
  const fetchFn = config.fetchFn || globalThis.fetch;

  // Config incompleta → agente sin observar pero 100% funcional (no-op silencioso).
  if (!ingestUrl || !apiKey || !clientId || !agentId || typeof fetchFn !== 'function') {
    return () => {};
  }

  return function onEvent(evt) {
    try {
      if (!evt || (evt.type !== 'provider_success' && evt.type !== 'provider_error')) return;

      const provider = PROVIDER_MAP[evt.provider];
      if (!provider) return; // groq/ollama: Watch no los acepta en su schema

      const ms = Number.isFinite(evt.ms) ? evt.ms : 0;
      const endedAt = Date.now();
      const event = {
        event_id: `evt_${require('crypto').randomUUID()}`,
        client_id: clientId,
        agent_id: agentId,
        session_id: typeof evt.sessionId === 'string' ? evt.sessionId : null,
        provider,
        model: String(evt.model || 'desconocido'),
        started_at: new Date(endedAt - ms).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        duration_ms: ms,
        status: evt.type === 'provider_success' ? 'success' : 'error',
        error_code: evt.type === 'provider_error' ? String(evt.error || 'ERROR') : null,
        input_tokens: (evt.usage && Number.isFinite(evt.usage.inputTokens)) ? evt.usage.inputTokens : 0,
        output_tokens: (evt.usage && Number.isFinite(evt.usage.outputTokens)) ? evt.usage.outputTokens : 0,
        cost_usd: 0,
        cache_hit: false,
        retries: 0,
      };

      const controller = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
        : {};

      // Fire-and-forget: nunca se espera, nunca se propaga un rechazo.
      Promise.resolve(fetchFn(`${ingestUrl}/api/v1/agent-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Watch-Client-Key': apiKey },
        body: JSON.stringify({ events: [event] }),
        ...controller,
      })).catch(() => { /* Watch caído: jamás afecta al agente */ });
    } catch { /* ni siquiera un bug aquí debe tocar el flujo del agente */ }
  };
}

module.exports = { createWatchTelemetry };
