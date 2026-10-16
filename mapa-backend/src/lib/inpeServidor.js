/**
 * Lo común de leer los modelos del CPTEC/INPE (BAM, Eta) del servidor de datos abiertos: listar carpetas, pedir tramos de bytes de archivos
 * de varios GB sin bajarlos enteros y repartir el trabajo en paralelo. El servidor atiende pedidos con varios rangos a la vez
 * (`Range: bytes=a-b,c-d`), que es lo que hace posible leer sólo lo necesario.
 *
 * ATENCIÓN: es el mismo servidor del que el INPE sacó el MONAN 3 km el 13/10 (pasó a pedir usuario y clave): si algún día pide clave,
 * `listar` lo dice con un mensaje claro y el modelo queda «sin datos» sin romper nada más.
 */
const { trozosDeRespuesta } = require("./monan");

const BASE = "https://dataserver.cptec.inpe.br/dataserver_modelos";
const TIMEOUT_MS = 90000;
const RANGOS_POR_PEDIDO = 40; // un encabezado Range muy largo lo rechazan los servidores

async function pedir(url, opciones = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opciones, signal: controller.signal }); }
  catch (e) { throw e.name === "AbortError" ? new Error(`INPE: tiempo de espera agotado (${url.split("/").slice(-2).join("/")}).`) : e; }
  finally { clearTimeout(timer); }
}

/** Nombres de archivo y carpetas de una carpeta del servidor; null si no existe. */
async function listar(url) {
  const r = await pedir(url, {}, 30000);
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error("el CPTEC/INPE pasó esta carpeta a usuario y clave (HTTP 401): hay que pedirles acceso.");
  if (!r.ok) throw new Error(`INPE: HTTP ${r.status} al listar ${url}.`);
  return [...(await r.text()).matchAll(/<a href="([^"?]+)">/g)].map((m) => decodeURIComponent(m[1])).filter((x) => !x.startsWith("/"));
}

async function tamanoDe(url) {
  const r = await pedir(url, { method: "HEAD" }, 30000);
  return r.ok ? Number(r.headers.get("content-length")) : null;
}

async function enParalelo(trabajos, n, hacer) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, trabajos.length) }, async () => { while (i < trabajos.length) await hacer(trabajos[i++]); }));
}

/**
 * Lee tramos [ini, fin] (inclusive) de `url` → arreglo de Buffers en el mismo orden. Si el servidor contesta algo que no sea 206 (por ejemplo
 * el archivo entero, que son GB) corta con un error en vez de bajarlo. Un tramo que se pasa del final del archivo vuelve más corto (hasta donde hay):
 * quien llama es quien sabe cuánto esperaba.
 */
async function leerRangos(url, rangos) {
  const salida = new Array(rangos.length);
  for (let a = 0; a < rangos.length; a += RANGOS_POR_PEDIDO) {
    const lote = rangos.slice(a, a + RANGOS_POR_PEDIDO);
    let trozos = null;
    for (let intento = 0; intento < 3 && !trozos; intento++) {
      try {
        const r = await pedir(url, { headers: { Range: `bytes=${lote.map(([i, f]) => `${i}-${f}`).join(",")}` } });
        if (r.status !== 206) { r.body?.cancel?.(); throw Object.assign(new Error(`INPE: HTTP ${r.status} al leer ${url.split("/").pop()} (se esperaba 206).`), { definitivo: true }); }
        trozos = trozosDeRespuesta(Buffer.from(await r.arrayBuffer()), r.headers.get("content-type"), r.headers.get("content-range"));
      } catch (e) { if (intento === 2 || e.definitivo) throw e; await new Promise((res) => setTimeout(res, 1500 * (intento + 1))); }
    }
    lote.forEach(([ini, fin], k) => {
      // Un trozo que cubra todo el tramo; si no hay (el tramo se pasa del final del archivo), el que lo empieza.
      const t = trozos.find((x) => x.ini <= ini && x.ini + x.datos.length > fin) || trozos.filter((x) => x.ini <= ini && x.ini + x.datos.length > ini).sort((a, b) => b.datos.length - a.datos.length)[0];
      if (!t) throw new Error(`INPE: el servidor no devolvió el tramo ${ini}-${fin} de ${url.split("/").pop()}.`);
      salida[a + k] = t.datos.subarray(ini - t.ini, fin - t.ini + 1);
    });
  }
  return salida;
}

const pad = (n, l = 2) => String(n).padStart(l, "0");
/** «AAAAMMDDHH» (UTC) de un instante en ms. */
const idHora = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`; };
const msDeId = (id) => Date.UTC(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8), +id.slice(8, 10));
const carpetaDelDia = (base, ms) => { const d = new Date(ms); return `${base}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/00/`; };

module.exports = { BASE, pedir, listar, tamanoDe, enParalelo, leerRangos, idHora, msDeId, carpetaDelDia, pad };
