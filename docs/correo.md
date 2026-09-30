# Envío del pronóstico por correo

Desde **Previsión del tiempo** (`/panel/pronostico`) el panel manda el pronóstico del día por
correo, con el `.docx` y el `.rtf` adjuntos, desde la casilla institucional
`alertatemprana@ecologia.misiones.gob.ar` (Microsoft 365).

- **Enviar por email:** asistente paso a paso: archivos (el `.docx` cargado + el `.rtf`) →
  destinatarios (todos marcados, se puede destildar) → asunto y mensaje → revisar → enviar.
  Los destinatarios reciben el correo **en copia oculta**; en «Para» va la propia casilla,
  así queda una copia en Enviados/Recibidos.
- **Destinatarios del email:** asistente para agregar, cambiar o quitar direcciones de la
  lista fija (también se pueden pegar varias juntas, como vienen en un mail).
- Cada envío queda registrado en la tabla `correo_envios` (quién, cuándo, asunto, a quiénes,
  archivos y si salió bien). La lista vive en `correo_destinatarios`; la primera vez se
  carga sola con la lista que se usaba desde el Gmail.

## Configuración en el servidor

La cuenta usa autenticación moderna (OAuth2): **no hay SMTP con usuario y contraseña**. El
envío va por la API de **Microsoft Graph** con una aplicación registrada en Entra ID por el
administrador de Microsoft 365 del gobierno (permiso de envío restringido a esa casilla).
Él pasa tres datos, que van en el `.env` del servidor:

```
MS_TENANT_ID=      # Id. de directorio (inquilino)
MS_CLIENT_ID=      # Id. de aplicación (cliente)
MS_CLIENT_SECRET=  # VALOR del secreto de cliente (no el «Id. del secreto»)
MAIL_FROM=alertatemprana@ecologia.misiones.gob.ar
```

Después: `docker compose up -d backend` (no `restart`: no relee el `.env`).

Sin esas variables el asistente se puede recorrer, pero en el último paso avisa que falta
configurar Microsoft 365 y no envía.

**El secreto de cliente vence** (máximo 24 meses). Anotá la fecha que informe el
administrador y pedí uno nuevo antes; si vence, el panel muestra «Microsoft rechazó el
secreto de cliente».

## Qué le pedimos al administrador (resumen)

1. Registrar la aplicación «Alerta Temprana – envío de pronóstico», inquilino único.
2. Permiso de envío **restringido a alertatemprana@**: RBAC para aplicaciones de Exchange
   Online (rol `Application Mail.Send` con un ámbito que sólo incluya esa casilla), o
   `Mail.Send` de aplicación + `New-ApplicationAccessPolicy`.
3. Un secreto de cliente, y pasarnos los tres datos por un medio seguro.

## Detalles técnicos

- `mapa-backend/src/lib/correo.js`: token por *client credentials* (se cachea ~1 h), crea el
  mensaje como borrador, sube los adjuntos (los de más de 3 MB en partes, por *upload
  session*) y lo envía. Si algo falla, borra el borrador.
- `mapa-backend/src/routes/correo.js`: `GET /api/correo/estado`,
  `GET|PUT /api/correo/destinatarios`, `POST /api/correo/pronostico` (multipart: `docx`,
  `rtf`, `asunto`, `cuerpo`, `ids`), `GET /api/correo/envios`. Todo con sesión.
- Sólo se puede enviar a direcciones de la lista fija (el pedido manda ids, no direcciones).
- Cada archivo, hasta 20 MB. Se valida el contenido: el `.docx` es un zip y el `.rtf`
  empieza con `{\rtf`.
