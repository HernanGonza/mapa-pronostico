/**
 * Convierte la grilla de clima (Open-Meteo) en imágenes suaves para las
 * capas del mapa: nubosidad, lluvia, temperatura.
 *
 * Cada capa es un PNG (data-URL) que MapLibre monta como `image` source y
 * reproyecta solo (funciona igual en globo o plano). Se regenera cuando
 * cambia la hora elegida.
 *
 * La grilla llega como `{ bounds, grid, horas, puntos:[{lat,lng, cloud[], precip[], temp[], windU[], windV[]}] }`
 * con `puntos` en orden fila-por-fila: índice = i*grid + j, i = lat (i=0 → latMin), j = lng (j=0 → lngMin).
 */

const RES = 168; // resolución del PNG generado (se suaviza más al escalar)

export function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

/** Rampa lineal entre paradas [{ v, rgba:[r,g,b,a] }]. */
export function rampa(paradas, v) {
  if (v <= paradas[0].v) return paradas[0].rgba;
  const last = paradas[paradas.length - 1];
  if (v >= last.v) return last.rgba;
  for (let k = 1; k < paradas.length; k++) {
    if (v <= paradas[k].v) {
      const a = paradas[k - 1];
      const b = paradas[k];
      const t = (v - a.v) / (b.v - a.v);
      return [
        a.rgba[0] + (b.rgba[0] - a.rgba[0]) * t,
        a.rgba[1] + (b.rgba[1] - a.rgba[1]) * t,
        a.rgba[2] + (b.rgba[2] - a.rgba[2]) * t,
        a.rgba[3] + (b.rgba[3] - a.rgba[3]) * t,
      ];
    }
  }
  return last.rgba;
}

// --- Rampas por campo ---

const RAMPA_NUBES = [
  { v: 0, rgba: [255, 255, 255, 0] },
  { v: 35, rgba: [214, 222, 232, 90] }, // borde: gris tenue
  { v: 60, rgba: [236, 240, 246, 190] },
  { v: 80, rgba: [248, 250, 253, 232] },
  { v: 100, rgba: [255, 255, 255, 250] }, // panza iluminada
];

const RAMPA_LLUVIA = [
  { v: 0, rgba: [0, 0, 0, 0] },
  { v: 0.1, rgba: [120, 180, 255, 0] },
  { v: 0.3, rgba: [120, 180, 255, 150] },
  { v: 1.5, rgba: [70, 200, 110, 190] },
  { v: 4, rgba: [245, 224, 66, 205] },
  { v: 9, rgba: [247, 150, 50, 215] },
  { v: 18, rgba: [235, 60, 60, 225] },
  { v: 40, rgba: [170, 40, 120, 235] },
];

const RAMPA_TEMP = [
  { v: -8, rgba: [40, 50, 150, 150] },
  { v: 2, rgba: [55, 125, 210, 150] },
  { v: 10, rgba: [95, 190, 200, 140] },
  { v: 17, rgba: [130, 200, 140, 130] },
  { v: 23, rgba: [240, 222, 110, 135] },
  { v: 29, rgba: [242, 155, 70, 150] },
  { v: 36, rgba: [214, 60, 55, 165] },
  { v: 44, rgba: [150, 30, 60, 175] },
];

export const RAMPAS = {
  nubes: RAMPA_NUBES,
  lluvia: RAMPA_LLUVIA,
  temp: RAMPA_TEMP,
};
const CAMPO = { nubes: "cloud", lluvia: "precip", temp: "temp" };

/** Bilinear sobre la grilla para un campo/hora. */
function valorEn(grilla, campo, hora, fi, fj) {
  const n = grilla.grid;
  const i0 = clamp(Math.floor(fi), 0, n - 2);
  const j0 = clamp(Math.floor(fj), 0, n - 2);
  const ti = fi - i0;
  const tj = fj - j0;
  const at = (i, j) => {
    const p = grilla.puntos[i * n + j];
    const s = p[campo];
    return s ? s[hora] ?? 0 : 0;
  };
  const a = at(i0, j0) * (1 - tj) + at(i0, j0 + 1) * tj;
  const b = at(i0 + 1, j0) * (1 - tj) + at(i0 + 1, j0 + 1) * tj;
  return a * (1 - ti) + b * ti;
}

/**
 * Genera el PNG (data-URL) de una capa para una hora dada.
 * @param capa  "nubes" | "lluvia" | "temp"
 * @returns { url, coordinates } listo para un `image` source de MapLibre
 */
export function generarCapaClima(grilla, capa, hora) {
  const campo = CAMPO[capa];
  const paradas = RAMPAS[capa];
  const n = grilla.grid;
  const { latMin, latMax, lngMin, lngMax } = grilla.bounds;

  const cv = document.createElement("canvas");
  cv.width = RES;
  cv.height = RES;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(RES, RES);
  const d = img.data;

  // Desvanecido de borde: la capa no debe verse como un cuadrado cuando
  // te alejás.
  const MARGEN = 0.14;
  const fade = (p) => {
    const t = clamp(Math.min(p, RES - 1 - p) / (RES * MARGEN), 0, 1);
    return t * t * (3 - 2 * t);
  };

  for (let py = 0; py < RES; py++) {
    // py=0 (arriba) = latMax ; py=RES (abajo) = latMin
    const fi = ((RES - 1 - py) / (RES - 1)) * (n - 1);
    const fy = fade(py);
    for (let px = 0; px < RES; px++) {
      const fj = (px / (RES - 1)) * (n - 1);
      const v = valorEn(grilla, campo, hora, fi, fj);
      const [r, g, b, alpha] = rampa(paradas, v);
      const o = (py * RES + px) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = alpha * fy * fade(px);
    }
  }
  ctx.putImageData(img, 0, 0);

  return {
    url: cv.toDataURL("image/png"),
    coordinates: [
      [lngMin, latMax],
      [lngMax, latMax],
      [lngMax, latMin],
      [lngMin, latMin],
    ],
  };
}

/** Índice de hora más cercano a "ahora" dentro de `grilla.horas` (hora local). */
export function horaActual(grilla) {
  return Math.round(horaActualFrac(grilla));
}

/**
 * Índice de hora FRACCIONARIO para "ahora" — permite interpolar entre horas
 * y que la capa se vea "en vivo" en vez de saltar de hora en hora.
 * `grilla.horas` viene en hora local (America/Argentina); las comparamos
 * con la hora local del navegador.
 */
export function horaActualFrac(grilla) {
  const horas = grilla.horas;
  if (!horas || horas.length < 2) return 0;
  // "2026-08-31T14:00" -> minutos desde epoch en hora local nominal.
  const aMin = (s) => {
    const [f, t] = s.split("T");
    const [Y, M, D] = f.split("-").map(Number);
    const [h, m] = t.split(":").map(Number);
    return Date.UTC(Y, M - 1, D, h, m) / 60000;
  };
  const ahora = (() => {
    const n = new Date();
    return Date.UTC(
      n.getFullYear(),
      n.getMonth(),
      n.getDate(),
      n.getHours(),
      n.getMinutes()
    ) / 60000;
  })();
  const t0 = aMin(horas[0]);
  const paso = aMin(horas[1]) - t0;
  const idx = (ahora - t0) / paso;
  return clamp(idx, 0, horas.length - 1);
}
