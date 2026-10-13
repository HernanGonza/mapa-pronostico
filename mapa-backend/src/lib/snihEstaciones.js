/**
 * Estaciones de Misiones del SNIH (Sistema Nacional de Información Hídrica, https://snih.hidricosargentina.gob.ar)
 * de las redes que usan los Informes diarios además de las 4 de SiNaRaMe (sinarame.js):
 *   - RMET, Red Meteorológica: temperatura, humedad, viento, dirección, lluvia y presión, una lectura por hora.
 *   - RHN, Red Hidrológica Nacional: sobre todo altura de ríos; algunas miden además lluvia y, pocas, el resto.
 *     Cada una reporta cada hora o cada 4 horas.
 * La lista no está escrita a mano: se pide al sitio (`Filtros.aspx/LeerEstaciones`, las 1.434 del país) y se queda con las de la
 * red y de Misiones que no están dadas de baja, y de cada una se mira qué mide hoy (`LeerDatosActuales`). Entran sólo las que
 * midieron algo del tiempo en los últimos 60 días; las que nunca reportaron o están muertas se dejan afuera.
 * Los códigos de medición son los del SNIH (ver CODIGOS). El sitio muestra unos términos de uso al entrar desde el navegador
 * («los datos a tiempo útil son el registro crudo del sensor, no validado»); estos pedidos son los mismos que ya usa sinarame.js.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "https://snih.hidricosargentina.gob.ar";
const PROVINCIA_MISIONES = 18; // en las 58 estaciones del recuadro de Misiones, 54 son de la provincia 18 y 4 de Corrientes
const REDES_SNIH = { rmet: { codigo: 28, red: "RMET" }, rhn: { codigo: 1, red: "RHN" } };
/** Códigos de medición del SNIH → campo. */
const CODIGOS = { viento: 4, direccion: 5, radiacion: 12, temperatura: 14, humedad: 18, lluvia: 20, presion: 218, altura: 1 };
const DEL_TIEMPO = [CODIGOS.temperatura, CODIGOS.humedad, CODIGOS.viento, CODIGOS.lluvia];
const DIAS_VIGENTE = 60, TIMEOUT_MS = 40000, VIGENCIA_MS = 6 * 3600e3;
const ARCHIVO = path.join(os.tmpdir(), "snih-estaciones-misiones.json");

async function post(ruta, cuerpo) {
  const r = await fetch(`${BASE}/${ruta}`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`SNIH: HTTP ${r.status}.`);
  const j = await r.json();
  if (j?.d?.RespuestaOK === false) throw new Error(`SNIH: ${j.d.MsgErr || "respuesta no OK"}.`);
  return j.d;
}
const msDe = (s) => { const m = /-?\d+/.exec(String(s ?? "")); return m ? Number(m[0]) : null; };
/** «Posadas - Misiones» → «Posadas»; «Uruguay - San Javier» → «Uruguay, San Javier». */
const limpiarNombre = (d) => String(d).replace(/\s*-\s*Misiones\s*$/i, "").replace(/\s+-\s+/g, ", ").replace(/\s+/g, " ").trim();

async function enParalelo(trabajos, n, hacer) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, trabajos.length) }, async () => { while (i < trabajos.length) await hacer(trabajos[i++]); }));
}

const cache = new Map(); // red → { t, estaciones } | { promesa }
/**
 * Las estaciones de Misiones de la red (`rmet` | `rhn`) que midieron algo del tiempo hace menos de 60 días:
 * [{ clave, id, nombre, lat, lng, red, horaria: true, codigos: [códigos que mide], ultimaMs }].
 */
async function estacionesDeRed(redId) {
  const red = REDES_SNIH[redId];
  if (!red) throw new Error(`Red desconocida: ${redId}.`);
  const guardada = cache.get(redId);
  if (guardada?.promesa) return guardada.promesa;
  if (guardada && Date.now() - guardada.t < VIGENCIA_MS) return guardada.estaciones;

  const promesa = (async () => {
    const todas = await post("Filtros.aspx/LeerEstaciones", {});
    const ahora = Date.now();
    const candidatas = todas.filter((e) => e.Red === red.codigo && e.Provincia === PROVINCIA_MISIONES && !(msDe(e.Baja) < ahora));
    const estaciones = [];
    await enParalelo(candidatas, 6, async (e) => {
      let med = [];
      for (let intento = 0; intento < 2 && !med.length; intento++) { try { med = (await post("MuestraDatos.aspx/LeerDatosActuales", { estacion: e.Codigo })).Mediciones || []; } catch { /* se reintenta una vez */ } }
      const codigos = [...new Set(med.map((m) => m.Codigo))];
      const ultimaMs = Math.max(0, ...med.map((m) => msDe(m.FechaHora) || 0));
      if (!codigos.some((c) => DEL_TIEMPO.includes(c)) || ahora - ultimaMs > DIAS_VIGENTE * 86400e3) return; // sólo altura de río, o sin datos recientes
      estaciones.push({ clave: `${redId}-${e.Codigo}`, id: String(e.Codigo), nombre: limpiarNombre(e.Descripcion), lat: -Math.abs(e.Latitud), lng: -Math.abs(e.Longitud), red: red.red, horaria: true, codigos, ultimaMs });
    });
    estaciones.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    cache.set(redId, { t: Date.now(), estaciones });
    try { fs.writeFileSync(ARCHIVO, JSON.stringify({ ...leerArchivo(), [redId]: { t: Date.now(), estaciones } })); } catch { /* sólo es un respaldo */ }
    return estaciones;
  })().catch((err) => {
    // Si el SNIH no responde, se sigue con la última lista que se pudo armar (aunque sea vieja).
    const respaldo = leerArchivo()[redId];
    cache.delete(redId);
    if (respaldo?.estaciones?.length) { console.error("[SNIH] no se pudo actualizar la lista de", redId, "-", err.message, "(se usa la última guardada)"); return respaldo.estaciones; }
    throw err;
  });
  cache.set(redId, { promesa });
  return promesa;
}
function leerArchivo() { try { return JSON.parse(fs.readFileSync(ARCHIVO, "utf8")); } catch { return {}; } }

module.exports = { estacionesDeRed, REDES_SNIH, CODIGOS, limpiarNombre, msDe };
