# Mapa de Pronóstico — Misiones

Sistema del Ministerio de Ecología y RNR de Misiones para publicar el
pronóstico diario en un mapa embebible y generar la imagen para redes.

```
mapa-backend/     API: parsea el .docx, resuelve geo, sirve la data del mapa,
                  genera el PNG para redes
mapa-frontend/    Panel de operador (/admin) + mapa público embebible (/embed)
```

## Flujo diario

1. El operador entra a `mapa-frontend` → **`/admin`** y sube el `.docx` que
   ya genera Alerta Temprana. No hay carga manual por localidad — el
   `.docx` es la única fuente.
2. El back devuelve las 13 estaciones oficiales estructuradas. El operador
   revisa/corrige en la tabla (la **condición se elige de una lista**, no
   se escribe; las temperaturas se validan) y ve la vista previa en vivo
   del mapa completo (79 municipios).
3. **Publicar** → el back guarda el dataset. Antes de confirmar, el panel
   muestra **qué cambió** respecto de lo último publicado.
4. El `<iframe>` del sitio del ministerio (`/embed`) muestra el mapa real.
5. Para redes: un botón genera el PNG cuadrado de siempre (server-side,
   `canvas`), o se automatiza con un cron contra
   `POST /api/pronostico/render-png`.

## El mapa público (`/embed`)

Mapa **MapLibre GL v5** con **proyección de globo** (estilo
earth.nullschool):

- Abre centrado en Misiones. Se puede **alejar hasta ver la Tierra como
  esfera** y **rotar/inclinar en todos los ejes**.
- **79 municipios** de Misiones extruidos por temperatura máxima y
  coloreados por condición (paleta del brandbook — ver
  `src/lib/condiciones.js`). Contorno blanco marcado para distinguir
  municipios vecinos del mismo color.
- **División política de todo el globo**: países (Natural Earth 1:50m) +
  **provincias/estados de Argentina, Brasil, Paraguay, Uruguay y Bolivia**
  (Natural Earth 1:10m), con sus **rótulos** (fuente Metropolis, glyphs
  self-hosteados). Los vecinos influyen en el clima local, por eso están.
- **Viento global animado** (partículas estilo nullschool). Es un
  *snapshot* GFS (`mapa-frontend/public/wind-global.json`), todavía **no
  está en vivo**. Se ve más marcado sobre Misiones.
- Al clickear un municipio: tarjeta con temperaturas, condición e ícono
  **animado** (Meteocons, MIT). Los 66 municipios que no son estación
  oficial muestran "dato de la estación más cercana: X (Y km)".
- Sin marcadores de estación en el mapa (se sacaron); el dato aparece al
  clickear.

Los datos geográficos y de terreno son propios/dominio público — **cero
proveedores de tiles de terceros**.

## El PNG para redes

Sigue siendo la imagen fija `basemap.png` (1280×1280) + coordenadas en
**píxeles**, dibujada con `canvas` en el backend. Eso **no cambió** — es un
asset gráfico armado a mano. No tiene nada que ver con el mapa interactivo.

`mapa-backend/README.md` tiene el detalle de los dos sistemas de
coordenadas y de por qué conviven.

## Levantar en local

```bash
# Terminal 1 — backend
cd mapa-backend
npm install
npm start                 # http://localhost:3000

# Terminal 2 — frontend
cd mapa-frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:3000
npm run dev               # http://localhost:5173
```

Abrí `http://localhost:5173/admin`, subí un `.docx`, publicá, y mirá
`http://localhost:5173/embed`.

## Deploy (Vercel + Render)

Todo lo necesario está: `mapa-frontend/vercel.json`,
`mapa-backend/render.yaml` y **`DEPLOY.md`** con el paso a paso. Resumen:
front a Vercel (root `mapa-frontend`, var `VITE_API_URL`), back a Render
(blueprint, `NODE_VERSION=18` por `canvas`). No es repo git todavía.

## Pendientes / notas

- **Viento en vivo**: hoy es un snapshot. Falta enganchar una fuente GFS
  que se actualice.
- **Viento en la vista de globo**: al alejarse mucho (zoom < 3.6) las
  partículas se ocultan (se proyectan fuera del disco de la Tierra). Falta
  recortar el canvas al círculo del globo.
- **Animación de entrada** (globo → Misiones): está en el código pero
  desactivada por defecto (`intro={false}` en `BaseMap`) — era inestable
  con toda la data cargando junta.
- **Primer render**: con muchísima geometría (mundo + provincias) el
  primer pintado puede tardar unos segundos en máquinas con GPU floja.
- **Auth en `/admin`**: hoy no tiene login.
- **Historial**: el store solo guarda el último publicado.
- **Fuentes FiraSans** para que el PNG de redes sea idéntico al original
  (falta el `.ttf`).
- `mapa-backend/data/terrain-tiles/` (~26 MB) quedó sin uso — se sacó el
  terreno 3D porque descolocaba los marcadores. Se puede borrar.
- Origen del `.docx`: hoy se sube a mano; se podría integrar con Google
  Drive.
