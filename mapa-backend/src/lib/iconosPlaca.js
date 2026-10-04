/**
 * Íconos de las placas de alerta (actualización de vigencia, recomendaciones, aviso
 * de alerta), dibujados con canvas: trazo blanco (o del color de la alerta) sobre el
 * fondo de rayos. Se dibujan en una grilla de 100×100 que se escala al tamaño pedido,
 * así salen nítidos en feed y en historias. Son una primera versión, calcada a ojo de
 * las placas armadas a mano: si llegan los íconos del diseñador, se reemplazan acá.
 *
 * dibujarIcono(ctx, nombre, x, y, tamano, color) — (x, y) es la esquina superior izquierda.
 */
const { OAK_SANS } = require("./fuentes");

const ICONOS = {
  reloj(c) {
    c.lineWidth = 7;
    c.beginPath(); c.arc(50, 50, 40, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(50, 24); c.lineTo(50, 52); c.lineTo(68, 64); c.stroke();
  },
  ubicacion(c) {
    c.beginPath();
    c.moveTo(50, 96);
    c.bezierCurveTo(40, 80, 18, 58, 18, 38);
    c.arc(50, 38, 32, Math.PI, 0);
    c.bezierCurveTo(82, 58, 60, 80, 50, 96);
    c.closePath();
    c.arc(50, 38, 12, 0, Math.PI * 2, true);
    c.fill("evenodd");
  },
  tormenta(c) {
    nube(c);
    c.fill();
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(56, 66); c.lineTo(42, 84); c.lineTo(56, 84); c.lineTo(44, 100); c.stroke();
  },
  alerta(c) {
    c.lineWidth = 7;
    c.beginPath(); c.arc(50, 50, 40, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(50, 26); c.lineTo(50, 58); c.stroke();
    c.beginPath(); c.arc(50, 72, 5.5, 0, Math.PI * 2); c.fill();
  },
  // Pronóstico (etiqueta de la condición del día)
  sol(c) {
    c.beginPath(); c.arc(50, 50, 20, 0, Math.PI * 2); c.fill();
    c.lineWidth = 7;
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; c.beginPath(); c.moveTo(50 + Math.cos(a) * 31, 50 + Math.sin(a) * 31); c.lineTo(50 + Math.cos(a) * 43, 50 + Math.sin(a) * 43); c.stroke(); }
  },
  nube(c) { c.save(); c.translate(0, 12); nube(c); c.fill(); c.restore(); },
  nubeSol(c) {
    c.save(); c.translate(22, -10); c.scale(0.62, 0.62);
    c.beginPath(); c.arc(50, 50, 20, 0, Math.PI * 2); c.fill();
    c.lineWidth = 8;
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; c.beginPath(); c.moveTo(50 + Math.cos(a) * 31, 50 + Math.sin(a) * 31); c.lineTo(50 + Math.cos(a) * 43, 50 + Math.sin(a) * 43); c.stroke(); }
    c.restore();
    c.save(); c.translate(0, 16); c.scale(0.9, 0.9); nube(c); c.fill(); c.restore();
  },
  lluvia(c) {
    c.save(); c.translate(0, -4); nube(c); c.fill(); c.restore();
    c.lineWidth = 5;
    for (const x0 of [30, 50, 70]) { c.beginPath(); c.moveTo(x0, 72); c.lineTo(x0 - 6, 92); c.stroke(); }
  },
  // Actualización de nivel: flecha en un círculo, para arriba si sube y para abajo si baja.
  sube(c) { flechaEnCirculo(c, 1); },
  baja(c) { flechaEnCirculo(c, -1); },
  // Recomendaciones
  objetos(c) {
    c.lineWidth = 5;
    // ráfagas de viento
    for (const [y, x0, x1] of [[26, 4, 36], [38, 10, 40], [50, 2, 34]]) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
    c.beginPath(); c.arc(36, 20, 6, Math.PI / 2, -Math.PI / 2 - 0.4, true); c.stroke();
    // silla volando, inclinada
    c.save(); c.translate(64, 52); c.rotate(0.45);
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(-14, -34); c.lineTo(-14, 10); c.lineTo(20, 10); c.stroke(); // respaldo y asiento
    c.beginPath(); c.moveTo(-14, 10); c.lineTo(-16, 42); c.moveTo(18, 10); c.lineTo(20, 42); c.stroke(); // patas
    c.lineWidth = 4;
    for (const x of [-4, 6]) { c.beginPath(); c.moveTo(x, -30); c.lineTo(x, 4); c.stroke(); } // listones
    c.beginPath(); c.moveTo(-14, -34); c.lineTo(14, -34); c.lineTo(14, 4); c.stroke();
    c.restore();
  },
  arroyos(c) {
    c.lineWidth = 6;
    c.beginPath(); c.arc(50, 50, 44, 0, Math.PI * 2); c.stroke();
    // auto
    c.beginPath();
    c.moveTo(26, 56); c.lineTo(30, 44); c.lineTo(38, 32); c.lineTo(62, 32); c.lineTo(70, 44); c.lineTo(74, 56); c.closePath();
    c.stroke();
    c.beginPath(); c.moveTo(32, 44); c.lineTo(68, 44); c.stroke();
    c.beginPath(); c.arc(36, 52, 3, 0, Math.PI * 2); c.arc(64, 52, 3, 0, Math.PI * 2); c.fill();
    // olas
    c.lineWidth = 5;
    for (const y of [66, 77]) {
      c.beginPath(); c.moveTo(18, y);
      for (let x = 18; x < 82; x += 16) c.quadraticCurveTo(x + 4, y - 6, x + 8, y), c.quadraticCurveTo(x + 12, y + 6, x + 16, y);
      c.stroke();
    }
    // prohibido
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(19, 19); c.lineTo(81, 81); c.stroke();
  },
  resguardo(c) {
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(4, 50); c.lineTo(42, 14); c.lineTo(80, 50); c.stroke(); // techo
    c.beginPath(); c.moveTo(62, 32); c.lineTo(62, 18); c.lineTo(72, 18); c.lineTo(72, 42); c.stroke(); // chimenea
    c.beginPath(); c.moveTo(14, 46); c.lineTo(14, 88); c.lineTo(56, 88); c.stroke(); // paredes
    c.beginPath(); c.rect(28, 60, 14, 28); c.stroke(); // puerta
    // escudo con tilde
    c.beginPath();
    c.moveTo(74, 52); c.lineTo(96, 60); c.lineTo(96, 76); c.bezierCurveTo(96, 88, 84, 96, 74, 100); c.bezierCurveTo(64, 96, 52, 88, 52, 76); c.lineTo(52, 60); c.closePath();
    c.stroke();
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(63, 76); c.lineTo(71, 84); c.lineTo(86, 68); c.stroke();
  },
  informado(c) {
    c.lineWidth = 6;
    redondeado(c, 26, 4, 48, 92, 9); c.stroke();
    c.beginPath(); c.moveTo(26, 18); c.lineTo(74, 18); c.moveTo(26, 80); c.lineTo(74, 80); c.stroke();
    c.beginPath(); c.arc(50, 88, 3, 0, Math.PI * 2); c.fill();
    // triángulo de advertencia
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(50, 30); c.lineTo(68, 64); c.lineTo(32, 64); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(50, 41); c.lineTo(50, 52); c.stroke();
    c.beginPath(); c.arc(50, 58, 2.8, 0, Math.PI * 2); c.fill();
  },
  emergencias(c) {
    // globo con "911"
    c.lineWidth = 5;
    redondeado(c, 34, 4, 62, 36, 14); c.stroke();
    c.beginPath(); c.moveTo(44, 40); c.lineTo(38, 50); c.lineTo(54, 40); c.stroke();
    c.font = `bold 26px ${OAK_SANS}`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("911", 65, 23);
    // tubo de teléfono
    c.beginPath();
    c.moveTo(14, 50); c.bezierCurveTo(8, 56, 8, 66, 14, 74); c.bezierCurveTo(22, 86, 34, 94, 44, 96);
    c.bezierCurveTo(50, 98, 54, 94, 56, 90); c.lineTo(48, 80); c.bezierCurveTo(44, 78, 42, 82, 38, 82);
    c.bezierCurveTo(32, 78, 28, 72, 26, 66); c.bezierCurveTo(26, 62, 30, 60, 28, 56); c.lineTo(20, 48);
    c.bezierCurveTo(18, 46, 16, 48, 14, 50); c.closePath(); c.fill();
    // ondas
    c.lineWidth = 4;
    for (const r of [10, 18]) { c.beginPath(); c.arc(56, 70, r, -Math.PI / 2.4, Math.PI / 5); c.stroke(); }
  },
};

function nube(c) {
  c.beginPath();
  c.moveTo(18, 64);
  c.arc(18, 47, 17, Math.PI / 2, Math.PI * 1.5);
  c.arc(44, 30, 24, Math.PI * 1.05, Math.PI * 1.9);
  c.arc(76, 45, 19, Math.PI * 1.35, Math.PI * 0.5);
  c.closePath();
}
function flechaEnCirculo(c, sentido) {
  c.lineWidth = 7;
  c.beginPath(); c.arc(50, 50, 40, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(50, 50 + 22 * sentido); c.lineTo(50, 50 - 22 * sentido); c.stroke();
  c.beginPath(); c.moveTo(36, 50 - 8 * sentido); c.lineTo(50, 50 - 22 * sentido); c.lineTo(64, 50 - 8 * sentido); c.stroke();
}
function redondeado(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

const NOMBRES = Object.keys(ICONOS);

function dibujarIcono(ctx, nombre, x, y, tamano, color = "#fff") {
  const dibujo = ICONOS[nombre];
  if (!dibujo) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(tamano / 100, tamano / 100);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8;
  dibujo(ctx);
  ctx.restore();
}

module.exports = { dibujarIcono, NOMBRES };
