'use strict';

// Generador de embeddings vía Gemini (text-embedding-004, 768 dims). Opcional: solo se usa
// si quieres memoria semántica con búsqueda por significado. ZENITH ya tiene GEMINI_API_KEY.
// Si no hay key, lanza — el caller decide si la semántica es opcional para su caso.
// @param {string} text
// @param {Object} [cfg] { apiKeyEnv='GEMINI_API_KEY', model='text-embedding-004', timeoutMs=15000 }
// @returns {Promise<number[]>} vector de 768 dimensiones.
async function embed(text, cfg = {}) {
  const apiKeyEnv = cfg.apiKeyEnv || 'GEMINI_API_KEY';
  const model = cfg.model || 'text-embedding-004';
  const timeoutMs = cfg.timeoutMs || 15000;
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) throw new Error(`${apiKeyEnv} no configurada — embeddings requieren key`);
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('embed requiere texto no vacío');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}`);
    const data = await res.json();
    const values = data && data.embedding && data.embedding.values;
    if (!Array.isArray(values)) throw new Error('respuesta de embeddings inválida');
    return values;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`embeddings timeout ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { embed };
