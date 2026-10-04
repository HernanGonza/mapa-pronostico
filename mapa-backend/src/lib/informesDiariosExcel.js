const ExcelJS = require("exceljs");

/**
 * Excel de un informe diario con TODO lo que trajeron las estaciones, en crudo (ver
 * informesDiarios.js): una hoja de resumen, una hoja por estación con cada registro de 10 min y
 * todos sus campos tal cual los manda cada red, los avisos del SMN y una hoja de fuentes y notas.
 * Las fechas van como fecha de Excel en hora de Misiones.
 */
const OFFSET_MS = 3 * 3600 * 1000;
const VERDE = "FF163E30";
// Nombres legibles (con unidad) de los campos del INTA; los que no estén acá salen con su nombre original.
const CAMPOS_INTA = {
  fechaHora: "fechaHora (tal cual INTA: es hora local aunque diga UTC)",
  tempAbrigo150: "Temperatura abrigo 1,5 m (°C)", tempAbrigo150Max: "Temperatura máx. del intervalo (°C)", tempAbrigo150Min: "Temperatura mín. del intervalo (°C)",
  humedad: "Humedad (%)", HMedia: "Humedad media (%)",
  precDiaCrono: "Lluvia en el intervalo (mm)", precDiaPlub: "Lluvia pluviómetro (mm)", precMax30: "Lluvia máx. 30 min (mm)",
  velVientoMax: "Ráfaga máx. (km/h)", velViento200Media: "Viento medio a 2 m (km/h)", velViento1000Media: "Viento medio a 10 m (km/h)",
  dirViento200: "Dirección del viento a 2 m", dirViento1000: "Dirección del viento a 10 m",
  radiacionGlobal: "Radiación global", tempSuelo10Media: "Temperatura del suelo a 10 cm (°C)", duracFollajeMojado: "Duración follaje mojado",
  bateria: "Batería (V)", alarmaActiva: "Alarma activa", alarmas: "Alarmas", id: "id (INTA)", idDiario: "idDiario (INTA)", idEstacion: "idEstacion (INTA)",
};
const CAMPOS_SMN = { hora: "HORA (hora oficial argentina)", temp: "TEMP (°C)", hum: "HUM (%)", pnm: "PNM, presión a nivel del mar (hPa)", dd: "DD, dirección del viento (grados)", ff: "FF, viento medio (km/h)" };
const CAMPOS_SINARAME = { temperatura: "Temperatura (°C)", humedad: "Humedad (%)", viento: "Viento (km/h)", precipitacion: "Lluvia en el intervalo (mm)" };

const localDe = (t) => new Date(t - OFFSET_MS); // Excel no tiene zona horaria: se guarda la hora de reloj de Misiones.
const nombreHoja = (texto, usados) => {
  let base = String(texto).replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Estación";
  let nombre = base, n = 2;
  while (usados.has(nombre.toLowerCase())) nombre = `${base.slice(0, 26)} ${n++}`;
  usados.add(nombre.toLowerCase());
  return nombre;
};

function encabezado(hoja, columnas) {
  hoja.columns = columnas.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho || Math.min(42, Math.max(12, c.titulo.length + 2)), style: c.formato ? { numFmt: c.formato } : undefined }));
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  fila.alignment = { vertical: "middle", wrapText: true };
  fila.height = 30;
  hoja.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
}

