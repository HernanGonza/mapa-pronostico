const ExcelJS = require("exceljs");

/**
 * Excel de la planilla de precipitaciones, con la forma del PRECIPITACIONES.xlsx original y con fórmulas vivas:
 *  - una hoja por mes («10,2026»): DIA × estaciones, TOTAL = SUM, MEDIA, ANOMALÍA = TOTAL − MEDIA (la media «se toma de» otra estación es una fórmula que apunta a su columna);
 *  - con `informe`, una hoja «informe» con lo acumulado del período (SUM de los días de las hojas), el mes hasta la fecha final, la media y la anomalía.
 */
const REDES = { 1: "Estaciones del SMN", 2: "Estaciones del INTA", 3: "Estaciones Automáticas", 4: "Estaciones Red Matteo" };
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const pad = (x) => String(x).padStart(2, "0");
const AZUL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE9F7" } }, GRIS = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
const BORDE = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
const nombreHoja = (anio, mes) => `${pad(mes)},${anio}`;
const titulo = (e) => ({ richText: [{ text: e.nombre, font: { bold: true } }, { text: String(e.red), font: { bold: true, vertAlign: "superscript" } }] });

/** Los meses {anio, mes} que toca el rango [desde, hasta] (AAAA-MM-DD). */
function mesesDe(desde, hasta) {
  const r = [];
  let a = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7));
  const fa = Number(hasta.slice(0, 4)), fm = Number(hasta.slice(5, 7));
  while (a < fa || (a === fa && m <= fm)) { r.push({ anio: a, mes: m }); if (++m > 12) { m = 1; a++; } }
  return r;
}

/** Media de la estación en el mes: { mediaMm, ref } (ref = estación de la que se toma). */
function mediaDe(e, mes, porId) {
  const m = e.medias?.[mes];
  if (!m) return { mediaMm: null, ref: null };
  if (m.usaMediaDe != null && porId.get(m.usaMediaDe)) return { mediaMm: porId.get(m.usaMediaDe).medias?.[mes]?.mediaMm ?? null, ref: porId.get(m.usaMediaDe) };
  return { mediaMm: m.mediaMm, ref: null };
}

function hojaMes(libro, { anio, mes, estaciones, valores, porId }) {
  const ws = libro.addWorksheet(nombreHoja(anio, mes));
  const dias = new Date(anio, mes, 0).getDate(), ultima = 3 + dias, filaTotal = ultima + 1, filaMedia = ultima + 2, filaAst = ultima + 3, filaAnom = ultima + 4;
  ws.getCell("A2").value = "MES"; ws.getCell("B2").value = MESES[mes - 1]; ws.getCell("C2").value = anio;
  for (const c of ["A2", "B2", "C2"]) { ws.getCell(c).font = { bold: true }; ws.getCell(c).fill = AZUL; }
  ws.getCell("A3").value = "DIA"; ws.getCell("A3").font = { bold: true }; ws.getCell("A3").fill = AZUL;
  ws.getColumn(1).width = 11;
  estaciones.forEach((e, i) => {
    const col = 2 + i, c = ws.getColumn(col).letter;
    ws.getColumn(col).width = 13;
    const h = ws.getCell(3, col); h.value = titulo(e); h.fill = AZUL; h.alignment = { horizontal: "center", wrapText: true }; h.border = BORDE;
    for (let d = 1; d <= dias; d++) {
      const v = valores.get(`${e.id}|${anio}-${pad(mes)}-${pad(d)}`);
      const cel = ws.getCell(3 + d, col); if (v != null) cel.value = v; cel.border = BORDE; cel.numFmt = "0.0";
    }
    ws.getCell(filaTotal, col).value = { formula: `SUM(${c}4:${c}${ultima})`, result: undefined };
    const med = mediaDe(e, mes, porId), refIdx = med.ref ? estaciones.findIndex((x) => x.id === med.ref.id) : -1;
    const celMedia = ws.getCell(filaMedia, col);
    if (refIdx >= 0) celMedia.value = { formula: `${ws.getColumn(2 + refIdx).letter}${filaMedia}` };
    else if (med.mediaMm != null) celMedia.value = med.mediaMm;
    if (med.ref) ws.getCell(filaAst, col).value = "*".repeat(1 + [...new Set(estaciones.map((x) => mediaDe(x, mes, porId).ref?.id).filter(Boolean))].indexOf(med.ref.id));
    ws.getCell(filaAnom, col).value = { formula: `${c}${filaTotal}-${c}${filaMedia}` };
    for (const f of [filaTotal, filaMedia, filaAnom]) { const cel = ws.getCell(f, col); cel.border = BORDE; cel.numFmt = "0.0"; cel.font = { bold: f !== filaMedia }; }
    ws.getCell(filaAst, col).alignment = { horizontal: "center" };
  });
  for (const [f, t] of [[filaTotal, "TOTAL"], [filaMedia, "MEDIA"], [filaAnom, "ANOMALÍA"]]) { const c = ws.getCell(f, 1); c.value = t; c.font = { bold: true }; c.fill = GRIS; c.border = BORDE; }
  for (let d = 1; d <= dias; d++) { const c = ws.getCell(3 + d, 1); c.value = d; c.fill = GRIS; c.border = BORDE; c.alignment = { horizontal: "center" }; }
  // Leyendas: las redes usadas y «se toma la media de …».
  let f = filaAnom + 2;
  for (const r of [...new Set(estaciones.map((e) => e.red))].sort()) ws.getCell(f++, 1).value = `${r} ${REDES[r]}`;
  const refs = [...new Set(estaciones.map((e) => mediaDe(e, mes, porId).ref?.id).filter(Boolean))];
  refs.forEach((id, i) => { ws.getCell(f++, 1).value = `${"*".repeat(i + 1)} se toma la media de ${porId.get(id).nombre}`; });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
  return { ws, filaTotal, filaMedia, dias, columna: (i) => ws.getColumn(2 + i).letter };
}

