const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { leerRangos } = require("../src/lib/inpeServidor");

// Servidor de prueba que atiende `Range` con varios tramos (como Apache) sobre un archivo de 1000 bytes donde cada byte vale su posición % 251.
const archivo = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
function servidor({ unirSolapados = false, responderTodo = false } = {}) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      if (responderTodo || !req.headers.range) { res.writeHead(200); return res.end(archivo); }
      let r = req.headers.range.replace("bytes=", "").split(",").map((x) => x.split("-").map(Number)).map(([a, b]) => [a, Math.min(b, archivo.length - 1)]);
      if (unirSolapados) { r.sort((x, y) => x[0] - y[0]); r = r.reduce((acc, t) => { const u = acc.at(-1); if (u && t[0] <= u[1] + 1) u[1] = Math.max(u[1], t[1]); else acc.push([...t]); return acc; }, []); }
      const sep = "BORDE";
      const partes = r.map(([a, b]) => Buffer.concat([Buffer.from(`--${sep}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${a}-${b}/${archivo.length}\r\n\r\n`), archivo.subarray(a, b + 1), Buffer.from("\r\n")]));
      res.writeHead(206, { "Content-Type": `multipart/byteranges; boundary=${sep}` });
      res.end(Buffer.concat([...partes, Buffer.from(`--${sep}--\r\n`)]));
    }).listen(0, () => ok({ s, url: `http://127.0.0.1:${s.address().port}/f` }));
  });
}

test("leerRangos devuelve cada tramo en su orden, también con tramos que se superponen o que el servidor une", async () => {
  for (const unir of [false, true]) {
    const { s, url } = await servidor({ unirSolapados: unir });
    try {
      const r = await leerRangos(url, [[10, 13], [12, 15], [500, 503], [11, 11]]);
      assert.deepEqual(r.map((b) => [...b]), [[10, 11, 12, 13], [12, 13, 14, 15], [500 % 251, 501 % 251, 502 % 251, 503 % 251], [11]], `unirSolapados=${unir}`);
    } finally { s.close(); }
  }
});

test("leerRangos: un tramo que se pasa del final vuelve más corto", async () => {
  const { s, url } = await servidor();
  try { const [b] = await leerRangos(url, [[995, 1100]]); assert.equal(b.length, 5); } finally { s.close(); }
});

test("leerRangos corta si el servidor contesta el archivo entero en vez de los tramos (no se bajan GB)", async () => {
  const { s, url } = await servidor({ responderTodo: true });
  try { await assert.rejects(leerRangos(url, [[0, 3]]), /HTTP 200/); } finally { s.close(); }
});
