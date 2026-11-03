import { enFemenino } from "./nivelAlerta.js";

/**
 * Epígrafes de las publicaciones en redes: se arman solos, con emojis y renglones separados, a partir de lo que ya trae la alerta o el
 * aviso (los textos del SMN se usan tal cual, sólo se ordenan). Nada de esto lo escribe la persona.
 */
const PIE = "🏛️ Ministerio de Ecología y RNR de Misiones";
const NIVEL = { Verde: { punto: "🟢", accion: "Tranquilidad" }, Amarillo: { punto: "🟡", accion: "Informate" }, Naranja: { punto: "🟠", accion: "Preparate" }, Rojo: { punto: "🔴", accion: "Seguí las instrucciones oficiales" } };
const FENOMENO = {
  tormentas: { emoji: "⛈️", nombre: "tormentas" }, "tormentas-severas": { emoji: "🌪️", nombre: "tormentas severas" }, granizo: { emoji: "🧊", nombre: "granizo" },
  "vientos-fuertes": { emoji: "💨", nombre: "vientos fuertes" }, "lluvias-intensas": { emoji: "🌧️", nombre: "lluvias intensas" }, inundacion: { emoji: "🌊", nombre: "inundaciones" },
};
const emojiDeTexto = (t) => {
  const s = String(t).toLowerCase();
  return /severa/.test(s) ? "🌪️" : /tormenta|el[eé]ctric|rayo/.test(s) ? "⛈️" : /granizo/.test(s) ? "🧊" : /viento|r[aá]faga/.test(s) ? "💨" : /lluvia|precipitaci/.test(s) ? "🌧️" : /inunda|crecida/.test(s) ? "🌊" : /calor|temperatura/.test(s) ? "🌡️" : /niebla/.test(s) ? "🌫️" : "⚠️";
};
const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}` : xs[0] || "");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const juntar = (bloques) => bloques.filter(Boolean).join("\n\n");

/**
 * Alerta meteorológica. `tipo`: qué placa es («Actualización de vigencia»…, opcional); `nivel`; `periodo`: el texto de vigencia;
 * `fenomenos`: ids del catálogo; `departamentos`: nombres de los que están en alerta.
 */
export function epigrafeAlerta({ tipo = "", nivel = "", periodo = "", fenomenos = [], departamentos = [] } = {}) {
  const n = NIVEL[nivel];
  const titulo = nivel ? `${n?.punto || "⚠️"} ALERTA ${enFemenino(nivel).toUpperCase()}` : "⚠️ ALERTA METEOROLÓGICA";
  const fen = fenomenos.map((id) => FENOMENO[id]).filter(Boolean);
  return juntar([
    tipo ? `${titulo}\n📌 ${tipo}` : titulo,
    fen.length ? `${fen.map((f) => f.emoji).join(" ")} ${cap(lista(fen.map((f) => f.nombre)))}` : "",
    periodo && `📅 ${periodo}`,
    departamentos.length ? `📍 ${departamentos.length === 1 ? "Departamento" : "Departamentos"}: ${lista(departamentos)}` : "",
    n?.accion && `✅ ${n.accion}`,
    `${PIE}\n#AlertaMeteorológica #Misiones`,
  ]);
}

/**
 * Aviso a muy corto plazo. `texto`: el que arma el panel (o el del SMN): fenómeno, «dd/mm/aaaa a las hh:mmhs», «Validez hasta: …» y
 * zonas, cada uno en su renglón. Lo que no calza con ese orden se pone igual, uno por renglón, con el emoji que le toca.
 */
export function epigrafeAcp(texto = "", { titulo = "Aviso a muy corto plazo" } = {}) {
  const lineas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cuerpo = lineas.map((l, i) => {
    if (/^validez/i.test(l)) return `⏳ ${l}`;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(l)) return `🕒 Emitido el ${l}`;
    if (i === 0) return `${emojiDeTexto(l)} ${l}`;
    return `📍 ${l}`;
  });
  return juntar([`🚨 ${titulo.toUpperCase()}`, cuerpo.slice(0, 1).join(""), cuerpo.slice(1).join("\n"), `${PIE}\n#AvisoACP #Misiones`]);
}
