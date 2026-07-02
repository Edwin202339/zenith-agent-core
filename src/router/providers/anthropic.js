'use strict';

const { fetchWithTimeout, historyToMessages } = require('./_fetch');

// Proveedor Anthropic (Claude). Estilo chat. Extraído de ZENITH_WEB api/server.js (callHaiku).
// Desde v1.1 soporta tool-calling nativo (request.tools / request.toolChoice) y turnos
// crudos (request.rawMessages, formato Anthropic con content blocks) — lo que necesitan
// los agentes tipo AURA para agendar/cancelar con herramientas.
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
    supportsTools: true,
    supportsRawMessages: true,
    skip: () => !process.env[apiKeyEnv],
    async call({ system, user, history, maxTokens, temperature, tools, toolChoice, rawMessages }) {
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) throw new Error(`${apiKeyEnv} no configurada`);

      // rawMessages (formato Anthropic, con content blocks) tiene prioridad: es el camino
      // de los turnos de seguimiento de tool-calling (assistant blocks + tool_result).
      const messages = Array.isArray(rawMessages) && rawMessages.length > 0
        ? rawMessages
        : [...historyToMessages(history), { role: 'user', content: user }];

      const body = { model, max_tokens: maxTokens, messages, temperature };
      if (system) body.system = system;
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = toolChoice || { type: 'auto' };
      }

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
      const blocks = (data && data.content) || [];
      const textBlock = blocks.find((b) => b && b.type === 'text');
      const toolBlock = blocks.find((b) => b && b.type === 'tool_use');

      return {
        text: ((textBlock && textBlock.text) || '').trim(),
        toolUse: toolBlock ? { id: toolBlock.id, name: toolBlock.name, input: toolBlock.input } : null,
        // content crudo completo: necesario para armar el turno assistant del follow-up de tools.
        content: blocks,
        usage: data && data.usage
          ? { inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0 }
          : null,
      };
    },
  };
};
