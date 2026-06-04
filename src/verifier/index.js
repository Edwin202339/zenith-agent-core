'use strict';

// Patrón ejecutor → verificador → aplicador para acciones IRREVERSIBLES.
// Regla ZENITH (CLAUDE.md): efectos irreversibles (cancelar evento, enviar email/WhatsApp,
// escribir al Sheet) NUNCA en el discovery; solo tras confirmación. Aquí se formaliza:
//   1. propose()  produce la acción candidata SIN ejecutarla.
//   2. verify()   valida la propuesta (otro criterio/agente). Debe devolver true para continuar.
//   3. apply()    ejecuta el efecto real — solo si verify pasó.
// Si verify falla, apply NUNCA se llama. Úsese solo donde el error duele (no en todo: sería 3x el costo).

class VerificationError extends Error {
  constructor(message, proposal) {
    super(message);
    this.name = 'VerificationError';
    this.proposal = proposal;
  }
}

/**
 * @param {Object} steps
 * @param {Function} steps.propose  async (ctx) => proposal
 * @param {Function} steps.verify   async (proposal, ctx) => boolean
 * @param {Function} steps.apply    async (proposal, ctx) => result
 * @param {Function} [steps.onReject] async (proposal, ctx) => any — qué hacer si no pasa verify.
 * @param {Object} [ctx]
 * @returns {Promise<{ applied:boolean, proposal:any, result?:any, rejected?:any }>}
 */
async function proposeVerifyApply({ propose, verify, apply, onReject }, ctx = {}) {
  if (typeof propose !== 'function' || typeof verify !== 'function' || typeof apply !== 'function') {
    throw new TypeError('proposeVerifyApply requiere propose(), verify() y apply() como funciones');
  }

  const proposal = await propose(ctx);

  let ok;
  try {
    ok = await verify(proposal, ctx);
  } catch (err) {
    // Un verificador que lanza se trata como rechazo: ante la duda, NO se aplica el efecto irreversible.
    throw new VerificationError(`Verificación falló: ${err.message}`, proposal);
  }

  if (!ok) {
    const rejected = typeof onReject === 'function' ? await onReject(proposal, ctx) : undefined;
    return { applied: false, proposal, rejected };
  }

  const result = await apply(proposal, ctx);
  return { applied: true, proposal, result };
}

module.exports = { proposeVerifyApply, VerificationError };
