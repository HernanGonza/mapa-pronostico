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
