# Bitácora de trabajo — mapa-pronostico

Registro incremental de lo que se pide y se hace, sesión por sesión, para no
perder contexto si se corta el editor. Cada pedido se anota ACÁ antes de
tocar código.

---

## 2026-09-10

**Objetivo de la sesión (dicho por el usuario):** hay que dejar todo
configurado en serio porque se va a montar en el servidor definitivo (una
VM nueva, separada de la VM donde corre `ecodatos`). Vamos paso a paso.
Regla de esta sesión: **todo pedido se escribe acá ANTES de mirar/tocar
código.**

### Pedido 1 — Frontend: pantalla de login
- Agrandar el navbar de la pantalla de login: está "muy finito" y el logo
  de Ecología no se ve bien.
- Archivo probable: `mapa-frontend/src/components/BrandHeader.jsx` (usado
  en `LoginPage.jsx`).

### Pedido 2 — Backend: base de datos
Contexto dado por el usuario:
- Tiene un servicio corriendo en una VM propia llamado **ecodatos**, que
  tiene un **Supabase** (Postgres) asociado.
- Este proyecto (`mapa-pronostico`) se va a desplegar en **otra VM**
  distinta a la de `ecodatos`.
- Quiere que los datos de `mapa-pronostico` cael en la base de
  **ese mismo Supabase de ecodatos**, y **eliminar el Postgres/Neon actual**
  que usa este proyecto.
- Propone crear un **schema nuevo dentro de ese Supabase** para tener los
  datos de `mapa-pronostico` bien separados del resto de `ecodatos`.
- **Auth**: no quiere reusar el sistema de auth de Supabase (GoTrue) de
  ecodatos. Prefiere una **tabla de usuarios propia** dentro del schema
  nuevo, tal como se viene manejando ahora contra Postgres (auth casera).
  Contra Supabase solo quiere pegarle para **guardado de datos**, no auth.
- Quiere empezar a guardar **histórico** de todo, entre otras cosas:
  - quién publicó el mapa/pronóstico y cuándo
  - alertas meteorológicas (SMN)
  - placas/imágenes generadas
  - mapas generados
  - alertas de incendios de NASA (FIRMS)
  - mapas de riesgo de fuego
  - en general: "reestructurar todos los datos de esto que estamos
    construyendo"

**Preguntas pendientes para poder ejecutar esto** (a resolver con el
usuario antes de migrar nada):
1. Datos de conexión al Supabase de `ecodatos`: `SUPABASE_URL`, y
   `service_role key` (o `DATABASE_URL` de Postgres directo con permisos
   para crear schema/tablas). ¿Los tiene a mano o hay que pedírselos al
   admin de esa VM?
2. ¿El proyecto va a usar el **cliente JS de Supabase** (`@supabase/supabase-js`)
   o conexión directa a Postgres (`pg`, como ahora) apuntando al Supabase?
   Con auth casera y sin RLS de Supabase, probablemente conviene seguir
   con `pg` directo contra el schema nuevo — más simple, menos que migrar
   en el código actual.
3. Nombre del schema nuevo (propuesta: `mapa_pronostico`).
4. ¿Hay que mantener el Postgres/Neon actual como fallback durante la
   migración, o se corta en seco?
5. Confirmar qué tablas actuales existen hoy (pronóstico, alertas, etc.)
   para mapear 1 a 1 al esquema nuevo — ver sección "Estado actual de la
   base" en `mapa-backend/README.md` / código en `mapa-backend/src/`.

### Relevamiento — estado actual de la base (hecho, antes de tocar nada)
- **Un solo pool `pg`** compartido, creado en `mapa-backend/src/lib/store.js`
  (`Pool` de `pg`, `max: 3`), usado por todos los módulos vía
  `store.getPool()`. Se activa solo si existe `DATABASE_URL` en el entorno
  (`store.usaPostgres()`); si no, cada módulo cae a un JSON en
  `data/store/*.json` (sin historial).
- **Tablas que crea cada módulo hoy** (todas en el schema `public`, sin
  prefijo — quedaría a mapear a un schema nuevo):
  - `store.js` → `pronosticos` (pronóstico publicado, historial completo).
  - `auth.js` → `usuarios` + `sesiones` (**auth casera**: Argon2id,
    sesión por token opaco hasheado en cookie — no es Supabase Auth/GoTrue,
    coincide con lo que pidió el usuario).
  - `alertasMeteorologicasStore.js` → `alertas_meteorologicas` (SMN).
  - `incendiosStore.js` → `alertas_incendio` (NASA FIRMS).
  - `riesgoIncendiosStore.js` → `riesgo_incendios` (selección manual del
    operador — no calculado).
  - **Falta tabla para "placas/mapas generados"** — hoy el PNG para redes
    (`generateMap.js` / `generateAlertaMap.js`) se genera al vuelo y se
    devuelve, no se persiste ni se registra quién/cuándo lo generó. Hay
    que agregar esto si el usuario quiere ese historial.
- **Infra actual**: `docker-compose.yml` (raíz) levanta un Postgres propio
  en container (`postgres:16-alpine`, sin TLS, `DATABASE_SSL=false`) +
  backend + Caddy. Ese es el Postgres a **eliminar** según el pedido.
  Alternativa que se usa en Render/Vercel (`DEPLOY.md`) es Neon — también
  a dar de baja.
- **Chequeo de integración Supabase de esta sesión** (`mcp__claude_ai_Supabase`,
  solo lectura, sin tocar nada): la única cuenta/proyecto que aparece
  conectado es **`METR1KA`** (`sa-east-1`, org `frgfbezcichzwtsntxfl`) — **NO
  aparece `ecodatos`**. O sea: esta sesión de Claude no tiene acceso directo
  al Supabase de `ecodatos` todavía. Para seguir necesito UNA de estas dos
  cosas del usuario:
  (a) conectar el proyecto `ecodatos` a esta integración de Supabase, o
  (b) pasar a mano `DATABASE_URL` (connection string directa a Postgres,
      puerto 5432, con usuario/clave que pueda crear schema/tablas) del
      Supabase de `ecodatos` — se pone en `.env`/variables de entorno del
      backend, nunca se comitea.

### Plan técnico propuesto (a confirmar, todavía sin ejecutar)
- **Conexión**: seguir usando `pg` directo (no `@supabase/supabase-js`) —
  ya es como está armado el backend, con auth casera y sin RLS no aporta
  nada el SDK de Supabase. Recomendado conectar por **connection directa**
  de Supabase (`db.<ref>.supabase.co:5432`), no por el pooler Supavisor en
  modo transacción (puerto 6543) — ese modo no sostiene bien `search_path`
  por conexión y el backend ya mantiene su propio pool persistente (no
  hace falta poolear más).
- **Separación por schema**: crear `mapa_pronostico` (`CREATE SCHEMA IF
  NOT EXISTS mapa_pronostico;`) dentro del Supabase de `ecodatos`, y hacer
  que el `Pool` de `store.js` abra cada conexión con
  `options: '-c search_path=mapa_pronostico,public'` — así **ningún
  archivo de los 5 stores necesita tocar el nombre de sus tablas**, todo
  sigue funcionando igual pero aterriza en el schema nuevo, separado del
  resto de `ecodatos`.
- **Baja del Postgres propio**: sacar el servicio `db` + volumen `pgdata`
  de `docker-compose.yml`; `DATABASE_URL` pasa a apuntar siempre al
  Supabase de `ecodatos`.
- **Historial nuevo a agregar** (lo que pidió el usuario, no existe hoy):
  - tabla de **publicaciones de mapa/pronóstico** con quién lo publicó
    (FK a `usuarios`) y cuándo — hoy `pronosticos` no guarda `usuario_id`.
  - tabla de **placas/imágenes generadas** (mapa PNG para redes, placa de
    alerta) con tipo, cuándo, quién, y opcionalmente la imagen o un link.
  - las de alertas SMN / NASA FIRMS / riesgo de incendio **ya existen** y
    ya son historial (una fila por publicación) — solo hay que migrarlas
    de schema.
- **Usuarios**: se mantiene tal cual `auth.js` — tabla `usuarios` propia
  dentro de `mapa_pronostico`, Argon2id, sesiones por cookie. Sin tocar
  Supabase Auth/GoTrue de `ecodatos`.

### Datos de conexión que pasó el usuario (sin persistir secretos acá)
- El Supabase de `ecodatos` es **self-hosted** (dominio propio
  `ecodatos.ecologia.misiones.gob.ar`, no `*.supabase.co` de la nube) —
  corre en la VM del usuario, seguramente stack Docker Compose completo
  (Kong/GoTrue/PostgREST/Studio/Postgres).
