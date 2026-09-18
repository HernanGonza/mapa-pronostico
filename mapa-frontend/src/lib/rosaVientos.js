export const DIRECCIONES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
export const BANDAS = [
  { desde: 0, hasta: 10, nombre: '0–10 km/h', color: '#d5e9c9' },
  { desde: 10, hasta: 20, nombre: '10–20 km/h', color: '#a9dac5' },
  { desde: 20, hasta: 30, nombre: '20–30 km/h', color: '#7bcabf' },
  { desde: 30, hasta: 40, nombre: '30–40 km/h', color: '#4caeaf' },
  { desde: 40, hasta: 50, nombre: '40–50 km/h', color: '#308da9' },
  { desde: 50, hasta: 60, nombre: '50–60 km/h', color: '#3470a4' },
  { desde: 60, hasta: Infinity, nombre: '>60 km/h', color: '#29477e' },
];

// La dirección SMN está codificada en decenas de grado (0..36).
// La intensidad diaria se registra en m/s; se convierte a km/h como en el atlas.
export function resumirRosa(filas) {
  const conteos = Array.from({ length: 16 }, () => Array(BANDAS.length).fill(0));
  let validos = 0;
  let calmas = 0;
  for (const f of filas) {
    const dir = f.viento_maximo_direccion;
    const velocidad = f.viento_maximo_intensidad;
    if (!Number.isFinite(dir) || !Number.isFinite(velocidad) || dir < 0 || dir > 36 || velocidad < 0) continue;
    validos++;
    if (velocidad === 0) { calmas++; continue; }
    const sector = Math.round((dir * 10 % 360) / 22.5) % 16;
    const kmh = velocidad * 3.6;
    const banda = BANDAS.findIndex(b => kmh >= b.desde && kmh < b.hasta);
    conteos[sector][banda]++;
  }
  const porcentajes = conteos.map(fila => fila.map(c => validos ? c / validos * 100 : 0));
  return { validos, calmas, porcentajes, maximo: Math.max(0, ...porcentajes.map(fila => fila.reduce((a, b) => a + b, 0))) };
}
