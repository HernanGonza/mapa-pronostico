const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const requireRole = require("../middleware/requireRole");

/**
 * Puente entre el panel y el servicio de transmisión en vivo (contenedor
 * `transmision`, ver transmision/servidor.mjs). El servicio no publica puertos: sólo
 * el backend le habla, por la red interna de docker, con TRANSMISION_TOKEN.
 * Sólo superadmin (Configuración → Transmisión).
 */
const router = express.Router();
const base = () => (process.env.TRANSMISION_CONTROL_URL || "http://transmision:8090").replace(/\/+$/, "");
const soloSuperadmin = [requireAuth, requireRole("superadmin")];

async function control(metodo, ruta, cuerpo) {
  const token = process.env.TRANSMISION_TOKEN || "";
  if (!token) throw Object.assign(new Error("Falta TRANSMISION_TOKEN en el .env del servidor (el mismo para el backend y el servicio de transmisión)."), { status: 503 });
  let res;
  try {
    res = await fetch(`${base()}${ruta}`, {
      method: metodo, signal: AbortSignal.timeout(20000),
      headers: { "x-token": token, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw Object.assign(new Error("El servicio de transmisión no responde. ¿Está levantado? (docker compose up -d transmision)"), { status: 503 });
  }
  return res;
}

async function reenviarJson(res, metodo, ruta, cuerpo) {
  try {
    const r = await control(metodo, ruta, cuerpo);
    res.status(r.status).set("Cache-Control", "no-store").json(await r.json().catch(() => ({})));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

router.get("/transmision/estado", ...soloSuperadmin, (req, res) => reenviarJson(res, "GET", "/estado"));
// { destinos: ["youtube", "facebook", …] }: a cuáles transmitir (de los que tienen clave en el .env).
router.post("/transmision/iniciar", ...soloSuperadmin, express.json({ limit: "4kb" }), (req, res) => {
  const destinos = Array.isArray(req.body?.destinos) ? req.body.destinos.filter((d) => typeof d === "string").slice(0, 10) : [];
  reenviarJson(res, "POST", "/iniciar", { destinos });
});
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
