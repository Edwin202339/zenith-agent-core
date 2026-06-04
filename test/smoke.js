'use strict';

// Smoke test SIN red: valida router (con providers mock), skills, memoria (file-store) y verificador.
// No toca APIs externas ni Postgres. Sale con código !=0 si algo falla → sirve como gate de CI.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRouter, RouterError } = require('../src/router');
const { SkillRegistry } = require('../src/skills');
const { Memory, FileStore } = require('../src/memory');
const { cosineSimilarity } = require('../src/memory/cosine');
const { proposeVerifyApply, VerificationError } = require('../src/verifier');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

// Provider mock: factory que devuelve { provider, model, skip, call }.
const mockProvider = (name, behavior) => ({
  provider: name,
  model: `${name}-model`,
  skip: () => false,
  call: async () => {
    if (behavior === 'throw') throw new Error(`${name} caído`);
    if (behavior === 'empty') return '   ';
    return `respuesta de ${name}`;
  },
});

(async () => {
  console.log('ROUTER');
  await test('primer proveedor sano gana', async () => {
    const r = createRouter({ providers: [mockProvider('A', 'ok'), mockProvider('B', 'ok')] });
    const out = await r.run({ user: 'hola' });
    assert.strictEqual(out.provider, 'A');
    assert.strictEqual(out.attempts, 1);
  });

  await test('cae al siguiente si el primero falla', async () => {
    const r = createRouter({ providers: [mockProvider('A', 'throw'), mockProvider('B', 'ok')] });
    const out = await r.run({ user: 'hola' });
    assert.strictEqual(out.provider, 'B');
    assert.strictEqual(out.attempts, 2);
  });

  await test('respuesta vacía cuenta como fallo y cae al siguiente', async () => {
    const r = createRouter({ providers: [mockProvider('A', 'empty'), mockProvider('B', 'ok')] });
    const out = await r.run({ user: 'hola' });
    assert.strictEqual(out.provider, 'B');
  });

  await test('salta proveedores con skip()=true', async () => {
    const skipped = { ...mockProvider('A', 'ok'), skip: () => true };
    const r = createRouter({ providers: [skipped, mockProvider('B', 'ok')] });
    const out = await r.run({ user: 'hola' });
    assert.strictEqual(out.provider, 'B');
  });

  await test('todos fallan → RouterError con detalle por proveedor', async () => {
    const r = createRouter({ providers: [mockProvider('A', 'throw'), mockProvider('B', 'throw')] });
    await assert.rejects(() => r.run({ user: 'hola' }), (e) => {
      assert.ok(e instanceof RouterError);
      assert.strictEqual(e.attempts.length, 2);
      return true;
    });
  });

  await test('telemetría recibe eventos sin romper si lanza', async () => {
    const events = [];
    const r = createRouter({
      providers: [mockProvider('A', 'throw'), mockProvider('B', 'ok')],
      onEvent: (e) => { events.push(e.type); throw new Error('telemetría rota'); },
    });
    await r.run({ user: 'hola' });
    assert.ok(events.includes('provider_error'));
    assert.ok(events.includes('provider_success'));
  });

  await test('rechaza request sin user', async () => {
    const r = createRouter({ providers: [mockProvider('A', 'ok')] });
    await assert.rejects(() => r.run({ user: '' }));
  });

  console.log('SKILLS');
  await test('dispatch ejecuta skill determinista (sin LLM)', async () => {
    const reg = new SkillRegistry();
    reg.register({
      name: 'normalize-phone',
      match: (input) => /\d/.test(input),
      run: (input) => input.replace(/\D/g, ''),
    });
    const out = await reg.dispatch('tel: 300-123-4567');
    assert.strictEqual(out.handled, true);
    assert.strictEqual(out.result, '3001234567');
  });

  await test('dispatch devuelve handled:false si nada aplica → caller va al LLM', async () => {
    const reg = new SkillRegistry();
    reg.register({ name: 'only-digits', match: (i) => /^\d+$/.test(i), run: (i) => i });
    const out = await reg.dispatch('texto libre sin match');
    assert.strictEqual(out.handled, false);
  });

  await test('resolve elige la skill de mayor score', async () => {
    const reg = new SkillRegistry();
    reg.register({ name: 'weak', match: () => 0.2, run: () => 'weak' });
    reg.register({ name: 'strong', match: () => 0.9, run: () => 'strong' });
    const m = reg.resolve('x');
    assert.strictEqual(m.name, 'strong');
  });

  await test('un match que lanza no tumba el dispatch', async () => {
    const reg = new SkillRegistry();
    reg.register({ name: 'boom', match: () => { throw new Error('x'); }, run: () => 'no' });
    reg.register({ name: 'safe', match: () => true, run: () => 'yes' });
    const out = await reg.dispatch('x');
    assert.strictEqual(out.result, 'yes');
  });

  console.log('MEMORY (file-store)');
  const tmpFile = path.join(os.tmpdir(), `zenith-mem-${Date.now()}.json`);
  await test('working: set/get/clear con TTL', async () => {
    const mem = new Memory(new FileStore(tmpFile));
    mem.remember('s1', 'nombre', 'ZENITH');
    assert.strictEqual(mem.recall('s1', 'nombre'), 'ZENITH');
    mem.remember('s1', 'temp', 'x', -1); // ya expirado
    assert.strictEqual(mem.recall('s1', 'temp'), undefined);
    mem.forget('s1');
    assert.strictEqual(mem.recall('s1', 'nombre'), undefined);
  });

  await test('episodic: append y query por tag', async () => {
    const mem = new Memory(new FileStore(tmpFile));
    mem.logEpisode({ tags: ['deploy'], summary: 'deploy ok' });
    mem.logEpisode({ tags: ['bug'], summary: 'fix regex' });
    const deploys = mem.episodes({ tag: 'deploy' });
    assert.strictEqual(deploys.length, 1);
    assert.strictEqual(deploys[0].summary, 'deploy ok');
  });

  await test('semantic: búsqueda por embedding manual (cosine)', async () => {
    const store = new FileStore(tmpFile);
    // embedFn falso e determinista para no tocar la red.
    const fakeEmbed = async (t) => (t.includes('perro') ? [1, 0, 0] : [0, 1, 0]);
    const mem = new Memory(store, { embedFn: fakeEmbed });
    await mem.learn('el perro ladra', { kind: 'animal' });
    await mem.learn('factura mensual', { kind: 'finanza' });
    const hits = await mem.search('perro grande', { topK: 1 });
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].metadata.kind, 'animal');
  });

  await test('relational: triples y consulta por comodín', async () => {
    const mem = new Memory(new FileStore(tmpFile));
    mem.relate('ZENITH', 'usa', 'Node.js');
    mem.relate('ZENITH', 'usa', 'Postgres');
    const usa = mem.relations({ subject: 'ZENITH', predicate: 'usa' });
    assert.strictEqual(usa.length, 2);
  });

  await test('persistencia: reabrir el archivo conserva datos', async () => {
    const mem2 = new Memory(new FileStore(tmpFile));
    assert.ok(mem2.relations({ subject: 'ZENITH' }).length >= 2);
  });

  await test('cosineSimilarity casos borde', () => {
    assert.strictEqual(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.strictEqual(cosineSimilarity([], [1]), 0);
  });

  console.log('VERIFIER');
  await test('aplica solo si verify pasa', async () => {
    let applied = false;
    const out = await proposeVerifyApply({
      propose: async () => ({ action: 'enviar-email' }),
      verify: async () => true,
      apply: async () => { applied = true; return 'enviado'; },
    });
    assert.strictEqual(applied, true);
    assert.strictEqual(out.applied, true);
    assert.strictEqual(out.result, 'enviado');
  });

  await test('NO aplica si verify falla; ejecuta onReject', async () => {
    let applied = false;
    let rejectedRan = false;
    const out = await proposeVerifyApply({
      propose: async () => ({ action: 'cancelar-evento' }),
      verify: async () => false,
      apply: async () => { applied = true; },
      onReject: async () => { rejectedRan = true; return 'bloqueado'; },
    });
    assert.strictEqual(applied, false);
    assert.strictEqual(rejectedRan, true);
    assert.strictEqual(out.applied, false);
    assert.strictEqual(out.rejected, 'bloqueado');
  });

  await test('verify que lanza → VerificationError, sin aplicar', async () => {
    let applied = false;
    await assert.rejects(
      () => proposeVerifyApply({
        propose: async () => ({}),
        verify: async () => { throw new Error('db caída'); },
        apply: async () => { applied = true; },
      }),
      (e) => e instanceof VerificationError
    );
    assert.strictEqual(applied, false);
  });

  // Limpieza
  try { fs.unlinkSync(tmpFile); } catch { /* noop */ }

  console.log(`\n${passed} pruebas pasaron${process.exitCode ? ' · CON FALLOS' : ' · OK ✓'}`);
})();
