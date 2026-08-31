// Carga .env / .env.local en desarrollo. En producción (Render) las
// variables se inyectan directo y estos archivos no existen.
require("dotenv").config({ path: [".env.local", ".env"], quiet: true });

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");

const pronosticoRouter = require("./routes/pronostico");
const store = require("./lib/store");

const app = express();
const PORT = process.env.PORT || 3000;

// El front (React) vive en otro origen (Vercel), y el iframe del
// ministerio es otro origen más. `CORS_ORIGIN` (coma-separado) restringe
// a esos dominios en producción; sin la variable, se permite cualquiera
// (cómodo para desarrollo y para la demo).
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
// Los GeoJSON (mundo, provincias, rótulos) pesan MB en texto plano; con
// gzip bajan ~4x y el mapa carga mucho más rápido.
app.use(compression());

app.get("/health", (req, res) => res.json({ ok: true }));

// Estáticos con cache larga (no cambian entre deploys).
const estatico = express.static;
const unAnio = { maxAge: "365d", immutable: true };

// Basemap + íconos: /materiales/basemap.png, /materiales/imgs/nublado.png
app.use("/materiales", estatico(path.join(__dirname, "..", "data", "materiales"), unAnio));

// Tiles de terreno (Terrain-RGB) del DEM de Ordenamiento Territorial:
// /terrain-tiles/{z}/{x}/{y}.png
app.use("/terrain-tiles", estatico(path.join(__dirname, "..", "data", "terrain-tiles"), unAnio));

// Glyphs (PBF) para los rótulos del mapa — /glyphs/{fontstack}/{range}.pbf
app.use("/glyphs", estatico(path.join(__dirname, "..", "data", "glyphs"), unAnio));

app.use("/api", pronosticoRouter);

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
