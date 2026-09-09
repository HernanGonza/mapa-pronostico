import { leerFuente, reconciliar, vigentes, colores } from './cap.mjs';
import * as store from './store.mjs';
export const INTERVALO = 5 * 60 * 1000;
const errores = {};
let actualizando = null;
const FUENTES_ACTIVAS = ['SAT'];

// Ejecuta una consulta completa bajo demanda. El lock evita que el botón de
// prueba y el sondeo periódico descarguen el SMN dos veces en paralelo.
export function actualizarAhora({ read = leerFuente, repository = store, logger = console } = {}) {
  if (actualizando) return actualizando;
  actualizando = Promise.allSettled(FUENTES_ACTIVAS.map(async fuente => {
    try {
      const previous = await repository.actual(fuente);
      const received = await read(fuente);
      const alcance = process.env.SMN_SCOPE || 'argentina';
      const datos = reconciliar((previous?.datos || []).filter(r => r.alcance === alcance), received);
      await repository.guardar(fuente, datos, previous?.revision || null);
      delete errores[fuente];
      const zonasResumen = received.flatMap(r => r.infos || []).flatMap(i => i.zonas || [])
        .map(z => `${z.nombre}${z.geocodigos?.length ? ` [${z.geocodigos.join(',')}]` : ''}`)
        .filter((v, i, a) => a.indexOf(v) === i).slice(0, 20).join(' | ');
      logger.info(`[SMN ${fuente}] consulta completada; recibidos ${received.length}, guardados ${datos.length}, vigentes ${vigentes(datos).length} · ${alcance}${zonasResumen ? ` · áreas: ${zonasResumen}` : ''}`);
    } catch (e) {
      errores[fuente] = `No se pudo actualizar desde el SMN: ${e.message}`;
      logger.error(`[SMN ${fuente}] ${e.message}`);
    }
  })).finally(() => { actualizando = null; });
  return actualizando;
}

export function iniciar({ read = leerFuente, repository = store, intervalMs = INTERVALO, logger = console } = {}) {
  let stopped = false;
  async function ejecutar() {
    if (stopped) return;
    return actualizarAhora({ read, repository, logger });
  }
  const timer = setInterval(ejecutar, intervalMs); timer.unref?.();
  void ejecutar();
  return { ejecutar, async detener() { stopped = true; clearInterval(timer); await actualizando; } };
}
export async function obtenerActual() {
  const fuentes = {};
  await Promise.all(FUENTES_ACTIVAS.map(async fuente => {
    const r = await store.actual(fuente);
    fuentes[fuente] = { consultadoEn: r?.consultadoEn || null, revision: r?.revision || null,
      desactualizado: !r || Date.now() - Date.parse(r.consultadoEn) > 2 * INTERVALO,
      error: errores[fuente] || null, alertas: vigentes(r?.datos || []) };
  }));
  return { fuente: 'SMN · RSS/CAP', alcance: process.env.SMN_SCOPE || 'argentina', intervaloSegundos: INTERVALO / 1000, colores, fuentes };
}
