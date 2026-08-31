# Mapa de Pronóstico — Backend

API Node/Express. Parsea el `.docx` diario, resuelve la geo de los 79
municipios, sirve la geometría y los glyphs del mapa, y genera el PNG
cuadrado para redes.

## Instalación

```bash
npm install
```

`canvas` compila un módulo nativo. En Linux, antes de `npm install`:

```bash
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev
```

(En Render se resuelve con `NODE_VERSION=18` — hay binarios precompilados.)

## Correr

```bash
npm start   # http://localhost:3000
```

## Dos sistemas de coordenadas — no confundirlos

1. **`src/config/coordinates.js`** — posiciones en **píxeles** sobre
   `data/materiales/basemap.png` (1280×1280). Las usa *solo* el generador
   del PNG para redes (`POST /api/pronostico/render-png`). No son
   geográficas.
2. **`data/municipios.json` / `data/municipios.geojson`** — coordenadas
   **geográficas reales** (lat/lng) de los 79 municipios. Las usa el mapa
   interactivo.

El PNG para Instagram sigue siendo la imagen fija de siempre. Lo que
cambió es el mapa *interactivo*.

## Los 79 municipios vs. las 13 estaciones del .docx

Alerta Temprana reporta datos puntuales para 13 localidades. El mapa
muestra los 79 municipios: a los 66 que no son estación se les asigna el
dato de la **estación oficial más cercana** (haversine — ver
`src/lib/municipios.js`). El front lo aclara en la tarjeta de info.

`src/config/estacionAliases.js` resuelve el desfasaje de nombres entre el
`.docx` (abreviado: "BDO. DE IRIGOYEN", "L. N. ALEM") y `municipios.json`
(nombres completos). Si cambia el formato del `.docx` o las estaciones, es
ahí donde hay que tocar.

## Persistencia del pronóstico

`src/lib/store.js`:

- Con **`DATABASE_URL`** (Postgres / Neon): cada "Publicar" inserta una
  fila en la tabla `pronosticos` (`id`, `publicado_en`, `filas jsonb`). El
  mapa usa la última; queda el **historial** completo
  (`GET /api/pronostico/historial`).
- Sin `DATABASE_URL`: cae a `data/store/pronostico-actual.json` (disco,
  sin historial) — sirve para desarrollo local.

La tabla se crea sola al arrancar (`CREATE TABLE IF NOT EXISTS`).
`DATABASE_URL` se carga de `.env` / `.env.local` (dotenv); en Render se
inyecta como variable de entorno.

## Carga de datos: solo por .docx

Por decisión explícita, no hay formulario de carga manual por localidad.
El flujo es "subir .docx → revisar/corregir en la tabla → publicar".

## Geometría del mapa (`data/`)

| Archivo | Qué es | Fuente |
|---|---|---|
| `municipios.geojson` | 79 polígonos de Misiones (WGS84) | Ordenamiento Territorial |
| `municipios.json` | 79 municipios con lat/lng + código | — |
| `mundo.geojson` | Países del mundo | Natural Earth 1:110m |
| `provincias.geojson` | Provincias/estados de AR, BR, PY, UY, BO | Natural Earth 1:10m |
| `paises-labels.geojson` | Puntos de rótulo de países | Natural Earth 1:50m |
| `provincias-labels.geojson` | Puntos de rótulo de provincias | Natural Earth 1:10m |
| `glyphs/Metropolis Regular/*.pbf` | Glyphs para los rótulos del mapa | openmaptiles/fonts |
| `terrain-tiles/` | **Sin uso** (se sacó el terreno 3D) — ~26 MB, se puede borrar | DEM Ordenamiento Territorial |
| `materiales/` | `basemap.png` + íconos del PNG de redes | armados a mano |

Los GeoJSON se sirven con `gzip` (middleware `compression`) — pesan MB en
texto plano.

## Endpoints

| Método | Ruta | Qué hace |
|--------|------|----------|
| POST | `/api/pronostico/parse` | Sube un `.docx`, devuelve `{ filas: [...] }` (13 estaciones), sin publicar. |
| POST | `/api/pronostico/publicar` | Body `{ filas }` → guarda el dataset "actual". |
| GET  | `/api/pronostico/actual` | Último publicado: `{ publicadoEn, filas }` (lo usa el panel). |
| GET  | `/api/pronostico/historial` | `{ historial: [{ id, publicadoEn }] }` — vacío si no hay base. |
| GET  | `/api/pronostico/mapa` | Los 79 municipios con lat/lng + pronóstico (propio o de la estación más cercana). |
| POST | `/api/pronostico/mapa-preview` | Igual, pero a partir de datos sin publicar (vista previa del panel). |
| POST | `/api/pronostico/render-png` | Genera el PNG cuadrado (1280×1280) para redes. Sirve para cron. |
| GET  | `/api/municipios/geojson` | 79 polígonos de Misiones. |
| GET  | `/api/mundo/geojson` | Países del mundo. |
| GET  | `/api/geo/:archivo` | `provincias`, `paises-labels`, `provincias-labels`. |
| GET  | `/api/viento/grilla` | Viento real (Open-Meteo) sobre la región, cacheado 30 min. *(el front hoy usa el snapshot global del propio front, no este endpoint)* |
| GET  | `/api/materiales/icono/:condicion` | Ícono por condición (ignora tildes) — para el PNG de redes. |
| GET  | `/glyphs/{fontstack}/{range}.pbf` | Glyphs de los rótulos. |
| GET  | `/materiales/basemap.png` | Imagen base del PNG de redes. |
| GET  | `/terrain-tiles/{z}/{x}/{y}.png` | Tiles de terreno (sin uso hoy). |

`CORS_ORIGIN` (env, coma-separado) restringe orígenes en producción; sin
la variable se permite cualquiera.

## Estructura

```
src/
  config/coordinates.js        # X/Y en píxeles — solo para el PNG de redes
  config/estacionAliases.js    # docx (abreviado) -> nombre completo
  lib/dateUtils.js             # fecha en español + UTC-3
  lib/docxTables.js            # extrae tablas del .docx
  lib/parseForecast.js         # arma filas LOCALIDAD/TMIN/TMAX/CONDICION
  lib/normalizeText.js         # comparación sin tildes (compartido)
  lib/iconResolver.js          # condición -> archivo de ícono
  lib/municipios.js            # 79 municipios + estación más cercana (haversine)
  lib/generateMap.js           # dibuja el PNG de redes (canvas)
  lib/viento.js                # grilla de viento regional (Open-Meteo)
  lib/store.js                 # persistencia del pronóstico publicado
  routes/pronostico.js         # todos los endpoints
  server.js                    # entrypoint + CORS + gzip + estáticos
```
