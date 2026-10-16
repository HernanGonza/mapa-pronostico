const ExcelJS = require("exceljs");

/**
 * Lee un Excel con la forma de PRECIPITACIONES.xlsx: una hoja por mes llamada «M,AAAA» (ej. «10,2026»), con DIA en la columna A y una
 * estación por columna (la red va como número en superíndice al final del nombre: 1 SMN, 2 INTA, 3 Automática, 4 Red Matteo),
 * después TOTAL, MEDIA (y los asteriscos «* se toma la media de …») y ANOMALÍA. Las demás hojas (informes) se ignoran.
 */
const NOMBRE_HOJA = /^\s*(\d{1,2})\s*[,.\-/]\s*(\d{4})\s*$/;
const redondear = (x) => Math.round(x * 10) / 10;
const pad = (x) => String(x).padStart(2, "0");

/** El valor de una celda como texto/número plano (resuelve fórmulas y texto con formato). */
function plano(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result ?? null;
    if (v instanceof Date) return v;
    if ("text" in v) return v.text;
  }
  return v;
}

/** «Posadas» + superíndice «3» → { nombre: "Posadas", red: 3 }. Sin superíndice, vale el último dígito 1-4 del texto. */
function estacionDe(valor) {
  if (valor && typeof valor === "object" && valor.richText) {
    const sup = valor.richText.filter((t) => t.font?.vertAlign === "superscript").map((t) => t.text).join("").trim();
    const nombre = valor.richText.filter((t) => t.font?.vertAlign !== "superscript").map((t) => t.text).join("").trim();
    if (/^[1-4]$/.test(sup) && nombre) return { nombre, red: Number(sup) };
  }
  const t = String(plano(valor) ?? "").replace(/[¹²³⁴]/g, (c) => ({ "¹": "1", "²": "2", "³": "3", "⁴": "4" }[c])).replace(/\^/g, "").trim();
  const m = t.match(/^(.*\D)\s*([1-4])$/);
  return m ? { nombre: m[1].trim(), red: Number(m[2]) } : null;
}

/** Devuelve { estaciones, hojas, ignorados } sin guardar nada. */
async function leerExcel(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  const porClave = new Map(), hojas = [], ignorados = [];
  for (const hoja of libro.worksheets) {
    const nombreHoja = hoja.name.match(NOMBRE_HOJA);
    if (!nombreHoja || !hoja.rowCount) continue;
    const mes = Number(nombreHoja[1]), anio = Number(nombreHoja[2]);
    if (mes < 1 || mes > 12) continue;
    let filaCab = 0, filaTotal = 0, filaMedia = 0, filaAst = 0;
    hoja.eachRow((fila, i) => {
      const a = String(plano(fila.getCell(1).value) ?? "").trim().toUpperCase();
      if (!filaCab && a === "DIA") filaCab = i;
      if (filaCab && a === "TOTAL" && !filaTotal) filaTotal = i;
      if (filaCab && /^MEDIA/.test(a) && !filaMedia) filaMedia = i;
    });
    if (!filaCab) continue;
    // Columnas de estaciones: desde la B hasta antes de otro «DIA» (la tabla de acumulados que está a la derecha).
    const columnas = [];
    for (let c = 2; c <= hoja.columnCount; c++) {
      const v = hoja.getRow(filaCab).getCell(c).value, t = String(plano(v) ?? "").trim();
      if (t.toUpperCase() === "DIA") break;
      const est = t ? estacionDe(v) : null;
      if (est) columnas.push({ c, ...est });
      else if (t) ignorados.push({ hoja: hoja.name, celda: hoja.getRow(filaCab).getCell(c).address, valor: t, motivo: "Encabezado sin red (1-4)" });
    }
    const hasta = filaTotal || filaCab + 32;
    if (filaMedia) filaAst = filaMedia + 1;
    // «* se toma la media de Cerro Azul» en cualquier celda de la hoja.
    const notas = {};
    hoja.eachRow((fila) => fila.eachCell((cel) => {
      const m = String(plano(cel.value) ?? "").match(/^\s*(\*+)\s*se toma la media de\s+(.+?)\s*$/i);
      if (m) notas[m[1]] = m[2];
    }));
    const diasDelMes = new Date(anio, mes, 0).getDate();
    let celdas = 0;
    for (const col of columnas) {
      const k = `${col.nombre}|${col.red}`;
      if (!porClave.has(k)) porClave.set(k, { nombre: col.nombre, red: col.red, medias: {}, dias: [] });
      const est = porClave.get(k);
      for (let r = filaCab + 1; r < hasta; r++) {
        const dia = plano(hoja.getRow(r).getCell(1).value);
        if (!Number.isInteger(Number(dia)) || dia === null || Number(dia) < 1 || Number(dia) > diasDelMes) continue;
        const cel = hoja.getRow(r).getCell(col.c), v = plano(cel.value);
        if (v == null || v === "") continue;
        const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
        if (!Number.isFinite(x) || x < 0 || x > 1500) { ignorados.push({ hoja: hoja.name, celda: cel.address, valor: String(v), motivo: "No es una cantidad de mm" }); continue; }
        est.dias.push([`${anio}-${pad(mes)}-${pad(Number(dia))}`, redondear(x)]);
        celdas++;
      }
      if (filaMedia) {
        const mm = plano(hoja.getRow(filaMedia).getCell(col.c).value), ast = String(plano(hoja.getRow(filaAst).getCell(col.c).value) ?? "").trim();
        if ((typeof mm === "number" && mm > 0) || notas[ast]) est.medias[mes] = { mm: typeof mm === "number" && mm > 0 ? redondear(mm) : null, ref: ast && notas[ast] ? notas[ast] : null };
      }
    }
    hojas.push({ hoja: hoja.name, mes, anio, estaciones: columnas.length, celdas });
  }
  return { estaciones: [...porClave.values()], hojas, ignorados };
}

module.exports = { leerExcel };
