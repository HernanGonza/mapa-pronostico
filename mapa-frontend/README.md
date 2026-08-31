# Mapa de Pronóstico — Frontend (React + MapLibre GL, 3D)

Dos vistas:

- **`/admin`** — panel del operador: subir `.docx`, revisar/corregir los
  13 puntos oficiales, publicar, y generar la imagen para redes.
- **`/embed`** — vista pública de solo lectura, mapa 3D completo con los
  79 municipios. **Esta es la URL que va en el `<iframe>` del ministerio.**

## Instalación

```bash
npm install
cp .env.example .env   # y apuntá VITE_API_URL al back
npm run dev             # http://localhost:5173
```

Ya no hace falta ninguna otra variable de entorno de tiles — no usamos
ningún proveedor externo (ver más abajo).

## Qué es este mapa, técnicamente

`src/components/BaseMap.jsx` es un mapa **MapLibre GL real, en 3D**, no
la imagen fija ni el mapa Leaflet de las versiones anteriores:

- **Terreno real**: relieve de Misiones (53-833m), generado del DEM de
  Ordenamiento Territorial. El mapa arranca con una entrada
  cinematográfica (`flyTo` desde una vista alta hacia la vista inclinada
  final).
- **Municipios extruidos**: cada uno de los 79 polígonos reales "crece"
  en 3D según su temperatura máxima, coloreado según la condición
  climática (`src/lib/condicionColor.js`).
- **Viento real animado**: partículas que fluyen según el viento real
  (Open-Meteo, no inventado) — técnica canvas 2D clásica
  (`src/lib/windParticles.js`), sincronizada con la proyección del mapa.
- **Hover con panel de info**: pasar el mouse por un municipio muestra
  nombre, temperaturas, condición, y si no es una de las 13 estaciones
  oficiales, aclara de cuál está tomando el dato ("Estación más cercana:
  X, 12 km").

**Cero dependencia de proveedores externos de mapas** — ni OSM, ni Carto,
ni Mapbox, ni nadie. Todo el terreno y los polígonos son datos propios,
servidos por nuestro propio backend. Esto resuelve para siempre el tipo
de problema que tuvimos con Carto (API key rota, watermarks, etc.).

## Carga de datos

Sigue siendo un solo camino: subir el `.docx` de Alerta Temprana. Nada
cambió ahí — ver `mapa-backend/README.md`.

## Generar la imagen para redes

Dos caminos desde `/admin`:

1. **"Generar imagen para redes (servidor)"** — el back la dibuja con
   `canvas` sobre la imagen fija cuadrada de siempre (esa parte no usa
   MapLibre ni 3D, sigue siendo el PNG plano para Instagram). Es la vía
   confiable, y la que hay que usar si se automatiza sin operador.
2. **"Capturar imagen del mapa (como se ve acá)"** — ya NO usa
   `html-to-image` (esa librería no puede capturar canvas WebGL, que es
   como renderiza MapLibre). Ahora usa el propio método de MapLibre
   (`map.getCanvas().toDataURL()`, con `preserveDrawingBuffer: true`
   activado) más una composición manual con el canvas del viento. Esto sí
   captura fielmente lo que se ve, en 3D, tal cual está la cámara en ese
   momento — pero no incluye el título/leyenda en HTML (eso solo lo trae
   la opción 1).

## Embeber en el sitio del ministerio

```html
<iframe
  src="https://tu-front.gob.ar/embed"
  style="width: 100%; height: 600px; border: 0;"
  title="Previsión del tiempo — Misiones"
></iframe>
```

## Estructura

```
src/
  api.js                       # todas las llamadas al back
  config.js                    # VITE_API_URL (nada de tiles)
  lib/condicionColor.js        # condición climática -> color
  lib/normalizeText.js         # comparación de texto sin tildes
  lib/windParticles.js         # animación de partículas de viento (canvas)
  components/BaseMap.jsx       # el mapa 3D — terreno, extrusión, viento, hover
  pages/AdminPage.jsx          # formulario + revisión + preview en vivo + publicar + capturas
  pages/EmbedPage.jsx          # vista pública de solo lectura (el iframe)
  styles.css
```

## Nota de rendimiento

El bundle de producción pesa ~980 KB (gzip ~277 KB), la mayor parte es
la librería MapLibre GL en sí — es esperable para un mapa WebGL con
terreno 3D, no es un bug. Si en algún momento pesa como problema real,
se puede code-splittear con `import()` dinámico, pero no hace falta
todavía.
