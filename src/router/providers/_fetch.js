'use strict';

// fetch con timeout duro vía AbortController. Un proveedor colgado NUNCA debe colgar al agente.
// Node 18+ trae fetch/AbortController globales — sin dependencias.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timeout ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Convierte historial formato Gemini → formato chat OpenAI/Anthropic.
// Filtra mensajes vacíos: Anthropic los rechaza.
function historyToMessages(history, limit = 10) {
  return history
    .slice(-limit)
    .map((h) => ({
      role: h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user',
      content: (h.parts && h.parts[0] && h.parts[0].text ? h.parts[0].text : '').trim(),
    }))
    .filter((m) => m.content.length > 0);
}

module.exports = { fetchWithTimeout, historyToMessages };
