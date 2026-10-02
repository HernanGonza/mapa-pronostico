const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/lib/auth');
const router = require('../src/routes/auth');

const ruta = () => router.stack.find(l => l.route?.path === '/auth/usuarios/:id' && l.route.methods.put).route;
function response() { return { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; } }; }
const DATOS = { email: 'a@b.com', nombre: 'Ana', apellido: 'Paz', telefono: '3764000000', dni: '12345678', rol: 'admin' };

test('editar usuario: solo superadmin', () => {
  for (const rol of ['usuario', 'admin']) {
    const res = response(); let next = false;
    ruta().stack[1].handle({ usuario: { rol } }, res, () => { next = true; });
    assert.equal(res.code, 403); assert.equal(next, false);
  }
});

test('editar usuario: contraseña opcional, y si viene se valida', async t => {
  const spy = t.mock.method(auth, 'editarUsuario', async (id, d) => ({ id, ...d }));
  const handle = ruta().stack.at(-1).handle;
  const usuario = { rol: 'superadmin', usuarioId: 1 };

  const sin = response();
  await handle({ params: { id: '7' }, body: DATOS, usuario }, sin);
  assert.equal(sin.code, 200); assert.equal(spy.mock.calls[0].arguments[1].password, null);

  const distinta = response();
  await handle({ params: { id: '7' }, body: { ...DATOS, password: 'ClaveValida1!', repetirPassword: 'otra' }, usuario }, distinta);
  assert.equal(distinta.code, 400);

  const debil = response();
  await handle({ params: { id: '7' }, body: { ...DATOS, password: 'corta', repetirPassword: 'corta' }, usuario }, debil);
  assert.equal(debil.code, 400);

  const id = response();
  await handle({ params: { id: '0 OR 1=1' }, body: DATOS, usuario }, id);
  assert.equal(id.code, 400);
  assert.equal(spy.mock.callCount(), 1);
});
