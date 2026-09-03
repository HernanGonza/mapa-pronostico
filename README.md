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

Mapa **plano en 2D** (MapLibre GL v5, proyección mercator, sin inclinación
ni rotación — se sacó todo lo 3D del proyecto):

- Abre centrado en Misiones, panorámica y zoom libres.
- **79 municipios** de Misiones coloreados por condición (paleta del
  brandbook — ver `src/lib/condiciones.js`), con su nombre rotulado y
  contorno blanco marcado para distinguir municipios vecinos del mismo
  color.
- **División política de contexto**: países (Natural Earth 1:50m) +
  **provincias/estados de Argentina, Brasil, Paraguay, Uruguay y Bolivia**
  (Natural Earth 1:10m), con sus **rótulos** (fuente Metropolis, glyphs
  self-hosteados). Los vecinos dan contexto geográfico, por eso están.
- La única interacción es clickear un municipio: tarjeta con temperaturas,
  condición e ícono **animado** (Meteocons, MIT). Los 66 municipios que no
  son estación oficial muestran "dato de la estación más cercana: X (Y km)".
  No hay capas de clima superpuestas (nubosidad/lluvia/viento/temperatura)
  ni pronóstico extendido — el `.docx` de Alerta Temprana hoy solo trae un
  día (TMIN/TMAX/CONDICION) por estación.

Los datos geográficos son propios/dominio público — **cero proveedores de
tiles de terceros**.

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

- **Primer render**: con muchísima geometría (mundo + provincias) el
  primer pintado puede tardar unos segundos en máquinas con GPU floja.
- **Auth en `/admin`**: hoy no tiene login.
- **Base de datos**: el pronóstico + historial se guardan en Postgres
  (Neon) cuando hay `DATABASE_URL`; si no, en un archivo en disco. Hay un
  proyecto Neon temporal creado — **hay que reclamarlo** (ver `DEPLOY.md`).
- **Fuentes FiraSans** para que el PNG de redes sea idéntico al original
  (falta el `.ttf`).
- Origen del `.docx`: hoy se sube a mano; se podría integrar con Google
  Drive.
