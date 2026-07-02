'use strict';

const { fetchWithTimeout } = require('./_fetch');

// Proveedor Google Gemini. Estilo chat (con system_instruction) y también sirve para tareas
// (system vacío + user = prompt). Extraído de ZENITH_WEB (callGemini) y lead-parser (processChunkWithGemini).
// @param {Object} cfg
// @param {string} [cfg.model]     Default 'gemini-2.5-flash'. Para extracción usar 'gemini-2.5-flash-lite'.
// @param {string} [cfg.apiKeyEnv] Default 'GEMINI_API_KEY'.
// @param {number} [cfg.timeoutMs] Default 20000.
module.exports = function gemini(cfg = {}) {
  const model = cfg.model || 'gemini-2.5-flash';
  const apiKeyEnv = cfg.apiKeyEnv || 'GEMINI_API_KEY';
  const timeoutMs = cfg.timeoutMs || 20000;

  return {
    provider: 'google',
    model,
    skip: () => !process.env[apiKeyEnv],
    async call({ system, user, history, maxTokens, temperature }) {
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) throw new Error(`${apiKeyEnv} no configurada`);

      const contents = [...history, { role: 'user', parts: [{ text: user }] }];
      const body = {
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      };
      if (system) body.system_instruction = { parts: [{ text: system }] };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, timeoutMs);

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini ${model} HTTP ${res.status}: ${detail.slice(0, 120)}`);
      }
      const data = await res.json();
      const text =
        data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      const usage = data && data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount || 0,
            outputTokens: data.usageMetadata.candidatesTokenCount || 0,
          }
        : null;
      return { text: (text || '').trim(), toolUse: null, content: null, usage };
    },
  };
};
