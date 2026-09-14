const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const auth = require('../src/lib/auth');
const recovery = require('../src/lib/passwordRecovery');
const router = require('../src/routes/auth');

test('normalización: acepta código pegado y rechaza tipos/tamaños inesperados', () => {
  assert.equal(recovery.normalizarCodigo('ABCD-1234 abcd\n5678'), 'abcd1234abcd5678');
  assert.equal(recovery.normalizarCodigo({}), '');
  assert.equal(recovery.normalizarCodigo('a'.repeat(81)), '');
});

test('emisión exige superadmin y confirmación; cambio público valida repetición', async t => {
  const issue = router.stack.find(l => l.route?.path === '/auth/usuarios/:id/recuperacion').route;
  function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; } }; }
  for (const rol of ['usuario', 'admin']) {
    const res = response(); let next = false;
    issue.stack[2].handle({ usuario: { rol } }, res, () => { next = true; });
    assert.equal(res.code, 403); assert.equal(next, false);
  }
  const spy = t.mock.method(recovery, 'generar', async () => { throw Error('No debe emitir'); });
  const res = response();
  await issue.stack.at(-1).handle({ params: { id: '1' }, body: { telefono: '123' }, usuario: { usuarioId: 1 } }, res);
  assert.equal(res.code, 400); assert.equal(spy.mock.callCount(), 0);
  const reset = router.stack.find(l => l.route?.path === '/auth/recuperacion').route.stack.at(-1).handle;
  const responseReset = response();
  await reset({ body: { codigo: 'code', password: 'ClaveValida123!', repetirPassword: 'otra' } }, responseReset);
  assert.equal(responseReset.code, 400);
});

// Opt-in: una base descartable, nunca DATABASE_URL de la aplicación.
test('Postgres: recuperación completa y concurrencia', { skip: !process.env.RECOVERY_TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.RECOVERY_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) || url.searchParams.get('host')?.startsWith('/tmp/'), 'Usar una base temporal local');
  process.env.DATABASE_URL = process.env.RECOVERY_TEST_DATABASE_URL;
  process.env.DATABASE_SSL = 'false';
  const store = require('../src/lib/store');
  await recovery.init();
  const pool = store.getPool();
  t.after(() => pool.end());
  const marker = crypto.randomBytes(8).toString('hex');
  const actor = await auth.crearUsuario({ email: `actor-${marker}@test.invalid`, password: 'Anterior123!', rol: 'superadmin', telefono: '111' });
  const usuario = await auth.crearUsuario({ email: `usuario-${marker}@test.invalid`, password: 'Anterior123!', rol: 'usuario', telefono: '3764000000', dni: '12345678', nombre: 'Prueba', apellido: 'Local', dependencia: 'Ecología' });
  t.after(async () => { /* La base completa es descartable; no se borran filas de otras pruebas. */ });
  await t.test('solo actor superadmin y teléfono confirmado pueden emitir', async () => {
    await assert.rejects(recovery.generar(usuario.id, usuario.id, usuario.telefono), e => e.status === 403);
    await assert.rejects(recovery.generar(usuario.id, actor.id, 'otro'), e => e.status === 400);
  });
  let emitido;
  const sesion = await auth.crearSesion(usuario.id);
  const actorSesion = await auth.crearSesion(actor.id);
  const credencialesAnteriores = await auth.verificarCredenciales(usuario.email, 'Anterior123!');
  await t.test('emite 128 bits, guarda solo hash y expira en 15 minutos', async () => {
    emitido = await recovery.generar(usuario.id, actor.id, usuario.telefono);
    assert.match(emitido.codigo, /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
    const { rows } = await pool.query('SELECT * FROM recuperaciones_password WHERE usuario_id = $1', [usuario.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].codigo_hash, crypto.createHash('sha256').update(recovery.normalizarCodigo(emitido.codigo)).digest('hex'));
    assert.equal(new Date(rows[0].expira_en) - new Date(rows[0].creado_en), 900000);
    assert.equal(rows[0].emitido_por, actor.id);
    assert.equal(await auth.obtenerSesion(sesion.token) !== null, true);
  });
  await t.test('reemisión invalida anterior y código equivocado no modifica cuenta', async () => {
    const anterior = emitido;
    emitido = await recovery.generar(usuario.id, actor.id, usuario.telefono);
    await assert.rejects(recovery.restablecer(anterior.codigo, 'NuevaClave123!'), e => e.message === recovery.ERROR_CODIGO);
    await assert.rejects(recovery.restablecer('f'.repeat(32), 'NuevaClave123!'), e => e.message === recovery.ERROR_CODIGO);
    assert.ok(await auth.verificarCredenciales(usuario.email, 'Anterior123!'));
  });
  await t.test('vencimiento comprobado en base', async () => {
    await pool.query("UPDATE recuperaciones_password SET expira_en = clock_timestamp() - interval '1 second' WHERE usuario_id = $1", [usuario.id]);
    await assert.rejects(recovery.restablecer(emitido.codigo, 'NuevaClave123!'), e => e.message === recovery.ERROR_CODIGO);
    emitido = await recovery.generar(usuario.id, actor.id, usuario.telefono);
  });
  await t.test('una sola petición concurrente consume; preserva perfil y revoca sesiones', async () => {
    const antes = (await auth.listarUsuarios()).find(u => u.id === usuario.id);
    const results = await Promise.allSettled([recovery.restablecer(emitido.codigo, 'NuevaClave123!'), recovery.restablecer(emitido.codigo, 'NuevaClave123!')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.deepEqual((await auth.listarUsuarios()).find(u => u.id === usuario.id), antes);
    assert.equal(await auth.obtenerSesion(sesion.token), null);
    assert.ok(await auth.obtenerSesion(actorSesion.token));
    assert.equal(await auth.verificarCredenciales(usuario.email, 'Anterior123!'), null);
    assert.ok(await auth.verificarCredenciales(usuario.email, 'NuevaClave123!'));
    await assert.rejects(recovery.restablecer(emitido.codigo, 'OtraClave123!'), e => e.message === recovery.ERROR_CODIGO);
    assert.equal(await auth.crearSesion(usuario.id, credencialesAnteriores.passwordHash), null, 'Un login iniciado con hash antiguo no revive la sesión');
  });
  await t.test('fallo al cerrar sesiones revierte contraseña y consumo', async () => {
    const codigo = await recovery.generar(usuario.id, actor.id, usuario.telefono);
    const connect = pool.connect.bind(pool);
    t.mock.method(pool, 'connect', async (...args) => {
      const client = await connect(...args);
      const query = client.query.bind(client);
      const release = client.release.bind(client);
      client.query = (...args) => args[0].startsWith('DELETE FROM sesiones') ? Promise.reject(new Error('Fallo simulado')) : query(...args);
      client.release = () => { client.query = query; client.release = release; release(); };
      return client;
    });
    await assert.rejects(recovery.restablecer(codigo.codigo, 'OtraClave123!'), /Fallo simulado/);
    t.mock.restoreAll();
    assert.ok(await auth.verificarCredenciales(usuario.email, 'NuevaClave123!'));
    await recovery.restablecer(codigo.codigo, 'OtraClave123!');
    assert.ok(await auth.verificarCredenciales(usuario.email, 'OtraClave123!'));
  });
});
