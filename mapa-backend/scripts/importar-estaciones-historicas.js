#!/usr/bin/env node
// Importación única de las tres planillas SMN. Solo persiste observaciones, nunca archivos.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const store = require('../src/lib/store');
const historico = require('../src/lib/historicoEstacionesStore');

const archivos = [
  ['iguazu_aero', 'Iguazú Aero.xlsx'],
  ['bernardo_de_irigoyen_aero', 'Bernardo de Irigoyen Aero (1).xlsx'],
  ['posadas_aero', 'Posadas Aero .xlsx'],
];
const campos = ['estacion_id', 'fecha', 'temperatura_maxima', 'temperatura_minima',
  'temperatura_media', 'punto_rocio', 'presion_estacion', 'precipitacion',
  'humedad_relativa', 'heliofania', 'nubosidad', 'viento_maximo_direccion',
  'viento_maximo_intensidad', 'viento_medio_intensidad'];
const columnas = 'BCDEFGHIJKLM';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false });
const lista = x => x == null ? [] : Array.isArray(x) ? x : [x];

function fechaExcel(valor) {
  const serial = Number(valor);
  if (!Number.isInteger(serial) || serial < 1 || serial > 100000) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}
function numero(valor) {
  if (valor == null || valor === '' || valor === '\\N') return null;
  const n = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Número inválido: ${valor}`);
  return n;
}
async function leerArchivo(archivo, estacionId) {
  const zip = await JSZip.loadAsync(fs.readFileSync(archivo));
  const shared = zip.file('xl/sharedStrings.xml');
  const strings = shared ? lista(parser.parse(await shared.async('string')).sst.si)
    .map(si => lista(si.r).length ? lista(si.r).map(r => r.t?.['#text'] ?? r.t ?? '').join('') : si.t?.['#text'] ?? si.t ?? '') : [];
  const sheet = parser.parse(await zip.file('xl/worksheets/sheet1.xml').async('string'));
  const filas = [];
  let sinFecha = 0;
  for (const row of lista(sheet.worksheet.sheetData.row)) {
    if (Number(row.r) < 5) continue;
    const cells = {};
    for (const cell of lista(row.c)) {
      const col = String(cell.r).replace(/[0-9]/g, '');
      cells[col] = cell.t === 's' ? strings[Number(cell.v)] : cell.v ?? cell.is?.t ?? null;
    }
    const fecha = fechaExcel(cells.A);
    if (!fecha) { sinFecha++; continue; }
    filas.push([estacionId, fecha, ...Array.from(columnas, col => numero(cells[col]))]);
  }
  return { filas, sinFecha };
}

async function importar() {
  await historico.init();
  const db = store.getPool();
  const carpeta = process.argv[2] || path.join(__dirname, '..', '..');
  for (const [id, nombre] of archivos) {
    const { filas, sinFecha } = await leerArchivo(path.join(carpeta, nombre), id);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < filas.length; i += 300) {
        const lote = filas.slice(i, i + 300);
        const valores = lote.flat();
        const placeholders = lote.map((_, row) => `(${campos.map((__, col) => `$${row * campos.length + col + 1}`).join(',')})`).join(',');
        await client.query(`INSERT INTO observaciones_historicas (${campos.join(',')}) VALUES ${placeholders}
          ON CONFLICT (estacion_id,fecha) DO UPDATE SET ${campos.slice(2).map(c => `${c}=EXCLUDED.${c}`).join(',')}`, valores);
      }
      await client.query('COMMIT');
      console.log(`${id}: ${filas.length} observaciones; ${sinFecha} filas sin fecha excluidas`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }
  console.table(await historico.obtenerResumen());
}

importar().then(() => store.getPool().end()).catch(async e => {
  console.error(e); await store.getPool()?.end(); process.exitCode = 1;
});
