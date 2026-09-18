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
