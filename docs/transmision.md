# Transmisión en vivo desde el servidor (YouTube, Facebook y otras)

La página **`/tv`** (mapas en rotación, videos institucionales, ACP y alertas a pantalla
completa) se transmite en vivo **desde el mismo servidor**, sin OBS ni una computadora
prendida, a **uno o varios destinos a la vez**: YouTube, Facebook, o cualquier plataforma que
acepte RTMP (Vimeo, Twitch, un servidor propio…).

Se maneja desde el panel: **Configuración → Transmisión** (sólo superadmin): elegir a dónde
transmitir, iniciar, detener, ver el estado y una vista previa de lo que está saliendo.

---

## Paso a paso: Facebook (automático, sin tocar nada)

El sistema **crea el vivo en la página él mismo** por la API de Facebook, con el mismo token
que ya se usa para publicar las placas (`META_PAGE_ID` y `META_PAGE_ACCESS_TOKEN`). Sale al
aire solo, sin entrar a Live Producer. Como Facebook corta cada vivo a las **8 horas**, a las
**7 h 45 min** el sistema cierra el vivo y abre uno nuevo: el corte dura **unos segundos** y
cada tramo queda como un video aparte en la página. Así puede quedar 24/7.

1. **Token con permiso de video.** El token de la página tiene que tener, además de los de
   publicar placas, el permiso **`publish_video`**. Si al iniciar el panel dice
   «al token de la página le falta el permiso publish_video», regeneralo:
   1. [Explorador de la Graph API](https://developers.facebook.com/tools/explorer/) → elegí la
      app → «Obtener token de acceso de usuario» → en los permisos agregá **`publish_video`**
      (dejá los que ya tenía: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
      `instagram_basic`, `instagram_content_publish`, `business_management`).
   2. Extendé el token (Depurador de tokens → «Extender token de acceso») y con el token largo
      hacé `GET me/accounts`: el `access_token` de la página es el nuevo
      `META_PAGE_ACCESS_TOKEN` (no vence).
   3. Reemplazalo en el `.env` del servidor.
2. **En el `.env`** (si todavía no está):
   ```
   TRANSMISION_TOKEN=<texto largo cualquiera; sale de: openssl rand -hex 32>
   ```
   Opcional, el título y la descripción con que aparece el vivo:
   ```
   TRANSMISION_TITULO=Alerta Temprana Misiones · En vivo
   TRANSMISION_DESCRIPCION=Pronóstico, alertas y avisos meteorológicos para Misiones, en vivo.
   ```
3. **Levantar los cambios:**
   ```
   git pull
   docker compose up -d --build
   ```
   La primera vez tarda más: arma la imagen del servicio de transmisión (con Chromium).
4. **Salir al aire.** Panel → **Configuración → Transmisión** → en «Transmitir a» dejá
   tildado **Facebook** → **Iniciar transmisión**. En ~30 s pasa a **«Al aire»**, aparece la
   vista previa y el vivo ya se ve en la página de Facebook. Listo: no hay que tocar nada más.

> **Modo manual** (por si no se quiere usar el token): `FACEBOOK_AUTOMATICO=false` y
> `FACEBOOK_STREAM_KEY=<clave persistente de Live Producer>`. En ese modo hay que tocar
> «Transmitir en vivo» en [Live Producer](https://www.facebook.com/live/producer) cada vez,
> y Facebook corta a las 8 h.

## Paso a paso: YouTube

1. En **YouTube Studio → Crear → Emitir en vivo** (la primera vez YouTube tarda hasta 24 h
   en habilitar el vivo del canal). En **Transmisión**, copiá la **Clave de transmisión**.
   Para probar, privacidad **No listado**. Conviene activar «Iniciar automáticamente» y
   «Finalizar automáticamente» desactivado, para que salga al aire sola cuando llega la señal.
2. En el `.env`: `YOUTUBE_STREAM_KEY=<la clave>` y `docker compose up -d` (no hace falta
   `--build` si ya estaba armado).
3. Panel → Transmisión → tildá **YouTube** (sólo o junto con Facebook) → **Iniciar**.

## Otras plataformas

Cualquier plataforma que dé una dirección RTMP y una clave se agrega sin tocar el código, en
el `.env`, como `Nombre|dirección completa terminada en la clave`, separadas por `;`:

```
TRANSMISION_OTROS=Vimeo|rtmps://rtmp-global.cloud.vimeo.com:443/live/LA_CLAVE;Twitch|rtmp://live.twitch.tv/app/LA_CLAVE
```

Aparecen en «Transmitir a» con ese nombre. (Vimeo requiere un plan pago con vivo.)

---

## Cómo funciona

El servicio `transmision` del `docker-compose.yml` (carpeta `transmision/`):

- **Xvfb**: una pantalla virtual del tamaño de la salida (`TRANSMISION_SALIDA`, 1280×720).
- **Chromium** en modo kiosco abriendo `/tv` en esa pantalla, con un factor de escala
  (ancho / 1920) para que la página se vea igual que a 1920×1080 pero dibuje sólo los
  píxeles que se transmiten (lo pide adentro de docker, al
  Caddy del frontend: `http://frontend/tv`).
- **ffmpeg**: captura la pantalla, le suma una pista de audio en silencio (las plataformas
  exigen audio) y la manda a los destinos elegidos (a Facebook, al vivo que crea por la API). Con varios destinos codifica **una sola
  vez** y reparte la señal: no multiplica el uso de CPU. Si un destino se corta, los demás
  siguen y al minuto se reconecta todo.

Un proceso chico (`servidor.mjs`) arranca todo, lo vigila y, si algo se cae, lo reinicia
(espera 5 s, 10 s… hasta 60 s). Si el servidor se reinicia estando al aire, retoma solo, a los
mismos destinos. Queda en espera (sin consumir casi nada) hasta que se lo inicia desde el panel.

## Antes de la primera vez, verificar en el servidor

- **Salida a internet por RTMP/RTMPS:**
  - Facebook usa RTMPS por el **443**: `nc -vz live-api-s.facebook.com 443`.
  - YouTube usa el **1935**: `nc -vz a.rtmp.youtube.com 1935`. Si está cerrado, usar RTMPS:
    `YOUTUBE_RTMP_URL=rtmps://a.rtmps.youtube.com:443/live2`.
- **Que /tv cargue adentro de docker:** el Caddy del frontend tiene que atender por
  cualquier nombre (`DOMAIN=:80`, como está hoy). Si algún día `DOMAIN` es un dominio, poner
  `TRANSMISION_URL=http://<ese dominio>/tv`.
- **CPU:** los mapas se dibujan por software (no hay GPU) y ffmpeg codifica por software.
  Con lo que viene por defecto (720p, 25 fps) mirar `docker stats` los primeros minutos. Si no
  alcanza: `TRANSMISION_FPS=15` (los mapas cambian lento, casi no se nota) y, si sigue sin
  alcanzar, `TRANSMISION_SALIDA=854x480` (Chromium dibuja la mitad de píxeles que a 720p).
- **Subida:** ~3,5 Mbps estables **por destino** para 720p (la señal se codifica una vez,
  pero se manda a cada plataforma): YouTube + Facebook ≈ 7 Mbps.

## Ajustes opcionales (`.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `TRANSMISION_SALIDA` | `1280x720` | Resolución que reciben las plataformas y tamaño en que dibuja Chromium (`854x480` gasta menos CPU; `1920x1080`, mucha más). |
| `TRANSMISION_FPS` | `25` | Cuadros por segundo. |
| `TRANSMISION_BITRATE` | `3000k` | Calidad del video (1080p: `5000k`–`6000k`). |
| `YOUTUBE_RTMP_URL` | `rtmp://a.rtmp.youtube.com/live2` | RTMPS si el 1935 está cerrado. |
| `FACEBOOK_HORAS_POR_VIVO` | `7.75` | Cada cuánto se renueva el vivo de Facebook (su límite es 8 h). |
| `TRANSMISION_TITULO` / `TRANSMISION_DESCRIPCION` | (textos de Alerta Temprana) | Cómo aparece el vivo en Facebook. |
| `FACEBOOK_AUTOMATICO` | `true` | `false` = modo manual con `FACEBOOK_STREAM_KEY`. |
| `TRANSMISION_URL` | `http://frontend/tv` | Qué página se transmite. |

## Si algo no anda

- Panel → Transmisión → **«Registro técnico»**, o en el servidor
  `docker compose logs -f transmision`.
- «El servicio de transmisión no responde»: `docker compose up -d transmision`.
- «Falta TRANSMISION_TOKEN»: agregarlo al `.env` y `docker compose up -d`.
- Facebook: si dice que falta `publish_video`, ver el paso 1 de Facebook. Si un vivo quedó
  abierto por un corte de luz, se ve en la página como «en vivo» sin señal: se cierra solo a
  los pocos minutos, o desde la página.
- Las claves y el token nunca aparecen en el panel ni en los registros (se tapan con ••••).
- El control del servicio (puerto 8090) no se publica: sólo lo usa el backend, por la red
  interna de docker.
