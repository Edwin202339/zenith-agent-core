'use strict';

const { fetchWithTimeout } = require('./_fetch');

// Proveedor Ollama local (modelos open source en :11434). Extraído de lead-parser (callOllama).
// Último eslabón gratis antes del fallback determinista. Timeout amplio: los modelos locales
// en hardware sin GPU dedicada son lentos (ver specs PC Edwin: i5 + Intel UHD).
// @param {Object} cfg
// @param {string} [cfg.model]    Default 'llama3.2:3b' (límite práctico con Docker activo, 16GB RAM).
// @param {string} [cfg.host]     Default 'http://localhost:11434'.
// @param {number} [cfg.timeoutMs] Default 90000.
// @param {boolean} [cfg.enabled]  Si false, el proveedor se salta siempre. Default true.
module.exports = function ollama(cfg = {}) {
  const model = cfg.model || 'llama3.2:3b';
  const host = cfg.host || 'http://localhost:11434';
  const timeoutMs = cfg.timeoutMs || 90000;
  const enabled = cfg.enabled !== false;

  return {
    provider: 'ollama',
    model,
    skip: () => !enabled,
    async call({ system, user }) {
      // Ollama /api/generate es prompt-único: se antepone el system como contexto.
      const prompt = system ? `${system}\n\n${user}` : user;
      const res = await fetchWithTimeout(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
      }, timeoutMs);

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return (data && data.response ? data.response : '').trim();
    },
  };
};
