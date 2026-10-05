/**
 * Si un ACP o una alerta queda FIJO en /tv (corta la rotación, a pantalla completa) o va como una
 * pantalla más de la rotación. Config por tipo (panel → Pantalla TV, ver tvStore.js del backend):
 *   { modo: "ciclo" | "fijo" | "rotacion", fijoMin, cadaMin, ancla, accion }
 * En "ciclo": fijo `fijoMin` minutos y después en la rotación, otra vez fijo a los `cadaMin`
 * minutos, y así. Se cuenta desde que el aviso empieza a verse (`desde`), salvo que después se
 * haya tocado un botón (`ancla` = cuándo, `accion` = cuál): «Fijar ahora» (el ciclo arranca ahí,
 * fijo) o «Pasar a la rotación ahora» (como si el rato fijo hubiera terminado ahí).
 */
export const CONFIG_PREDETERMINADA = { modo: "ciclo", fijoMin: 15, cadaMin: 60, ancla: null, accion: null };
const MIN = 60_000;

/** Lo que manda el backend → config completa (lo de antes era un booleano: false = sólo rotación). */
export function configDe(v) {
  if (v === false) return { ...CONFIG_PREDETERMINADA, modo: "rotacion" };
  return { ...CONFIG_PREDETERMINADA, ...(v && typeof v === "object" ? v : {}) };
}

/** El tipo de config que le toca a cada aviso de /tv. */
export const tipoDe = (u) => (u.tipo === "acp" ? "acp" : "alertas");

/** Desde cuándo se cuenta el ciclo de este aviso. */
function inicioDelCiclo(desde, cfg, ahora) {
  const d = Date.parse(desde), a = cfg.ancla ? Date.parse(cfg.ancla) : NaN;
  const t = Number.isFinite(d) && d <= ahora ? d : ahora;
  if (!Number.isFinite(a) || a > ahora || a < t) return t; // el botón es de antes de que apareciera: no cuenta
  return cfg.accion === "soltar" ? a - cfg.fijoMin * MIN : a;
}

/** { fijo, hasta }: si está fijo ahora y hasta cuándo dura ese estado (ms; null = mientras esté vigente). */
export function estadoUrgente(desde, cfg = CONFIG_PREDETERMINADA, ahora = Date.now()) {
  if (cfg.modo === "fijo") return { fijo: true, hasta: null };
  if (cfg.modo === "rotacion") return { fijo: false, hasta: null };
  const fijo = cfg.fijoMin * MIN, cada = Math.max(cfg.cadaMin * MIN, fijo + MIN);
  const t0 = inicioDelCiclo(desde, cfg, ahora);
  const fase = (ahora - t0) % cada, vuelta = ahora - fase;
  return fase < fijo ? { fijo: true, hasta: vuelta + fijo } : { fijo: false, hasta: vuelta + cada };
}
