# Envío del pronóstico por correo

Cada tarjeta de **Previsión del tiempo** (`/panel/pronostico`) tiene su botón **Enviar por correo**: el servidor arma el
**PDF de ese informe** y lo manda como adjunto. Sale por **Gmail** (contraseña de aplicación) o, cuando el administrador lo
entregue, por **Microsoft 365**; si están las dos, se usa Gmail.

- **Asistente de envío:** destinatarios (todos marcados, se puede destildar) → asunto y mensaje → revisar → enviar. Los
  destinatarios reciben el correo **en copia oculta**; en «Para» va la propia casilla, así queda una copia.
- **Destinatarios del correo:** agregar, cambiar o quitar direcciones de la lista fija (también se pueden pegar varias juntas).
- Cada envío queda registrado en `correo_envios` (quién, cuándo, asunto, a quiénes, adjuntos y si salió bien) y en la tarjeta
  del informe (insignia «Enviado»). La lista vive en `correo_destinatarios`.

## Configurar Gmail (pasos)

1. En la cuenta de Gmail que va a mandar los pronósticos: activar la **verificación en dos pasos**
   (myaccount.google.com → Seguridad).
2. Crear una **contraseña de aplicación**: myaccount.google.com/apppasswords → nombre «Alerta Temprana» → copiar las 16
   letras (se ve una sola vez; con o sin espacios, da igual).
3. Cargar en el `.env` del servidor (la raíz del proyecto, junto al `docker-compose.yml`):

```
GMAIL_USER=la-cuenta@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
MAIL_FROM_NOMBRE=Alerta Temprana — Ecología Misiones   # opcional: cómo se ve el remitente
PDF_OWNER_PASSWORD=                                     # opcional: clave para abrir/editar los PDF (sin ella quedan sellados)
```

4. Aplicar con `docker compose up -d backend` (no `restart`: no relee el `.env`).
5. Probar: en «Previsión del tiempo» desaparece el aviso rojo y dice «Los correos salen desde …». Mandar un informe a una
   dirección propia (destildando al resto en el asistente).

Notas: Gmail permite unos **500 destinatarios por día** por cuenta (sobra para 3 informes por día a ~22 direcciones) y la
contraseña de aplicación deja de servir si se cambia la contraseña de la cuenta o se la revoca. Si Gmail la rechaza, el panel
avisa «Gmail rechazó el usuario o la contraseña de aplicación».

## Alternativa: Microsoft 365

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

Sin ninguna casilla configurada (ni Gmail ni Microsoft) el asistente se puede recorrer, pero en el último paso avisa que falta configurarla y no envía.

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
  `GET|PUT /api/correo/destinatarios`, `POST /api/correo/pronostico` (multipart: `pdf`,
  `asunto`, `cuerpo`, `ids`) y `POST /api/pronostico/informes/:id/enviar` (el que usa el panel: arma el PDF del informe), `GET /api/correo/envios`. Todo con sesión.
- Sólo se puede enviar a direcciones de la lista fija (el pedido manda ids, no direcciones).
- Cada archivo, hasta 20 MB. En el envío por archivo se valida el contenido: el PDF empieza con `%PDF-`.
