'use strict';

// Registro de skills: la pieza que hace rentable al agente.
// Principio: DETERMINISMO PRIMERO. Antes de gastar un token, se intenta resolver con código.
// El LLM es el fallback, no el centro. Esto invierte la pirámide de costo.
//
// Cada skill: { name, match(input, ctx) => boolean|number, run(input, ctx) => any }
//   - match: devuelve true / un score (>0) si la skill aplica, o false / 0 si no.
//   - run:   resuelve la tarea SIN LLM. Idealmente puro e idempotente.
// resolve() elige la skill de mayor score. dispatch() la ejecuta o señala que hay que ir al LLM.

class SkillRegistry {
  constructor() {
    /** @type {Array<{name:string, match:Function, run:Function}>} */
    this._skills = [];
  }

  /**
   * Registra una skill determinista.
   * @returns {SkillRegistry} this — encadenable.
   */
  register(skill) {
    if (!skill || typeof skill.name !== 'string' || !skill.name) {
      throw new TypeError('register requiere skill.name (string no vacío)');
    }
    if (typeof skill.match !== 'function' || typeof skill.run !== 'function') {
      throw new TypeError(`skill "${skill.name}" requiere match() y run() como funciones`);
    }
    if (this._skills.some((s) => s.name === skill.name)) {
      throw new Error(`skill "${skill.name}" ya está registrada`);
    }
    this._skills.push(skill);
    return this;
  }

  /** Lista los nombres registrados (para introspección/observabilidad). */
  list() {
    return this._skills.map((s) => s.name);
  }

  /**
   * Encuentra la skill de mayor score para un input. No la ejecuta.
   * @returns {{name, run, score}|null}
   */
  resolve(input, ctx = {}) {
    let best = null;
    let bestScore = 0;
    for (const s of this._skills) {
      let score;
      try {
        score = s.match(input, ctx);
      } catch {
        // Un match que lanza se trata como "no aplica" — nunca tumba el dispatch.
        score = 0;
      }
      const numeric = score === true ? 1 : (typeof score === 'number' ? score : 0);
      if (numeric > bestScore) {
        bestScore = numeric;
        best = s;
      }
    }
    return best ? { name: best.name, run: best.run, score: bestScore } : null;
  }

  /**
   * Resuelve y ejecuta. Si ninguna skill aplica, devuelve { handled:false } para que
   * el caller escale al LLM. Distingue el fallo de la skill (lo propaga) de "no aplica".
   * @returns {Promise<{handled:true, skill:string, result:any} | {handled:false}>}
   */
  async dispatch(input, ctx = {}) {
    const match = this.resolve(input, ctx);
    if (!match) return { handled: false };
    const result = await match.run(input, ctx);
    return { handled: true, skill: match.name, result };
  }
}

module.exports = { SkillRegistry };
