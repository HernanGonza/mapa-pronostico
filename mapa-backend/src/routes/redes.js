const express = require("express");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middleware/requireAuth");
const redes = require("../lib/redesSociales");
const redesStore = require("../lib/redesStore");

const router = express.Router();

// Publicar es irreversible desde el sistema: un tope evita ráfagas por error
// (doble clic, script) o por una sesión robada.
const publicarLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas publicaciones en poco tiempo. Esperá unos minutos." },
});

// Qué destinos están configurados (el front oculta/deshabilita los que no).
router.get("/redes/estado", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store").json(redes.estado());
});

// Publicaciones previas exitosas de una placa (para avisar de duplicados).
router.get("/redes/publicaciones", requireAuth, async (req, res) => {
  const { feedUrl, historiasUrl } = req.query;
  const validas = [feedUrl, historiasUrl].filter((u) => redes.esUrlDePlaca(u));
  try {
    res.set("Cache-Control", "no-store").json({ publicaciones: await redesStore.exitosasDe(validas) });
  } catch (e) {
    console.error(e);
    res.json({ publicaciones: [] }); // el aviso de duplicados es un extra, no debe trabar el modal
  }
});

router.post("/redes/publicar", requireAuth, publicarLimiter, express.json({ limit: "20kb" }), async (req, res) => {
  const { feedUrl, historiasUrl, epigrafe, destinos, formatos, forzar } = req.body || {};
  const error = redes.errorDePedido({ feedUrl, historiasUrl, epigrafe, destinos, formatos });
  if (error) return res.status(400).json({ error });
  const config = redes.estado();
  const sinConfigurar = destinos.filter((d) => !config[d]);
  if (sinConfigurar.length) return res.status(503).json({ error: `Sin configurar en el servidor: ${sinConfigurar.join(", ")}.` });

  try {
    // Guardia contra duplicados: mismo destino + formato + placa ya publicados.
    if (!forzar) {
      const previas = await redesStore.exitosasDe([feedUrl, historiasUrl]).catch(() => []);
      const repetidas = previas.filter((p) => destinos.includes(p.destino) && formatos.includes(p.formato));
      if (repetidas.length) return res.status(409).json({ error: "Esta placa ya se publicó en alguno de los destinos elegidos.", yaPublicado: repetidas });
    }
    const resultados = await redes.publicar({ feedUrl, historiasUrl, epigrafe, destinos, formatos });
    await redesStore.registrar({ usuarioId: req.usuario.usuarioId, epigrafe, feedUrl, historiasUrl, resultados })
      .catch((e) => console.error("[redes] no se pudo registrar la publicación:", e.message));
    res.set("Cache-Control", "no-store").json({ resultados });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo publicar." });
  }
});

router.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "El pedido es demasiado grande." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "El contenido enviado no es válido." });
  next(err);
});

module.exports = router;
