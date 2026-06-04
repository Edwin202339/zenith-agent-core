'use strict';

// Barrel del runtime compartido de agentes ZENITH.
// Importar desde aquí mantiene un único punto de entrada estable para los 3 cerebros
// (ZENITH_WEB, AURA Vet, lead-parser) sin acoplarlos a rutas internas del paquete.

const router = require('./src/router');
const skills = require('./src/skills');
const memory = require('./src/memory');
const verifier = require('./src/verifier');

module.exports = {
  // Router multimodelo
  createRouter: router.createRouter,
  providers: router.providers,
  RouterError: router.RouterError,

  // Registro de skills (determinismo primero, LLM al final)
  SkillRegistry: skills.SkillRegistry,

  // Memoria en capas
  Memory: memory.Memory,
  FileStore: memory.FileStore,
  PostgresStore: memory.PostgresStore,
  cosineSimilarity: memory.cosineSimilarity,

  // Verificador de acciones irreversibles
  proposeVerifyApply: verifier.proposeVerifyApply,
  VerificationError: verifier.VerificationError,
};