/** `estaciones`: las del libro (en orden); `diarias`: [[estacionId, fecha, mm]]; `todas`: todas las estaciones (para resolver «media de»). */
async function armarExcel({ estaciones, todas, diarias, desde, hasta, informe = false }) {
  const libro = new ExcelJS.Workbook();
  libro.calcProperties = { fullCalcOnLoad: true }; // las fórmulas se calculan al abrir
  const porId = new Map(todas.map((e) => [e.id, e]));
  const valores = new Map(diarias.map(([id, f, mm]) => [`${id}|${f}`, mm]));
  const meses = mesesDe(desde, hasta);
  const hojas = new Map();
  const wsInforme = informe ? libro.addWorksheet("informe") : null; // primera hoja; se completa después, cuando están las de los meses
  for (const m of meses) hojas.set(`${m.anio}-${m.mes}`, hojaMes(libro, { ...m, estaciones, valores, porId }));
  if (informe) {
    const ws = wsInforme, fin = meses[meses.length - 1];
    const ultimaHoja = hojas.get(`${fin.anio}-${fin.mes}`);
    ws.getCell("B3").value = "MONITOREO DE PRECIPITACIONES PROVINCIA DE MISIONES"; ws.getCell("B3").font = { bold: true, size: 13 };
    ws.getCell("B4").value = MESES[fin.mes - 1]; ws.getCell("C4").value = fin.anio;
    const dd = (s) => `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;
    estaciones.forEach((e, i) => {
      const col = 3 + i, h = ws.getCell(5, col); h.value = titulo(e); h.fill = AZUL; h.border = BORDE; h.alignment = { horizontal: "center", wrapText: true };
      ws.getColumn(col).width = 14;
      const L = ultimaHoja.columna(i);
      // Período: suma de los días de cada hoja que toca el rango.
      const trozos = meses.map((m) => {
        const hoja = hojas.get(`${m.anio}-${m.mes}`), ini = m === meses[0] ? Number(desde.slice(8, 10)) : 1, fi = m === meses[meses.length - 1] ? Number(hasta.slice(8, 10)) : hoja.dias;
        return `SUM('${hoja.ws.name}'!${hoja.columna(i)}${3 + ini}:${hoja.columna(i)}${3 + fi})`;
      });
      ws.getCell(6, col).value = { formula: trozos.join("+") };
      ws.getCell(7, col).value = { formula: `SUM('${ultimaHoja.ws.name}'!${L}4:${L}${3 + Number(hasta.slice(8, 10))})` };
      ws.getCell(8, col).value = { formula: `'${ultimaHoja.ws.name}'!${L}${ultimaHoja.filaMedia}` };
      ws.getCell(9, col).value = { formula: `${ws.getColumn(col).letter}7-${ws.getColumn(col).letter}8` };
      for (let r = 6; r <= 9; r++) { const c = ws.getCell(r, col); c.border = BORDE; c.numFmt = "0.0"; }
    });
    ws.getCell("B6").value = desde === hasta ? dd(desde) : `${dd(desde)}-${dd(hasta)}`; ws.getCell("B7").value = "MES"; ws.getCell("B8").value = "MEDIA"; ws.getCell("B9").value = "ANOMALÍA";
    ws.getColumn(2).width = 14;
    for (let r = 6; r <= 9; r++) { ws.getCell(r, 2).font = { bold: true }; ws.getCell(r, 2).fill = GRIS; ws.getCell(r, 2).border = BORDE; }
    let f = 11;
    for (const r of [...new Set(estaciones.map((e) => e.red))].sort()) ws.getCell(f++, 2).value = `${r} ${REDES[r]}`;
    ws.getCell(f + 1, 2).value = "Las anomalías positivas indican que se superó la precipitación media mensual";
  }
  return libro.xlsx.writeBuffer();
}

module.exports = { armarExcel, mesesDe };
