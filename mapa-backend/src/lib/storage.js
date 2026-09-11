/**
 * Cliente mínimo para Supabase Storage (self-hosted, en la misma
 * instancia de ecodatos) — sin sumar `@supabase/supabase-js`, alcanza
 * con `fetch` nativo (Node 18+, ya es el mínimo del proyecto) pegándole
 * directo a la API REST del servicio `storage-api`, mismo criterio de
 * "sin SDK/ORM de más" que ya usa el resto del backend con `pg`.
 *
 * Requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno.
 * El bucket se crea una sola vez a mano (no hace falta crearlo acá).
 */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "alerta-temprana";

function base() {
  return (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function habilitado() {
  return !!(base() && serviceKey());
}

/** Sube (o sobreescribe) un archivo al bucket. `ruta` es relativa al bucket. */
async function subirArchivo(ruta, buffer, contentType = "image/png") {
  if (!habilitado()) throw new Error("Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${base()}/storage/v1/object/${BUCKET}/${ruta}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      apikey: serviceKey(),
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`Storage respondió ${res.status}: ${detalle}`);
  }
}

/** URL pública de un objeto (el bucket se crea como público). */
function urlPublica(ruta) {
  return `${base()}/storage/v1/object/public/${BUCKET}/${ruta}`;
}

module.exports = { subirArchivo, urlPublica, habilitado, BUCKET };
