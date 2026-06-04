-- Esquema de memoria ZENITH para PostgreSQL + pgvector.
-- Activar cuando la escala supere lo que el file-store maneja cómodo (decenas de miles de registros).
-- Requiere: CREATE EXTENSION IF NOT EXISTS vector;  (extensión pgvector)

CREATE EXTENSION IF NOT EXISTS vector;

-- working: estado efímero por sesión (clave→valor con expiración opcional).
CREATE TABLE IF NOT EXISTS mem_working (
  session_id  TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL,
  expires_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, key)
);

-- episodic: experiencias append-only (proyecto / error / solución / resultado).
CREATE TABLE IF NOT EXISTS mem_episodic (
  id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tags   TEXT[]      NOT NULL DEFAULT '{}',
  body   JSONB       NOT NULL,
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mem_episodic_tags ON mem_episodic USING GIN (tags);

-- semantic: conocimiento con embedding para búsqueda por significado.
-- 768 = dimensión de text-embedding-004 (Gemini). Ajustar al modelo que se use.
CREATE TABLE IF NOT EXISTS mem_semantic (
  id        TEXT PRIMARY KEY,
  text      TEXT        NOT NULL,
  embedding vector(768),
  metadata  JSONB       NOT NULL DEFAULT '{}',
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Índice ANN para búsquedas rápidas por similitud coseno.
CREATE INDEX IF NOT EXISTS idx_mem_semantic_embedding
  ON mem_semantic USING hnsw (embedding vector_cosine_ops);

-- relational: triples (sujeto, predicado, objeto) → grafo de conocimiento.
CREATE TABLE IF NOT EXISTS mem_relational (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject   TEXT        NOT NULL,
  predicate TEXT        NOT NULL,
  object    TEXT        NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mem_relational_spo ON mem_relational (subject, predicate, object);
