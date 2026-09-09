const router = require('express').Router();
router.get('/alertas-meteorologicas/smn', async (req, res) => {
  try { const s = await import('../lib/smn/service.mjs'); res.set('Cache-Control', 'no-store').json(await s.obtenerActual()); }
  catch (e) { console.error('[SMN lectura]', e.message); res.status(503).json({ error: 'No se pudieron leer las alertas del SMN' }); }
});
router.post('/alertas-meteorologicas/smn/actualizar', async (req, res) => {
  try {
    const s = await import('../lib/smn/service.mjs');
    await s.actualizarAhora();
    let actual = await s.obtenerActual();
    // El SMN puede responder con timeout de forma intermitente. El botón
    // manual hace un segundo intento cuando el primero no dejó SAT vigente.
    const sat = actual?.fuentes?.SAT;
    if (sat && !sat.alertas.length && sat.error) {
      await new Promise(resolve => setTimeout(resolve, 750));
      await s.actualizarAhora();
      actual = await s.obtenerActual();
    }
    res.set('Cache-Control', 'no-store').json(actual);
  } catch (e) {
    console.error('[SMN actualización manual]', e.message);
    res.status(503).json({ error: 'No se pudo consultar el SMN ahora' });
  }
});
router.get('/alertas-meteorologicas/smn-api', async (req, res) => {
  try {
    const { leerApiAlertas, descargar, API_ALERTAS, API_AREAS } = await import('../lib/smn/cap.mjs');
    let areas = [];
    try { areas = JSON.parse(await descargar(API_AREAS)); } catch (e) { console.warn('[SMN API áreas]', e.message); }
    const datos = await leerApiAlertas();
    const soloMisiones = (process.env.SMN_SCOPE || 'argentina') === 'misiones';
    const ids = soloMisiones ? new Set(areas.filter(a => a.provinces?.some(p => p.name === 'Misiones')).map(a => a.id)) : null;
    res.set('Cache-Control', 'no-store').json({ fuente: API_ALERTAS, datos: ids ? datos.filter(a => ids.has(a.area_id)) : datos, areas: ids ? areas.filter(a => ids.has(a.id)) : areas });
  } catch (e) {
    console.error('[SMN API]', e.message);
    res.status(503).json({ error: e.message, fuente: process.env.SMN_API_URL || 'https://ws.smn.gob.ar/alerts/type/AL' });
  }
});
// Cuarta vía, manual y pesada: renderiza la página del SMN con Chrome headless.
router.get('/alertas-meteorologicas/smn-scrape', async (req, res) => {
  try {
    const { consultarPagina } = await import('../lib/smn/scrape.mjs');
    const url = req.query.url || process.env.SMN_SCRAPE_URL || 'https://www.smn.gob.ar/alertas';
    if (!/^https:\/\/(www\.)?smn\.gob\.ar\//.test(url)) return res.status(400).json({ error: 'URL de scraping no permitida' });
    res.set('Cache-Control', 'no-store').json(await consultarPagina(url));
  } catch (e) { console.error('[SMN scraping]', e.message); res.status(503).json({ error: e.message }); }
});
router.get('/alertas-meteorologicas/smn/:fuente.png', async (req, res) => {
  const fuente = req.params.fuente.toUpperCase();
  if (!['SAT', 'ACP'].includes(fuente)) return res.sendStatus(404);
  try {
    const s = await import('../lib/smn/store.mjs'); const r = await s.actual(fuente);
    if (!r || Date.now() - Date.parse(r.consultadoEn) > 10 * 60 * 1000) return res.status(503).json({ error: 'La imagen requiere una consulta reciente al SMN' });
    // Recalcula vencimientos al descargar entre dos consultas del worker.
    const { generarImagen } = await import('../lib/smn/image.mjs');
    const { vigentes } = await import('../lib/smn/cap.mjs');
    res.set('Cache-Control', 'no-store').type('png').send(generarImagen(fuente, vigentes(r.datos), new Date(r.consultadoEn)));
  } catch (e) { console.error('[SMN imagen]', e.message); res.status(503).json({ error: 'No se pudo generar la imagen' }); }
});
module.exports = router;
