'use strict';

// Error que agrupa el fallo de TODOS los proveedores de la cadena.
// Conserva el detalle por proveedor para diagnóstico, sin filtrarlo al cliente final.
class RouterError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = 'RouterError';
    this.attempts = attempts || []; // [{ provider, model, error }]
  }
}

module.exports = { RouterError };
