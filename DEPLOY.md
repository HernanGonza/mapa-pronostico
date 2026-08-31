# Deploy — front en Vercel, back en Render

Dos servicios separados. Primero el back (para tener su URL), después el front.

## 1. Backend → Render

1. Subí el repo a GitHub (o GitLab/Bitbucket).
2. En Render: **New + → Blueprint**, elegí el repo. Render lee
   `mapa-backend/render.yaml` y crea el web service.
   - Si preferís a mano: **New + → Web Service**, root directory
     `mapa-backend`, build `npm install`, start `npm start`,
     health check `/health`.
3. Variables de entorno:
   - `NODE_VERSION` = `18` (con 20+ `canvas` intenta compilar y falla)
   - `CORS_ORIGIN` = la URL del front en Vercel (la completás en el paso 2,
     después de crear el front). Podés dejarla vacía para la demo — sin
     ella el back acepta cualquier origen.
4. `canvas` (para el PNG de redes) usa binarios precompilados con Node 18
   (por eso `NODE_VERSION=18`). Si en el futuro se sube a Node 20+, hay
   que pasar a `canvas@^3`.
5. Anotá la URL que te da Render, por ej. `https://mapa-pronostico-backend.onrender.com`.

> El plan free de Render **duerme el servicio tras 15 min sin tráfico**.
> La primera carga después de eso tarda ~30 s. Para la demo, abrí el back
> una vez antes de mostrarlo.

> El plan **free de Render no permite disco persistente**, así que el
> pronóstico publicado (`data/store/`) se borra en cada deploy/reinicio —
> hay que volver a publicar desde `/admin`. Para la demo alcanza. En
> producción: subir de plan y agregar un Disk en
> `/opt/render/project/src/mapa-backend/data/store`.

## 2. Frontend → Vercel

1. En Vercel: **Add New → Project**, elegí el repo.
2. **Root Directory**: `mapa-frontend`.
3. Framework: Vite (lo detecta solo; ya está en `vercel.json`).
4. Variable de entorno:
   - `VITE_API_URL` = la URL del back de Render (paso 1),
     **sin barra final**.
5. Deploy. Te queda algo como `https://mapa-pronostico.vercel.app`.
6. Volvé a Render y poné esa URL en `CORS_ORIGIN` (redeploy del back).

## 3. Probar

- `https://tu-front.vercel.app/admin` → subí el `.docx`, publicá.
- `https://tu-front.vercel.app/embed` → el mapa que iría en el iframe.

## Notas

- El campo de viento global (`mapa-frontend/public/wind-global.json`) es
  un **snapshot** (no está en vivo todavía). Alcanza para la demo; para
  producción hay que enganchar una fuente GFS que se actualice.
- Los tiles de terreno (~26 MB) y los GeoJSON viajan en el repo dentro de
  `mapa-backend/data/` — se deployan con el back, no hay que subirlos
  aparte.
