# Transmisión a YouTube desde el servidor

La página **`/tv`** (mapas en rotación, videos institucionales, ACP y alertas a pantalla
completa) se puede transmitir en vivo a YouTube **desde el mismo servidor**, sin OBS ni una
computadora prendida. Se maneja desde el panel: **Configuración → Transmisión** (sólo
superadmin): iniciar, detener, estado y vista previa de lo que está saliendo.

## Cómo funciona

El servicio `transmision` del `docker-compose.yml` (carpeta `transmision/`) tiene:

- **Xvfb**: una pantalla virtual de 1920×1080.
- **Chromium** en modo kiosco abriendo `/tv` en esa pantalla (lo pide adentro de docker, al
  Caddy del frontend: `http://frontend/tv`).
- **ffmpeg**: captura la pantalla, le suma una pista de audio en silencio (YouTube exige
  audio) y la manda por RTMP a YouTube.

Un proceso chico (`servidor.mjs`) los arranca, los vigila y, si alguno se cae, reinicia todo
(espera 5 s, 10 s… hasta 60 s). Si el servidor se reinicia estando al aire, retoma solo.
Queda en espera (sin consumir casi nada) hasta que se lo inicia desde el panel.

## Puesta en marcha

1. En YouTube Studio: **Crear → Emitir en vivo → Transmisión**. Copiá la **clave de
   transmisión**. (La primera vez YouTube puede tardar hasta 24 h en habilitar el vivo.)
   Conviene configurar ahí la transmisión como «continua» y la privacidad (para probar:
   **No listado**).
2. En el `.env` del servidor:
   ```
   TRANSMISION_TOKEN=<texto largo cualquiera, ej. el resultado de: openssl rand -hex 32>
   YOUTUBE_STREAM_KEY=<la clave de transmisión>
   ```
3. `docker compose up -d --build` (levanta el servicio nuevo y le pasa el token al backend).
4. Panel → Configuración → Transmisión → **Iniciar transmisión**. En ~30 s pasa a «Al aire»
   y aparece la vista previa; YouTube Studio muestra la señal.

## Antes de la primera vez, verificar en el servidor

- **Salida a YouTube:** `nc -vz a.rtmp.youtube.com 1935` tiene que conectar. Si el puerto
  1935 está bloqueado, usar RTMPS por el 443:
  `YOUTUBE_RTMP_URL=rtmps://a.rtmps.youtube.com:443/live2`.
- **Que /tv cargue adentro de docker:** el Caddy del frontend tiene que atender por
  cualquier nombre (`DOMAIN=:80`, como está hoy). Si algún día se configura un dominio en
  `DOMAIN`, poner `TRANSMISION_URL=http://<ese dominio>/tv` o una dirección que Caddy atienda.
- **CPU:** los mapas se dibujan por software (no hay GPU) y ffmpeg codifica por software.
  Con la configuración por defecto (720p, 25 fps) mirar `docker stats` los primeros minutos.
  Si la CPU no da, bajar `TRANSMISION_FPS=15` (los mapas cambian lento, casi no se nota).
- **Subida:** ~3,5 Mbps estables para 720p (`TRANSMISION_BITRATE=3000k`).

## Ajustes opcionales (`.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `TRANSMISION_SALIDA` | `1280x720` | Resolución que recibe YouTube (`1920x1080` pide más CPU y subida). |
| `TRANSMISION_FPS` | `25` | Cuadros por segundo. |
| `TRANSMISION_BITRATE` | `3000k` | Calidad del video (1080p: `5000k`–`6000k`). |
| `YOUTUBE_RTMP_URL` | `rtmp://a.rtmp.youtube.com/live2` | Destino (RTMPS si el 1935 está cerrado). |
| `TRANSMISION_URL` | `http://frontend/tv` | Qué página se transmite. |

## Notas

- La clave de YouTube nunca aparece en el panel ni en los registros (se tapa con ••••).
- El control del servicio (puerto 8090) no se publica: sólo lo ve el backend por la red
  interna de docker, con `TRANSMISION_TOKEN`.
- El audio es silencio: los videos de `/tv` se transmiten sin sonido.
- Mirar qué pasa: panel → Transmisión → «Registro técnico», o `docker compose logs -f transmision`.
