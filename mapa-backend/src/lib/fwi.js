/**
 * Sistema canadiense de Índice Meteorológico de Incendios (FWI — Fire
 * Weather Index, Van Wagner 1987) — puerto directo de
 * generadorreporteincendiomisiones.LogicaDeNegocio.CalculoIndice (ECOSOTAT,
 * Java, Subsecretaría de Ordenamiento Territorial de Misiones), función
 * por función, misma nomenclatura de variables que el original (F/m/H/T/W,
 * P=DMC, D=DC, R=ISI, U=BUI, S=FWI) para poder compararlo línea a línea.
 *
 * Son todas funciones puras: cada código de humedad (FFMC/DMC/DC) se
 * calcula a partir del código de AYER + el clima de HOY (T=temperatura °C,
 * H=humedad relativa %, W=viento km/h, r0=lluvia de las últimas 24h en
 * mm). No hay estado acá — la serie día a día la persiste
 * riesgoIncendiosIndiceStore.js.
 *
 * Las tablas de duración del día (LONGITUD_DIA para DMC, FACTOR_LONGITUD_DIA
 * para DC) NO son las tablas estándar del manual canadiense (hemisferio
 * norte): están adaptadas al hemisferio sur, calibradas a mano para la
 * latitud de Posadas en el original — se copian tal cual.
 */

// Horas de luz por mes (para DMC, ecuación 16) — enero=índice 0.
const LONGITUD_DIA = [13.666, 13.016, 12.266, 11.433, 10.766, 10.416, 10.55, 11.133, 11.916, 12.716, 13.466, 13.85];
// Factor de longitud de día por mes (para DC, ecuación 22) — enero=índice 0.
const FACTOR_LONGITUD_DIA = [6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8];

function validarMes(mes) {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new Error(`FWI: el mes debe ser un entero entre 1 y 12 (recibido: ${mes}).`);
}

// ---------------------------------------------------------------------------
// FFMC (Fine Fuel Moisture Code)
// ---------------------------------------------------------------------------
function ffmcM0(F0) { return (147.2 * (101 - F0)) / (59.5 + F0); }
function ffmcRf(r0) { return r0 - 0.5; }
function ffmcMrMenor(m0, rf) {
  // Válida cuando m0 <= 150 (ecuación 8/9 del manual, rama de lluvia).
  return m0 + 42.5 * rf * Math.exp(-100 / (251 - m0)) * (1 - Math.exp(-6.93 / rf));
}
function ffmcMrMayor(m0, rf) {
  // Válida cuando m0 > 150.
  return ffmcMrMenor(m0, rf) + 0.0015 * (m0 - 150) ** 2 * Math.sqrt(rf);
}
function ffmcMr(m0, rf) { return m0 <= 150 ? ffmcMrMenor(m0, rf) : ffmcMrMayor(m0, rf); }
function ffmcEd(H, T) {
  return 0.942 * H ** 0.679 + 11 * Math.exp((H - 100) / 10) + 0.18 * (21.1 - T) * (1 - Math.exp(-0.115 * H));
}
function ffmcEw(H, T) {
  return 0.618 * H ** 0.753 + 10 * Math.exp((H - 100) / 10) + 0.18 * (21.1 - T) * (1 - Math.exp(-0.115 * H));
}
function ffmcK0(H, W) { return 0.424 * (1 - (H / 100) ** 1.7) + 0.0694 * Math.sqrt(W) * (1 - (H / 100) ** 8); }
function ffmcKd(H, W, T) { return ffmcK0(H, W) * 0.581 * Math.exp(0.0365 * T); }
function ffmcKl(H, W) { return 0.424 * (1 - ((100 - H) / 100) ** 1.7) + 0.0694 * Math.sqrt(W) * (1 - ((100 - H) / 100) ** 8); }
function ffmcKw(kl, T) { return kl * 0.581 * Math.exp(0.0365 * T); }
function ffmcMEc8(Ed, m0, kd) { return Ed + (m0 - Ed) * 10 ** -kd; }
function ffmcMEc9(Ew, m0, kw) { return Ew - (Ew - m0) * 10 ** -kw; }
function ffmcFDeM(m) { return (59.5 * (250 - m)) / (147.2 + m); }

