function nombreSeguro(nombre) { return nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

export async function exportarElementoPdf(elemento, titulo) {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const fondo = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
  const imagen = await toPng(elemento, { backgroundColor: fondo, pixelRatio: 2, cacheBust: true });
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const propiedades = pdf.getImageProperties(imagen);
  const ancho = 277;
  const alto = Math.min(170, propiedades.height * ancho / propiedades.width);
  pdf.setFontSize(13);
  pdf.text(titulo, 10, 13);
  pdf.addImage(imagen, 'PNG', 10, 19, ancho, alto);
  pdf.save(`${nombreSeguro(titulo)}.pdf`);
}

export async function exportarImagenPdf(imagen, titulo) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const propiedades = pdf.getImageProperties(imagen);
  const ancho = 277;
  const alto = Math.min(170, propiedades.height * ancho / propiedades.width);
  pdf.setFontSize(13);
  pdf.text(titulo, 10, 13);
  pdf.addImage(imagen, 'PNG', 10, 19, ancho, alto);
  pdf.save(`${nombreSeguro(titulo)}.pdf`);
}

export async function exportarTablaPdf({ titulo, columnas, filas, nombre }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.setFontSize(13);
  pdf.text(titulo, 10, 13);
  autoTable(pdf, {
    head: [columnas], body: filas, startY: 18,
    styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: [38, 83, 67] },
    margin: { left: 9, right: 9 },
  });
  pdf.save(`${nombreSeguro(nombre || titulo)}.pdf`);
}

/**
 * Informe diario para autoridades, A4 vertical: título, fecha, texto, mapa de estaciones,
 * tabla por estación, gráficos y lo que emitió el SMN. `mapa` y `graficos`: elementos del DOM
 * (se pasan a imagen).
 */
export async function exportarInformePdf({ titulo, subtitulo, resumen, mapa, graficos, tabla, avisos, fuente, nombre }) {
  const [{ toPng }, { jsPDF }, { default: autoTable }] = await Promise.all([import('html-to-image'), import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 14, ancho = W - 2 * M;
  let y = 18;
  const nuevaPagina = (alto) => { if (y + alto > 282) { pdf.addPage(); y = 18; } };
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(22, 62, 48);
  pdf.text(titulo, M, y); y += 7;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor(80, 90, 85);
  pdf.text(subtitulo, M, y); y += 4;
  pdf.setDrawColor(22, 62, 48); pdf.setLineWidth(0.6); pdf.line(M, y, W - M, y); y += 7;
  pdf.setFontSize(10.5); pdf.setTextColor(30, 35, 33);
  for (const parrafo of resumen.split(/\n\s*\n/)) {
    const lineas = pdf.splitTextToSize(parrafo.trim(), ancho);
    nuevaPagina(lineas.length * 4.8 + 3);
    pdf.text(lineas, M, y); y += lineas.length * 4.8 + 3;
  }
  const imagen = async (el, maxAlto) => {
    if (!el) return;
    const png = await toPng(el, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true });
    const p = pdf.getImageProperties(png), alto = Math.min(maxAlto, (p.height * ancho) / p.width), w = (p.width * alto) / p.height;
    nuevaPagina(alto + 4);
    pdf.addImage(png, 'PNG', M + (ancho - w) / 2, y, w, alto); y += alto + 5;
  };
  await imagen(mapa, 120);
  autoTable(pdf, { startY: y, head: [tabla.columnas], body: tabla.filas, margin: { left: M, right: M }, styles: { fontSize: 8.5, cellPadding: 1.6 }, headStyles: { fillColor: [22, 62, 48] }, alternateRowStyles: { fillColor: [244, 247, 244] } });
  y = pdf.lastAutoTable.finalY + 6;
  await imagen(graficos, 150);
  if (avisos?.filas?.length) {
    nuevaPagina(20);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(22, 62, 48); pdf.text('Avisos y alertas del SMN', M, y); y += 3;
    autoTable(pdf, { startY: y, head: [avisos.columnas], body: avisos.filas, margin: { left: M, right: M }, styles: { fontSize: 8.5, cellPadding: 1.6 }, headStyles: { fillColor: [22, 62, 48] } });
    y = pdf.lastAutoTable.finalY + 6;
  }
  const paginas = pdf.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110, 120, 115);
    pdf.text(fuente, M, 290); pdf.text(`${i} / ${paginas}`, W - M, 290, { align: 'right' });
  }
  pdf.save(`${nombreSeguro(nombre || titulo)}.pdf`);
}
