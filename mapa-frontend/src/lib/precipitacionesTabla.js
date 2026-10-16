/** Lo que comparten la tabla pública (/embed/precipitaciones), el mapa y la pantalla de edición. */
export const coma = (n) => (n == null ? "—" : String(n).replace(".", ","));
export const fecha = (f) => f.split("-").reverse().join("/");
export const periodo = (r) => (r.desde === r.hasta ? fecha(r.desde) : `${fecha(r.desde).slice(0, 5)} al ${fecha(r.hasta)}`);
export const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const COLUMNAS = [
  { id: "estacion", t: "Estación", v: (r) => r.estacion, texto: true },
  { id: "red", t: "Red", v: (r) => r.red, texto: true },
  { id: "hasta", t: "Período", v: (r) => r.hasta + r.desde, f: periodo, texto: true },
  { id: "lluvia", t: "Lluvia (mm)", v: (r) => r.lluvia },
  { id: "max", t: "Máx. (mm)", v: (r) => r.max, f: (r) => (r.max == null ? "—" : `${coma(r.max)}${r.maxMinutos === 60 ? " en 1 h" : " en 30 min"}`) },
  { id: "mes", t: "Mes (mm)", v: (r) => r.mes },
  { id: "media", t: "Media (mm)", v: (r) => r.media },
  { id: "anomalia", t: "Anomalía (mm)", v: (r) => r.anomalia, f: (r) => (r.anomalia == null ? "—" : `${r.anomalia > 0 ? "+" : ""}${coma(r.anomalia)}`) },
  { id: "lat", t: "Latitud", v: (r) => r.lat, f: (r) => (r.lat == null ? "—" : r.lat.toFixed(5).replace(".", ",")), soloAdmin: true },
  { id: "lng", t: "Longitud", v: (r) => r.lng, f: (r) => (r.lng == null ? "—" : r.lng.toFixed(5).replace(".", ",")), soloAdmin: true },
];
export const COLUMNAS_PUBLICAS = COLUMNAS.filter((c) => !c.soloAdmin);

/** Filtra por texto (en el nombre), red y rango de fechas (el período se cruza con el rango), y ordena (los sin dato, al final). */
export function filtrarYOrdenar(datos, { q = "", red = "", desde = "", hasta = "", orden }) {
  const col = COLUMNAS.find((c) => c.id === orden.id), buscado = normal(q.trim());
  return (datos || []).filter((r) => (!buscado || normal(r.estacion).includes(buscado)) && (!red || r.red === red) && (!desde || r.hasta >= desde) && (!hasta || r.desde <= hasta))
    .sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (col.texto ? String(x).localeCompare(String(y), "es") : x - y) * orden.dir;
    });
}
/** El orden al tocar una columna: la misma invierte; una nueva arranca de A→Z (texto) o de mayor a menor (números). */
export const ordenarPor = (o, id) => (o.id === id ? { id, dir: -o.dir } : { id, dir: id === "estacion" || id === "red" ? 1 : -1 });

export function csv(filas) {
  const esc = (s) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cuerpo = filas.map((r) => [r.estacion, r.red, fecha(r.desde), fecha(r.hasta), r.lluvia, r.max, r.maxMinutos, r.mes, r.media, r.anomalia, r.lat, r.lng].map((v) => esc(v == null ? "" : String(v).replace(".", ","))).join(";"));
  return `﻿${["Estación;Red;Desde;Hasta;Lluvia (mm);Máxima (mm);Ventana (min);Mes (mm);Media (mm);Anomalía (mm);Latitud;Longitud", ...cuerpo].join("\r\n")}`;
}
export function bajarCsv(filas, nombre = "precipitaciones-misiones.csv") {
  const url = URL.createObjectURL(new Blob([csv(filas)], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Color del punto en el mapa según los mm del último dato. */
export const ESCALA = [[0, "#c3cad2", "Sin lluvia"], [0.1, "#9fd0f2", "Hasta 10 mm"], [10, "#4a9be0", "10 a 25 mm"], [25, "#1f5fbf", "25 a 50 mm"], [50, "#6b2fb0", "50 a 100 mm"], [100, "#b4233c", "Más de 100 mm"]];
export const colorDe = (mm) => { let c = ESCALA[0][1]; for (const [desde, color] of ESCALA) if (mm != null && mm >= desde) c = color; return c; };