/** m = contenido de humedad del combustible fino luego del secado/mojado
 * (paso intermedio del FFMC, se reutiliza también para el ISI). */
function ffmcCalcularM(F0, r0, H, T, W) {
  if ([F0, r0, H, T, W].some((v) => v == null || Number.isNaN(v))) throw new Error("FWI: falta algún dato para calcular el FFMC.");
  let m0 = ffmcM0(F0);
  if (r0 > 0.5) {
    const rf = ffmcRf(r0);
    m0 = Math.min(ffmcMr(m0, rf), 250);
  }
  const Ed = ffmcEd(H, T);
  let m = null;
  if (m0 > Ed) m = ffmcMEc8(Ed, m0, ffmcKd(H, W, T));
  if (m0 < Ed) {
    const Ew = ffmcEw(H, T);
    if (m0 < Ew) m = ffmcMEc9(Ew, m0, ffmcKw(ffmcKl(H, W), T));
    if (Ed >= m0 && m0 >= Ew) m = m0;
  }
  if (m == null) throw new Error("FWI: no se pudo calcular m (humedad del combustible fino) — revisar los datos de entrada.");
  return m;
}

function calcularFFMC(F0, r0, H, T, W) { return ffmcFDeM(ffmcCalcularM(F0, r0, H, T, W)); }

// ---------------------------------------------------------------------------
// DMC (Duff Moisture Code)
// ---------------------------------------------------------------------------
function dmcRe(r0) { return 0.92 * r0 - 1.27; }
function dmcM0(P0) { return 20 + Math.exp(5.6348 - P0 / 43.3); }
function dmcB(P0) {
  if (P0 <= 33) return 100 / (0.5 + 0.3 * P0);
  if (P0 <= 65) return 14 - 1.3 * Math.log(P0);
  return 6.2 * Math.log(P0) - 17.2;
}
function dmcMr(M0, re, b) { return M0 + (1000 * re) / (48.77 + b * re); }
function dmcPr(Mr) { return Math.max(0, 244.72 - 43.43 * Math.log(Mr - 20)); }
function dmcK(T, H, Le) { return 1.894 * (Math.max(-1.1, T) + 1.1) * (100 - H) * Le * 1e-6; }

function calcularDMC(P0, r0, mes, T, H) {
  validarMes(mes);
  if (r0 > 1.5) {
    const re = dmcRe(r0), M0 = dmcM0(P0), b = dmcB(P0);
    P0 = dmcPr(dmcMr(M0, re, b));
  }
  const K = dmcK(T, H, LONGITUD_DIA[mes - 1]);
  return P0 + 100 * K;
}

// ---------------------------------------------------------------------------
// DC (Drought Code)
// ---------------------------------------------------------------------------
function dcRd(r0) { return 0.83 * r0 - 1.27; }
function dcQ0(D0) { return 800 * Math.exp(-D0 / 400); }
function dcQr(Q0, rd) { return Q0 + 3.937 * rd; }
function dcDr(Qr) { return 400 * Math.log(800 / Qr); }
function dcV(T, Lf) { return 0.36 * (T + 2.8) + Lf; }

function calcularDC(D0, r0, mes, T) {
  validarMes(mes);
  T = Math.max(-2.8, T);
  if (r0 > 2.8) {
    const rd = dcRd(r0), Q0 = dcQ0(D0);
    D0 = Math.max(0, dcDr(dcQr(Q0, rd)));
  }
  const V = dcV(T, FACTOR_LONGITUD_DIA[mes - 1]);
  return D0 + 0.5 * V;
}

// ---------------------------------------------------------------------------
// ISI (Initial Spread Index)
// ---------------------------------------------------------------------------
function isiFW(W) { return Math.exp(0.05039 * W); }
function isiFF(m) { return 91.9 * Math.exp(-0.1386 * m) * (1 + m ** 5.31 / (4.93 * 10 ** 7)); }

function calcularISI(F0, r0, H, T, W) {
  const m = ffmcCalcularM(F0, r0, H, T, W);
  return 0.208 * isiFW(W) * isiFF(m);
}

