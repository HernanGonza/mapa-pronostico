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

MapLibre GL **v5**, **plano en 2D** (mercator, sin inclinación ni rotación
— el proyecto no tiene nada en 3D).

- **Municipios** (`municipiosGeojson`): capa `fill` plana, color por
  condición vía `feature-state`. Contorno (`municipios-outline`) marcado y
  nombre rotulado (`municipios-label`). Click → selecciona y muestra la
  tarjeta con el pronóstico. Es la **única interacción del mapa** — no hay
  capas de clima superpuestas, es deliberado: se ve el municipio, se
  clickea, se lee el dato.
- **Mundo + provincias** (`mundoGeojson`, `provincias`,
  `paisesLabels`, `provinciasLabels`): países vecinos + provincias/estados
  de los 5 vecinos, con rótulos (`symbol` layers, fuente
  `Metropolis Regular` — los glyphs los sirve el backend en
  `/glyphs/{fontstack}/{range}.pbf`). Van **debajo** de los municipios.
- **Íconos de condición**: Meteocons animados (MIT), en `public/iconos/`,
  mapeo en `src/lib/iconoCondicion.js`.

Props: `interactive`, `enableCapture` (para la captura PNG del lado del
cliente).

### GeoJSON

Se piden por HTTP al backend y se pasan como objetos (props), no por URL
directa en MapLibre.

## Generar la imagen para redes

1. **"Imagen para redes (servidor)"** — el back la dibuja con `canvas`
   sobre la imagen fija cuadrada. Vía confiable, y la que hay que usar si
   se automatiza.
2. **"Capturar el mapa como se ve acá"** — usa
   `map.getCanvas().toDataURL()` (con `preserveDrawingBuffer: true`) +
   composición manual con el canvas del viento. Sin el título/leyenda en
   HTML.

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
  lib/tiempoRelativo.js        # "hace X" + fecha larga en español
  lib/normalizeText.js         # comparación sin tildes (compartido con el back)
  components/BaseMap.jsx       # el mapa (plano 2D: municipios + división política)
  components/BrandHeader.jsx   # cabecera institucional del panel
  components/Legend.jsx        # leyenda del mapa
  components/WeatherIcon.jsx   # ícono animado de condición
  pages/AdminPage.jsx          # panel del operador
  pages/EmbedPage.jsx          # vista pública (el iframe)
public/
  fonts/OakSans-*.ttf          # tipografía institucional
  iconos/*.svg                 # Meteocons animados (MIT)
  brand/                       # flor del Lapacho, logo Ordenamiento Territorial
```
