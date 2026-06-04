'use strict';

// Router multimodelo con fallback en cadena.
// Unifica los dos patrones que ZENITH ya tenía duplicados:
//   - ZENITH_WEB: Haiku → Gemini 2.5 → Gemini 1.5 (estilo chat con historial)
//   - lead-parser: Gemini → Groq → Ollama → regex (estilo task de extracción)
// Un solo proveedor falla → se intenta el siguiente. Primer éxito gana.

const { RouterError } = require('./errors');
const anthropic = require('./providers/anthropic');
const gemini = require('./providers/gemini');
const groq = require('./providers/groq');
const ollama = require('./providers/ollama');

/**
 * @typedef {Object} LLMRequest
 * @property {string} [system]       Prompt de sistema (vacío en tareas de extracción).
 * @property {string} user           Mensaje del usuario o prompt de la tarea.
 * @property {Array}  [history]      Historial formato Gemini: [{ role, parts:[{text}] }].
 * @property {number} [maxTokens]    Límite de tokens de salida. Default 512.
 * @property {number} [temperature]  Default 0.5.
 */

/**
 * Crea un router a partir de una lista ordenada de proveedores ya configurados.
 * @param {Object} opts
 * @param {Array}  opts.providers  Proveedores en orden de preferencia (factories de ./providers).
 * @param {Function} [opts.onEvent] Hook de telemetría: (evt) => void. Nunca debe lanzar.
 */
function createRouter({ providers, onEvent } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new TypeError('createRouter requiere al menos un proveedor en opts.providers');
  }

  const emit = (evt) => {
    if (typeof onEvent !== 'function') return;
    try { onEvent(evt); } catch { /* la telemetría jamás rompe el flujo del agente */ }
  };

  /**
   * Ejecuta la cadena. Devuelve el primer éxito o lanza RouterError si todos fallan.
   * @param {LLMRequest} request
   * @param {Object} [meta]  Contexto opcional para telemetría (ej. { sessionId }).
   * @returns {Promise<{ text:string, provider:string, model:string, attempts:number, ms:number }>}
   */
  async function run(request, meta = {}) {
    if (!request || typeof request.user !== 'string' || request.user.length === 0) {
      throw new TypeError('run requiere request.user (string no vacío)');
    }
    const normalized = {
      system: request.system || '',
      user: request.user,
      history: Array.isArray(request.history) ? request.history : [],
      maxTokens: Number.isFinite(request.maxTokens) ? request.maxTokens : 512,
      temperature: Number.isFinite(request.temperature) ? request.temperature : 0.5,
    };

    const attempts = [];
    for (const p of providers) {
      if (p.skip && p.skip()) {
        emit({ type: 'provider_skip', provider: p.provider, model: p.model, ...meta });
        continue;
      }
      const startedAt = Date.now();
      emit({ type: 'provider_attempt', provider: p.provider, model: p.model, ...meta });
      try {
        const text = await p.call(normalized);
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new Error('respuesta vacía');
        }
        const ms = Date.now() - startedAt;
        emit({ type: 'provider_success', provider: p.provider, model: p.model, ms, ...meta });
        return { text, provider: p.provider, model: p.model, attempts: attempts.length + 1, ms };
      } catch (error) {
        const ms = Date.now() - startedAt;
        attempts.push({ provider: p.provider, model: p.model, error: error.message });
        emit({ type: 'provider_error', provider: p.provider, model: p.model, ms, error: error.message, ...meta });
        // Continúa al siguiente proveedor.
      }
    }
    throw new RouterError('Ningún proveedor LLM respondió correctamente', attempts);
  }

  return { run };
}

module.exports = {
  createRouter,
  RouterError,
  providers: { anthropic, gemini, groq, ollama },
};
