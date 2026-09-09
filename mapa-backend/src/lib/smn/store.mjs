import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import legacy from '../store.js';
import { hash } from './cap.mjs';
import { generarImagen } from './image.mjs';
const dir = new URL('../../../data/store/', import.meta.url);
let initialized;
async function init() {
  if (!legacy.usaPostgres()) return;
  if (!initialized) initialized = legacy.init().then(() => legacy.getPool().query(readFileSync(new URL('../../../sql/smn.sql', import.meta.url), 'utf8'))).catch(e => { initialized = null; throw e; });
  await initialized;
}
export async function actual(fuente) {
  await init(); const pool = legacy.getPool();
  if (pool) {
    const { rows } = await pool.query('SELECT consultado_en, revision, datos, imagen FROM smn_estado WHERE fuente=$1', [fuente]);
    const r = rows[0]; return r ? { consultadoEn: r.consultado_en.toISOString(), revision: r.revision, datos: r.datos, imagen: r.imagen } : null;
  }
  try { const x = JSON.parse(await fs.readFile(new URL(`smn-${fuente}.json`, dir), 'utf8')); return { ...x, imagen: Buffer.from(x.imagen, 'base64') }; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function guardar(fuente, datos, expected, now = new Date()) {
  await init(); const revision = hash(datos), imagen = generarImagen(fuente, datos, now);
  const pool = legacy.getPool();
  if (!pool) {
    const previous = await actual(fuente);
    if ((previous?.revision || null) !== expected) throw new Error('SMN: revisión concurrente; se reintentará');
    const value = { consultadoEn: now.toISOString(), revision, datos, imagen: imagen.toString('base64') };
    await fs.mkdir(dir, { recursive: true });
    const target = new URL(`smn-${fuente}.json`, dir), tmp = new URL(`smn-${fuente}.${process.pid}.tmp`, dir);
    await fs.writeFile(tmp, JSON.stringify(value)); await fs.rename(tmp, target);
    return;
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '10s'");
    await c.query("SET LOCAL lock_timeout = '3s'");
    await c.query('SELECT pg_advisory_xact_lock(719235, $1)', [fuente === 'SAT' ? 1 : 2]);
    const { rows } = await c.query('SELECT revision FROM smn_estado WHERE fuente=$1', [fuente]);
    if ((rows[0]?.revision || null) !== expected) throw new Error('SMN: revisión concurrente; se reintentará');
    if (rows[0]?.revision !== revision) await c.query('INSERT INTO smn_historial(fuente,revision,datos) VALUES($1,$2,$3::jsonb)', [fuente, revision, JSON.stringify(datos)]);
    await c.query(`INSERT INTO smn_estado(fuente,consultado_en,revision,datos,imagen) VALUES($1,$2,$3,$4::jsonb,$5)
      ON CONFLICT(fuente) DO UPDATE SET consultado_en=EXCLUDED.consultado_en,revision=EXCLUDED.revision,datos=EXCLUDED.datos,imagen=EXCLUDED.imagen`, [fuente, now, revision, JSON.stringify(datos), imagen]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
