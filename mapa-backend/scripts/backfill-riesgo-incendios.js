#!/usr/bin/env node
/**
 * Reconstruye el historial del índice FWI de los 17 departamentos con
 * clima histórico real (estación más cercana — SiNaRaMe/INA vía SNIH o
 * Red Agrometeorológica INTA vía SIGA — completado con Open-Meteo donde
 * falte, ver climaPorDepartamento.js), para que el cron diario
 * (riesgoIncendiosIndiceService.js) arranque con la serie ya estabilizada
 * en vez de con la semilla de arranque de primavera (el FFMC/DMC/DC recién
 * prendido tarda unos días en asentarse — ver riesgoIncendiosIndiceCalculo.js).
 *
 * Uso: node scripts/backfill-riesgo-incendios.js [días=45]
 * Se puede correr de nuevo sin problema: cada fila se sobreescribe
 * (ON CONFLICT departamento_id+fecha), y sigue la recursión desde lo que
 * ya haya guardado, así que ir día por día en orden es obligatorio (no
 * se puede paralelizar entre fechas de un mismo departamento) — pero el
 * clima de todo el rango se pide de una sola vez por departamento, no
 * día por día.
 */
const path = require("path");
require("dotenv").config({ path: [path.join(__dirname, "..", ".env.local"), path.join(__dirname, "..", ".env")], quiet: true });

const { loadDepartamentos, loadCentroides } = require("../src/lib/departamentos");
const climaPorDepartamento = require("../src/lib/climaPorDepartamento");
const { calcularDepartamento } = require("../src/lib/riesgoIncendiosIndiceCalculo");
const store = require("../src/lib/store");

const fechaISO = (d) => d.toISOString().slice(0, 10);

async function main() {
  const dias = Number(process.argv[2]) || 45;
  await store.init();
  if (!store.usaPostgres()) {
    console.error("No hay DATABASE_URL configurado — el backfill necesita Postgres para persistir la serie.");
    process.exit(1);
  }

  const departamentos = loadDepartamentos();
  const centroides = loadCentroides();
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(desde.getDate() - dias);
  const hasta = new Date(hoy); hasta.setDate(hasta.getDate() - 1); // hasta ayer: hoy lo cubre el cron con datos "actuales", no históricos.
  const desdeISO = fechaISO(desde), hastaISO = fechaISO(hasta);

  let ok = 0, fallidos = 0;
  for (const d of departamentos) {
    const id = String(d.id);
    const centroide = centroides.get(id);
    console.log(`\n=== ${d.nombre} (id ${id}) — centroide ${centroide.lat.toFixed(3)},${centroide.lng.toFixed(3)} ===`);
    let serie;
    try {
      serie = await climaPorDepartamento.climaHistoricoPorDepartamento(id, centroide, desdeISO, hastaISO);
    } catch (e) {
      console.error(`  ERROR pidiendo el clima del rango: ${e.message}`);
      fallidos++;
      continue;
    }
    for (let i = dias; i >= 1; i--) {
      const fecha = new Date(hoy);
      fecha.setDate(fecha.getDate() - i);
      const iso = fechaISO(fecha);
      const clima = serie.get(iso);
      if (!clima) {
        console.error(`  ${iso}: sin clima (ni estación ni Open-Meteo respondieron para este día) — se salta.`);
        fallidos++;
        continue;
      }
      try {
        const r = await calcularDepartamento(id, iso, clima);
        console.log(`  ${iso} [${clima.fuente}${clima.fuente !== "openmeteo" ? `: ${clima.estacionNombre}` : ""}]: T=${clima.temperatura?.toFixed?.(1)}° H=${clima.humedad?.toFixed?.(0)}% W=${clima.viento?.toFixed?.(0)}km/h r=${clima.precipitacion?.toFixed?.(1)}mm -> FWI=${r.fwi.toFixed(1)} (${r.categoria})`);
        ok++;
      } catch (e) {
        console.error(`  ${iso}: ERROR calculando el índice: ${e.message}`);
        fallidos++;
      }
    }
  }
  console.log(`\nListo: ${ok} días calculados, ${fallidos} fallidos.`);
  process.exit(fallidos > 0 && ok === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
