const router = require('express').Router();
const service = require('../lib/cuencas/service');

router.get('/cuencas', (req, res) => {
  res.set('Cache-Control', 'no-store').json(service.obtenerActual());
});

router.post('/cuencas/actualizar', async (req, res) => {
  await service.actualizarAhora();
  res.set('Cache-Control', 'no-store').json(service.obtenerActual());
});

module.exports = router;