- Usuario pasó primero `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
  (credenciales del **cliente JS de Supabase**, para REST/Auth desde el
  browser) — **correctamente identificó que no es lo que hace falta** acá,
  porque el backend habla Postgres directo (`pg`), no PostgREST.
- Después pasó la plantilla de conexión que muestra el **Studio de
  Supabase** (`Connect` → Postgres): `host 127.0.0.1, port 5432, database
  postgres, user postgres, password [YOUR-PASSWORD]`. Ese `127.0.0.1` es
  la vista **desde adentro de la VM de ecodatos** (Studio corriendo ahí
  mismo) — **no sirve tal cual** para conectar desde la VM nueva, donde va
  a vivir `mapa-pronostico`, son dos VMs distintas.
- **No se guardó ningún secreto en archivos del repo** — `.env` (raíz y
  `mapa-backend/`) está gitignoreado, ahí va a ir cuando esté completo.

**Sigue faltando para poder conectar:**
1. La **contraseña real** de Postgres (no el placeholder `[YOUR-PASSWORD]`).
2. Un **host/dirección alcanzable desde la VM nueva** (no `127.0.0.1`):
   - ¿Las dos VMs están en la misma red privada/VPC? → usar la IP privada.
   - ¿Solo hay conectividad por internet pública? → habría que exponer el
     puerto 5432 de Postgres con firewall restringido a la IP pública de
     la VM nueva (site-to-site, menos ideal en seguridad pero funciona), o
   - Armar un túnel (WireGuard / SSH tunnel) entre ambas VMs y conectar
     por ahí — más seguro, recomendado si no hay ya una red privada común.
3. Confirmar si Postgres del stack self-hosted ya escucha en una interfaz
   distinta de loopback / tiene un puerto mapeado hacia afuera del host
   (en compose suele ser algo como `"5432:5432"` en el servicio `db`/`postgres`).

**Decisión — tipo de conexión (pregunta del usuario: PSQL primary database,
direct connection o session pooler?):** **Direct connection**, no pooler.
Motivo: el backend ya mantiene su propio pool `pg` chico y persistente
(`max: 3`, un solo proceso Node de larga vida en la VM) — el pooler
(Supavisor, session o transaction) existe para los casos que acá no
aplican: serverless/edge con muchísimas conexiones cortas, o IPv4 en el
plan hosted de Supabase. Además `search_path` (para el schema
`mapa_pronostico`) se setea una vez por conexión al abrir el `Pool`, y
eso es más predecible en directa — en modo transacción (puerto 6543)
Supavisor no sostiene bien parámetros de sesión por conexión. Como es
self-hosted, no hay límite de conexiones concurrentes del plan que
obligue a poolear.

### Datos de red/infra que pasó el usuario (sin persistir secretos acá)
- Confirmado: **direct connection** es lo correcto (`psql -h 127.0.0.1 -p
  5432 -d postgres -U postgres` visto desde dentro de la VM de ecodatos).
- La VM de `ecodatos` está en el **mismo server físico** donde va a ir la
  VM nueva de `mapa-pronostico`, IP privada **`10.0.0.231`**. Esto encaja
  con el escenario "red privada compartida" que planteamos — no debería
  hacer falta exponer Postgres a internet pública ni armar un túnel
  WireGuard, si ambas VMs quedan en la misma red interna del hypervisor.
- El usuario compartió el **`.env` completo del stack self-hosted de
  Supabase** (el que trae `docker-compose` de supabase/supabase). **No se
  guarda ningún valor de ahí en archivos del repo** (ni acá ni en ningún
  tracked file) — solo notas sin secretos. Cuando haga falta, el
  `DATABASE_URL` real va únicamente a `mapa-backend/.env` (gitignoreado).
- **Confirma el layout esperado**: `POSTGRES_HOST=db`, `POSTGRES_DB=postgres`,
  `POSTGRES_PORT=5432` — Postgres corre en la red interna de ese
  `docker-compose`, con el usuario/base default (`postgres`/`postgres`).

### Hallazgo clave — el usuario pasó el `docker-compose.yml` completo de `ecodatos`
Instrucción explícita del usuario: **"no voy a cambiar ni una coma de
ecodatos"** — cualquier solución tiene que funcionar con lo que ya está
publicado, sin tocar ese compose.

Revisando el compose (proyecto `app-formularios`, que **incluye** el
compose oficial de self-host de Supabase vía `include:`):
- El contenedor `db` (`supabase-db`, Postgres real) **NO publica ningún
  puerto al host** — solo es alcanzable dentro de la red docker interna
  `supabase` como `db:5432` (coincide con `POSTGRES_HOST=db` del `.env`).
  Por eso el "direct connection" en el sentido literal (hablarle al
  Postgres posta) **no existe hacia afuera** de esa VM sin tocar el
  compose — cosa que el usuario descartó.
- Lo que SÍ publica puertos al host es **Supavisor** (el pooler),
  servicio `supavisor`:
  ```
  ports:
    - ${POSTGRES_PORT}:5432        # modo SESSION
    - ${POOLER_PROXY_PORT_TRANSACTION}:6543   # modo TRANSACTION
  ```
  Sin IP explícita → Docker publica en `0.0.0.0`, o sea alcanzable desde
  la IP del host (`10.0.0.231`) en la red privada, **sin tocar nada de
  ecodatos** — ya está expuesto tal cual está hoy.
- **Conclusión: no hace falta ninguna edge function ni cambio en
  ecodatos.** La solución es conectar por **Supavisor en modo SESSION
  (puerto 5432)** — mantiene una conexión de backend dedicada por sesión
  de cliente (a diferencia del modo transacción/6543, que multiplexa y
  no sostiene bien parámetros de sesión). Sigue siendo la elección
  correcta que ya habíamos charlado (evitar 6543), solo que llega ahí
  **a través** de Supavisor en vez de "directo" a Postgres — funciona
  igual para lo que necesitamos.
- **Usuario/formato de conexión de Supavisor** (multi-tenant): el
  usuario de conexión no es `postgres` a secas, es
  `postgres.<POOLER_TENANT_ID>`. El `.env` de ecodatos tiene
  `POOLER_TENANT_ID` **todavía en el valor placeholder por defecto** — no
  es un secreto en sí (es más un routing id), pero hay que usarlo tal
  cual está hoy: `postgres.your-tenant-id`. **A confirmar** con un
  `psql` de prueba desde adentro de la VM de ecodatos contra
  `127.0.0.1:5432` (el puerto de Supavisor) antes de asumir que ese es
  el formato exacto — no tengo shell en esa VM para probarlo yo.
- **Ajuste al plan de `search_path`**: en vez de depender de que
  Supavisor reenvíe bien las startup options (`-c search_path=...`), más
  robusto — y funciona igual en modo session — es que `store.js` haga
  `pool.on('connect', client => client.query('SET search_path TO
  mapa_pronostico, public'))`, por cada conexión física nueva del pool.
  Así no depende de un detalle de implementación del pooler.
- El usuario también pasó el `nginx.conf` de ese stack (rutas
  `/auth|/rest|/storage|/functions` → Kong, `/studio/` → Kong con
  basic-auth, y rutas de otra app ajena — "Geolytic"/Ordenamiento
  Territorial en `10.0.0.244`). **No es relevante para
  `mapa-pronostico`** — no hay ninguna ruta ahí para este proyecto ni
  hace falta agregar una (nos alcanza con el puerto de Supavisor ya
  expuesto). Queda solo como contexto de la infra compartida del server.

### ⚠️ Alerta de seguridad (a decidir con el usuario, no se tocó nada)
Revisando el `.env` que pasó: **la gran mayoría de los secretos siguen
siendo el valor por defecto** de la plantilla oficial de self-host de
Supabase (la que trae el propio archivo con el comentario "YOU MUST
CHANGE THESE BEFORE GOING INTO PRODUCTION" arriba de todo). Puntualmente:
- `POSTGRES_PASSWORD` = literalmente `postgres` (el default de Docker).
- `DASHBOARD_PASSWORD` = literalmente el string default de ejemplo.
- `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, `LOGFLARE_PUBLIC/PRIVATE_ACCESS_TOKEN`,
  `POOLER_TENANT_ID` = también valores placeholder de ejemplo, sin cambiar.
- Esto es **antes** de conectar `mapa-pronostico` — es un tema del stack
  de `ecodatos` en sí, no algo que generamos nosotros. Si ese Postgres
  quedara alcanzable desde cualquier lado con esa password, es una puerta
  abierta a los datos de `ecodatos` (y a los que vamos a sumar nosotros).
  **Recomendación: rotar `POSTGRES_PASSWORD` (y de paso el resto) antes de
  poner esto en producción de verdad**, sobre todo ahora que va a
  empezar a guardar histórico del Ministerio. Rotarla implica actualizar
  el `.env` de `ecodatos` y reiniciar ese `docker compose` — lo decide el
  usuario, no se tocó nada todavía.

**Intento de rotar la password (usuario) — falló, y tiene sentido que
falle:** el usuario probó el botón "Reset database password" del Studio
self-hosted y dio `Failed to reset database password: API error happened
while trying to communicate with the server`. Ese botón de Studio le
pega a la **Management API de Supabase Cloud** (ahí rotar la password
también actualiza sola todos los servicios dependientes) — en self-host
esa API no existe/no está configurada, por eso el error genérico.
Además, mirando el compose: **todos** los roles internos (`postgres`,
`supabase_admin`, `supabase_auth_admin`, `authenticator`,
`supabase_storage_admin`, y la password que usa el pooler) comparten el
mismo valor `${POSTGRES_PASSWORD}` — rotarla a mano implicaría
`ALTER ROLE ... PASSWORD` para cada uno de esos roles **dentro** de
Postgres (cambiar el `.env` solo no alcanza, ese valor solo inicializa
el volumen la primera vez) y reiniciar todos los servicios que dependen
de esa password (auth, rest, storage, meta, analytics, supavisor,
functions). Es exactamente el tipo de cambio invasivo que el usuario ya
dijo que no quiere tocar.

**Decisión: no se sigue insistiendo con rotar la password ahora.** Se
sigue con la password actual para conectar `mapa-pronostico` — ya quedó
avisado el riesgo, el resto lo decide el usuario en otro momento si
quiere.

### Hallazgo — `supabase-pooler` (Supavisor) está crasheando en ecodatos
`docker ps` del usuario en `vm-ecodatos` muestra:
```
54b74c0cafcb   supabase/supavisor:2.7.4   ...   Restarting (1) 25 seconds ago   supabase-pooler
```
O sea: **Supavisor está en crash-loop**, no está arriba de forma estable
ahora mismo. Esto explica por qué nuestro plan de conectar por el puerto
5432/6543 (Supavisor) todavía no se pudo probar — ese contenedor no está
sirviendo. Confirmado también por `docker ps`: `supabase-db` (el Postgres
real) solo muestra `5432/tcp` **sin mapeo a host** (como ya
concluíamos), y `supabase-pooler` no muestra columna de PORTS (coherente
con que está cayéndose antes de bindear).

Dato a favor: mirando de nuevo el compose, **todos los servicios internos
del stack** (auth/rest/storage/meta/analytics/functions) usan
`${POSTGRES_HOST}` = `db` — es decir, le hablan a Postgres **directo**,
no pasan por Supavisor. Solo lo usan clientes externos. Así que, aunque
esto esté roto, **la app de `ecodatos`/`formularios` en sí no debería
verse afectada** — el impacto es específicamente que nosotros no podemos
conectar todavía.

Posible relación con el intento fallido de "reset password" del Studio:
el crash empezó "hace 25 segundos" al momento del `docker ps`, cerca en
el tiempo del intento de reset — puede ser causalidad o coincidencia, no
hay forma de confirmarlo sin ver logs.

**Siguiente paso pedido al usuario**: correr en `vm-ecodatos`
`docker logs supabase-pooler --tail 50` (o `docker compose logs
supavisor --tail 50` si tiene el compose a mano) para ver por qué
reinicia en loop, antes de seguir. No tengo shell en esa VM — esto lo
tiene que correr el usuario.

Usuario probó `psql` directo en el **host** de la VM (fuera de
contenedores) y no está instalado (`Command 'psql' not found`). No es
bloqueante ni urgente instalarlo: aunque estuviera, hoy no hay nada
escuchando en `127.0.0.1:5432` del host mientras el pooler esté
crasheado (`supabase-db` no publica puerto al host, solo Supavisor lo
hace cuando está sano). **Prioridad sigue siendo el log del pooler** —
si más adelante hace falta probar `psql` sin instalar nada en el host,
se puede correr adentro del contenedor `supabase-db` (que ya trae el
cliente): `docker exec -it supabase-db psql -U postgres`.

### Cambio de alcance — el usuario SÍ quiere arreglar el pooler (dentro de ecodatos)
El usuario frenó el plan de "conectar como está" y pidió **arreglar el
crash-loop de Supavisor de raíz** — dice que ya le pasó antes: algo como
"datos que quedaron firmados con un código y otros con otra firma", y lo
necesita resuelto porque piensa **conectar varias cosas más a esa misma
base**, no solo `mapa-pronostico`. Esto amplía el alcance: para esto
puntual el usuario SÍ está dispuesto a tocar `ecodatos` (arreglar el
pooler roto), a diferencia del resto (passwords, schemas de otras apps)
que sigue off-limits.

**Hipótesis técnica (a confirmar con el log, todavía no se tocó nada):**
Supavisor guarda la config de sus "tenants" (cifrada/firmada con
`SECRET_KEY_BASE` + `VAULT_ENC_KEY`) en tablas propias dentro de la base
`_supabase` de ese mismo Postgres (migradas por `volumes/db/pooler.sql`).
Al arrancar corre `/app/bin/migrate && /app/bin/supavisor eval
"$(cat /etc/pooler/pooler.exs)" && /app/bin/server` — si en algún
momento cambiaron `SECRET_KEY_BASE`/`VAULT_ENC_KEY` en el `.env` (o se
restauró un `.env` de otro momento) mientras la fila del tenant en
Postgres quedó cifrada/firmada con las claves viejas, Supavisor no puede
descifrarla al bootear y crashea en loop — coincide con la descripción
del usuario ("datos firmados con un código, otros con otra firma"). **Si
se confirma con el log**, el fix típico y **poco invasivo** (no toca
`POSTGRES_PASSWORD` ni las otras apps) sería limpiar/resetear la tabla de
tenants de Supavisor en `_supabase` para que se regenere sola desde
`pooler.exs`/`.env` actual en el próximo boot — a confirmar con log real
antes de tocar nada, es una base compartida en producción.

**Pedido al usuario**: pegar la salida de
`docker logs supabase-pooler --tail 100` para confirmar la hipótesis
antes de proponer un comando concreto.

### Causa raíz confirmada (log real) — NO es lo que pensaba el usuario, es más simple
El log muestra siempre el mismo error, en loop:
```
** (ErlangError) Erlang error: {:badarg, {~c"aead.c", 90}, ~c"Unknown cipher or invalid key size"}
:crypto.crypto_one_time_aead(:aes_256_gcm, "<VAULT_ENC_KEY>", ...)
(cloak 1.1.4) Cloak.Ciphers.AES.GCM.encrypt/2
```
**No es un problema de "datos viejos firmados con otra clave"** (mi
hipótesis original era incorrecta) — es más simple: `VAULT_ENC_KEY` en
el `.env` de ecodatos tiene **64 caracteres** (parece generado con
`openssl rand -hex 32`, que da 64 caracteres hex). Supavisor usa ese
valor **tal cual, como bytes crudos**, sin decodificar de hex — y
AES-256-GCM necesita una clave de **exactamente 32 bytes**. Con 64
bytes, `:crypto` tira "Unknown cipher or invalid key size" siempre que
intenta cifrar algo (el `Cloak.Ciphers.AES.GCM.encrypt/2` que aparece en
el stack), y Supavisor crashea en loop al primer intento de guardar/leer
config de un tenant. Esto es coherente con que **nunca haya andado bien**
desde que se armó el `.env` — no un cambio de clave en el tiempo.

**Fix propuesto (bajo impacto — solo toca `VAULT_ENC_KEY`, no
`POSTGRES_PASSWORD` ni nada que usen las otras apps):**
1. Generar una clave nueva de 32 caracteres: `openssl rand -hex 16` (16
   bytes random → 32 caracteres hex, el largo correcto).
2. Reemplazar `VAULT_ENC_KEY=` en el `.env` de `ecodatos` por ese valor
   nuevo de 32 caracteres.
3. Recrear **solo** el contenedor de Supavisor para que tome el `.env`
   actualizado (un `docker restart` NO alcanza — no relee el `.env`,
   hace falta recrear el contenedor):
   ```bash
   docker compose up -d --force-recreate supavisor
   ```
   (parado en el directorio donde está el `docker-compose.yml`/`.env` de
   `ecodatos` — el usuario lo tiene que correr, no hay shell nuestro ahí).
4. Como nunca funcionó, no debería haber tenants/config previos válidos
   que se pierdan al cambiar la clave — bajo riesgo.

Pendiente: que el usuario confirme el directorio donde vive ese
`docker-compose.yml`/`.env` (el de `app-formularios`, con el `include:`)
para dar el comando exacto, y que lo corra.

### ✅ Pooler arreglado
Usuario corrió el fix desde `~/ecodatos` (ese es el directorio del
compose). `docker logs supabase-pooler --tail 30` ahora muestra arranque
limpio: `Proxy started session(local=false) on port 5432`,
`Proxy started transaction(local=false) on port 6543`,
`Running SupavisorWeb.Endpoint...`, y los health checks (`HEAD
/api/health` → `204`) respondiendo cada 10s sin cortes. **Sin errores,
sin crash-loop.** Supavisor está sano.

**Siguiente paso**: probar la conexión real a través del pooler para
confirmar el formato de usuario (`postgres.your-tenant-id` u otro). Dos
formas:
- **Representativa de lo que va a hacer la VM nueva** (recomendada):
  instalar `postgresql-client` en el host de `vm-ecodatos`
  (`sudo apt install postgresql-client-common postgresql-client`, no
  toca ningún container) y correr
  `psql "postgresql://usuario:password@127.0.0.1:5432/postgres"` contra
  el puerto publicado real del pooler.
- **Sin instalar nada**: `docker exec -it supabase-db psql
  "postgresql://usuario:password@supavisor:5432/postgres"` — usa el
  cliente que ya trae `supabase-db` y el hostname interno de docker del
  servicio (`supavisor`, mismo `network: supabase`), no `127.0.0.1`
  (adentro del container `supabase-db`, `127.0.0.1` es el propio
  container, no el host). Solo valida credenciales/tenant, no la ruta
  externa real.

### ✅ Conexión confirmada por dentro de la red docker
```
docker exec -it supabase-db psql "postgresql://postgres.your-tenant-id:postgres@supavisor:5432/postgres"
psql (15.8)
postgres=>
```
**Usuario confirmado: `postgres.your-tenant-id`**, password = la que ya
sabíamos (default `postgres` — sigue pendiente la decisión de rotarla,
no bloqueante). Falta confirmar la ruta **externa** real (desde otra
VM/máquina contra `10.0.0.231:5432`, no desde dentro de la red docker) —
próximo test.

### ✅ Conexión externa confirmada de punta a punta
Desde este desktop (no la VM nueva, pero sí "de afuera" del server/red
docker) — antes daba "conexión rehusada" porque el pooler estaba
crasheado, ahora conecta:
```
$ psql "postgresql://postgres.your-tenant-id:postgres@10.0.0.231:5432/postgres?sslmode=prefer" -c "select version();"
PostgreSQL 15.8 on x86_64-pc-linux-gnu...
```
**Ya está confirmado el `DATABASE_URL` completo** (host `10.0.0.231`,
puerto `5432`, user `postgres.your-tenant-id`, db `postgres`). El único
detalle: **ese Postgres no tiene TLS configurado**
(`sslmode=require` → `server does not support SSL`), así que la
conexión va a viajar sin cifrar — pre-existente del stack de `ecodatos`,
no algo que generamos nosotros, y consistente con que ya se decidió no
tocar ese stack más allá del fix del pooler. Se usa `sslmode=disable`
(no `require`) en el `DATABASE_URL`.

**Con esto ya se puede seguir con la implementación**: crear el schema
`mapa_pronostico`, cambiar `store.js` (pool + `SET search_path` por
conexión), armar `mapa-backend/.env`, y sacar el Postgres propio del
`docker-compose.yml` de este repo. Falta luz verde del usuario para
correr el primer `CREATE SCHEMA` contra la base compartida.

**Luz verde del usuario**: "si, quiero que hagas el schema nuevo asi lo
puedo ver a ver si todo funciona" — se ejecuta `CREATE SCHEMA IF NOT
EXISTS mapa_pronostico;` contra `10.0.0.231:5432` (vía el pooler, user
`postgres.your-tenant-id`) desde este desktop con `psql` (ya lo teníamos
probado en modo lectura). Primera escritura real contra la base
compartida de `ecodatos`.

### ✅ Schema `mapa_pronostico` creado
```
CREATE SCHEMA IF NOT EXISTS mapa_pronostico;
→ CREATE SCHEMA
\dn → aparece "mapa_pronostico | postgres" junto a los schemas propios
       del stack (auth, storage, realtime, vault, cron, etc.) — separado,
       sin tocar ninguno de los existentes.
```
El usuario puede verificarlo en el Studio de `ecodatos`: Table Editor →
selector de schema (arriba a la izquierda) → debería listar
`mapa_pronostico` junto a `public`. Todavía **sin tablas adentro** — eso
es el siguiente paso (código de `store.js` + los 5 módulos, corriendo
`init()` contra este schema).

**Usuario confirmó que lo ve en el Studio, pero pide cambiar el
nombre**: no quiere `mapa_pronostico`, quiere que el schema se llame
**`alerta_temprana`**. Se borra el que se creó (estaba vacío, sin
tablas — sin riesgo) y se crea el nuevo con el nombre correcto. De acá
en más, todo el plan usa `alerta_temprana` en vez de `mapa_pronostico`.

### ✅ Renombrado — schema final: `alerta_temprana`
```
DROP SCHEMA IF EXISTS mapa_pronostico;    → DROP SCHEMA
CREATE SCHEMA IF NOT EXISTS alerta_temprana;  → CREATE SCHEMA
\dn → aparece "alerta_temprana | postgres", mapa_pronostico ya no existe.
```
Este es el nombre definitivo a usar en todo el código (`SET search_path
TO alerta_temprana, public`), en la documentación y en cualquier
referencia futura. Sigue vacío — falta el código del backend para que
se creen las tablas ahí.

### Pedido — alcance acotado a "alertas meteorológicas" + estructura de datos pensada para histórico/estadísticas
El usuario pidió avanzar con el código, pero **acotando el alcance por
ahora solo a alertas meteorológicas** (incendios/riesgo de fuego quedan
para después, se construyen manualmente por ahora). Pidió pensar bien la
estructura porque en algún momento va a querer sacar **estadísticas e
histórico**. Puntualmente:
- Empezar un **registro histórico de las alertas meteorológicas de la
  provincia**: color, ubicación, y qué fenómeno es (lluvia, tormenta,
  granizo, etc.) por departamento.
- De la **generación de placas** (las imágenes PNG para redes, feed +
  historias) guardar: quién la generó, cuándo (fecha y hora), y **todos
  los parámetros de los selects** que arma esa pantalla (zonas/colores
  por departamento, período, fondo, iconos elegidos).
- Guardar también **cuándo se publica en la página** — porque esto
  después también se va a publicar como iframe (el mapa interactivo).
- Guardar **las placas en sí** (los dos formatos, historias y feed) → 
  hace falta un **bucket en Storage** (de Supabase).
- Pidió chequear si hay **latitud/longitud** de los departamentos en
  algún lado.

**Relevamiento del código actual (`AlertasMeteorologicasPage.jsx` +
`alertasMeteorologicas.js` + `generateAlertaMap.js` + rutas) — antes de
tocar nada:**
- Hoy son **dos acciones separadas** en esa pantalla:
  1. **"Guardar mapa manual"** → `POST /alertas-meteorologicas/publicar`
     → ya persiste en `alertas_meteorologicas` (tabla actual: `id`,
     `publicado_en`, `zonas` jsonb, `iconos` jsonb) — esto es lo que
     alimenta el `/embed/alertas-meteorologicas` (el interactivo). **No
     guarda quién publicó** — falta `usuario_id`.
  2. **"Generar placa para redes"** → `POST
     /alertas-meteorologicas/render-png` (una vez por `tamano`: `feed` e
     `historias`) → genera el PNG al vuelo y se descarga en el browser.
     **Hoy no se persiste nada**: ni quién, ni cuándo, ni los parámetros,
     ni el archivo.
- Los **17 departamentos** de Misiones están en
  `data/departamentos.json` (`id`, `nombre` — sin lat/lon) y
  `data/departamentos.geojson` (mismos `id`/`nombre` + polígono
  `Polygon`, sin holes en los que se revisaron). **No hay lat/lon
  guardado en ningún lado today** — pero se puede calcular un centroide
  del polígono de cada departamento (no hace falta ninguna librería
  nueva tipo turf, es un cálculo de centroide de polígono estándar) y
  guardarlo como catálogo.
- Categorías (colores): `Verde/Amarillo/Naranja/Rojo` (con hex ya
  definido). Fenómenos/iconos: `tormentas-severas`, `vientos-fuertes`,
  `granizo`, `inundacion` (selección global de la placa, no por
  departamento).
- `requireAuth` ya cuelga `req.usuario = {usuarioId, email}` en las
  rutas protegidas — está disponible para guardar autoría sin cambios
  en el middleware.

**Propuesta de estructura de datos (a confirmar con el usuario antes de
crear nada):**
- `alerta_temprana.departamentos` — catálogo: `id`, `nombre`, `lat`,
  `lon` (centroide calculado una sola vez del geojson existente).
- `alerta_temprana.alertas_meteo_publicaciones` — reemplaza la tabla
  actual `alertas_meteorologicas`: `id`, `publicado_en`, `usuario_id`
  FK → `usuarios(id)` (nuevo, para saber quién publicó).
  - hijo `alertas_meteo_publicacion_departamentos`: `publicacion_id`,
    `departamento_id` FK, `categoria` — **normalizado** (no jsonb) para
    que las consultas de histórico/estadística ("¿cuántas veces estuvo
    en Rojo tal departamento este año?") sean directas en SQL.
  - hijo `alertas_meteo_publicacion_fenomenos`: `publicacion_id`,
    `fenomeno_id`, `categoria` — ídem, normalizado.
- `alerta_temprana.alertas_meteo_placas` — un registro por cada
  "Generar placa para redes" (una sola fila por las dos imágenes,
  matching la acción real del operador): `id`, `generado_por` FK
  `usuarios(id)`, `generado_en`, `periodo` (texto), `fondo`
  (tormenta/nubes), `zonas` jsonb y `iconos` jsonb (**acá sí como
  snapshot/jsonb**, es una foto de auditoría de qué se renderizó, no la
  fuente de verdad para estadísticas — esa es la tabla normalizada de
  arriba), `feed_path` y `historias_path` (ruta en el bucket de
  Storage), `publicado_en` (nullable — para marcar a futuro si/cuándo
  se posteó afuera, ej. redes sociales).
- **Bucket de Storage**: nuevo bucket (nombre a definir, ej.
  `alerta-temprana`) en el Storage de `ecodatos` (self-hosted, backend
  de archivos en filesystem). Para subir ahí desde el backend hace falta
  pegarle a la API de Storage — más simple usar el cliente
  `@supabase/supabase-js` **solo para Storage** (no para Auth ni para
  Postgres, eso sigue con `pg`/auth casera) con `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` como variables nuevas en
  `mapa-backend/.env`.

**Pendiente**: presentar esta propuesta al usuario, ajustar nombres si
hace falta, y recién ahí crear las tablas.

**Centroides calculados** (a partir de `data/departamentos.geojson`,
fórmula estándar de centroide de polígono ponderado por área — no
promedio simple de vértices, porque los departamentos son formas
irregulares/cóncavas):

| id | nombre | lat | lon |
|----|--------|-----|-----|
| 1 | Apóstoles | -27.888482 | -55.677279 |
| 2 | Cainguás | -27.147788 | -54.802386 |
| 3 | Candelaria | -27.460624 | -55.582983 |
| 4 | Capital | -27.550725 | -55.855764 |
| 5 | Concepción | -27.930783 | -55.466965 |
| 6 | Eldorado | -26.313971 | -54.441141 |
| 7 | General Manuel Belgrano | -25.988799 | -53.959507 |
| 8 | Guaraní | -27.025741 | -54.269611 |
| 9 | Iguazú | -25.87327 | -54.400246 |
| 10 | Libertador General San Martín | -26.893091 | -54.92356 |
| 11 | Leandro N. Alem | -27.630585 | -55.388092 |
| 12 | Montecarlo | -26.658202 | -54.564848 |
| 13 | Oberá | -27.476205 | -55.071286 |
| 14 | San Ignacio | -27.17683 | -55.339976 |
| 15 | San Javier | -27.777156 | -55.167723 |
| 16 | San Pedro | -26.638364 | -53.966533 |
| 17 | 25 de Mayo | -27.37827 | -54.634158 |

Valores coherentes con la ubicación real de Misiones (lat ≈ -25.9 a
-27.9, lon ≈ -53.9 a -55.9). Van a ser el `seed` inicial de
`alerta_temprana.departamentos`.

### Usuario confirmó el diseño — "si, metele a todo". Ejecutando.
Plan de implementación (en orden):
1. `store.js`: `CREATE SCHEMA IF NOT EXISTS alerta_temprana` +
   `pool.on('connect', ...)` con `SET search_path TO alerta_temprana,
   public` — así todas las `CREATE TABLE IF NOT EXISTS` sin calificar de
   los demás módulos (auth, pronosticos, alertas, incendios, riesgo)
   quedan dentro del nuevo schema sin tocar cada módulo uno por uno.
2. `storage.js` (nuevo): helper liviano con `fetch` nativo (Node 18+, ya
   es el mínimo del proyecto) contra la API REST de Supabase Storage —
   **no se suma `@supabase/supabase-js`** como dependencia, mismo
   criterio "sin ORM/SDK de más" que ya usa el resto del backend con
   `pg`. Usa `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
3. `departamentosStore.js` (nuevo): tabla `departamentos` (id, nombre,
   lat, lon), sembrada una vez con los 17 centroides ya calculados.
4. `alertasMeteorologicasStore.js` (reescrito): la tabla plana
   `alertas_meteorologicas` pasa a `alertas_meteo_publicaciones` +
   `alertas_meteo_publicacion_departamentos` +
   `alertas_meteo_publicacion_fenomenos` (normalizado, con
   `usuario_id`). Como el schema `alerta_temprana` está vacío (no había
   nada migrado ahí todavía), **no hace falta migrar datos** — es tabla
   nueva directamente.
5. `placasMeteoStore.js` (nuevo): tabla `alertas_meteo_placas` (quién,
   cuándo, período, fondo, snapshot de zonas/iconos, rutas del feed e
   historias en el bucket, `publicado_en` nullable para más adelante).
6. Ruta: `POST /alertas-meteorologicas/publicar` ahora manda
   `req.usuario.usuarioId`. Se **reemplaza** `POST
   .../render-png` (streameaba un PNG por tamaño, nada persistido) por
   `POST .../placa`: genera feed + historias **en una sola llamada**
   (antes el front pegaba dos veces, una por tamaño — eso hacía
   imposible agrupar ambas imágenes bajo un mismo evento de "se generó
   una placa"), las sube al bucket, graba la fila en
   `alertas_meteo_placas` y devuelve JSON con las URLs públicas en vez
   de bytes de imagen.
7. Frontend (`api.js` + `AlertasMeteorologicasPage.jsx`): adaptar
   `generar()` a la nueva forma de la respuesta (URLs en vez de blobs).
8. Bucket `alerta-temprana` en Storage (público — son placas para
   redes, ya nacen para difundirse) — se crea a mano una vez vía curl
   con la `service_role key`, mismo criterio que se usó para crear el
   schema a mano.
9. `mapa-backend/.env` (nuevo, gitignoreado — nunca se commitea):
   `DATABASE_URL` al pooler de ecodatos (`sslmode=disable`, ver
   hallazgo previo), `DATABASE_SSL=false`, `SUPABASE_URL=https://ecodatos.ecologia.misiones.gob.ar`,
   `SUPABASE_SERVICE_ROLE_KEY`. Se arma con los datos ya confirmados en
   esta conversación (el `POOLER_TENANT_ID` de ecodatos sigue en su
   valor **placeholder por defecto** `your-tenant-id` — no lo cambiaron
   — así que el usuario de conexión real es literalmente
   `postgres.your-tenant-id`; no es una redacción mía).
10. `.env.example` (mapa-backend y raíz) documentados con las variables
    nuevas, sin valores reales.
11. `docker-compose.yml`: se saca el servicio `db` y el volumen
    `pgdata` — el backend pasa a conectarse siempre a la Supabase de
    ecodatos vía `DATABASE_URL` del `.env` de la raíz.
12. Primer usuario en la tabla `usuarios` nueva vía
    `scripts/crear-usuario.js`.

Ojo: `mapa-backend/.env.local` (desarrollo local de Hernán, Postgres
propio en :5544) **no se toca** — sigue apuntando a esa base local para
seguir developando sin depender de la VPN/red hacia ecodatos.

### Test de conectividad (solo lectura, no se escribió nada)
Probé TCP contra `10.0.0.231:5432` desde esta máquina (el desktop donde
corre esta sesión, no la VM nueva todavía): **"conexión rehusada"** — no
timeout/sin ruta, sino rechazo activo. Puede ser: (a) esta máquina no
tiene ruta real a la red privada del server (lo más probable — normal,
esto no es la VM nueva) y algo en el medio devuelve RST, o (b) el
`db`/Postgres de ese compose **no publica el puerto 5432 hacia el host**
de la VM (`POSTGRES_HOST=db` sugiere que solo es alcanzable dentro de la
red interna de ese `docker-compose`, no desde otra VM aunque comparta
red). **Falta verificar desde el lado del server**: si el servicio `db`
en el `docker-compose.yml` de `ecodatos` tiene `ports: ["5432:5432"]` (o
similar) publicado hacia la IP `10.0.0.231` del host, y si el firewall de
esa VM permite conexiones entrantes en 5432 desde la IP privada que va a
tener la VM nueva.

**Plan de acción propuesto (a confirmar con el usuario):**
- Punto 1 (navbar/login) se resuelve ahora mismo en el frontend.
- Punto 2 (base de datos) requiere info de acceso al Supabase de
  `ecodatos` antes de tocar nada — no se migra en esta sesión sin esos
  datos. Mientras tanto se relevará el estado actual de la base
  (Postgres/Neon) y se propondrá el schema nuevo.

### Hecho — Pedido 1 (navbar/login)
- `mapa-frontend/src/theme.css`: `--header-h` 64px → **76px**.
- `mapa-frontend/src/styles.css` (`.brand-header` y afines): padding
  vertical `0` → `14px 28px`, `min-height: var(--header-h)` explícito
  (antes, fuera del grid de `/admin`, el header no tenía piso de altura —
  por eso se veía "finito" en `/login`), logo 34px→44px, wordmark
  15px/12px → 19px/13px, separador 26px→32px, subtítulo 13px→14px.
- `mapa-frontend/src/components/BrandHeader.jsx`: `width`/`height` del
  `<img>` del logo 34→44.
- `BrandHeader` es compartido (`AdminPage`, `LoginPage`, `PanelPage`,
  `AlertasMeteorologicasPage`, `AlertasIncendiosPage`,
  `RiesgoIncendiosPage`) → el cambio agranda el navbar en **todas** las
  pantallas, no solo en el login. Confirmar que está bien así.
- `npm run build` en `mapa-frontend` OK, sin errores.
- **Falta**: el usuario tiene que verlo renderizado y confirmar que el
  logo "se ve bien" ahora (no se corrió browser, solo build).

### ⚠️ Se reinició VSCode (quedó sin RAM) — retomando tras el corte
Se venía ejecutando el plan de arriba ("Usuario confirmó el diseño — sí,
metele a todo") cuando el editor se reinició por falta de RAM, justo
después de escribir `mapa-backend/.env` con las credenciales reales. Esta
bitácora no se había alcanzado a actualizar con ese tramo de trabajo.
Repaso hecho ahora (leyendo timestamps + diff, sin tocar nada más) para
confirmar qué quedó hecho y qué no:

**Hecho (código, verificado con `node --check` en cada archivo tocado y
`npm run build` del frontend, ambos OK):**
1. `store.js` — `CREATE SCHEMA IF NOT EXISTS alerta_temprana` +
   `pool.on('connect', ...)` con `SET search_path TO alerta_temprana,
   public`. ✅
2. `storage.js` (nuevo) — cliente mínimo con `fetch` nativo contra la API
   REST de Supabase Storage, sin sumar `@supabase/supabase-js`. ✅
3. `departamentosStore.js` (nuevo) — tabla `departamentos`, sembrada con
   los 17 centroides calculados. ✅
4. `alertasMeteorologicasStore.js` (reescrito) — normalizado en
   `alertas_meteo_publicaciones` +
   `alertas_meteo_publicacion_departamentos` +
   `alertas_meteo_publicacion_fenomenos`, con `usuario_id`. ✅
5. `placasMeteoStore.js` (nuevo) — tabla `alertas_meteo_placas`, sube
   feed+historias al bucket y graba la fila. ✅
6. Rutas (`routes/alertasMeteorologicas.js`) — `/publicar` manda
   `req.usuario.usuarioId`; `/render-png` reemplazado por `POST .../placa`
   (feed + historias en una sola llamada, sube al bucket, graba fila,
   devuelve JSON con URLs). ✅
7. Frontend (`api.js` + `AlertasMeteorologicasPage.jsx`) — adaptado a la
   respuesta nueva (URLs en vez de blobs), botones de descarga con
   `?download=` de Supabase Storage. ✅
8. Bucket `alerta-temprana` en Storage — **no se creó todavía** (queda
   pendiente, hace falta un curl con la `service_role key` contra el
   Supabase de ecodatos, no se corrió).
9. `mapa-backend/.env` (gitignoreado, no se commitea) — armado con
   `DATABASE_URL` al pooler de ecodatos (`sslmode=disable`),
   `DATABASE_SSL=false`, `DATABASE_SCHEMA=alerta_temprana`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_STORAGE_BUCKET=alerta-temprana`. ✅ (Esto fue lo último que
   se escribió antes del reinicio.)
10. `.env.example` (raíz y `mapa-backend/`) documentados con las
    variables nuevas, sin valores reales. ✅
11. `docker-compose.yml` — sacado el servicio `db` y el volumen
    `pgdata`; `DATABASE_URL`/`DATABASE_SSL`/`SUPABASE_URL`/
    `SUPABASE_SERVICE_ROLE_KEY` ahora vienen del `.env` de la raíz. De
    paso quedó agregado (de una sesión previa, no de esto) el volumen
    `smn_token` para no perder el JWT del SMN en cada redeploy. ✅
12. Primer usuario en `usuarios` vía `scripts/crear-usuario.js` — **no
    se corrió**. Ojo: el script carga `.env.local` antes que `.env`
    (`dotenv().config({ path: [".env.local", ".env"] })`), así que
    corriéndolo desde este desktop crearía el usuario en el Postgres
    local de desarrollo (`:5544`), no en el de `ecodatos` — para crear el
    primer usuario real hace falta correrlo **en la VM nueva** (sin
    `.env.local` ahí) o forzar el `.env` de producción acá a mano.

**No probado todavía de punta a punta**: ni `store.init()` ni ningún
`init()` de los módulos nuevos corrieron nunca contra el Postgres de
`ecodatos` (el servidor de este desktop usa `.env.local`, apunta al
Postgres local de desarrollo) — **las tablas nuevas
(`departamentos`, `alertas_meteo_publicaciones` y afines,
`alertas_meteo_placas`) todavía no existen** dentro del schema
`alerta_temprana` (que sigue vacío, como quedó tras crearlo). Van a
crearse solas la primera vez que el backend arranque apuntando a ese
`DATABASE_URL`.

**Sin pérdida de trabajo**: no hay nada roto ni a medio escribir — el
corte cayó justo después de terminar de escribir `mapa-backend/.env`,
antes de seguir con los pasos 8 y 12 (que son acciones manuales, no
edición de código).

**Pendiente para seguir, a confirmar con el usuario antes de ejecutar**
(son acciones sobre infraestructura compartida/productiva):
- Crear el bucket `alerta-temprana` en Storage (paso 8).
- Probar un arranque real contra `DATABASE_URL` de ecodatos para que se
  creen las tablas nuevas (hoy solo se corrió `npm run build` del
  frontend; el backend no se levantó apuntando a producción).
- Crear el primer usuario real (paso 12), ya sea desde la VM nueva o
  forzando el `.env` de producción en este desktop.

### ⚠️ Segundo reinicio de VSCode (mismo motivo, sin pérdida de trabajo)
Se cayó el editor de nuevo, esta vez justo después de guardar la entrada de
arriba y sin tocar código en el medio (confirmado: ningún archivo del repo
tiene fecha posterior a esa entrada, salvo caché interna de `graft`). Se
relevó RAM al retomar: `free -h` mostraba 535Mi libres de 6,6Gi totales,
con el proxy `headroom-ai` en ~780MB RSS y varios procesos de Chrome/VSCode
sumando el resto — no se tocó nada de eso, es información para el usuario,
no una acción a ejecutar sola.

### Pedido — seguir con los 3 pendientes de arriba ("sí, metele")
Usuario confirmó seguir con los tres puntos pendientes (bucket, arranque
real contra `ecodatos`, primer usuario). Se ejecutan en ese orden, cada uno
verificado antes de pasar al siguiente:
1. Crear bucket `alerta-temprana` (público) en Supabase Storage de
   `ecodatos` vía curl con la `service_role key` de `mapa-backend/.env`.
2. Correr un script puntual que hace `require` de `store`,
   `departamentosStore`, `alertasMeteorologicasStore` y
   `placasMeteoStore` y llama a cada `init()`, cargando **solo**
   `mapa-backend/.env` (no `.env.local`) — así se crean/verifican todas
   las tablas nuevas dentro de `alerta_temprana` en el Postgres real de
   `ecodatos`, sin tocar el Postgres local de desarrollo. Script
   descartable, no se commitea.
3. Primer usuario real: falta que el usuario indique el email a usar (la
   contraseña se pide interactiva, no se escribe en el chat) — se corre
   `crear-usuario.js` apuntando también a `.env` de producción.

**Bloqueado por el clasificador de permisos**: los pasos 1 y 2 (curl al
bucket, y correr `scripts/_tmp-bootstrap.js` contra `ecodatos`) los frenó
el clasificador automático por ser escrituras contra infraestructura
productiva compartida — no se insistió. Quedaron los comandos listos para
que el usuario los corra con `!` o dé permiso explícito. Sigue pendiente
también el punto 3 (falta el email a usar).
`mapa-backend/scripts/_tmp-bootstrap.js` quedó creado en el repo
(descartable, sin commitear) a la espera de que se corra.

### Pedido — pantalla de registro de usuarios
El usuario quiere ahora una pantalla de **registro**, con campos: nombre,
apellido, email, contraseña, repetir contraseña, teléfono, DNI, "y no sé
qué más podría ser" (pide sugerencias).

Contexto importante: hoy **no hay alta pública** — el comentario de
`auth.js`/`crear-usuario.js` es explícito ("Sin registro público — se usa
desde `scripts/crear-usuario.js`", corrido a mano por un admin). La tabla
`usuarios` de producción también es mínima (`email`, `password_hash`,
`creado_en`) — sin nombre/apellido/teléfono/DNI ni roles todavía. Antes de
tocar código hacen falta definiciones de diseño/seguridad (es un sistema
que emite alertas oficiales del Ministerio), quedan preguntadas al
usuario en el chat antes de escribir nada.

### Usuario respondió — diseño confirmado, ejecutando
- **Opción C**: no es alta pública. Es una pantalla "crear usuario"
  *dentro* del panel, solo accesible ya logueado como `admin`/`superadmin`.
- **Roles**: `superadmin`, `admin`, `usuario`. Matriz de permisos que
  propongo (no la pidió explícita, la infiero del pedido — a corregir si
  no es lo que quiere): `superadmin` crea cualquier rol; `admin` crea
  solo `usuario`; el rol `usuario` no ve ni puede usar la pantalla.
- **Campos**: nombre, apellido, email, contraseña, repetir contraseña,
  teléfono, DNI + los sumados: **puesto**, **dependencia**.
- **Validaciones**: DNI solo dígitos, 7 u 8 caracteres. Teléfono libre
  (sin formato). Contraseña: mín. 8 caracteres, 1 mayúscula, 1 número, 1
  carácter especial — con checklist en vivo (check verde por regla a
  medida que se cumple), y la misma regla **también** validada en el
  back (nunca confiar solo en el front).

**Plan técnico:**
1. `auth.js` — tabla `usuarios` gana columnas (todas nullable salvo
   `rol`, para no romper el bootstrap por CLI): `nombre`, `apellido`,
   `telefono`, `dni`, `puesto`, `dependencia`, `rol text NOT NULL DEFAULT
   'usuario' CHECK (rol IN ('superadmin','admin','usuario'))`. Validador
   de contraseña compartido (una función, la usan back y — misma lógica
   traducida — el checklist del front). `crearUsuario` ahora recibe todos
   los campos + `rol`. `obtenerSesion`/login devuelven también
   `rol`/`nombre` (hace falta en el front para mostrar/ocultar la
   pantalla).
2. `scripts/crear-usuario.js` — se mantiene para el arranque en frío
   (bootstrap: el primer usuario no puede crearse solo desde el panel
   porque hace falta estar logueado). Pasa a crear siempre con
   `rol='superadmin'` (quien tiene acceso a la terminal del server ya es
   de máxima confianza); el resto de los campos quedan `null`, se
   completan después si hace falta.
3. Rutas nuevas en `routes/auth.js`: `POST /api/auth/usuarios` (crear,
   `requireAuth` + chequeo de rol del creador) y `GET /api/auth/usuarios`
   (listar, mismo gate) — para que la pantalla también muestre los
   usuarios ya creados.
4. Frontend: `UsuariosPage.jsx` en `/panel/usuarios` (protegida +
   redirige si `rol === "usuario"`). Formulario con los 8 campos +
   componente `PasswordChecklist` reusable (4 reglas con check verde en
   vivo) + selector de rol limitado a lo que el usuario logueado puede
   asignar + tabla de usuarios existentes debajo. Tarjeta "Usuarios" en
   `PanelPage` visible solo para `admin`/`superadmin`. `api.js` suma
   `crearUsuarioPanel`/`listarUsuariosPanel`.

**Alcance de esta vuelta**: alta + listado. Sin editar/desactivar/borrar
usuarios todavía (se suma después si hace falta).

### ⚠️ Tercer reinicio de VSCode (mismo motivo) — repaso tras el corte
Se volvió a caer el editor. Antes de tocar nada se releyó esta bitácora
(regla de la sesión) y se verificó archivo por archivo, con `node --check`
y `npm run build`, que **todo el plan de "pantalla de registro de
usuarios" ya había quedado completo** antes del corte — no se perdió nada:
- Back: `lib/auth.js` (tabla `usuarios` con los 8 campos + `rol`,
  `puedeCrearRol`, `validarPassword`/`validarDni`, `crearUsuario`,
  `listarUsuarios`), `middleware/requireRole.js`, `routes/auth.js`
  (`GET`/`POST /api/auth/usuarios`, gateados con `requireAuth` +
  `requireRole("superadmin","admin")`). `node --check` OK en los 4
  archivos tocados/nuevos.
- Front: `UsuariosPage.jsx` (formulario completo + tabla de usuarios
  existentes, redirige si `rol === "usuario"`), `PasswordChecklist.jsx`
  (mismas 4 reglas que el back), ruta `/panel/usuarios` en `App.jsx`,
  tarjeta "Usuarios" en `PanelPage.jsx` (oculta para `rol === "usuario"`),
  `api.js` (`listarUsuariosPanel`/`crearUsuarioPanel`). `npm run build`
  OK, sin errores.
- `scripts/crear-usuario.js` — sigue dando de alta siempre con
  `rol: "superadmin"` (bootstrap), sin cambios pendientes.

**Nada de esto se probó corriendo el server de verdad** (ni local ni
contra `ecodatos`) — solo sintaxis/build estático. Sigue pendiente de la
entrada anterior: crear el bucket de Storage, levantar el backend contra
`DATABASE_URL` de `ecodatos` para que se creen las tablas nuevas
(incluidas las columnas nuevas de `usuarios`), y recién ahí crear el
primer usuario real (`crear-usuario.js`, falta el email a confirmar con
el usuario). Nada de esto se ejecutó todavía — quedan los tres pasos ya
frenados por el clasificador de permisos, a la espera de que el usuario
los corra o dé permiso explícito.

### Pedido — tabla de `roles` propia, con relación a `usuarios`
El usuario señala (con razón) que hoy `rol` en `usuarios` es una columna
`text` suelta (sin `CHECK`, ver `lib/auth.js`), validada solo en JS
(`ROLES`/`puedeCrearRol`) — no hay tabla `roles` en el schema
`alerta_temprana` ni una relación (FK) real entre `usuarios` y los roles.
Pedido: normalizarlo como tabla propia con relación. Todavía sin
implementar — se hace después de resolver el pedido de login de abajo
(mismo archivo, `lib/auth.js`, para no pisarse).

### Pedido — "cambié la contraseña con un hasheador online y no puedo entrar"
Investigación (solo lectura, contra la base **local** de desarrollo,
`.env.local`, no se tocó `ecodatos`):
- La tabla `usuarios` existe **duplicada** en la base local: una vieja en
  `public.usuarios` (de antes del cambio de schema de esta sesión, creada
  2026-09-03) y una nueva y **vacía** en `alerta_temprana.usuarios`
  (creada por el `init()` de `store.js`/`auth.js` de esta sesión).
- El `search_path` que se agregó a `store.js` esta sesión es
  `alerta_temprana, public` — o sea, cualquier consulta a `usuarios` sin
  calificar de schema (como usa todo `lib/auth.js`) **resuelve contra
  `alerta_temprana.usuarios`, que está vacía**, no contra la vieja donde
  está la cuenta real de `hernangozalez@gmail.com`.
- **Esa es la causa real** del "no me deja entrar": el login busca el
  email en una tabla vacía, no importa qué contraseña se pruebe — no es
  un problema del hash en sí.
- Se verificó el hash guardado en `public.usuarios` para esa cuenta:
  formato `$argon2id$v=19$m=19456,t=2,p=1$...`, largo 97 — es un
  argon2id **válido** y con los mismos parámetros default de
  `@node-rs/argon2` (la librería que ya usa el back), no algo roto. Probé
  `verify()` contra una contraseña cualquiera y no tiró error de formato
  (solo dio `false`, esperado) — es decir, **este hash específico parece
  ser el original de cuando se creó la cuenta**, no uno pisado por el
  hasheador online. No se puede confirmar sin que el usuario diga si
  llegó a correr algún `UPDATE` a mano — a preguntar.
- **Aparte de la causa raíz**: pisar `password_hash` a mano con un
  hasheador online (aunque el formato coincida) no es buena práctica acá
  — es un sistema que emite alertas oficiales del Ministerio; conviene
  seguir generando el hash siempre con `@node-rs/argon2` (vía
  `crear-usuario.js`, que ya lo hace bien), no copiar/pegar un hash hecho
  afuera.

**Corrección — el diagnóstico de arriba estaba mirando la base
equivocada.** El usuario avisó que él está viendo la fila en el Studio de
**`ecodatos`** (producción), no en la base local. Se repitió el chequeo
(solo lectura) contra `DATABASE_URL` de `mapa-backend/.env` (producción,
no `.env.local`) y ahí sí aparece todo distinto:
- `alerta_temprana.usuarios` **existe en producción** con 1 fila
  (`hernangozalez@gmail.com`), pero la tabla sigue con el esquema
  **viejo/mínimo**: solo `id`, `email`, `password_hash`, `creado_en` —
  sin `rol` ni el resto de columnas nuevas (coincide con lo que reportó
  el usuario). El resto de tablas nuevas del schema (`departamentos` con
  sus 17 filas sembradas, `sesiones`, `alertas_meteo_*`, `smn_*`,
  `pronosticos`) **ya existen en producción** — o sea que en algún
  momento (no registrado acá, después del segundo reinicio de VSCode) sí
  se corrió el backend o el bootstrap contra `ecodatos`, pero con una
  versión de `auth.js` anterior a los cambios de "pantalla de registro"
  de esta sesión (por eso nunca corrió el `ALTER TABLE` que agrega `rol`
  y compañía).
- **Causa real del login roto**: `password_hash` de esa fila es
  `$2a$12$EIedRWkG...` — formato **bcrypt** (60 caracteres, prefijo
  `$2a$`), **no argon2id**. El hasheador online que usó el usuario generó
  bcrypt. El back verifica con `argon2Verify` (`@node-rs/argon2`), que no
  puede leer un hash bcrypt — por eso el login falla siempre, sin
  importar la contraseña. No es un problema de schema/tabla vacía (esa
  hipótesis era sobre la base local, equivocada) ni del contenido del
  hash en sí (formato bcrypt válido, solo que es el algoritmo que no usa
  este backend).

**Plan (dado al usuario, pendiente que lo corra):**
1. Recrear la cuenta corriendo `node scripts/crear-usuario.js
   hernangozalez@gmail.com` **el usuario mismo en su terminal** —
   apuntado a **producción** (hay que sacar `.env.local` del medio
   momentáneamente, si no dotenv prioriza esa y pega contra el Postgres
   local): `mv .env.local .env.local.bak && node
   scripts/crear-usuario.js hernangozalez@gmail.com; mv .env.local.bak
   .env.local`. Al llamar `auth.init()` de paso corre el `ALTER TABLE`
   que agrega las columnas nuevas (`rol` incluido) a la tabla real de
   producción, y upsertea la fila con un hash argon2id válido y
   `rol='superadmin'`.
2. Recién después de esto (confirmado por el usuario que ya puede
   entrar), implementar el pedido de tabla `roles` con relación a
   `usuarios`.

### ✅ Login funcionando — causa real: `.env.local` tapaba a `.env`
Confirmado con el usuario: no era (solo) el hash bcrypt — aunque ya se
había corregido con `crear-usuario.js`, seguía sin poder entrar porque el
backend local, al arrancar, carga `.env.local` **antes** que `.env`
(`dotenv` no pisa una variable ya seteada) — y `.env.local` tenía su
propio `DATABASE_URL` apuntando al Postgres local de desarrollo (`:5544`,
vacío). O sea: el server local nunca habló con `ecodatos`, pasara lo que
pasara con el hash.

**Pedido explícito del usuario**: "tenes que conectar todo a mi base de
datos bien conectado" — quiere que el backend local pegue contra
`ecodatos` (la base real), no contra el Postgres local aislado de
desarrollo (decisión anterior, ahora superada a pedido de él).

**Hecho**: comentadas las líneas `DATABASE_URL`/`DATABASE_SSL` de
`mapa-backend/.env.local` (dejadas comentadas debajo, no borradas, por si
se quiere volver a ese modo) — el resto de `.env.local` (SMN,
`PUPPETEER_EXECUTABLE_PATH`) sigue igual. Así `dotenv` cae al
`DATABASE_URL` de `.env` (producción). Se arrancó el backend local
(`npm start`, proceso en background) — logueó `[store] Postgres listo`,
`persistencia: Postgres`, sin errores; probado con `curl` contra
`/api/auth/login`: email inexistente → 401, contraseña incorrecta para
`hernangozalez@gmail.com` → 401 (comportamiento esperado, sin revelar
nada). **El usuario confirmó que ahora sí puede entrar** desde el
frontend. Pendiente: recordar este cambio de `.env.local` para cuando se
quiera volver a developar aislado (o para cuando se levante la VM nueva
de producción, que va a tener su propio `.env` sin `.env.local` al lado).

### Pedido — visibilidad de "Usuarios" en el panel, ajustada
El usuario define la matriz definitiva de visibilidad del panel:
- **`superadmin`**: ve todos los cuadros, incluido "Usuarios".
- **`admin`**: ve todos los cuadros **menos** "Usuarios" (antes lo veía
  también — se saca).
- **`usuario`**: todavía sin definir del todo ("vamos a ver cómo lo
  definimos") — **por ahora, igual que `admin`** (ya era así: no veía
  "Usuarios"; sin cambios para este rol).

Implica tocar: `PanelPage.jsx` (la tarjeta "Usuarios" pasa a mostrarse
solo si `rol === "superadmin"`, no `!== "usuario"`), `UsuariosPage.jsx`
(el guard de redirect pasa a "si no es superadmin, afuera", no "si es
usuario"), y las rutas del back `GET`/`POST /api/auth/usuarios` (pasan a
`requireRole("superadmin")` nomás, ya no `"superadmin","admin"`) — para
que el gate del servidor coincida con lo que se oculta en el front.

### ✅ Hecho — visibilidad "Usuarios" ajustada (solo `superadmin`)
`PanelPage.jsx`, `UsuariosPage.jsx` (guard + `rolesAsignables`),
`routes/auth.js` (`requireRole("superadmin")` en las dos rutas de
usuarios) y `lib/auth.js` (`puedeCrearRol` simplificado: solo
`superadmin` crea usuarios, de cualquier rol) — todo verificado con
`node --check` + `npm run build`, y con el backend local reiniciado
(contra `ecodatos`) probé `/api/auth/usuarios` sin cookie → sigue dando
401. Usuario confirmó que el login ya andaba antes de este cambio.

### ✅ Hecho — tabla `roles` propia, con relación a `usuarios`
Pedido confirmado por el usuario ("si, dale, quiero que hagas eso").
Cambios en `mapa-backend/src/lib/auth.js`:
- `init()`: crea `roles` (`id` identity, `nombre` UNIQUE) y la siembra
  desde el array `ROLES` (única fuente de verdad — ya no hay una lista
  separada, la tabla se llena con los mismos 3 valores que ya validaba
  el código: `superadmin`, `admin`, `usuario`).
- `usuarios` pasa de tener `rol text` a `rol_id bigint NOT NULL
  REFERENCES roles(id)` — relación real, no más texto suelto.
- **Migración** para las dos instalaciones que ya existían (ver
  hallazgos de arriba: producción tenía el esquema mínimo sin `rol` en
  absoluto; en algún momento pudo haber quedado con `rol` texto): agrega
  `rol_id` nullable, backfillea desde `rol` si esa columna existía (un
  `DO $$ ... EXCEPTION WHEN undefined_column` atrapa el caso de que
  nunca haya existido), completa con `'usuario'` lo que quede sin
  resolver, recién ahí exige `NOT NULL`, y borra la columna vieja `rol`.
  Pensada para poder correr las veces que hagan falta sin romper nada
  (mismo estilo que ya usaba el resto de `init()`).
- Las consultas (`crearUsuario`, `listarUsuarios`, `verificarCredenciales`,
  `obtenerSesion`) pasan a hacer `JOIN roles r ON r.id = usuarios.rol_id`
  y devuelven `r.nombre AS rol` — **el contrato hacia rutas/frontend no
  cambia** (siguen viendo `rol` como string), solo cambió el
  almacenamiento interno. `crearUsuario` arma el `INSERT`/`UPSERT` con un
  CTE (`WITH u AS (...)`) porque `RETURNING` no puede hacer `JOIN`.

**Probado de punta a punta contra `ecodatos`** (backend local reiniciado,
apuntando a producción tras el cambio de `.env.local` de la entrada de
arriba): se disparó `auth.init()` con un login de prueba, log
`[auth] Postgres listo (tablas roles/usuarios/sesiones)` sin errores.
Verificado directo en la base (con el schema bien calificado, ver ⚠️
abajo): `alerta_temprana.roles` tiene exactamente `superadmin`, `admin`,
`usuario`; `alerta_temprana.usuarios` tiene a `hernangozalez@gmail.com`
con `rol_id` resuelto a `superadmin` vía el join. Login de prueba con
contraseña incorrecta sigue dando 401 coherente.

**⚠️ Nota para no repetir el error**: al verificar a mano con
un script suelto (`pg.Pool` armado ad-hoc, sin pasar por `store.js`), la
primera consulta sin calificar (`FROM roles`, `FROM usuarios`) pescó una
tabla `roles` **de otra aplicación** que ya vivía en `public` de ese
mismo Postgres compartido (UUIDs, columnas `key`/`activo`/`created_at`,
roles tipo `adminArea` — nada nuestro), porque un `Pool` armado a mano no
trae el `SET search_path TO alerta_temprana, public` que sí aplica
`store.js` en `pool.on('connect', ...)`. **Cualquier verificación manual
futura contra `ecodatos` tiene que calificar el schema explícito
(`alerta_temprana.tabla`)** — no asumir que el `search_path` por default
de una conexión nueva es el mismo que usa la app.

## Pedido — separar "alertas automáticas" (SMN) de la pantalla de Alertas meteorológicas + publicar el iframe

Pedido textual del usuario: sacar el bloque de alertas automáticas (SMN)
de `/panel/alertas-meteorologicas` y llevarlo a **otra tarjeta aparte**
en la página principal del panel — por ahora sin tocar esa parte más
("no la tengo bien pensada"). En Alertas meteorológicas debe quedar
únicamente lo de generar las placas (mapa manual por departamento +
placa para redes). Además necesita que Alertas meteorológicas se
publique en la web con iframe **igual que Pronóstico y Riesgo de
incendios** — tiene que mandar los 3 iframes (pronóstico, alertas
meteorológicas, riesgo de incendios forestales) a quienes hacen la
página del ministerio.

**Relevamiento antes de tocar nada:**
- `AlertasMeteorologicasPage.jsx` ya tiene un `<EmbedShare
  path="/embed/alertas-meteorologicas">` y la ruta `/embed/alertas-meteorologicas`
  ya existe en `App.jsx` — pero hoy `EmbedAlertasMeteorologicasPage.jsx`
  renderiza `<SmnAlertas/>` (la herramienta interna de SMN, con botones
  de admin tipo "Consultar ahora"/"Respaldar con navegador") en vez del
  mapa manual publicado. Eso no sirve para un iframe público — hay que
  arreglarlo para que muestre el mapa publicado (zonas + placa), al
  estilo `EmbedRiesgoPage.jsx` (que llama `getRiesgoActual()` y pinta
  `RiesgoMap` de solo lectura).
- Las rutas backend de `alertas-meteorologicas` (`catalogo`, `geojson`,
  `actual`) ya son públicas (sin `requireAuth`), así que el embed puede
  pegarle directo sin sesión — mismo patrón que riesgo/pronóstico.
- El bloque SMN vive hoy inline en `AlertasMeteorologicasPage.jsx`
  (estado `smn`, polling `getSmnAlertas`, banner "Ver alertas
  automáticas", tab "SMN automático" que muestra `<SmnAlertas/>`). El
  componente `SmnAlertas.jsx` ya existe standalone y no hace falta
  tocarlo — solo hay que sacarlo de esta pantalla y darle su propia
  tarjeta/ruta en el panel.
- El panel (`PanelPage.jsx`) ya tiene 4 tarjetas (Pronóstico, Riesgo de
  incendios, Alertas de incendios NASA FIRMS, Alertas meteorológicas) —
  se agrega una 5ª: "Alertas automáticas (SMN)".

**Plan:**
1. `AlertasMeteorologicasPage.jsx`: sacar el estado/efecto de `smn`, el
   banner de "alertas automáticas" y el tab "SMN automático" (queda
   `manual`/`placa` nomás). Sacar el import de `SmnAlertas`.
2. Página nueva `AlertasAutomaticasPage.jsx` (mismo patrón que las
   demás: `BrandHeader` + link "← Panel" + `<SmnAlertas/>` adentro).
3. Ruta nueva `/panel/alertas-automaticas` (protegida) en `App.jsx`.
4. `PanelPage.jsx`: agregar la tarjeta "Alertas automáticas (SMN)" →
   `/panel/alertas-automaticas`.
5. `EmbedAlertasMeteorologicasPage.jsx`: reescribir para mostrar el
   mapa **publicado** (catálogo + geojson + `actual`) de solo lectura,
   igual patrón que `EmbedRiesgoPage.jsx`, en vez de `SmnAlertas`.
6. Verificar con `npm run build` en el frontend.

No toca nada del backend (las rutas públicas ya existen), ni la base de
datos.

### ✅ Hecho — SMN separado a su propia tarjeta + iframe de Alertas meteorológicas arreglado

- `pages/AlertasAutomaticasPage.jsx` (nueva): `BrandHeader` + `<SmnAlertas/>`
  suelto, sin tocar el componente. Ruta `/panel/alertas-automaticas`
  agregada en `App.jsx` (protegida, `RutaProtegida`). Tarjeta nueva en
  `PanelPage.jsx`: "Alertas automáticas (SMN)".
- `AlertasMeteorologicasPage.jsx`: sacado el estado/efecto `smn`
  (`getSmnAlertas` + polling), el banner "Ver alertas automáticas", el
  import de `SmnAlertas` y el tab "SMN automático" del switcher de
  vistas (queda `Mapa manual` / `Placa para redes`). Ajustado el texto
  de ayuda que mencionaba al SMN (ya no aplica: el mapa público ahora es
  el manual publicado, no el automático).
- `EmbedAlertasMeteorologicasPage.jsx`: reescrita de cero — ya no
  renderiza `<SmnAlertas/>` (herramienta interna con botones de admin,
  no apta para iframe público). Ahora sigue el mismo patrón que
  `EmbedRiesgoPage.jsx`: trae catálogo + geojson una vez, y `actual`
  (lo publicado) cada 60s, y pinta `RiesgoMap` de solo lectura.
- Verificado con `npm run build` en `mapa-frontend` — sin errores.

**Quedan los 3 iframes listos para mandar** (mismo patrón en los tres,
público, sin login, se actualizan solos):
- Pronóstico → `/embed`
- Riesgo de incendios forestales → `/embed/riesgo-incendios`
- Alertas meteorológicas → `/embed/alertas-meteorologicas`

Pendiente: el usuario tiene que entrar a `/panel/alertas-meteorologicas`
y tocar "Guardar mapa manual" al menos una vez (si no lo hizo antes) para
que `/embed/alertas-meteorologicas` tenga algo publicado que mostrar —
si nunca se publicó nada, el embed va a decir "Todavía no hay un reporte
publicado" en vez de mostrar un mapa vacío. No probado en el navegador
todavía (el usuario me pidió no levantar servidores; falta que él lo
pruebe corriendo el proyecto de su lado).

## Pedido — unificar el flujo de publicación de Alertas meteorológicas con Pronóstico/Riesgo ("Revisar y publicar")

Pedido textual: "necesito que todo tenga consistencia. en el mapa de
pronostico y en el de riesgo de incendios, tengo revisar y publicar, y
en el de alertas meteorologicas tengo guardar mapa. tiene que ser el de
revisar y publicar".

**Relevamiento**: en `RiesgoIncendiosPage.jsx` el flujo es de dos pasos:
botón "Revisar y publicar" (habilitado solo si hay cambios sin publicar,
`sucio`) → abre un panel "Revisar publicación" con la lista de qué
departamento cambia de qué categoría a cuál → "Confirmar y publicar"
(publica) o "Seguir editando" (cancela la revisión). Cualquier edición
posterior cierra la revisión abierta. Hay además un indicativo de estado
("Cambios sin publicar" / "Publicado" / "Sin publicar") y un `mensaje`
de confirmación tras publicar. `AdminPage.jsx` (pronóstico) tiene el
mismo patrón de dos pasos con sus propios nombres.

**Plan**: llevar `AlertasMeteorologicasPage.jsx` al mismo patrón:
- Estado `confirmando` + `mensaje`.
- El botón "Guardar mapa manual" se reemplaza por "Revisar y publicar"
  (deshabilitado si no hay cambios) que abre el panel de revisión.
- Panel de revisión lista los departamentos que cambian de categoría
  (comparando `zonas` contra `publicado.zonas`) y si cambiaron los
  iconos de la placa; "Confirmar y publicar" llama a `guardar()`
  (ya existente, pega a `publicarAlertasMeteorologicas`), "Seguir
  editando" cierra el panel sin publicar.
- Cualquier cambio en zona o ícono (`change`, `agregarIcono`,
  `cambiarIcono`, `quitarIcono`) cierra una revisión abierta, igual que
  en Riesgo.
- Solo frontend, no toca backend (la ruta `publicar` ya existe y ya se
  usa desde `guardar()`).

### ✅ Hecho — Alertas meteorológicas con el mismo flujo "Revisar y publicar"

`AlertasMeteorologicasPage.jsx`: agregado `confirmando`/`mensaje`, botón
"Guardar mapa manual" reemplazado por "Revisar y publicar" (deshabilitado
sin cambios) → panel "Revisar publicación" con la lista de departamentos
que cambian de categoría (Verde por defecto → nueva) y aviso si cambiaron
los iconos de la placa → "Confirmar y publicar" (publica) o "Seguir
editando" (cancela). Editar cualquier zona o ícono cierra una revisión
abierta, igual que en `RiesgoIncendiosPage.jsx`. Agregado también el
indicador de estado ("Cambios sin publicar"/"Publicado"/"Sin publicar")
y mensaje de confirmación tras publicar, para que las tres pantallas
(Pronóstico, Riesgo, Alertas meteorológicas) se vean y se usen igual.
Verificado con `npm run build`, sin errores. No probado en navegador
(el usuario corre los servidores del lado suyo).

## Pedido: reemplazar las placas fijas por el nuevo material separado (`Placas-Alertas-Separadas/`)

> "bien, acabo de cargar todas las imagenes que forman las placas, tanto la
> de historias como la de feed, todo separado y el mapa en svg, asi lo
> podemos manipular mejor. estan en la carpeta Placas-Alertas-Separadas de
> la raiz del proyecto para que podamos formar mejor las placas. fijate
> como esta todo hecho y reemplazamos las placas fijas que tenemos, pero
> ojo, tenemos que mantener la ubicacion de los elementos y todo eso / el
> mapa tiene que respetar los colores del cuadro de referencias de niveles
> de alerta, exactamente los mismo colores"

**Relevamiento de `Placas-Alertas-Separadas/`:**
- `MAPA MISIONES.svg` — mapa vectorial real (viewBox 976.1×1072.11), 17
  `<path>` con clase CSS propia; el gris de cada `fill` (decodificado
  hex→decimal, redondeado a la decena) coincide con la misma tabla
  `ZONAS` (gris→id de depto) que ya usa `generateAlertaMap.js` → se puede
  resolver el departamento por clase, sin flood-fill. Un solo `stroke`
  blanco compartido para los bordes.
- `NIVELES DE ALERTA.svg` (viewBox 450.67×331.51) — caja redondeada
  translúcida + 4 círculos + texto ("NIVEL DE ALERTA" + los 4 `accion`).
  Colores de los círculos, de arriba a abajo (verde/amarillo/naranja/rojo,
  mismo orden que `categorias`): `#7ad5b0`, `#f7dc8a`, `#f4953d`,
  `#db5461`. **Estos son los colores que hay que igualar en el mapa.**
- `CUADRADO FECHA.svg` — sólo el rectángulo blanco puntas redondeadas del
  período (mismo radio=alto/2 que ya dibuja `pill()` a mano); no aporta
  nada nuevo, se sigue usando `pill()`.
- 4 fondos nuevos (`fondo feed.png`, `fondo feed (2).png`, `fondo
  historias.png`, `fondo historias (2).png`) — el nombre de archivo NO
  indica tamaño ni tema; se verificó por dimensión real + inspección
  visual:
  - nubes/feed → `fondo feed (2).png` (2250×2813)
  - nubes/historias → `fondo feed.png` (2250×4000)
  - tormenta/feed → `fondo historias.png` (2250×2813)
  - tormenta/historias → `fondo historias (2).png` (2250×4000)
  Ya traen impreso el título "ALERTA METEOROLÓGICA", el pie
  "Emergencias 911 o Defensa Civil 103 / Fuente SMN" y las 3 marcas
  (Misiones/Ecología, Subsecretaría OT, Alerta Temprana) — pero NO el
  mapa, ni la caja de niveles, ni el período: ese medio queda vacío para
  componer encima, igual que antes.
- `iconos/`: `iconos de riesgos-50/51/52.png` y `Ministerio de Ecología
  -53.png` — pese al nombre, son las filas armadas de cada fenómeno
  (ícono + texto + una franja gris lisa a la derecha, todo en un lienzo
  ancho de 2250×324): 50=Tormentas Severas, 51=Vientos Fuertes,
  52=Granizo, 53=Inundación (confirmado abriendo cada una). Mismo formato
  que los 4 PNG viejos (`tormentas-severas.png` etc., también 2250×324) —
  el código actual ya sólo usa el recorte 0,0,350,324 (el ícono solo) y
  dibuja el texto y la barra de color a mano; se mantiene esa lógica tal
  cual, sólo cambian los 4 archivos de origen. `icono granizo-25.png`
  (1667×1667, ícono suelto grande) no se usa en la placa.
- Tipografía: viene la familia completa de Oak Sans; se sigue usando sólo
  Regular/Bold (ya registradas), no hace falta agregar más pesos.

**Plan de implementación:**
1. Backend `alertasMeteorologicas.js`: actualizar `categorias[].color` a
   los 4 hex exactos de `NIVELES DE ALERTA.svg` (`#7AD5B0`/`#F7DC8A`/
   `#F4953D`/`#DB5461`). El `RiesgoMap` del panel toma el color de acá,
   así que el mapa interactivo también se actualiza solo.
2. Copiar los assets nuevos a `mapa-backend/data/alertas/placas-2025/`
   (fondos, los 2 SVG, las 4 filas de íconos) — se conservan los PNG
   viejos sin usar, por si hay que volver atrás.
3. Reescribir `generateAlertaMap.js` (misma firma pública
   `generateAlertaMap({zonas,periodo,fondo,tamano,iconos})`, mismo
   `TAMANOS` exportado):
   - Reemplazar `plantilla()`/`resolverMapa()`/`bfsContest()` (flood-fill
     sobre PNG plano) por: cargar el fondo nuevo correspondiente a
     `{fondo,tamano}`, recolorear `MAPA MISIONES.svg` por
     clase→departamento (reemplazo de string en el `<style>`, un color
     por clase según `categorias` del zona), rasterizarlo con
     `loadImage()` (ya probado que node-canvas rasteriza SVG crudo) y
     componerlo escalado/centrado en la zona del lienzo donde estaba el
     mapa en las plantillas viejas (bbox medido: feed
     x431-2044/y414-2425, historias x191-2052/y979-3298 — igual en las
     dos plantillas viejas de cada tamaño, o sea que no depende del
     fondo).
   - Rasterizar `NIVELES DE ALERTA.svg` tal cual (ya trae sus 4 colores
     correctos y el texto) y ubicarlo donde estaba la caja "NIVEL DE
     RIESGO" vieja (medido a mano sobre las plantillas viejas: caja
     debajo del período, arriba/izquierda del mapa).
   - Período: sigue igual (`pill()` + `ctx.fillText`), mismas coordenadas
     `LAYOUTS`.
   - Íconos elegidos: sigue igual (recorte 0,0,350,324 de la fila nueva +
     texto/barra a mano), mismas coordenadas `LAYOUTS.iconos`, sólo
     cambia qué archivo se carga por `icon.id`.
4. Generar placas de prueba (las 4 combinaciones fondo×tamaño) con
   `Read` para verificar visualmente la posición antes de dar por
   terminado — no hay test automático de este render.

### ✅ Hecho — verificación visual de las 4 combinaciones

Se cortó VSCode justo después de escribir el plan de arriba, antes de
confirmarlo por escrito. Al retomar, se relevó el estado real: los 3 pasos
de código (colores en `alertasMeteorologicas.js`, assets copiados a
`mapa-backend/data/alertas/placas-2025/`, reescritura de
`generateAlertaMap.js`) **ya estaban hechos** — coincide con el plan al
detalle. Faltaba únicamente el paso 4, la verificación visual, que se hizo
ahora:

- Se generaron las 4 combinaciones (`tormenta`/`nubes` × `feed`/`historias`)
  con zonas y 2 íconos de prueba, vía `generateAlertaMap()` directo (sin
  pasar por HTTP), y se inspeccionaron los PNG resultantes.
- Las 4 salen bien: mapa recoloreado con los 4 hex exactos de `NIVELES DE
  ALERTA.svg` (`#7AD5B0`/`#F7DC8A`/`#F4953D`/`#DB5461`), caja "NIVEL DE
  ALERTA" con el mismo texto/colores en su posición (debajo del período,
  arriba/izq. del mapa), período (pill blanca) y fila de íconos elegidos
  todos en la posición correcta de cada plantilla, sin overlaps ni
  recortes raros.
- No se tocó código, sólo se confirmó visualmente lo que ya estaba
  implementado. Pedido considerado terminado.