// ---------------------------------------------------------------------------
// BUI (Buildup Index)
// ---------------------------------------------------------------------------
function calcularBUI(P, D) {
  // P = DMC, D = DC.
  if (P <= 0.4 * D) return (0.8 * P * D) / (P + 0.4 * D);
  return P - (1 - (0.8 * D) / (P + 0.4 * D)) * (0.92 + (0.0114 * P) ** 1.7);
}

// ---------------------------------------------------------------------------
// FWI (Fire Weather Index)
// ---------------------------------------------------------------------------
function calcularFWI(U, R) {
  // U = BUI, R = ISI.
  const fD = U <= 80 ? 0.626 * U ** 0.809 + 2 : 1000 / (25 + 108.64 * Math.exp(-0.023 * U));
  const B = 0.1 * R * fD;
  return B > 1 ? Math.exp(2.72 * (0.434 * Math.log(B)) ** 0.647) : B;
}

/**
 * Calcula el día completo (los 6 códigos) a partir de ayer (F0/DMC0/DC0) y
 * el clima de hoy. `mes` es 1-12 (mes calendario de la fecha del cálculo).
 */
function calcularDia({ F0, DMC0, DC0, r0, H, T, W, mes }) {
  const FFMC = calcularFFMC(F0, r0, H, T, W);
  const DMC = calcularDMC(DMC0, r0, mes, T, H);
  const DC = calcularDC(DC0, r0, mes, T);
  // La pantalla de producción de ECOSOTAT pasa el FFMC recién calculado
  // a calcular_isi(), que vuelve a calcular m con el clima de hoy.
  // Aunque difiera de la formulación canadiense habitual, la sugerencia
  // automática debe reproducir el resultado que ven los técnicos.
  const ISI = calcularISI(FFMC, r0, H, T, W);
  const BUI = calcularBUI(DMC, DC);
  const FWI = calcularFWI(BUI, ISI);
  return { FFMC, DMC, DC, ISI, BUI, FWI };
}

const CATEGORIAS = ["BAJO", "MODERADO", "ALTO", "MUY ALTO", "EXTREMO"];

/**
 * Clasifica el FWI contra los umbrales de una zona — mismo criterio que
 * CalculoIndice.evaluarIndiceDinamico de ECOSOTAT: redondea el FWI al
 * entero más cercano y lo compara contra una cadena de intervalos como
 * "[-100,1];(1,3];(3,9];(9,16];(16,100]" (corchete = límite inclusivo,
 * paréntesis = exclusivo), en el mismo orden que CATEGORIAS.
 */
function clasificar(fwi, criterios) {
  const redondeado = Math.round(fwi);
  const intervalos = criterios.split(";");
  for (let i = 0; i < intervalos.length; i++) {
    const intervalo = intervalos[i];
    const [a, b] = intervalo.replace(/[[\]()]/g, "").split(",").map(Number);
    const cumpleInferior = intervalo.startsWith("(") ? redondeado > a : redondeado >= a;
    const cumpleSuperior = intervalo.endsWith(")") ? redondeado < b : redondeado <= b;
    if (cumpleInferior && cumpleSuperior) return CATEGORIAS[i];
  }
  // Los intervalos de ECOSOTAT ponen un techo arbitrario (ej. "100") dando
  // por hecho que el FWI nunca lo supera en la práctica. Si en un evento
  // extremo lo superara, para un cálculo que corre solo sin supervisión es
  // más seguro clasificar como la categoría más alta que dejar ese
  // departamento sin clasificar — un valor realmente inválido (NaN, etc.)
  // sigue fallando acá abajo.
  if (Number.isFinite(redondeado) && redondeado > 0) return CATEGORIAS.at(-1);
  throw new Error(`FWI: no se pudo clasificar el índice ${fwi} con los criterios "${criterios}".`);
}

module.exports = {
  calcularFFMC, calcularDMC, calcularDC, calcularISI, calcularBUI, calcularFWI,
  calcularDia, clasificar, CATEGORIAS, LONGITUD_DIA, FACTOR_LONGITUD_DIA,
};
