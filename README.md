# @zenith/agent-core

Runtime compartido para **todos** los agentes ZENITH. No es un producto: es la base que importan los cerebros (ZENITH_WEB, AURA Vet, lead-parser y los que vengan). **Cero dependencias en runtime** (`pg` es opcional). CommonJS — consumible desde ESM y CJS por igual.

> Por qué existe: hoy el router LLM está **copiado** en cada agente. Esto lo unifica en una sola fuente. Arreglas un bug del router o agregas un modelo nuevo **una vez**, y los tres agentes lo heredan.

---

## Las 4 piezas

| Pieza | Qué resuelve | Dónde se usa |
|---|---|---|
| **Router** | Multimodelo con fallback en cadena. Un proveedor cae → siguiente. | Todo agente que llame a un LLM |
| **Skills** | Determinismo primero: resuelve con código antes de gastar un token. | Donde repites lógica determinista |
| **Memory** | 4 capas (working/episodic/semantic/relational) sobre un store intercambiable. | Agentes que recuerdan entre sesiones |
| **Verifier** | propose→verify→apply para acciones irreversibles. | Calendar, email, WhatsApp, Sheets |
| **Telemetría Watch** | Reporta cada llamada LLM a ZENITH Watch (latencia/errores/fallback), fire-and-forget. | `onEvent: createWatchTelemetry()` en todo router |

---

## Router

```js
const { createRouter, providers } = require('@zenith/agent-core');

// Agente conversacional (estilo ZENITH_WEB): Haiku → Gemini 2.5 → Gemini 1.5
const router = createRouter({
  providers: [
    providers.anthropic({ model: 'claude-haiku-4-5-20251001' }),
    providers.gemini({ model: 'gemini-2.5-flash' }),
    providers.gemini({ model: 'gemini-1.5-flash' }),
  ],
  onEvent: (e) => console.log(`[router] ${e.type} ${e.provider} ${e.ms || ''}ms`),
});

const out = await router.run({
  system: 'Eres el agente de ZENITH...',
  user: 'quiero agendar una reunión',
  history: [],          // formato Gemini: [{ role:'user'|'model', parts:[{text}] }]
  maxTokens: 300,
});
// → { text, provider, model, attempts, ms }
```

```js
// Agente de extracción (estilo lead-parser): Gemini-lite → Groq → Ollama
const extractor = createRouter({
  providers: [
    providers.gemini({ model: 'gemini-2.5-flash-lite' }),
    providers.groq(),                       // llama 70b → 8b con fallback por rate-limit
    providers.ollama({ model: 'llama3.2:3b' }),
  ],
});
const { text } = await extractor.run({ user: PROMPT_DE_EXTRACCION });
```

Cada proveedor se **salta solo** si su key no está. Si ninguno responde → `RouterError` con el detalle por proveedor.

---

## Skills — determinismo primero

```js
const { SkillRegistry } = require('@zenith/agent-core');

const skills = new SkillRegistry();
skills.register({
  name: 'normalize-phone',
  match: (input) => /\d{7,}/.test(input),     // ¿aplica? true/score
  run:   (input) => input.replace(/\D/g, ''), // resuelve SIN LLM
});

const r = await skills.dispatch(userInput);
if (r.handled) usar(r.result);                // resuelto gratis
else respuesta = await router.run({ user: userInput }); // recién aquí se gasta token
```

Esta es la pieza que hace **rentable** al agente: el LLM es el fallback, no el centro.

---

## Memory — 4 capas, un store

```js
const { Memory, FileStore } = require('@zenith/agent-core');

const mem = new Memory(new FileStore('./.agent-memory.json')); // funciona hoy, sin infra

mem.remember(sessionId, 'mascota', 'Firulais', 30 * 60_000);  // working (TTL 30min)
mem.recall(sessionId, 'mascota');                              // 'Firulais'

mem.logEpisode({ tags: ['cita'], summary: 'agendó vacuna', resultado: 'ok' }); // episodic
mem.episodes({ tag: 'cita' });

await mem.learn('El cliente prefiere citas en la tarde', { clienteId: 42 });   // semantic
await mem.search('horario preferido del cliente', { topK: 3 });               // por significado

mem.relate('Firulais', 'pertenece_a', 'cliente-42');          // relational (grafo)
mem.relations({ subject: 'Firulais' });
```

**Al escalar** (decenas de miles de registros): cambia `FileStore` por `PostgresStore` — el agente no cambia.

```js
const { Memory, PostgresStore } = require('@zenith/agent-core');
// 1. psql < src/memory/schema.sql   (requiere extensión pgvector)
// 2. npm i pg
const mem = new Memory(new PostgresStore({ connectionString: process.env.DATABASE_URL }));
```

---

## Verifier — acciones irreversibles

```js
const { proposeVerifyApply } = require('@zenith/agent-core');

const r = await proposeVerifyApply({
  propose: async () => ({ to: cliente.email, asunto: 'Confirmación de cita' }),
  verify:  async (p) => isValidEmail(p.to) && !yaEnviado(p),  // otro criterio valida
  apply:   async (p) => sendEmail(p),                          // solo si verify pasó
  onReject: async (p) => log('email bloqueado', p),
});
// → { applied:boolean, proposal, result? | rejected? }
```

Úsalo **solo** donde el error duele (efectos irreversibles). En todo sería 3× el costo sin 3× el valor.

---

## Verificar

```bash
node --check index.js     # gate de sintaxis
npm test                  # 20 pruebas sin red (router/skills/memory/verifier)
```

---

Estándar completo y reglas de arquitectura: [`00_ESTANDARES/ARQUITECTURA_AGENTES.md`](../../00_ESTANDARES/ARQUITECTURA_AGENTES.md), sección **ZENITH Agent Core**.
