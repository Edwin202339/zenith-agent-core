'use strict';

const { FileStore } = require('./stores/file-store');
const { PostgresStore } = require('./stores/postgres-store');
const { cosineSimilarity } = require('./cosine');
const { embed } = require('./embeddings');

// Facade de memoria en 4 capas sobre un store intercambiable (FileStore hoy, PostgresStore al escalar).
// El agente habla con Memory; nunca con el store directo. Cambiar de backend = cambiar el store,
// sin tocar la lógica del agente.
class Memory {
  /**
   * @param {Object} store  Instancia de FileStore o PostgresStore (mismo contrato).
   * @param {Object} [opts] { embedFn } — generador de embeddings para helpers semánticos. Default Gemini.
   */
  constructor(store, opts = {}) {
    if (!store) throw new TypeError('Memory requiere un store (FileStore o PostgresStore)');
    this.store = store;
    this._embed = opts.embedFn || embed;
  }

  // ── working ──
  remember(sessionId, key, value, ttlMs) { return this.store.workingSet(sessionId, key, value, ttlMs); }
  recall(sessionId, key) { return this.store.workingGet(sessionId, key); }
  forget(sessionId) { return this.store.workingClear(sessionId); }

  // ── episodic ──
  logEpisode(episode) { return this.store.episodeAdd(episode); }
  episodes(query) { return this.store.episodeQuery(query); }

  // ── semantic ──
  // Guarda texto generando su embedding automáticamente (si hay key). El embedding habilita
  // la búsqueda por significado posterior.
  async learn(text, metadata = {}, id) {
    let embedding = null;
    try {
      embedding = await this._embed(text);
    } catch {
      // Sin embedding el registro se guarda igual (recuperable por otros medios), pero no
      // participará en semanticSearch. Degradación explícita, no fallo silencioso.
      embedding = null;
    }
    return this.store.semanticAdd({ id, text, embedding, metadata });
  }

  // Busca conocimiento por significado. Embebe la query y delega al store.
  async search(queryText, opts) {
    const queryEmbedding = await this._embed(queryText);
    return this.store.semanticSearch(queryEmbedding, opts);
  }

  // ── relational (grafo) ──
  relate(subject, predicate, object) { return this.store.relate(subject, predicate, object); }
  relations(filter) { return this.store.relations(filter); }
}

module.exports = { Memory, FileStore, PostgresStore, cosineSimilarity, embed };
