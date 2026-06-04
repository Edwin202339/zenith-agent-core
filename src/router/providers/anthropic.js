'use strict';

const { fetchWithTimeout, historyToMessages } = require('./_fetch');

// Proveedor Anthropic (Claude). Estilo chat. Extraído de ZENITH_WEB api/server.js (callHaiku).
// @param {Object} cfg
// @param {string} [cfg.model]    Default 'claude-haiku-4-5-20251001'.
// @param {string} [cfg.apiKeyEnv] Nombre de la env var con la key. Default 'ANTHROPIC_API_KEY'.
// @param {number} [cfg.timeoutMs] Default 20000.
module.exports = function anthropic(cfg = {}) {
  const model = cfg.model || 'claude-haiku-4-5-20251001';
  const apiKeyEnv = cfg.apiKeyEnv || 'ANTHROPIC_API_KEY';
  const timeoutMs = cfg.timeoutMs || 20000;

  return {
    provider: 'anthropic',
    model,
    skip: () => !process.env[apiKeyEnv],
    async call({ system, user, history, maxTokens, temperature }) {
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) throw new Error(`${apiKeyEnv} no configurada`);

      const messages = [...historyToMessages(history), { role: 'user', content: user }];
      const body = { model, max_tokens: maxTokens, messages, temperature };
      if (system) body.system = system;

      const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      }, timeoutMs);

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${detail.slice(0, 120)}`);
      }
      const data = await res.json();
      const text = data && data.content && data.content[0] && data.content[0].text;
      return (text || '').trim();
    },
  };
};
