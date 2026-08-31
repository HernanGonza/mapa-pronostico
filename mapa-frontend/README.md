# Mapa de Pronóstico — Frontend (React + MapLibre GL v5)

Dos vistas:

- **`/admin`** — panel del operador: subir `.docx`, revisar/corregir los
  13 puntos oficiales, ver el diff antes de publicar, publicar, generar la
  imagen para redes.
- **`/embed`** — vista pública de solo lectura. **Esta es la URL que va en
  el `<iframe>` del ministerio.**

## Instalación

```bash
npm install
cp .env.example .env   # VITE_API_URL apuntando al back
npm run dev            # http://localhost:5173
```

## El mapa — `src/components/BaseMap.jsx`

MapLibre GL **v5**, proyección de **globo** (`projection: {type:"globe"}`).

- **Municipios** (`municipiosGeojson`): capa `fill-extrusion`, altura =
  `TMAX × 90` (escala de visualización, no metros), color por condición
  vía `feature-state`. Contorno (`municipios-outline`) marcado.
- **Mundo + provincias** (`mundoGeojson`, `provincias`,
  `paisesLabels`, `provinciasLabels`): países de todo el globo +
  provincias/estados de los 5 vecinos, con rótulos (`symbol` layers, fuente
  `Metropolis Regular` — los glyphs los sirve el backend en
  `/glyphs/{fontstack}/{range}.pbf`). Van **debajo** de los municipios.
- **Viento** (`viento`, formato GFS-JSON): `src/lib/windParticles.js`,
  canvas 2D superpuesto. Snapshot global, no en vivo. No se dibuja con
  zoom < 3.6 (vista de globo).
- **Íconos de condición**: Meteocons animados (MIT), en `public/iconos/`,
  mapeo en `src/lib/iconoCondicion.js`.

Props: `intro` (animación globo → Misiones, **false** por defecto),
`interactive`, `enableCapture` (para la captura PNG del lado del cliente).

### GeoJSON

Se piden por HTTP al backend y se pasan como objetos (props). Se probó
cargarlos por URL directo en MapLibre pero con la proyección de globo v5
el repintado quedaba a medias.

## Generar la imagen para redes

1. **"Imagen para redes (servidor)"** — el back la dibuja con `canvas`
   sobre la imagen fija cuadrada. Vía confiable, y la que hay que usar si
   se automatiza.
2. **"Capturar el mapa como se ve acá"** — usa
   `map.getCanvas().toDataURL()` (con `preserveDrawingBuffer: true`) +
   composición manual con el canvas del viento. Captura fiel del 3D, pero
   sin el título/leyenda en HTML.

## Embeber

```html
<iframe src="https://tu-front.gob.ar/embed"
        style="width:100%;height:600px;border:0"
        title="Previsión del tiempo — Misiones"></iframe>
```

## Estructura

```
src/
  theme.css                    # tokens de diseño (paleta brandbook, Oak Sans)
  api.js                       # llamadas al back
  config.js                    # VITE_API_URL
  lib/condiciones.js           # catálogo de condiciones + paleta + leyenda
  lib/iconoCondicion.js        # condición -> ícono Meteocons
  lib/windParticles.js         # animación de viento global (canvas)
  lib/tiempoRelativo.js        # "hace X" + fecha larga en español
  lib/normalizeText.js         # comparación sin tildes (compartido con el back)
  components/BaseMap.jsx       # el mapa (globo, municipios, división política, viento)
  components/BrandHeader.jsx   # cabecera institucional del panel
  components/Legend.jsx        # leyenda del mapa
  components/WeatherIcon.jsx   # ícono animado de condición
  pages/AdminPage.jsx          # panel del operador
  pages/EmbedPage.jsx          # vista pública (el iframe)
public/
  fonts/OakSans-*.ttf          # tipografía institucional
  iconos/*.svg                 # Meteocons animados (MIT)
  brand/                       # flor del Lapacho, logo Ordenamiento Territorial
  wind-global.json             # snapshot de viento global (GFS-JSON)
```
