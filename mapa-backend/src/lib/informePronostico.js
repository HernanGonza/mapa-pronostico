/**
 * Informe «PREVISIÓN DEL TIEMPO PARA LA PROVINCIA DE MISIONES» (formato final de la DGAT): se arma completando
 * la plantilla real (templates/informe-pronostico.docx) en vez de generar un documento nuevo, así quedan
 * idénticos la tipografía, los bordes, los colores y el logo. El .docx es un zip; sólo se reescribe
 * word/document.xml, párrafo por párrafo y celda por celda, tomando el formato del texto que ya había en cada
 * lugar (o, si estaba vacío, el de la marca de párrafo). Lo demás del archivo no se toca.
 *
 * El informe (`borrador`) lo arma el asistente del cajón del ensamble:
 * {
 *   emision: { fecha: "AAAA-MM-DD", hora: 9 },
 *   dias: [{ fecha, texto, recomendaciones? }, { fecha, texto }],           // los dos días con texto
 *   provincia: { tmin: { valor, lugar }, tmax: { valor, lugar }, humedad, precipitaciones, vientos },
 *   zonas: { Sur|Centro|Norte: { tmin, tmax, sens, humedad, vientos, estado, alerta } },
 *   ciudades: [{ tmin, tmax, estado, alerta } × 13, en el orden de CIUDADES],
 *   extendido: { Sur|Centro|Norte: [{ fecha, tmin, tmax, estado, alerta } × 2] },
 * }
 * Las temperaturas se escriben como número («12») y salen «12º C»; el resto es texto libre.
 */
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

const PLANTILLA = path.join(__dirname, "..", "..", "templates", "informe-pronostico.docx");
const ZONAS = ["Sur", "Centro", "Norte"];
// Las ciudades del informe, en el orden de la tabla. `municipio`: cómo figura en municipios.json (para ubicarlas).
const CIUDADES = [
  { nombre: "POSADAS", municipio: "POSADAS" }, { nombre: "L. N. ALEM", municipio: "LEANDRO N. ALEM" },
  { nombre: "APÓSTOLES", municipio: "APOSTOLES" }, { nombre: "SAN JAVIER", municipio: "SAN JAVIER" },
  { nombre: "MONTECARLO", municipio: "MONTECARLO" }, { nombre: "JARDÍN AMÉRICA", municipio: "JARDÍN AMERICA" },
  { nombre: "SAN VICENTE", municipio: "SAN VICENTE" }, { nombre: "A. DEL VALLE", municipio: "ARISTOBULO DEL VALLE" },
  { nombre: "OBERÁ", municipio: "OBERA" }, { nombre: "PUERTO IGUAZÚ", municipio: "PUERTO IGUAZU" },
  { nombre: "BDO. DE IRIGOYEN", municipio: "BERNARDO DE IRIGOYEN" }, { nombre: "ELDORADO", municipio: "ELDORADO" },
  { nombre: "SAN PEDRO", municipio: "SAN PEDRO" },
];

const OPCIONES = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false, processEntities: false, parseTagValue: false, parseAttributeValue: false };

// --- el árbol del XML (preserveOrder): { "w:p": [hijos], ":@": { atributos } } -------------------------------
const tag = (n) => Object.keys(n).find((k) => k !== ":@");
const hijos = (n) => n[tag(n)];
const buscar = (n, t) => hijos(n).find((h) => tag(h) === t);
const filtrar = (n, t) => hijos(n).filter((h) => tag(h) === t);
const textoDe = (n) => (n["#text"] !== undefined ? n["#text"] : Array.isArray(n[tag(n)]) ? n[tag(n)].map(textoDe).join("") : "");
const esc = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const nodoTexto = (s) => ({ "w:t": [{ "#text": esc(s) }], ":@": { "@_xml:space": "preserve" } });
/** Un run con el formato `rPr` y el texto `valor` (las líneas van separadas por saltos de línea). */
function run(rPr, valor, extra = []) {
  const partes = String(valor ?? "").split(/\r?\n/);
  const cuerpo = [];
  partes.forEach((linea, i) => { if (i) cuerpo.push({ "w:br": [] }); cuerpo.push(nodoTexto(linea)); });
  return { "w:r": [...(rPr ? [rPr] : []), ...cuerpo, ...extra] };
}
/** `rPr` con el texto en superíndice (para «s/a¹»). */
const superindice = (rPr) => ({ "w:rPr": [...(rPr ? hijos(rPr).filter((h) => tag(h) !== "w:vertAlign") : []), { "w:vertAlign": [], ":@": { "@_w:val": "superscript" } }] });

