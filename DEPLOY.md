# Despliegue con Docker Compose

La aplicación usa React + MapLibre en el navegador, Express para la API y
Postgres para publicaciones y sesiones. Caddy sirve el frontend, proxea la API
y gestiona HTTPS. Pronóstico y riesgo de incendios comparten este stack;
no hace falta desplegar Java ni ECOSOTAT.

## Preparar el servidor

Requisitos: Docker Engine con Compose v2, un dominio apuntando al servidor y
puertos 80/443 disponibles. Desde la raíz del repositorio:

```sh
cp .env.example .env
openssl rand -hex 24
```

Usar el valor generado como `POSTGRES_PASSWORD` (hexadecimal evita caracteres
reservados en la URL de conexión). Configurar `DOMAIN=mapas.ejemplo.gob.ar` y
mantener `VITE_API_URL=` vacío: frontend y API se consumen por el mismo origen,
incluidas las cookies de sesión. No subir `.env` al repositorio.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec backend node scripts/crear-usuario.js operador@ejemplo.gob.ar
```

El último comando pide la contraseña del operador. Requiere Postgres disponible;
el login no tiene modo de persistencia en archivos. Repetir el comando para un
usuario existente cambia su contraseña.

En producción Caddy solicita el certificado del dominio. En una prueba local,
`DOMAIN=localhost` usa HTTPS con certificado local de Caddy: abrir
`https://localhost` y confiar en ese certificado para la prueba. No se debe
interpretar `localhost` como una configuración de HTTP plano.

Para probar por HTTP en la red local, por ejemplo `http://10.0.0.227:8080`,
configurar en `.env`:

```dotenv
DOMAIN=:80
HTTP_PORT=8080
SESSION_COOKIE_SECURE=false
```

Aplicar con `docker compose up -d --build` y volver a iniciar sesión.
En HTTPS mantener `SESSION_COOKIE_SECURE=true` (valor predeterminado).
Una cookie `Secure` no se envía por HTTP a una IP: el login puede responder
correctamente, pero las siguientes solicitudes devuelven 401.

## Verificación después de desplegar

1. `/health` debe devolver `{"ok":true}`.
2. `/login`: ingresar con el operador creado.
3. `/panel/pronostico`: cargar el DOCX, revisar, publicar y descargar PNG.
4. `/embed`: verificar municipios, colores y fichas sobre Positron, sin selector de tema.
5. `/panel/riesgo-incendios`: asignar los 17 niveles, revisar y publicar.
6. `/embed/riesgo-incendios`: comprobar el reporte público sin sesión.
7. Descargar el PNG de riesgo y comprobar mapa, leyenda y estado publicado.
8. Reiniciar con `docker compose restart` y comprobar que el reporte permanece.

```html
<iframe src="https://mapas.ejemplo.gob.ar/embed/riesgo-incendios"
        title="Riesgo de incendios forestales de Misiones"
        width="100%" height="720" style="border:0" loading="lazy"></iframe>
```

El iframe de riesgo consulta actualizaciones cada minuto. Todos los mapas usan
Positron como fondo fijo, sin selector ni preferencias de tema del navegador.

## Persistencia y actualizaciones

El volumen `pgdata` guarda pronósticos, riesgo, usuarios y sesiones. Los volúmenes
de Caddy guardan certificados y configuración. `docker compose down` conserva
los volúmenes; **no usar `down -v`** si se quieren conservar los datos.

Respaldo antes de actualizar (ajustar usuario/base si cambiaron en `.env`):

```sh
docker compose exec -T db pg_dump -U mapa mapa_pronostico > respaldo.sql
docker compose up -d --build
docker compose logs --tail=100 backend frontend
```

La geometría de los 17 departamentos y su catálogo están incluidos en la imagen
del backend. Las tablas de riesgo se crean al primer uso. Sin `DATABASE_URL`,
el riesgo puede guardarse en archivo para desarrollo, pero ese modo no permite
iniciar sesión y no sustituye Postgres en producción.

## Mapas y exportación

El fondo Positron se solicita directamente a OpenFreeMap mediante
su [integración oficial con MapLibre](https://openfreemap.org/quick_start/).
El navegador necesita acceso a `tiles.openfreemap.org` y a los recursos indicados
por ese estilo. No se requiere clave de API ni un servicio adicional en Compose.

La integración de ECOSOTAT reproduce la asignación manual de cinco categorías
por departamento y sus colores originales. Los IDs geográficos son los del
GeoJSON actual, no los números `ZONA_n` del Java. No se calcula automáticamente
el índice FWI. El catálogo de categorías se sirve desde el backend para mantener
editor, validación, leyenda y PNG consistentes.

La imagen institucional de riesgo se genera en el backend con la plantilla
original `data/ecosotat/misiones.png`: escala semicircular, encabezado, nombres,
colores por zona y franja de logos. La fecha se elige en el editor. No necesita
OpenFreeMap, navegador ni Java para renderizar. El endpoint autenticado es
`POST /api/riesgo-incendios/render-png` con `{zonas, fecha: "YYYY-MM-DD"}`.
La descarga refleja las categorías editadas y no publica por sí sola.

Ambas pantallas ofrecen además «Capturar mapa actual» para guardar la vista
interactiva con sus overlays. El generador institucional del pronóstico conserva
su plantilla existente. Ambos editores comparten el bloque para abrir el mapa
público y copiar el iframe.

## Alcance de la validación local

Se debe ejecutar `npm test` en `mapa-backend` y `npm run build` en
`mapa-frontend`. El build de las imágenes y el arranque completo de Compose
requieren Docker; no quedan verificados solamente por esos dos comandos.
