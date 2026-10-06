import { leerFuente, reconciliar, depurarGuardados, unirZonas, vigentes, ultimaEmision, colores } from './cap.mjs';
import * as store from './store.mjs';
import colorAcp from '../colorAcp.js';
import alertasManuales from '../alertasMeteorologicasStore.js';
export const INTERVALO = 5 * 60 * 1000;
const errores = {};
let actualizando = null;
const FUENTES_ACTIVAS = ['SAT', 'ACP'];
const cachePorFuente = { SAT: new Map(), ACP: null }; // CAP ya leídos (ver leerFuente); los ACP se leen como siempre

// Ejecuta una consulta completa bajo demanda. El lock evita que el botón de
// prueba y el sondeo periódico descarguen el SMN dos veces en paralelo.
export function actualizarAhora({ read = leerFuente, repository = store, logger = console } = {}) {
  if (actualizando) return actualizando;
  actualizando = Promise.allSettled(FUENTES_ACTIVAS.map(async fuente => {
    try {
      const previous = await repository.actual(fuente);
      const received = await read(fuente, undefined, cachePorFuente[fuente]);
      const alcance = process.env.SMN_SCOPE || 'argentina';
      const datos = reconciliar(depurarGuardados((previous?.datos || []).filter(r => r.alcance === alcance), alcance), received);
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
      // SAT: sólo la última emisión (reemplaza a las anteriores). Los ACP son
      // avisos sueltos de corta duración: se muestran todos los vigentes.
      error: errores[fuente] || null, alertas: fuente === 'SAT' ? unirZonas(vigentes(ultimaEmision(r?.datos || []))) : vigentes(r?.datos || []) };
  }));
  // Los ACP no traen nivel en `severity`: va el de su titular («AVISO NARANJA…») o, si
  // no lo dice, el de la alerta (SMN o manual) en cuya vigencia caen (ver colorAcp.js). `acpAhora`: el de un ACP que se cree ya.
  const manuales = await alertasManuales.pendientes().then(colorAcp.intervalosManuales).catch(() => []);
  const intervalos = [...colorAcp.intervalosSmn(fuentes.SAT?.alertas), ...manuales];
  if (fuentes.ACP) fuentes.ACP.alertas = fuentes.ACP.alertas.map(r => ({ ...r, infos: r.infos.map(i => ({ ...i, ...colorAcp.colorDeAcp(intervalos, i.inicio, i.fin, colorAcp.nivelDeTitulo(i.titulo) || colorAcp.nivelDeTitulo(i.evento)) })) }));
  // Si los ACP vigentes ya dicen su nivel en el titular, el de ahora es el más alto de ésos.
  const ahora = Date.now(), niveles = { Amarillo: 1, Naranja: 2, Rojo: 3 };
  const delTitular = (fuentes.ACP?.alertas || []).flatMap(r => r.infos)
    .filter(i => Date.parse(i.inicio) <= ahora && Date.parse(i.fin) > ahora && colorAcp.nivelDeTitulo(i.titulo))
    .map(i => i.nivel).sort((a, b) => niveles[b] - niveles[a])[0] || null;
  const acpAhora = colorAcp.colorDeAcp(intervalos, new Date(ahora).toISOString(), undefined, delTitular);
  return { fuente: 'SMN · RSS/CAP', acpAhora, alcance: process.env.SMN_SCOPE || 'argentina', intervaloSegundos: INTERVALO / 1000, colores, fuentes };
}
