# Publicar placas en redes desde el panel

Cada pantalla que genera placas (pronóstico, alertas meteorológicas,
recomendaciones, riesgo de incendios y avisos a muy corto plazo) tiene un botón
**Publicar en redes**. Abre un diálogo donde se elige formato (feed / historias),
destino y epígrafe, y desde ahí se publica sin bajar ni subir archivos a mano.

| Destino | Cómo funciona | Configuración |
|---|---|---|
| Facebook (página) | Graph API de Meta: foto en el feed e historia de página | `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` |
| Instagram | Graph API de Meta: publicación de feed e historia | `META_IG_USER_ID` (+ el token de arriba) |
| Telegram | Bot API: el bot manda la foto a un canal/grupo | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| WhatsApp | Abre WhatsApp Web con el epígrafe y los enlaces a las imágenes (no publica solo) | `WHATSAPP_NUMERO` (opcional) |

Un destino sin variables aparece como «sin configurar» y no se puede elegir.
Las variables van en el `.env` del servidor (junto al `docker-compose.yml`) y se
aplican con `docker compose up -d`.

Cada publicación queda registrada en la tabla `publicaciones_redes` (quién, cuándo,
dónde, enlace). Si una placa ya salió en un destino, el sistema avisa antes de repetirla.

## Meta (Facebook + Instagram)

1. **Instagram**: la cuenta tiene que ser *Business* o *Creator* (Configuración →
   Cuenta → Cambiar tipo de cuenta) y estar **vinculada a la página de Facebook** del
   Ministerio (Página → Configuración → Cuentas vinculadas).
2. **Crear la app**: en <https://developers.facebook.com/apps> → *Crear app* → tipo
   *Empresa* (Business). Agregar los productos **Facebook Login for Business** e
   **Instagram Graph API**.
3. **No hace falta pasar la revisión de Meta** mientras la app esté en modo
   *Desarrollo* y la persona que genera el token tenga rol (administrador o
   desarrollador) en la app. Para publicar solo en cuentas propias del Ministerio
   alcanza con eso.
4. **Generar el token**, en el [Explorador de la Graph API](https://developers.facebook.com/tools/explorer/):
   - Elegir la app y *Obtener token de acceso de usuario* con los permisos
     `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
     `instagram_basic`, `instagram_content_publish`, `business_management`.
   - Convertirlo en larga duración:
     `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<TOKEN_CORTO>`
   - Pedir los tokens de página con ese token largo: `GET /me/accounts`. El
     `access_token` de la página que devuelve **no vence** cuando sale de un token
     de usuario de larga duración: ese es `META_PAGE_ACCESS_TOKEN`, y el `id` es
     `META_PAGE_ID`.
5. **ID de Instagram**: `GET /<META_PAGE_ID>?fields=instagram_business_account` → el
   `id` de `instagram_business_account` es `META_IG_USER_ID`.
6. Cargar las tres variables en el `.env` y reiniciar el backend.

Si el token se revoca (cambio de contraseña, se saca el rol en la app, etc.), el panel
muestra «El token de Meta venció o fue revocado»: repetir el paso 4.

Detalles técnicos que ya resuelve el sistema: Instagram solo acepta JPEG y proporción
4:5 (feed) o 9:16 (historias), así que cada placa se convierte a JPEG 1080×1350 /
1080×1920 y se guarda una copia pública en `redes/` del mismo bucket antes de
publicar. Las historias no admiten epígrafe.

## Telegram

1. En Telegram, hablar con **@BotFather** → `/newbot` → guardar el token
   (`TELEGRAM_BOT_TOKEN`).
2. Agregar el bot como **administrador** del canal (o al grupo).
3. `TELEGRAM_CHAT_ID`: `@nombre_del_canal` si es público; si es privado, el id numérico
   (empieza con `-100…`; se ve mandando un mensaje al canal y abriendo
   `https://api.telegram.org/bot<TOKEN>/getUpdates`). Acepta varios separados por coma.

El bot manda la imagen como archivo y el epígrafe como pie de foto (si supera los 1024
caracteres que admite Telegram, va como mensaje aparte).

## WhatsApp

Por ahora es un botón que abre `web.whatsapp.com` con el mensaje armado; WhatsApp Web
no permite adjuntar una imagen por enlace, así que el mensaje lleva las URLs públicas
de las placas (WhatsApp muestra la vista previa) y se envía a mano.

- `WHATSAPP_NUMERO=5493764000000` (código de país, sin `+` ni espacios): abre el chat
  con ese número. Vacío: WhatsApp deja elegir el contacto o grupo.
- Enviar automáticamente (sin abrir WhatsApp Web) requiere la API oficial de WhatsApp
  Business (Cloud API), que necesita un número dedicado y plantillas aprobadas. Cuando
  esté el teléfono se puede evaluar; queda fuera de esta versión.

## Ideas para más adelante

- Bot de Telegram **interactivo** (que respondan «/alerta» y reciban la última placa,
  o suscripción por zona), además del envío al canal que ya existe.
- Programar la publicación para más tarde.
