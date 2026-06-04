'use strict';

const fs = require('fs');
const path = require('path');
const { cosineSimilarity } = require('../cosine');

// Store de memoria respaldado en un archivo JSON. FUNCIONA HOY, sin infraestructura.
// Cubre las 4 capas con una sola pieza, adecuado hasta decenas de miles de registros:
//   working    — estado efímero por sesión (clave→valor, con TTL opcional)
//   episodic   — experiencias append-only (proyecto/error/solución/resultado)
//   semantic   — registros con embedding opcional → búsqueda por similitud (cosine)
//   relational — triples (subject, predicate, object) → consultas de grafo simples
// Escritura atómica (tmp + rename) para no corromper el archivo ante un crash a mitad de write.
class FileStore {
  constructor(filePath) {
    if (!filePath) throw new TypeError('FileStore requiere una ruta de archivo');
    this.filePath = filePath;
    this._data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        working: parsed.working || {},
        episodic: Array.isArray(parsed.episodic) ? parsed.episodic : [],
        semantic: Array.isArray(parsed.semantic) ? parsed.semantic : [],
        relational: Array.isArray(parsed.relational) ? parsed.relational : [],
      };
    } catch {
      // Archivo inexistente o corrupto → arrancar limpio. No es un error fatal.
      return { working: {}, episodic: [], semantic: [], relational: [] };
    }
  }

  _persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this._data), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  // ── working ────────────────────────────────────────────────────────────────
  workingSet(sessionId, key, value, ttlMs) {
    const ns = (this._data.working[sessionId] = this._data.working[sessionId] || {});
    ns[key] = { value, expiresAt: ttlMs ? Date.now() + ttlMs : null };
    this._persist();
  }

  workingGet(sessionId, key) {
    const entry = this._data.working[sessionId] && this._data.working[sessionId][key];
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      delete this._data.working[sessionId][key];
      this._persist();
      return undefined;
    }
    return entry.value;
  }

  workingClear(sessionId) {
    delete this._data.working[sessionId];
    this._persist();
  }

  // ── episodic ───────────────────────────────────────────────────────────────
  episodeAdd(episode) {
    const record = { ...episode, at: episode.at || new Date().toISOString() };
    this._data.episodic.push(record);
    this._persist();
    return record;
  }

  episodeQuery({ tag, limit = 20 } = {}) {
    let rows = this._data.episodic;
    if (tag) rows = rows.filter((e) => Array.isArray(e.tags) && e.tags.includes(tag));
    return rows.slice(-limit).reverse();
  }

  // ── semantic ─────────────────────────────────────────────────────────────────
  semanticAdd({ id, text, embedding, metadata }) {
    const record = {
      id: id || `${Date.now()}-${this._data.semantic.length}`,
      text,
      embedding: Array.isArray(embedding) ? embedding : null,
      metadata: metadata || {},
      at: new Date().toISOString(),
    };
    this._data.semantic.push(record);
    this._persist();
    return record;
  }

  // Búsqueda por significado. Requiere que el caller pase el embedding de la query.
  semanticSearch(queryEmbedding, { topK = 5, minScore = 0 } = {}) {
    if (!Array.isArray(queryEmbedding)) return [];
    return this._data.semantic
      .filter((r) => Array.isArray(r.embedding))
      .map((r) => ({ ...r, score: cosineSimilarity(queryEmbedding, r.embedding) }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ── relational (grafo) ───────────────────────────────────────────────────────
  relate(subject, predicate, object) {
    this._data.relational.push({ subject, predicate, object, at: new Date().toISOString() });
    this._persist();
  }

  // Consulta de triples por cualquier combinación de campos (los undefined son comodín).
  relations({ subject, predicate, object } = {}) {
    return this._data.relational.filter((t) =>
      (subject === undefined || t.subject === subject) &&
      (predicate === undefined || t.predicate === predicate) &&
      (object === undefined || t.object === object)
    );
  }
}

module.exports = { FileStore };
