const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const requireRole = require("../middleware/requireRole");
const tv = require("../lib/tvStore");

/**
 * Pantalla de transmisión (/tv): qué se ve y en qué orden (ver lib/tvStore.js).
 *   GET  /api/tv/rotacion            público: lo lee /tv cada 20 s
 *   PUT  /api/tv/rotacion            superadmin: guarda la lista del panel
 *   PUT  /api/tv/urgentes            superadmin: { acp?, alertas? } si cortan la rotación (se aplica al toque)
 *   POST /api/tv/archivos            superadmin: sube un video o una imagen (campo "archivo")
 *   GET  /api/tv/archivos/<nombre>   público: el archivo (con Range, para los videos)
 */
const router = express.Router();
const soloSuperadmin = [requireAuth, requireRole("superadmin")];

const EXTENSIONES = { "video/mp4": "mp4", "video/webm": "webm", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_VIDEO_MB = 500;
const MAX_IMAGEN_MB = 20;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => fs.mkdir(tv.DIR_ARCHIVOS, { recursive: true }, (e) => cb(e, tv.DIR_ARCHIVOS)),
    filename: (req, file, cb) => cb(null, tv.nombreNuevo(EXTENSIONES[file.mimetype])),
  }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!EXTENSIONES[file.mimetype]),
});

router.get("/tv/rotacion", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await tv.obtener());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo leer la rotación de la pantalla de transmisión." });
  }
});

router.put("/tv/rotacion", ...soloSuperadmin, express.json({ limit: "200kb" }), async (req, res) => {
  try {
    res.json(await tv.guardar(req.body?.pantallas, req.usuario.usuarioId));
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : "No se pudo guardar la rotación." });
  }
});

router.put("/tv/urgentes", ...soloSuperadmin, express.json({ limit: "2kb" }), async (req, res) => {
  try {
    res.json({ urgentes: await tv.guardarUrgentes(req.body, req.usuario.usuarioId) });
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : "No se pudo guardar." });
  }
});

router.post("/tv/archivos", ...soloSuperadmin, upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Elegí un video (MP4 o WebM) o una imagen (JPG, PNG o WebP)." });
  const esVideo = req.file.mimetype.startsWith("video/");
  if (!esVideo && req.file.size > MAX_IMAGEN_MB * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(413).json({ error: `La imagen supera los ${MAX_IMAGEN_MB} MB.` });
  }
  res.json({ tipo: esVideo ? "video" : "imagen", src: `${tv.PREFIJO_ARCHIVO}${req.file.filename}` });
});

// Cada archivo tiene un nombre único que no se reutiliza: se puede guardar en caché para siempre.
router.get("/tv/archivos/:nombre", (req, res) => {
  if (!tv.NOMBRE_ARCHIVO.test(req.params.nombre)) return res.status(404).end();
  res.sendFile(path.join(tv.DIR_ARCHIVOS, req.params.nombre), { maxAge: "365d", immutable: true }, (e) => {
    if (e && !res.headersSent) res.status(404).end();
  });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `El archivo supera los ${MAX_VIDEO_MB} MB.` : "El archivo enviado no es válido." });
  }
  next(err);
});

module.exports = router;
