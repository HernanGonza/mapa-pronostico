// Carga .env / .env.local en desarrollo. En producción (Render) las
// variables se inyectan directo y estos archivos no existen.
require("dotenv").config({ path: [".env.local", ".env"], quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");

const pronosticoRouter = require("./routes/pronostico");
const authRouter = require("./routes/auth");
const incendiosRouter = require("./routes/incendios");
const riesgoIncendiosRouter = require("./routes/riesgoIncendios");
const store = require("./lib/store");

const app = express();
const PORT = process.env.PORT || 3000;

// Cabeceras de seguridad estándar (helmet), con dos excepciones a
// propósito: /embed y sus hermanas se abren en un <iframe> de OTRO origen
// (el sitio del ministerio) — frameguard/CORP por defecto lo bloquearían.
app.use(
  helmet({
    contentSecurityPolicy: false, // el CSP lo define el front (Vite/Caddy); acá solo hay JSON + estáticos
    frameguard: false, // embebido a propósito en un origen ajeno
    crossOriginResourcePolicy: { policy: "cross-origin" }, // /materiales y /glyphs los consume el front en otro origen
    crossOriginEmbedderPolicy: false,
  })
);

// El front (React) vive en otro origen (Vercel), y el iframe del
// ministerio es otro origen más. `CORS_ORIGIN` (coma-separado) restringe
// a esos dominios en producción; sin la variable, se permite cualquiera
// (cómodo para desarrollo y para la demo). `credentials: true` para que
// el cookie de sesión viaje en los fetch cross-origin del panel.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigin, credentials: true }));
// Los GeoJSON (mundo, provincias, rótulos) pesan MB en texto plano; con
// gzip bajan ~4x y el mapa carga mucho más rápido.
app.use(compression());

app.get("/health", (req, res) => res.json({ ok: true }));

// Estáticos con cache larga (no cambian entre deploys).
const estatico = express.static;
const unAnio = { maxAge: "365d", immutable: true };

// Basemap + íconos: /materiales/basemap.png, /materiales/imgs/nublado.png
app.use("/materiales", estatico(path.join(__dirname, "..", "data", "materiales"), unAnio));

// Glyphs (PBF) para los rótulos del mapa — /glyphs/{fontstack}/{range}.pbf
app.use("/glyphs", estatico(path.join(__dirname, "..", "data", "glyphs"), unAnio));

app.use("/api", authRouter);
app.use("/api", pronosticoRouter);
app.use("/api", incendiosRouter);
app.use("/api", riesgoIncendiosRouter);

// Prepara la conexión a la base (si hay DATABASE_URL) antes de escuchar.
store
  .init()
  .catch((err) => console.error("[store] no se pudo inicializar:", err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Servidor escuchando en http://localhost:${PORT}`);
      console.log(
        process.env.DATABASE_URL
          ? "[store] persistencia: Postgres"
          : "[store] persistencia: archivo en disco (sin DATABASE_URL)"
      );
    });
  });