/** El formato del texto de un párrafo: el de su primer run con texto, o el de la marca de párrafo si está vacío. */
function formatoDe(p) {
  const conTexto = filtrar(p, "w:r").find((r) => buscar(r, "w:t"));
  if (conTexto) return buscar(conTexto, "w:rPr") || null;
  const pPr = buscar(p, "w:pPr");
  return (pPr && buscar(pPr, "w:rPr")) || null;
}
/** Reemplaza todo el texto del párrafo por `valor`, conservando el formato (o el de `modelo` si el párrafo estaba vacío). */
function ponerTexto(p, valor, modelo = null) {
  const pPr = buscar(p, "w:pPr");
  const rPr = filtrar(p, "w:r").some((r) => buscar(r, "w:t")) ? formatoDe(p) : (modelo || formatoDe(p));
  p[tag(p)] = [...(pPr ? [pPr] : []), ...(valor === "" || valor == null ? [] : [run(rPr, valor)])];
}
/** Igual, para una celda: queda un solo párrafo (las notas para quien escribe, como la de los vientos, se van). */
function ponerCelda(tc, valor, modelo = null) {
  const ps = filtrar(tc, "w:p");
  ponerTexto(ps[0], valor, modelo);
  const sobran = new Set(ps.slice(1));
  tc[tag(tc)] = hijos(tc).filter((h) => !sobran.has(h));
}
/** «s/a» (sin alerta) lleva el superíndice de la nota «1 sin alerta» del pie, como en el original. */
function ponerAlerta(tc, valor, modelo, conNota) {
  if (conNota && /^s\/a$/i.test(String(valor).trim())) {
    ponerCelda(tc, "", modelo);
    const p = filtrar(tc, "w:p")[0], rPr = modelo || formatoDe(p);
    p[tag(p)].push(run(rPr, String(valor).trim()), run(superindice(rPr), "1"));
  } else ponerCelda(tc, valor, modelo);
}

