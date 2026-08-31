# Mapa de Pronóstico — Backend común

## Instalación

```bash
npm install
```

`canvas` compila un módulo nativo. En Linux instalá las libs de Cairo/Pango
antes de `npm install`:

```bash
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev
```

## Correr

```bash
npm start   # http://localhost:3000
```

## Dos sistemas de coordenadas — no confundirlos

Este proyecto usa **dos** datasets de coordenadas distintos, para dos
cosas distintas:

1. **`src/config/coordinates.js`** — posiciones en **píxeles** sobre
   `basemap.png` (1280×1280). Las usa *solo* el generador del PNG
   cuadrado para redes (`POST /api/pronostico/render-png`). No son
   geográficas, son literalmente "dónde cae el texto en la imagen".
2. **`data/municipios.json`** — coordenadas **geográficas reales**
   (lat/lng) de los 79 municipios de Misiones. Las usa el mapa
   interactivo (Leaflet, en el front) para ubicar cada municipio en su
   lugar real.

El PNG para Instagram sigue siendo la imagen fija de siempre — eso no
cambió. Lo que cambió es el mapa *interactivo*, que ahora es un mapa real
con tiles, no la imagen tratada como plano de píxeles.

## Los 79 municipios vs. las 13 estaciones del .docx

Alerta Temprana solo reporta datos puntuales para 13 localidades (las de
siempre: Puerto Iguazú, Oberá, Posadas, etc.), pero el mapa interactivo
tiene que mostrar los 79 municipios de la provincia para que cualquiera
encuentre el suyo.

Solución: para los 66 municipios que NO son una de las 13 estaciones, se
les asigna el dato de **la estación oficial geográficamente más cercana**
(distancia real, fórmula de haversine — ver `src/lib/municipios.js`). El
front lo deja explícito: los 13 se ven con su cartel completo siempre
visible, el resto son puntos que al clickear muestran "Estación más
cercana: X (12.5 km)" antes del dato, para que quede claro que no es una
medición propia de ese municipio.

`src/config/estacionAliases.js` resuelve el desfasaje de nombres entre el
.docx (que abrevia: "BDO. DE IRIGOYEN", "L. N. ALEM", "A. DEL VALLE") y el
dataset de municipios (nombres completos). Si en algún momento cambia el
formato del .docx o se agregan/sacan estaciones oficiales, es ahí donde
hay que tocar.

## Carga de datos: solo por .docx, sin formulario manual

Por decisión explícita: no hay un formulario de carga manual por
localidad (tipo "elegí condición de una lista"). Alerta Temprana ya
genera el `.docx` diario con esa información — el flujo es "subir
.docx → revisar/corregir en la tabla → publicar", nunca cargar cada
municipio a mano desde cero.

## Materiales

`data/materiales/basemap.png` y `data/materiales/imgs/*.png` ya están
incluidos. Faltan las fuentes para que el PNG del server sea idéntico al
original — ver instrucciones en el código de `src/lib/generateMap.js`, o
copiá los `.ttf` a `data/materiales/fonts/`:

```
data/materiales/fonts/FiraSans-Regular.ttf
data/materiales/fonts/FiraSans-SemiBold.ttf
data/materiales/fonts/FiraSans-Bold.ttf
```

## Endpoints

| Método | Ruta                                | Qué hace |
|--------|--------------------------------------|----------|
| POST   | `/api/pronostico/parse`              | Sube un `.docx`, devuelve `{ filas: [...] }` (las 13 estaciones) sin publicar nada. |
| POST   | `/api/pronostico/publicar`           | Body `{ filas: [...] }` → guarda el dataset "actual". |
| GET    | `/api/pronostico/actual`             | Último pronóstico publicado, las 13 filas crudas (lo usa el panel de admin). |
| GET    | `/api/pronostico/mapa`               | **El que consume el mapa interactivo**: los 79 municipios con lat/lng real + pronóstico (propio o de la estación más cercana). |
| POST   | `/api/pronostico/mapa-preview`       | Igual que el anterior pero a partir de datos sin publicar (vista previa en el panel de admin mientras se edita). |
| POST   | `/api/pronostico/render-png`         | Genera el PNG cuadrado (1280×1280, imagen fija) para redes. Sirve también para automatizar por cron sin operador. |
| GET    | `/api/coordenadas`                   | Posiciones píxel — uso interno del generador de PNG. |
| GET    | `/api/municipios`                    | Los 79 municipios con lat/lng, sin pronóstico (mapa base). |
| GET    | `/api/municipios/geojson`            | Los 79 polígonos reales (WGS84), geometría de Ordenamiento Territorial. |
| GET    | `/api/viento/grilla`                 | Velocidad + dirección de viento real (Open-Meteo), cacheado 30 min. |
| GET    | `/api/materiales/icono/:condicion`   | Resuelve ícono por condición, ignorando tildes. |
| GET    | `/materiales/basemap.png`            | Imagen base servida como estática (para el PNG server-side). |
| GET    | `/terrain-tiles/{z}/{x}/{y}.png`     | Tiles de terreno (Terrain-RGB, codificación Mapbox) generados del DEM real. |

