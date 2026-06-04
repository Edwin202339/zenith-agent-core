'use strict';

const { fetchWithTimeout, historyToMessages } = require('./_fetch');

// Proveedor Groq (Llama, API OpenAI-compatible). Extraído de lead-parser (processChunkWithGroq).
// Soporta varios modelos en orden: si uno da rate limit (429) intenta el siguiente.
// @param {Object} cfg
// @param {string[]} [cfg.models]  Default ['llama-3.3-70b-versatile','llama-3.1-8b-instant'].
// @param {string} [cfg.apiKeyEnv] Default 'GROQ_API_KEY'.
// @param {number} [cfg.timeoutMs] Default 20000.
module.exports = function groq(cfg = {}) {
  const models = cfg.models || ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  const apiKeyEnv = cfg.apiKeyEnv || 'GROQ_API_KEY';
  const timeoutMs = cfg.timeoutMs || 20000;

  return {
    provider: 'groq',
    model: models.join(','),
    skip: () => !process.env[apiKeyEnv],
    async call({ system, user, history, maxTokens, temperature }) {
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) throw new Error(`${apiKeyEnv} no configurada`);

      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push(...historyToMessages(history), { role: 'user', content: user });

      let lastError;
      for (const model of models) {
        try {
          const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
          }, timeoutMs);

          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            const err = new Error(`Groq ${model} HTTP ${res.status}: ${detail.slice(0, 120)}`);
            // Solo el rate limit justifica probar el siguiente modelo; otros errores cortan.
            if (res.status === 429) { lastError = err; continue; }
            throw err;
          }
          const data = await res.json();
          const text = data && data.choices && data.choices[0] &&
            data.choices[0].message && data.choices[0].message.content;
          const out = (text || '').trim();
          if (out) return out;
          lastError = new Error(`Groq ${model} respondió vacío`);
        } catch (err) {
          lastError = err;
          if (!/429|rate.?limit/i.test(err.message)) throw err;
        }
      }
      throw lastError || new Error('Groq: todos los modelos fallaron');
    },
  };
};
