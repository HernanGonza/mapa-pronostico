// Fechas sin zona de las fuentes regionales: Argentina / sur de Brasil (UTC-3).
const HORA = 3600000;
function numero(v) {
  if (v == null || String(v).trim() === '' || v === '-') return null;
  const s = String(v).trim();
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}
function fecha(raw, ahora = Date.now()) {
  let s = String(raw || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))? (\d{2}:\d{2})(?::(\d{2}))?$/);
  if (m) {
    let year = m[3] || new Date(ahora - 3 * HORA).getUTCFullYear();
    s = `${year}-${m[2]}-${m[1]}T${m[4]}:${m[5] || '00'}-03:00`;
    if (!m[3] && Date.parse(s) > ahora + 24 * HORA) s = s.replace(String(year), String(year - 1));
  } else {
    s = s.replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += '-03:00';
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function csv(text) {
  const lines = text.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
  const sep = lines[0].includes(';') ? ';' : ',';
  const split = line => {
    const cells = []; let cell = '', quote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (quote && line[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
      else if (c === sep && !quote) { cells.push(cell.trim()); cell = ''; } else cell += c;
    }
    cells.push(cell.trim()); return cells;
  };
  const keys = split(lines[0]).map(k => k.toLowerCase());
  return lines.slice(1).filter(l => l.trim()).map(l => Object.fromEntries(split(l).map((v, i) => [keys[i], v])));
}
function serie(text, tipo, ahora = Date.now()) {
  const rows = csv(text).map(r => {
    const f = fecha(r.din_instante || r.fecha_hora || r.fecha, ahora);
    let valor;
    if (tipo === 'usina') {
      const parts = ['volumen_turbinado', 'volumen_vertido', 'volumen_chapeco'].map(k => numero(r[k]));
      valor = parts.every(n => n !== null) ? parts.reduce((a, b) => a + b, 0) : null;
    } else valor = numero(tipo === 'ons' ? r.val_vazaodefluente : (r.nivel ?? r.altura_m));
    return { fecha: f, valor };
  }).filter(r => r.fecha && r.valor !== null && r.valor >= 0 && Date.parse(r.fecha) <= ahora + 15 * 60000)
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  const unique = rows.filter((r, i) => !i || r.fecha !== rows[i - 1].fecha);
  if (!unique.length) throw new Error('Sin lecturas válidas');
  return unique.slice(0, 48);
}
function vigente(lectura, horas, ahora = Date.now()) {
  const age = ahora - Date.parse(lectura?.fecha);
  return lectura?.valor != null && Number.isFinite(age) && age >= -15 * 60000 && age <= horas * HORA;
}
function tendencia(rows) {
  const last = rows?.[0];
  const prev = rows?.find(r => Date.parse(last.fecha) - Date.parse(r.fecha) >= HORA);
  const hours = prev ? (Date.parse(last.fecha) - Date.parse(prev.fecha)) / HORA : 0;
  if (!hours || hours > 6) return { tendencia: 'Sin tendencia reciente', variacion: null };
  const rate = (last.valor - prev.valor) / hours;
  return { tendencia: rate >= 0.005 ? 'Sube' : rate <= -0.005 ? 'Baja' : 'Estable', variacion: rate };
}
// La portada SIG usa la última fila ONS y la primera de CHAPECO_USINA.
// Preservar ese orden y su redondeo, independientemente de la serie de alertas.
function lecturaPortada(text, tipo, ahora = Date.now()) {
  const rows = csv(text);
  const r = tipo === 'usina' ? rows[0] : rows.at(-1);
  if (!r) throw new Error('Sin lectura de portada');
  const parts = tipo === 'usina'
    ? [numero(r.volumen_afluente ?? r.volume_afluente), numero(r.volumen_chapeco ?? r.volume_chapeco)]
    : [numero(r.val_vazaodefluente)];
  if (parts.some(v => v === null || v < 0)) throw new Error('Lectura de portada inválida');
  return { valor: Math.round(parts.reduce((a, b) => a + b, 0)), fecha: fecha(r.din_instante || r.fecha_hora, ahora) };
}
module.exports = { lecturaPortada, numero, fecha, csv, serie, vigente, tendencia };
