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

import { separarFuturas } from '../src/lib/smn/service.mjs';
test('las infos Future se separan de las publicables', () => {
  const { publicables, proximas } = separarFuturas([{ id: 'a', infos: [{ urgencia: 'Expected' }, { urgencia: 'Future' }] }, { id: 'b', infos: [{ urgencia: 'Future' }] }]);
  assert.equal(publicables.length, 1); assert.equal(publicables[0].infos.length, 1);
  assert.equal(proximas.length, 2);
});
