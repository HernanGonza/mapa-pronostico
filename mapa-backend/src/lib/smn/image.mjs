import { createCanvas } from 'canvas';
import { readFileSync } from 'node:fs';
import { colores, vigentes } from './cap.mjs';
const base = JSON.parse(readFileSync(new URL('../../../data/departamentos.geojson', import.meta.url)));
const priority = { Amarillo: 1, Naranja: 2, Rojo: 3, ACP: 4 };
export function generarImagen(fuente, rows, now = new Date()) {
  const canvas = createCanvas(1080, 1350), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f7f3'; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#163e30'; ctx.font = 'bold 44px sans-serif';
  ctx.fillText(fuente === 'SAT' ? 'Alertas meteorológicas' : 'Avisos a muy corto plazo', 55, 75);
  ctx.font = '28px sans-serif'; ctx.fillText('Misiones · Servicio Meteorológico Nacional', 55, 122);
  ctx.font = '22px sans-serif';
  ctx.fillText(`Consultado: ${now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, 55, 164);
  ctx.fillText('Períodos vigentes y próximos · consultar horarios', 55, 201);
  const infos = vigentes(rows, now.getTime()).flatMap(r => r.infos).sort((a, b) => priority[a.categoria] - priority[b.categoria]);
  function draw(geo, color, alpha = 1) {
    const polygons = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
    ctx.beginPath();
    for (const polygon of polygons) for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => {
        const x = 90 + (lon + 56.1) * 315, y = 260 + (-25.4 - lat) * 330;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill('evenodd');
    ctx.globalAlpha = 1; ctx.strokeStyle = '#365748'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const f of base.features) draw(f.geometry, '#d5dbd5');
  // Recorta sólo la imagen a Misiones; el mapa interactivo conserva el polígono completo.
  ctx.save(); ctx.beginPath();
  for (const f of base.features) {
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of ps) for (const ring of p) {
      ring.forEach(([lon, lat], i) => { const x = 90 + (lon + 56.1) * 315, y = 260 + (-25.4 - lat) * 330; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath();
    }
  }
  ctx.clip('evenodd');
  for (const info of infos) for (const zone of info.zonas) if (zone.geometry) draw(zone.geometry, colores[info.categoria], 0.85);
  ctx.restore();
  ctx.fillStyle = '#163e30'; ctx.font = 'bold 24px sans-serif';
  ctx.fillText(infos.length ? `${infos.length} períodos de aviso para Misiones` : 'Sin avisos vigentes en los datos consultados', 55, 1050);
  const summaries = [...new Set(infos.map(i => `${i.titulo} · ${i.categoria} · hasta ${new Date(i.fin).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`))];
  ctx.font = '20px sans-serif';
  summaries.slice(0, 5).forEach((s, i) => ctx.fillText(s, 55, 1090 + i * 31, 965));
  ctx.font = '18px sans-serif'; ctx.fillText('Fuente: SMN · RSS/CAP · Detalle y horarios en el mapa interactivo', 55, 1298);
  return canvas.toBuffer('image/png');
}
