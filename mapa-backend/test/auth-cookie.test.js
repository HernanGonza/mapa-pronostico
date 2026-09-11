const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/lib/auth');
const router = require('../src/routes/auth');

test('cookie de login: producción HTTPS por defecto y HTTP local explícito', async (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecure = process.env.SESSION_COOKIE_SECURE;
  t.after(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    if (originalSecure === undefined) delete process.env.SESSION_COOKIE_SECURE;
    else process.env.SESSION_COOKIE_SECURE = originalSecure;
  });
  t.mock.method(auth, 'verificarCredenciales', async () => ({ id: 1, email: 'test@example.com' }));
  t.mock.method(auth, 'crearSesion', async () => ({ token: 'test-token', expiraEn: new Date(Date.now() + 60000) }));
  const login = router.stack.find(layer => layer.route?.path === '/auth/login').route.stack.at(-1).handle;
  for (const [env, override, secure] of [
    ['production', undefined, true],
    ['production', 'false', false],
    ['production', 'invalid', true],
    ['development', undefined, false],
    ['development', 'true', true],
  ]) {
    process.env.NODE_ENV = env;
    if (override === undefined) delete process.env.SESSION_COOKIE_SECURE;
    else process.env.SESSION_COOKIE_SECURE = override;
    let cookie;
    await login({ body: { email: 'test@example.com', password: 'example' } }, {
      setHeader(name, value) { assert.equal(name, 'Set-Cookie'); cookie = value; },
      json() {},
    });
    assert.equal(/; Secure(?:;|$)/i.test(cookie), secure);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  }
});
