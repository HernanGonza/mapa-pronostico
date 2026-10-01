const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const requireRole = require("../middleware/requireRole");

/**
 * Puente entre el panel y el servicio de transmisión a YouTube (contenedor
 * `transmision`, ver transmision/servidor.mjs). El servicio no publica puertos: sólo
 * el backend le habla, por la red interna de docker, con TRANSMISION_TOKEN.
 * Sólo superadmin (Configuración → Transmisión).
 */
const router = express.Router();
const base = () => (process.env.TRANSMISION_CONTROL_URL || "http://transmision:8090").replace(/\/+$/, "");
const soloSuperadmin = [requireAuth, requireRole("superadmin")];

async function control(metodo, ruta) {
  const token = process.env.TRANSMISION_TOKEN || "";
  if (!token) throw Object.assign(new Error("Falta TRANSMISION_TOKEN en el .env del servidor (el mismo para el backend y el servicio de transmisión)."), { status: 503 });
  let res;
  try {
    res = await fetch(`${base()}${ruta}`, { method: metodo, headers: { "x-token": token }, signal: AbortSignal.timeout(20000) });
  } catch {
    throw Object.assign(new Error("El servicio de transmisión no responde. ¿Está levantado? (docker compose up -d transmision)"), { status: 503 });
  }
  return res;
}

async function reenviarJson(res, metodo, ruta) {
  try {
    const r = await control(metodo, ruta);
    res.status(r.status).set("Cache-Control", "no-store").json(await r.json().catch(() => ({})));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

router.get("/transmision/estado", ...soloSuperadmin, (req, res) => reenviarJson(res, "GET", "/estado"));
router.post("/transmision/iniciar", ...soloSuperadmin, (req, res) => reenviarJson(res, "POST", "/iniciar"));
router.post("/transmision/detener", ...soloSuperadmin, (req, res) => reenviarJson(res, "POST", "/detener"));

router.get("/transmision/captura.jpg", ...soloSuperadmin, async (req, res) => {
  try {
    const r = await control("GET", "/captura.jpg");
    if (!r.ok) return res.status(r.status).json(await r.json().catch(() => ({ error: "No se pudo capturar la pantalla." })));
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "no-store" }).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
