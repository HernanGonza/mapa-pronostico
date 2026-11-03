import test from "node:test";
import assert from "node:assert";
import { horizonteSat, limitarHorizonte } from "../src/lib/smn/cap.mjs";

// Emisión del domingo 1/11/2026 a las 19:38 de Misiones (el reloj del CAP es UTC: 22:38). SMN publica hasta pasado mañana (martes 3/11).
const emitidoEn = "2026-11-01T22:38:59.000Z";
const info = (inicio, fin) => ({ inicio, fin, zonas: [{ nombre: "x" }] });

test("el horizonte es la medianoche de Misiones del día siguiente al último que publica el SMN", () => {
  assert.equal(new Date(horizonteSat(emitidoEn)).toISOString(), "2026-11-04T03:00:00.000Z"); // miércoles 00:00 hora de Misiones
  assert.equal(new Date(horizonteSat("2026-11-02T01:30:00.000Z")).toISOString(), "2026-11-04T03:00:00.000Z"); // 22:30 del domingo local: sigue siendo domingo
});

test("los tramos del cuarto día (miércoles) no se toman y los que cruzan el límite se cortan", () => {
  const r = limitarHorizonte({ fuente: "SAT", emitidoEn, infos: [
    info("2026-11-01T22:38:59.000Z", "2026-11-02T14:59:59.000Z"), // lunes
    info("2026-11-03T21:00:00.000Z", "2026-11-04T08:59:59.000Z"), // martes 18 h → miércoles 06 h: se corta a la medianoche
    info("2026-11-04T09:00:00.000Z", "2026-11-04T20:59:59.000Z"), // miércoles 06 a 18 h: afuera
  ] });
  assert.equal(r.infos.length, 2);
  assert.equal(r.infos[1].fin, "2026-11-04T02:59:59.000Z");
});

test("no toca los avisos a muy corto plazo ni lo que ya está dentro", () => {
  const acp = { fuente: "ACP", emitidoEn, infos: [info("2026-11-01T22:38:59.000Z", "2026-11-05T20:59:59.000Z")] };
  assert.equal(limitarHorizonte(acp), acp);
  const dentro = { fuente: "SAT", emitidoEn, infos: [info("2026-11-01T22:38:59.000Z", "2026-11-02T14:59:59.000Z")] };
  assert.equal(limitarHorizonte(dentro), dentro);
});

test('una alerta naranja no desaparece porque salió otra emisión después; sólo la reemplaza una que la referencie', async () => {
  const { ultimaEmisionVigente } = await import('../src/lib/smn/cap.mjs');
  const fin = new Date(Date.now() + 3600e3).toISOString();
  const msg = (id, emitidoEn, referencias = []) => ({ id, emitidoEn, referencias, infos: [{ fin }] });
  const naranja = msg('urn:oid:2.49.0.1.32.0.2026.11.03.18.00.00.1', '2026-11-03T18:00:00Z');
  const amarilla = msg('urn:oid:2.49.0.1.32.0.2026.11.03.20.00.00.1', '2026-11-03T20:00:00Z');
  assert.deepEqual(ultimaEmisionVigente([naranja, amarilla]).map(r => r.id), [naranja.id, amarilla.id]);
  const act = msg('urn:oid:2.49.0.1.32.0.2026.11.03.21.00.00.1', '2026-11-03T21:00:00Z', ['urn:oid:2.49.0.1.32.0.2026.11.03.18.00.00']);
  assert.deepEqual(ultimaEmisionVigente([naranja, amarilla, act]).map(r => r.id), [amarilla.id, act.id]);
});
