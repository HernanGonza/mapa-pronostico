const { test } = require("node:test");
const assert = require("node:assert/strict");
const { derivar, trozosDeRespuesta, valorEn, posicion, celdasDe } = require("../src/lib/monan");
const { valorMonan } = require("../src/lib/ensamble");

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} no está a ${tol} de ${b}`);

test("derivar: temperatura, humedad relativa y punto de rocío salen de T2, q2 y la presión", () => {
  const d = derivar({ t2m: 293.15, q2: 0.01, surface_pressure: 100000, u10: 0, v10: 0 });
  cerca(d.tc, 20, 0.01, "°C");
  cerca(d.hr, 68.4, 1.5, "humedad relativa"); // e = q·p/(0,622+0,378q) ≈ 16 hPa; es(20 °C) ≈ 23,4 hPa
  cerca(d.td, 13.9, 0.6, "punto de rocío");
  assert.ok(d.td < d.tc, "el rocío nunca supera a la temperatura");
});

test("derivar: el viento sale de u10 y v10, y la dirección es de DÓNDE sopla", () => {
  const norte = derivar({ u10: 0, v10: -5 }), este = derivar({ u10: -5, v10: 0 }), sur = derivar({ u10: 0, v10: 5 }), oeste = derivar({ u10: 5, v10: 0 });
  cerca(norte.vel, 18, 0.01, "5 m/s = 18 km/h");
  cerca(norte.dir, 0, 0.01); cerca(este.dir, 90, 0.01); cerca(sur.dir, 180, 0.01); cerca(oeste.dir, 270, 0.01);
});

test("derivar: ráfaga, lluvia acumulada (convectiva + de grilla), nubosidad y CAPE en las unidades del ensamble", () => {
  const d = derivar({ gust10m_max: 10, rainc: 3, rainnc: 4.5, cldfrac_tot_UPP: 0.87, sbcape: 1200, refl10cm_max: 37, updraft_helicity_max: 12 });
  assert.equal(d.rafaga, 36); assert.equal(d.lluviaAcc, 7.5); assert.equal(d.nub, 87); assert.equal(d.cape, 1200); assert.equal(d.refl, 37); assert.equal(d.uh, 12);
  assert.equal(derivar({ cape: 300 }).cape, 300, "el 10 km publica `cape`, el 3 km `sbcape`");
  assert.equal(derivar({}).tc, NaN, "sin datos no se inventa nada");
});

test("la posición de un valor en el archivo sale del bloque que lo contiene", () => {
  const d = { H: 2, W: 3, vars: { t2m: { "0,0": 100, "0,3": 200, "2,0": 300, "2,3": 400 } } };
  assert.equal(posicion(d, "t2m", 0, 0), 100);
  assert.equal(posicion(d, "t2m", 3, 4), 400 + ((3 - 2) * 3 + (4 - 3)) * 4);
  assert.equal(posicion(d, "t2m", 1, 5), 200 + (1 * 3 + 2) * 4);
});

test("celdasDe: la celda más cercana, con la longitud en 0–360", () => {
  const d = { lat: [-28, -27.5, -27], lon: [303, 304, 305] };
  assert.deepEqual(celdasDe(d, [{ lat: -27.45, lng: -56.2 }, { lat: -27.9, lng: -54.1 }]), [[1, 1], [0, 2]]);
});

const flotante = (x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return b; };
test("trozosDeRespuesta: varios rangos en un pedido (multipart), cada valor ubicado por su posición", () => {
  const sep = "ABC123";
  const parte = (ini, x) => `--${sep}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${ini}-${ini + 3}/999999\r\n\r\n${flotante(x).toString("latin1")}\r\n`;
  const cuerpo = Buffer.from(parte(1000, 21.5) + parte(5000, -3.25) + `--${sep}--\r\n`, "latin1");
  const trozos = trozosDeRespuesta(cuerpo, `multipart/byteranges; boundary=${sep}`, null);
  assert.equal(trozos.length, 2);
  assert.equal(valorEn(trozos, 1000), 21.5); assert.equal(valorEn(trozos, 5000), -3.25);
  assert.equal(valorEn(trozos, 3000), null, "lo que no se pidió no está");
});
test("trozosDeRespuesta: si el servidor une rangos que se tocan, los valores se siguen encontrando", () => {
  const dos = Buffer.concat([flotante(1.5), flotante(2.5)]); // un solo trozo de 8 bytes que cubre dos pedidos contiguos
  const trozos = trozosDeRespuesta(dos, "application/octet-stream", "bytes 400-407/12345");
  assert.equal(valorEn(trozos, 400), 1.5); assert.equal(valorEn(trozos, 404), 2.5);
});
test("trozosDeRespuesta: valores binarios con bytes parecidos a un separador no confunden", () => {
  const sep = "SEP";
  const raro = Buffer.from([0x2d, 0x2d, 0x53, 0x45]); // «--SE»
  const cuerpo = Buffer.concat([Buffer.from(`--${sep}\r\nContent-Range: bytes 8-11/100\r\n\r\n`, "latin1"), raro, Buffer.from(`\r\n--${sep}--\r\n`, "latin1")]);
  const t = trozosDeRespuesta(cuerpo, `multipart/byteranges; boundary=${sep}`, null);
  assert.equal(t.length, 1); assert.deepEqual([...t[0].datos], [...raro]);
});

// Una corrida de 3 km (horaria) y una de 10 km (cada 3 h), con la temperatura subiendo 1 °C por hora.
const H = 3600e3, init = Date.UTC(2026, 9, 12, 0);
const corrida = (paso, horas) => {
  const validos = []; for (let h = paso / H; h <= horas; h += paso / H) validos.push(init + h * H);
  const col = (f) => validos.map((t, k) => [f((t - init) / H, k)]);
  return { corrida: new Date(init).toISOString(), paso, validos, ser: { tc: col((h) => h), lluviaAcc: col((h) => h * 0.5), vel: col(() => 10), dir: col((h) => (h % 2 ? 350 : 10)), rafaga: col((h) => h * 2) } };
};
const art = (dia, hora) => `2026-10-${dia}T${String(hora).padStart(2, "0")}:00`; // hora de Misiones = UTC − 3

test("valorMonan (horario): máxima, mínima, promedio y dirección circular dentro de la ventana", () => {
  const m = corrida(H, 72);
  // 13/10 de 06:00 a 12:00 en Misiones = de 09 a 15 UTC del 13 = horas 33 a 39 de la corrida
  assert.equal(valorMonan(m, "tc", "max", 0, art(13, 6), art(13, 12)), 39);
  assert.equal(valorMonan(m, "tc", "min", 0, art(13, 6), art(13, 12)), 33);
  assert.equal(valorMonan(m, "tc", "mean", 0, art(13, 6), art(13, 12)), 36);
  const dir = valorMonan(m, "dir", "dir", 0, art(13, 6), art(13, 12)); // 4 muestras de 350° y 3 de 10°
  cerca(Math.min(dir, 360 - dir), 0, 5, "350° y 10° promedian norte (cruzando el 0), no 180°");
});
test("valorMonan (horario): la lluvia es el acumulado al final menos el de la hora anterior al comienzo", () => {
  const m = corrida(H, 72);
  cerca(valorMonan(m, "lluviaAcc", "sum", 0, art(13, 6), art(13, 12)), 0.5 * (39 - 32), 1e-9); // de la hora 32 a la 39
});
test("valorMonan: si la corrida no cubre toda la ventana, no hay dato (igual que ICON o GEM)", () => {
  const m = corrida(H, 72); // llega hasta el 15/10 00 UTC = 14/10 21:00 en Misiones
  assert.equal(valorMonan(m, "tc", "max", 0, art(14, 0), art(14, 23)), null, "el día entero no entra");
  assert.notEqual(valorMonan(m, "tc", "max", 0, art(14, 0), art(14, 21)), null);
  assert.equal(valorMonan(m, "tc", "max", 0, art(11, 0), art(11, 10)), null, "antes de que empiece la corrida");
  assert.equal(valorMonan(m, "inexistente", "max", 0, art(13, 0), art(13, 5)), null);
});
test("valorMonan (cada 3 h): usa las muestras que hay y la lluvia con la más cercana", () => {
  const m = corrida(3 * H, 264);
  // 13/10 de 00:00 a 23:00 en Misiones = de 03 UTC del 13 a 02 UTC del 14: las muestras son 03, 06, … 24 UTC (el 14 a las 00)
  // = horas 27, 30, … 48 de la corrida, así que la máxima es la última: 48
  assert.equal(valorMonan(m, "tc", "max", 0, art(13, 0), art(13, 23)), 48);
  cerca(valorMonan(m, "lluviaAcc", "sum", 0, art(13, 0), art(13, 23)), 0.5 * 24, 1e-9); // de las 00 a las 24 h
});
