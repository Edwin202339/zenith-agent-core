'use strict';

// Store de memoria sobre PostgreSQL + pgvector. Mismo contrato que FileStore (intercambiables).
// `pg` es optionalDependency: se carga con require lazy SOLO al instanciar este store, para que
// el paquete funcione sin Postgres instalado mientras se use FileStore.
// Activar cuando la escala lo justifique (ver schema.sql). Métodos async (red).
class PostgresStore {
  constructor({ connectionString, pool } = {}) {
    let Pool;
    try {
      ({ Pool } = require('pg'));
    } catch {
      throw new Error(
        "PostgresStore requiere el paquete 'pg'. Instalar con: npm i pg — o usar FileStore mientras tanto."
      );
    }
    this.pool = pool || new Pool(connectionString ? { connectionString } : undefined);
  }

  // ── working ────────────────────────────────────────────────────────────────
  async workingSet(sessionId, key, value, ttlMs) {
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;
    await this.pool.query(
      `INSERT INTO mem_working (session_id, key, value, expires_at, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (session_id, key)
       DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [sessionId, key, JSON.stringify(value), expiresAt]
    );
  }

  async workingGet(sessionId, key) {
    const { rows } = await this.pool.query(
      `SELECT value, expires_at FROM mem_working WHERE session_id=$1 AND key=$2`,
      [sessionId, key]
    );
    if (!rows.length) return undefined;
    const row = rows[0];
    if (row.expires_at && Date.now() > new Date(row.expires_at).getTime()) {
      await this.pool.query(`DELETE FROM mem_working WHERE session_id=$1 AND key=$2`, [sessionId, key]);
      return undefined;
    }
    return row.value;
  }

  async workingClear(sessionId) {
    await this.pool.query(`DELETE FROM mem_working WHERE session_id=$1`, [sessionId]);
  }

  // ── episodic ───────────────────────────────────────────────────────────────
  async episodeAdd(episode) {
    const { tags = [], ...body } = episode;
    await this.pool.query(
      `INSERT INTO mem_episodic (tags, body) VALUES ($1,$2)`,
      [tags, JSON.stringify(body)]
    );
    return episode;
  }

  async episodeQuery({ tag, limit = 20 } = {}) {
    const { rows } = tag
      ? await this.pool.query(
          `SELECT body, at FROM mem_episodic WHERE $1 = ANY(tags) ORDER BY at DESC LIMIT $2`,
          [tag, limit]
        )
      : await this.pool.query(`SELECT body, at FROM mem_episodic ORDER BY at DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({ ...r.body, at: r.at }));
  }

  // ── semantic ─────────────────────────────────────────────────────────────────
  async semanticAdd({ id, text, embedding, metadata }) {
    const recId = id || `${Date.now()}`;
    await this.pool.query(
      `INSERT INTO mem_semantic (id, text, embedding, metadata)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET text=EXCLUDED.text, embedding=EXCLUDED.embedding, metadata=EXCLUDED.metadata`,
      [recId, text, embedding ? `[${embedding.join(',')}]` : null, JSON.stringify(metadata || {})]
    );
    return { id: recId, text, metadata: metadata || {} };
  }

  async semanticSearch(queryEmbedding, { topK = 5 } = {}) {
    if (!Array.isArray(queryEmbedding)) return [];
    const vec = `[${queryEmbedding.join(',')}]`;
    // 1 - distancia_coseno = similitud. Operador <=> de pgvector.
    const { rows } = await this.pool.query(
      `SELECT id, text, metadata, 1 - (embedding <=> $1) AS score
       FROM mem_semantic WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1 LIMIT $2`,
      [vec, topK]
    );
    return rows;
  }

  // ── relational ────────────────────────────────────────────────────────────────
  async relate(subject, predicate, object) {
    await this.pool.query(
      `INSERT INTO mem_relational (subject, predicate, object) VALUES ($1,$2,$3)`,
      [subject, predicate, object]
    );
  }

  async relations({ subject, predicate, object } = {}) {
    const where = [];
    const params = [];
    if (subject !== undefined) { params.push(subject); where.push(`subject=$${params.length}`); }
    if (predicate !== undefined) { params.push(predicate); where.push(`predicate=$${params.length}`); }
    if (object !== undefined) { params.push(object); where.push(`object=$${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT subject, predicate, object, at FROM mem_relational ${clause} ORDER BY at DESC`,
      params
    );
    return rows;
  }
}

module.exports = { PostgresStore };