## El mapa interactivo ahora es 3D real, sin ningún proveedor externo

El front (MapLibre GL) ya no depende de ningún tile server de terceros —
ni OSM, ni Carto, ni nadie. Todo sale de datos propios:

- **Terreno**: `data/terrain-tiles/` — generado a partir del DEM real de
  Ordenamiento Territorial (`dem_30m_rec_posgar98ok.tif`), reproyectado a
  Web Mercator y codificado como Terrain-RGB (formato que MapLibre
  entiende nativamente para desplazar el terreno en 3D). Zoom 5-11, ~26 MB.
  Si el DEM origen cambia, hay que regenerar los tiles (el proceso está
  documentado en el historial de esta conversación — reproyección con
  `rio warp` + tileo con `rio rgbify`).
- **Polígonos**: `data/municipios.geojson` — los 79 municipios reales, de
  `MUNICIPIOS_2025.shp` (Ordenamiento Territorial), reproyectados de
  POSGAR98 Faja 7 a WGS84 y cruzados por nombre con el resto de los datos.
- **Viento**: no es un dato propio — sale de Open-Meteo (modelo numérico
  real, gratis, sin key), vía `/api/viento/grilla`.

**Dato importante que hay que saber**: el campo `zonas` del shapefile
(NORTE/CENTRO/SUR) **no coincide exactamente** con la zonificación que usa
Alerta Temprana en el `.docx` (difieren en Oberá y Jardín América). Por
eso `src/lib/municipios.js` NO usa ese campo para nada — sigue resolviendo
la estación más cercana por distancia real (haversine), que no depende de
ninguna de las dos zonificaciones. Vale la pena que alguien concilie esa
diferencia entre Ordenamiento Territorial y Alerta Temprana en algún
momento, pero no bloquea nada de lo que armamos acá.

## Altura de las columnas 3D — no es literal

La extrusión de cada municipio (`fill-extrusion-height` en el front) se
calcula como `TMAX × 300` — es una escala de visualización para que se
note a la escala del mapa, no representa metros reales de nada. Está
comentado así en `BaseMap.jsx` (`alturaPorTemperatura`) por si en algún
momento quieren ajustar el factor.

## Estructura

```
data/materiales/             # basemap, íconos, (opcional) fuentes — para el PNG de redes
data/municipios.json         # 79 municipios con lat/lng real
data/store/                  # pronóstico actualmente publicado (JSON)
src/config/coordinates.js    # X/Y en píxeles — solo para el PNG de redes
src/config/estacionAliases.js # docx (abreviado) -> nombre completo en municipios.json
src/lib/dateUtils.js         # formato de fecha en español + offset UTC-3
src/lib/docxTables.js        # extrae tablas del .docx
src/lib/parseForecast.js     # arma filas LOCALIDAD/TMIN/TMAX/CONDICION
src/lib/normalizeText.js     # comparación de texto sin tildes (compartido)
src/lib/iconResolver.js      # matchea condición -> ícono
src/lib/municipios.js        # dataset de 79 municipios + estación más cercana (haversine)
src/lib/generateMap.js       # dibuja el PNG de redes (canvas)
src/lib/store.js             # persistencia del pronóstico publicado
src/routes/pronostico.js     # todos los endpoints
src/server.js                # entrypoint + CORS + estáticos
```
