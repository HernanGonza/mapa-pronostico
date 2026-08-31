# Mapa de Pronóstico — Misiones

```
mapa-backend/     API: parsea el .docx, sirve materiales, resuelve geo, genera el PNG para redes
mapa-frontend/    Panel de operador (/admin) + mapa embebible georreferenciado (/embed)
```

## Flujo diario

1. Operador entra a `mapa-frontend` → `/admin`, sube el `.docx` que ya
   genera Alerta Temprana. Sin formularios manuales por localidad — el
   .docx es la única fuente de datos.
2. El back devuelve las 13 estaciones oficiales estructuradas; el
   operador revisa/corrige si hace falta en la tabla editable, y ve una
   vista previa en vivo del mapa completo (79 municipios).
3. Click en **Publicar** → el back guarda el dataset y lo deja disponible
   para el mapa público.
4. El `<iframe>` en la web del ministerio (`/embed`) muestra el mapa real
   (Leaflet, lat/lng geográficas) con los 79 municipios: los 13 oficiales
   con su dato directo, el resto con el de la estación más cercana.
5. Para redes: desde `/admin`, un botón genera el PNG cuadrado de siempre
   (server-side), o se automatiza con un cron pegándole directo a
   `POST /api/pronostico/render-png`.

## Por qué dos sistemas de coordenadas

- El **PNG para Instagram** sigue usando la imagen fija `basemap.png` +
  coordenadas en píxeles — eso no cambió, es un asset gráfico armado a
  mano y así tiene que seguir siendo.
- El **mapa interactivo** (el que va en el iframe) es un mapa 3D real
  (MapLibre GL) con terreno propio (DEM de Ordenamiento Territorial),
  polígonos reales de los 79 municipios, extruidos por temperatura, con
  viento animado real (Open-Meteo). No usa ningún proveedor de mapas de
  terceros — todo autohospedado.

Son dos cosas independientes que conviven en el mismo backend; el detalle
está en `mapa-backend/README.md` y `mapa-frontend/README.md`.

## Levantar todo en local

```bash
# Terminal 1
cd mapa-backend
npm install
npm start                 # http://localhost:3000

# Terminal 2
cd mapa-frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:3000
npm run dev                # http://localhost:5173
```

Abrí `http://localhost:5173/admin`, subí el `.docx` de ejemplo, publicá,
y mirá `http://localhost:5173/embed` — eso es lo que va a terminar
embebido en el sitio del ministerio.

## Pendientes para producción

- **Fuentes** para que el PNG de redes sea visualmente idéntico al
  original (falta el `.ttf` de FiraSans).
- **Auth en `/admin`** — hoy no tiene login.
- **Historial** — el store solo guarda el último publicado.
- **Origen del `.docx` automático** — hoy se sube a mano; se podría
  integrar con la API de Google Drive si en algún momento quieren que
  deje de ser manual.
- **Deploy**: `canvas` necesita Cairo/Pango en el servidor.