async function armarExcel(datos) {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Sistema Integrado Alerta Temprana · Ministerio de Ecología y RNR de Misiones";
  libro.created = new Date();
  const usados = new Set(["resumen", "avisos smn", "smn temperaturas extremas", "fuentes y notas"]);

  // 1) Resumen por estación.
  const resumen = libro.addWorksheet("Resumen");
  encabezado(resumen, [
    { titulo: "Estación", clave: "nombre", ancho: 40 }, { titulo: "Red", clave: "red", ancho: 10 }, { titulo: "Hoja con los datos", clave: "hoja", ancho: 30 },
    { titulo: "Registros", clave: "registros" }, { titulo: "Primer registro", clave: "desde", formato: "dd/mm/yyyy hh:mm", ancho: 17 }, { titulo: "Último registro", clave: "hasta", formato: "dd/mm/yyyy hh:mm", ancho: 17 },
    { titulo: "Lluvia total (mm)", clave: "lluvia" }, { titulo: "Lluvia máx. 30 min (mm)", clave: "l30" }, { titulo: "Desde las", clave: "l30h" },
    { titulo: "Ráfaga máx. (km/h)", clave: "rafaga" }, { titulo: "A las", clave: "rafagah" },
    { titulo: "Temp. mín. (°C)", clave: "tmin" }, { titulo: "A las", clave: "tminh" }, { titulo: "Temp. máx. (°C)", clave: "tmax" }, { titulo: "A las", clave: "tmaxh" },
    { titulo: "Caída brusca de temp. (°C)", clave: "caida" }, { titulo: "En (min)", clave: "caidam" }, { titulo: "Desde las", clave: "caidah" }, { titulo: "Empezó a llover", clave: "inicio" },
    { titulo: "Viento medio máx. (km/h, SMN)", clave: "viento" }, { titulo: "A las", clave: "vientoh" },
    { titulo: "TMAX oficial SMN (°C)", clave: "exmax" }, { titulo: "TMIN oficial SMN (°C)", clave: "exmin" },
    { titulo: "Estado", clave: "estado", ancho: 30 },
  ]);
  const hojas = new Map();
  // "INTA Cerro Azul", "SiNaRaMe Eldorado" (sin repetir la red si el nombre ya la trae).
  for (const e of datos.estaciones || []) { const n = e.nombre.split(" - ")[0]; hojas.set(e.clave, nombreHoja(n.toUpperCase().startsWith(e.red.toUpperCase()) ? n : `${e.red} ${n}`, usados)); }
  for (const e of datos.estaciones || []) {
    const r = e.resumen;
    resumen.addRow({
      nombre: e.nombre, red: e.red, hoja: hojas.get(e.clave), registros: r?.registros ?? 0,
      desde: r ? localDe(r.desde) : null, hasta: r ? localDe(r.hasta) : null,
      lluvia: r?.lluviaTotal ?? null, l30: r?.lluvia30?.mm ?? null, l30h: r?.lluvia30?.hora ?? null,
      rafaga: r?.rafaga?.kmh ?? null, rafagah: r?.rafaga?.hora ?? null,
      tmin: r?.tMin?.c ?? null, tminh: r?.tMin?.hora ?? null, tmax: r?.tMax?.c ?? null, tmaxh: r?.tMax?.hora ?? null,
      caida: r?.caida?.grados ?? null, caidam: r?.caida?.minutos ?? null, caidah: r?.caida?.hora ?? null, inicio: r?.inicioLluvia ?? null,
      viento: r?.viento?.kmh ?? null, vientoh: r?.viento?.hora ?? null, exmax: e.extremas?.tmax ?? null, exmin: e.extremas?.tmin ?? null,
      estado: e.error ? `Error: ${e.error}` : !r ? "Sin datos en la franja" : [r.sinLluvia && "no mide lluvia", r.sinViento && "sin sensor de viento", r.sinTemperatura && "sin temperatura", e.avisoDatos && `faltan días: ${e.avisoDatos}`].filter(Boolean).join(", ") || "OK",
    });
  }

  // 2) Una hoja por estación: cada registro de 10 min, con todos los campos tal cual vienen.
  for (const e of datos.estaciones || []) {
    const hoja = libro.addWorksheet(hojas.get(e.clave));
    const crudo = e.crudo || [];
    const nombres = e.red === "INTA" ? CAMPOS_INTA : e.red === "SMN" ? CAMPOS_SMN : CAMPOS_SINARAME;
    const campos = [...new Set(crudo.flatMap((f) => Object.keys(f)))].filter((k) => k !== "t");
    // Primero los conocidos (en el orden de la tabla de nombres), después el resto.
    campos.sort((a, b) => (Object.keys(nombres).indexOf(a) + 1 || 999) - (Object.keys(nombres).indexOf(b) + 1 || 999));
    encabezado(hoja, [{ titulo: "Fecha y hora (Misiones)", clave: "__t", formato: "dd/mm/yyyy hh:mm", ancho: 18 }, ...campos.map((k) => ({ titulo: nombres[k] || k, clave: k }))]);
    for (const f of crudo) hoja.addRow({ __t: localDe(f.t), ...Object.fromEntries(campos.map((k) => [k, f[k] === undefined ? null : typeof f[k] === "object" && f[k] !== null ? JSON.stringify(f[k]) : f[k]])) });
    if (!crudo.length) hoja.addRow({ __t: null, [campos[0] || "__t"]: e.error ? `Error al consultar: ${e.error}` : "La estación no informó datos en esa franja." });
  }

  // 3) Temperaturas extremas oficiales del SMN (un valor por día y estación).
  const conExtremas = (datos.estaciones || []).filter((e) => e.red === "SMN");
  if (conExtremas.length) {
    const ext = libro.addWorksheet("SMN temperaturas extremas");
    encabezado(ext, [{ titulo: "Estación", clave: "nombre", ancho: 30 }, { titulo: "Fecha", clave: "fecha", ancho: 12 }, { titulo: "TMAX (°C)", clave: "tmax" }, { titulo: "TMIN (°C)", clave: "tmin" }, { titulo: "Nota", clave: "nota", ancho: 60 }]);
    for (const e of conExtremas) for (const x of e.extremasPorDia || [{ fecha: datos.fecha, ...(e.extremas || { tmax: null, tmin: null }) }]) {
      const hay = x.tmax != null || x.tmin != null;
      ext.addRow({ nombre: e.nombre, fecha: x.fecha.split("-").reverse().join("/"), tmax: x.tmax ?? null, tmin: x.tmin ?? null,
        nota: hay ? null : "El SMN no tiene el archivo de ese día (lo publica al día siguiente y guarda alrededor de un año)." });
    }
  }

  // 4) Avisos del SMN y lo publicado.
  const avisos = libro.addWorksheet("Avisos SMN");
  encabezado(avisos, [{ titulo: "Tipo", clave: "tipo", ancho: 26 }, { titulo: "Nivel", clave: "nivel" }, { titulo: "Título", clave: "titulo", ancho: 60 },
    { titulo: "Desde", clave: "inicio", formato: "dd/mm/yyyy hh:mm", ancho: 17 }, { titulo: "Hasta", clave: "fin", formato: "dd/mm/yyyy hh:mm", ancho: 17 }, { titulo: "Zonas", clave: "zonas", ancho: 80 }]);
  for (const a of datos.smn || []) avisos.addRow({ tipo: a.fuente === "ACP" ? "Aviso a muy corto plazo" : "Alerta (SAT)", nivel: a.nivel || null, titulo: a.titulo, inicio: localDe(Date.parse(a.inicio)), fin: localDe(Date.parse(a.fin)), zonas: a.zonas || null });

  // 5) Fuentes y notas.
  const notas = libro.addWorksheet("Fuentes y notas");
  notas.columns = [{ width: 120 }];
  [
    `Informe ${datos.fechaHasta && datos.fechaHasta !== datos.fecha ? `desde el ${datos.fecha} a las ${datos.desde} h hasta el ${datos.fechaHasta} a las ${datos.hasta} h` : `del ${datos.fecha} de ${datos.desde} a ${datos.hasta} h`} (hora de Misiones). Datos consultados el ${new Date(datos.consultadoEn).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.`,
    "",
    "INTA — Red Agrometeorológica (SIGA, https://siga.inta.gob.ar): registros cada 10 minutos, tal cual los publica el INTA.",
    "  · La columna fechaHora dice UTC, pero es hora local de Misiones (la columna «Fecha y hora (Misiones)» ya está bien).",
    "  · «Lluvia en el intervalo» es la de cada registro de 10 minutos: la suma da la lluvia del período.",
    "  · Algunas estaciones no tienen anemómetro o tienen la humedad rota (marca 0 %): esos valores están en crudo acá, pero el resumen los descarta.",
    "  · El INTA publica con algunas horas de demora.",
    "SiNaRaMe — Red Meteorológica del INA (vía SNIH, https://snih.hidricosargentina.gob.ar): registros cada 10 minutos.",
    "  · -999 / -9999 = sin dato (así lo marca SNIH).",
    "SMN — datos abiertos (https://www.smn.gob.ar/descarga-de-datos), tal cual vienen en los archivos:",
    "  · «Datos meteorológicos horarios» (observaciones/datohorarioAAAAMMDD.txt): TEMP, HUM, PNM, DD y FF cada hora, en hora oficial argentina. FF es el viento medio, no la ráfaga. No trae lluvia.",
    "  · «Observaciones diarias de temperaturas extremas» (observaciones/obsAAAAMMDD.txt): TMAX y TMIN oficiales del día. El SMN guarda alrededor de un año.",
    "  · Con datos horarios la caída brusca de temperatura se mide de una hora a la siguiente (no en 30 min).",
    "SMN: alertas (SAT) y avisos a muy corto plazo (ACP) vigentes en la franja, del historial que guarda el sistema.",
  ].forEach((t) => notas.addRow([t]));
  notas.getRow(1).font = { bold: true };

  return libro.xlsx.writeBuffer();
}

module.exports = { armarExcel };
