const express = require("express");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");
const avisos = require("../lib/avisosEspecialesStore");
const pendientes = require("../lib/placasPendientes");
const { generarAvisoEspecialAmbos, errorDeAvisoEspecial, TITULO } = require("../lib/generateAvisoEspecial");

const router = express.Router();
const TIPOS = ["image/png", "image/jpeg"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, TIPOS.includes(file.mimetype)),
});

// Genera feed + historias del aviso especial (texto libre + captura de radar/satélite).
// multipart/form-data: texto, emitidoEn ("AAAA-MM-DDTHH:mm", hora de Misiones), titulo, subtitulo y nivel (opcionales), imagen
// (JPG/PNG) y vistaPrevia=true — o, para guardar la vista previa ya revisada,
// confirmarToken + texto + emitidoEn (sin imagen: no se vuelve a generar).
router.post("/avisos-especiales/generar", requireAuth, upload.single("imagen"), async (req, res) => {
  const { texto, emitidoEn, confirmarToken } = req.body || {};
  // Título de dos líneas y nivel (opcionales; sin título va "AVISO ESPECIAL").
  const titulo = req.body?.titulo || TITULO, subtitulo = req.body?.subtitulo || "", nivel = req.body?.nivel || null;
  const error = errorDeAvisoEspecial({ texto, emitidoEn, titulo, subtitulo, nivel }) || (confirmarToken || req.file ? null : "Subí la imagen de radar o satélite (JPG o PNG).");
  if (error) return res.status(400).json({ error });
  try {
    await pendientes.resolver(req, res, {
      generar: () => generarAvisoEspecialAmbos({ texto, emitidoEn, titulo, subtitulo, nivel, imagen: req.file.buffer }),
      guardar: (pngs) => avisos.crear({ texto, emitidoEn, titulo, subtitulo, nivel, usuarioId: req.usuario.usuarioId, ...pngs }),
    });
  } catch (e) {
    if (!e.status) console.error(e);
    const status = [400, 503].includes(e.status) ? e.status : 500;
    res.status(status).json({ error: status === 500 ? "No se pudo generar el aviso especial." : e.message });
  }
});

// Para el histórico (todavía no se muestra en el panel).
router.get("/avisos-especiales/historial", requireAuth, async (req, res) => {
  try {
    res.json({ historial: await avisos.obtenerHistorial() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "La imagen supera los 15 MB." : "El archivo enviado no es válido." });
  }
  next(err);
});

module.exports = router;
