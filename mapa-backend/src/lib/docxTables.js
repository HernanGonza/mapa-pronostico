const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");

/**
 * Extrae todas las tablas de un .docx, en el orden en que aparecen.
 * Devuelve: Array<Array<Array<string>>>  ->  tabla -> fila -> celda (texto)
 *
 * Reemplaza a `docx2python`: en vez de depender de la estructura interna
 * de docx2python (doc_result.body[1], [3], [5]...), leemos directamente
 * el XML del documento y tomamos las tablas en orden (tabla 0, 1, 2 =
 * zona norte, centro, sur).
 *
 * @param {Buffer} buffer - contenido del archivo .docx
 */
async function extractDocxTables(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) {
    throw new Error("El archivo no parece ser un .docx válido (falta word/document.xml)");
  }
  const xml = await documentEntry.async("string");

  const parser = new XMLParser({
    ignoreAttributes: true,
    preserveOrder: true,
    trimValues: false,
  });
  const parsed = parser.parse(xml);

  const tables = [];

  function collectText(node, acc) {
    if (Array.isArray(node)) {
      node.forEach((n) => collectText(n, acc));
      return;
    }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        if (key === ":@") continue;
        if (key === "w:t") {
          const val = node[key];
          if (Array.isArray(val) && val[0] && val[0]["#text"] !== undefined) {
            acc.push(String(val[0]["#text"]));
          } else if (typeof val === "string") {
            acc.push(val);
          }
        } else {
          collectText(node[key], acc);
        }
      }
    }
  }

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node["w:tbl"]) {
        const table = [];
        const rowNodes = node["w:tbl"].filter((n) => n["w:tr"]);
        for (const rowNode of rowNodes) {
          const cellNodes = rowNode["w:tr"].filter((n) => n["w:tc"]);
          const row = cellNodes.map((cellNode) => {
            const acc = [];
            collectText(cellNode["w:tc"], acc);
            return acc.join("").trim();
          });
          table.push(row);
        }
        tables.push(table);
      } else {
        for (const key of Object.keys(node)) {
          if (key !== ":@") walk(node[key]);
        }
      }
    }
  }

  walk(parsed);
  return tables;
}

module.exports = { extractDocxTables };
