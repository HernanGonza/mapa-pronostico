const store = require("./store");
const auth = require("./auth");

/**
 * Alertas del SMN (SAT) que el operador eligió publicar en el embebido de
 * alertas meteorológicas, una fila por alerta. Se guarda una copia completa
 * (título, nivel, período, descripción, zonas con su polígono): el SMN la
 * reemplaza en el informe siguiente y lo publicado tiene que seguir igual.
 * Se ve hasta `vigente_hasta` (el fin de la alerta del SMN); despublicar =
 * `vigente_hasta = now()`. Mismo esquema que los avisos a muy corto plazo.
 */

let initPromise;
async function init() {
  if (!store.usaPostgres()) return;
  if (initPromise) return initPromise;
  await store.init();
  await auth.init();
  const p = store.getPool();
  initPromise = p
    .query(
      `CREATE TABLE IF NOT EXISTS alertas_smn_publicadas (
         id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         smn_id        text NOT NULL,
         publicado_por bigint REFERENCES usuarios(id),
         publicado_en  timestamptz NOT NULL DEFAULT now(),
         vigente_hasta timestamptz NOT NULL,
         datos         jsonb NOT NULL
       )`
    )
    .then(() => p.query(`CREATE INDEX IF NOT EXISTS alertas_smn_publicadas_vigente_idx ON alertas_smn_publicadas (vigente_hasta)`))
    .then(() => console.log("[alertasSmnPublicadasStore] Postgres listo (tabla alertas_smn_publicadas)"))
    .catch((e) => {
      initPromise = null;
      throw e;
    });
  return initPromise;
}

function sinBase() {
  return Object.assign(new Error("Publicar alertas del SMN necesita la base de datos."), { status: 503 });
}

const fila = (r) => ({
  id: Number(r.id),
  smnId: r.smn_id,
  publicadoEn: r.publicado_en.toISOString(),
  vigenteHasta: r.vigente_hasta.toISOString(),
  publicadoPorEmail: r.publicado_por_email || null,
  ...r.datos,
});

/** Lo que se guarda de una alerta del SMN: sólo lo que muestra el embebido. */
function copiaDe(alerta, info, colores = {}) {
  return {
    titulo: info.titulo,
    categoria: info.categoria,
    color: colores[info.categoria] || null,
    descripcion: info.descripcion,
    instrucciones: info.instrucciones,
    inicio: info.inicio,
    fin: info.fin,
    emitidoEn: alerta.emitidoEn,
    url: alerta.url || null,
    zonas: (info.zonas || []).map((z) => ({ nombre: z.nombre, departamentos: z.departamentos || [], geometry: z.geometry || null })),
  };
}

/**
 * Publica la alerta `smnId` ("<id del CAP>:<índice del info>") tomada de las
 * alertas SAT vigentes (`alertas`, lo mismo que ve el panel). Si ya está
 * publicada y vigente, devuelve esa misma (no la duplica). `colores`: nivel → color
 * del SMN, se guarda con la copia para que el embebido la pinte igual que el panel.
 */
async function publicar(smnId, alertas, usuarioId = null, colores = {}) {
  if (!store.usaPostgres()) throw sinBase();
  const corte = String(smnId).lastIndexOf(":");
  const alerta = alertas.find((a) => a.id === String(smnId).slice(0, corte));
  const info = alerta?.infos[Number(String(smnId).slice(corte + 1))];
  if (!info) throw Object.assign(new Error("Esa alerta del SMN ya no está vigente. Consultá de nuevo."), { status: 404 });
  if (!info.zonas?.some((z) => z.geometry)) throw Object.assign(new Error("La alerta no trae el área en el mapa: no se puede publicar."), { status: 400 });
  await init();
  const p = store.getPool();
  const { rows: ya } = await p.query(`SELECT * FROM alertas_smn_publicadas WHERE smn_id = $1 AND vigente_hasta > now() ORDER BY id DESC LIMIT 1`, [smnId]);
  if (ya.length) return fila(ya[0]);
  const { rows } = await p.query(
    `INSERT INTO alertas_smn_publicadas (smn_id, publicado_por, vigente_hasta, datos) VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
    [smnId, usuarioId, info.fin, JSON.stringify(copiaDe(alerta, info, colores))]
  );
  return fila(rows[0]);
}

async function despublicar(id) {
  if (!store.usaPostgres()) throw sinBase();
  await init();
  const { rowCount } = await store.getPool().query(`UPDATE alertas_smn_publicadas SET vigente_hasta = now() WHERE id = $1 AND vigente_hasta > now()`, [id]);
  if (!rowCount) throw Object.assign(new Error("La alerta no está publicada."), { status: 404 });
}

/** Las publicadas y todavía vigentes, por fecha de inicio (lo que muestra el embebido). */
async function obtenerVigentes() {
  if (!store.usaPostgres()) return [];
  await init();
  const { rows } = await store.getPool().query(
    `SELECT a.*, u.email AS publicado_por_email
       FROM alertas_smn_publicadas a LEFT JOIN usuarios u ON u.id = a.publicado_por
      WHERE a.vigente_hasta > now()
      ORDER BY a.datos->>'inicio', a.id`
  );
  return rows.map(fila);
}

module.exports = { init, publicar, despublicar, obtenerVigentes, copiaDe };
