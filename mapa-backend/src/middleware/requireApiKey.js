const crypto = require("crypto");

/**
 * Protege rutas server-a-server (el otro sistema nos empuja datos; del otro
 * lado no hay browser ni sesión). Header fijo compartido en vez de cookie:
 * `X-Api-Key`, comparado contra `ALERTAS_INCENDIOS_TOKEN`. Todavía no hay
 * dominio propio — cuando lo haya, esto se puede reforzar con IP fija o
 * HMAC, pero por ahora el token alcanza y es una variable de entorno, así
 * que rotarlo el día que haga falta es solo cambiar el env.
 */
function requireApiKey(req, res, next) {
  const esperado = process.env.ALERTAS_INCENDIOS_TOKEN;
  if (!esperado) {
    return res.status(501).json({
      error: "Falta configurar ALERTAS_INCENDIOS_TOKEN en el servidor.",
    });
  }
  const recibido = req.headers["x-api-key"] || "";
  const a = Buffer.from(String(recibido));
  const b = Buffer.from(esperado);
  // Comparación de tiempo constante — igual que con las contraseñas, no
  // queremos que el tiempo de respuesta filtre cuánto del token acertaron.
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return res.status(401).json({ error: "API key inválida" });
  }
  next();
}

module.exports = requireApiKey;
