/**
 * "hace 5 minutos", "hace 2 horas", "ayer"... a partir de una fecha ISO.
 * Devuelve null si no hay fecha.
 */
export function tiempoRelativo(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const seg = Math.round((Date.now() - t) / 1000);
  if (seg < 45) return "recién";
  if (seg < 90) return "hace 1 minuto";

  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} minutos`;

  const hs = Math.round(min / 60);
  if (hs < 24) return `hace ${hs} ${hs === 1 ? "hora" : "horas"}`;

  const dias = Math.round(hs / 24);
  if (dias === 1) return "ayer";
  if (dias < 7) return `hace ${dias} días`;
  return `hace ${Math.round(dias / 7)} semanas`;
}

/** Fecha larga en español: "domingo 31 de agosto". */
export function fechaLarga(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}