// --- formatos ---------------------------------------------------------------------------------------------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fecha = (iso) => new Date(`${iso}T12:00:00Z`);
const ddmmaaaa = (iso) => iso.split("-").reverse().join("/");
/** «Martes 13 de Octubre» */
const encabezadoDia = (iso) => { const d = fecha(iso), f = (o) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", ...o }).format(d); return `${cap(f({ weekday: "long" }))} ${f({ day: "numeric" })} de ${cap(f({ month: "long" }))}`; };
const horas = (h) => (Number(h) === 1 ? "a la 1 hora" : `a las ${Number(h)} horas`);
/** «12» → «12º C»; si ya trae unidad u otro texto, se deja como está. */
const temp = (v) => { const s = String(v ?? "").trim(); return /^-?\d+([.,]\d+)?$/.test(s) ? `${s.replace(".", ",")}º C` : s; };
const conLugar = (x) => { const v = temp(x?.valor), l = String(x?.lugar ?? "").trim(); return v && l ? `${v} en ${l}` : v; };

/** Reglas de forma del borrador (el asistente las revisa antes de dejar generar). Devuelve el texto del error o null. */
function errorDelBorrador(b) {
  const f = /^\d{4}-\d{2}-\d{2}$/;
  if (!b || typeof b !== "object") return "Falta el informe.";
  if (!f.test(b.emision?.fecha || "") || !Number.isInteger(Number(b.emision?.hora)) || b.emision.hora < 0 || b.emision.hora > 23) return "Falta la fecha y la hora de emisión.";
  if (!Array.isArray(b.dias) || b.dias.length !== 2 || b.dias.some((d) => !f.test(d?.fecha || ""))) return "Faltan los dos días con texto.";
  if (!Array.isArray(b.ciudades) || b.ciudades.length !== CIUDADES.length) return `Tienen que estar las ${CIUDADES.length} ciudades.`;
  for (const z of ZONAS) { if (!b.zonas?.[z]) return `Falta la zona ${z}.`; if (!Array.isArray(b.extendido?.[z]) || b.extendido[z].length !== 2) return `Faltan los dos días del extendido de la zona ${z}.`; }
  return null;
}

// --- armado ------------------------------------------------------------------------------------------------
/** Completa la plantilla con el borrador y devuelve el .docx (Buffer). */
async function generarDocx(borrador) {
  const e = errorDelBorrador(borrador);
  if (e) throw Object.assign(new Error(e), { status: 400 });
  const zip = await JSZip.loadAsync(fs.readFileSync(PLANTILLA), { createFolders: false }); // sin carpetas implícitas: el zip queda como el original
  const xml = await zip.file("word/document.xml").async("string");
  const arbol = new XMLParser(OPCIONES).parse(xml);
  const doc = arbol.find((n) => tag(n) === "w:document"), cuerpo = buscar(doc, "w:body");
  const parrafos = filtrar(cuerpo, "w:p"), tablas = filtrar(cuerpo, "w:tbl");
  const q = (re) => parrafos.findIndex((p) => re.test(textoDe(p).trim()));
  const dias = [...parrafos.keys()].filter((i) => /^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+\d{1,2}\s+de\s+/i.test(textoDe(parrafos[i]).trim()));
  const iEmision = q(/^EMISI[ÓO]N/i), iReco = q(/^RECOMENDACIONES/i), iNota = q(/^1\s+sin alerta/i);
  if (iEmision < 0 || dias.length < 2 || iReco < 0 || tablas.length < 4) throw new Error("La plantilla del informe no tiene la forma esperada (revisá templates/informe-pronostico.docx).");
  const celdas = (t, fila) => filtrar(filtrar(t, "w:tr")[fila], "w:tc");
  const modeloDe = (t, fila, col) => formatoDe(filtrar(celdas(t, fila)[col], "w:p")[0]);

  // Texto corrido: emisión, los dos días y las recomendaciones.
  ponerTexto(parrafos[iEmision], `EMISIÓN:    ${ddmmaaaa(borrador.emision.fecha)}, ${horas(borrador.emision.hora)}  `);
  borrador.dias.forEach((d, i) => { ponerTexto(parrafos[dias[i]], encabezadoDia(d.fecha)); ponerTexto(parrafos[dias[i] + 1], d.texto || ""); });
  ponerTexto(parrafos[iReco], borrador.dias[0].recomendaciones?.trim() ? `RECOMENDACIONES : ${borrador.dias[0].recomendaciones.trim()}` : "");

  // Provincia: filas Mínima, Máxima, Humedad, Precipitaciones, Vientos (valor en la 2.ª columna).
  const [tProv, tZonas, tCiudades, tExt] = tablas, P = borrador.provincia || {};
  [conLugar(P.tmin), conLugar(P.tmax), P.humedad, P.precipitaciones, P.vientos].forEach((v, i) => ponerCelda(celdas(tProv, i + 1)[1], v ?? ""));

  // Hay «s/a»: se conserva la nota «1 sin alerta» del pie; si no, se saca.
  const alertas = [...ZONAS.map((z) => borrador.zonas[z].alerta), ...borrador.ciudades.map((c) => c.alerta)];
  const conNota = alertas.some((a) => /^s\/a$/i.test(String(a ?? "").trim()));
  if (iNota >= 0 && !conNota) ponerTexto(parrafos[iNota], "");

  // Zonas: Sur, Centro, Norte → Mín, Máx, Sens. térmica, Humedad, Vientos, Estado, Alerta (col. 1 a 7).
  ZONAS.forEach((z, i) => {
    const d = borrador.zonas[z], fila = celdas(tZonas, i + 2);
    [temp(d.tmin), temp(d.tmax), d.sens, d.humedad, d.vientos, d.estado].forEach((v, c) => ponerCelda(fila[c + 1], v ?? "", modeloDe(tZonas, 2, c + 1)));
    ponerAlerta(fila[7], d.alerta ?? "", modeloDe(tZonas, 2, 7), conNota);
  });

  // Ciudades: Mín, Máx, Estado, Alerta (col. 1 a 4), a partir de la fila 2.
  borrador.ciudades.forEach((c, i) => {
    const fila = celdas(tCiudades, i + 2);
    [temp(c.tmin), temp(c.tmax), c.estado].forEach((v, k) => ponerCelda(fila[k + 1], v ?? "", modeloDe(tCiudades, 2, k + 1)));
    ponerAlerta(fila[4], c.alerta ?? "", modeloDe(tCiudades, 2, 4), conNota);
  });

  // Extendido: por zona, 4 filas (título, encabezado y los dos días): Fecha, Mín, Máx, Estado, Alerta.
  ZONAS.forEach((z, i) => borrador.extendido[z].forEach((d, k) => {
    const fila = celdas(tExt, i * 4 + 2 + k);
    [ddmmaaaa(d.fecha), temp(d.tmin), temp(d.tmax), d.estado, d.alerta].forEach((v, c) => ponerCelda(fila[c], v ?? "", modeloDe(tExt, 2, c)));
  }));

  const salida = new XMLBuilder({ ...OPCIONES, format: false, suppressEmptyNode: true }).build(arbol).replace("?><w:document", "?>\r\n<w:document");
  zip.file("word/document.xml", salida, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

module.exports = { generarDocx, errorDelBorrador, CIUDADES, ZONAS, encabezadoDia, temp };
