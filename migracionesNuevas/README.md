# Migraciones nuevas (03/10/2026)

Cambios de base de lo hecho el 03/10 (y las alertas en fila del 02/10), para correr en la base de
**ecodatos (Supabase)**. Todo va en el esquema **`alerta_temprana`**, con los nombres escritos
completos: nada toca `public`.

Correr en orden:

| Archivo | Qué hace |
|---|---|
| `001_alertas_meteo_publicaciones.sql` | Alertas manuales: `en_fila_de` (en fila), `fijada` (fijar en el mapa público), `actualizada_en` |
| `002_alertas_meteo_eventos.sql` | Historial de cada alerta (publicada, reemplazada, vigencia cambiada, fijada/desfijada, despublicada, placas generadas/editadas/eliminadas), con quién y cuándo |
| `003_alertas_meteo_publicacion_placas.sql` | Placas de la tarjeta de cada alerta (vigencia, recomendaciones, aviso, nivel), con versiones anteriores y eliminadas |
| `004_avisos_corto_plazo.sql` | ACP: `nivel` (del titular del SMN), `partes` (textos por partes), `nivel_placa` y `nivel_origen` |
| `005_avisos_especiales.sql` | Aviso especial: `titulo`, `subtitulo` (2.ª línea en color) y `nivel` |
| `006_pronostico_placas.sql` | Placa del pronóstico sobre foto: `fondo`, `etiqueta`, `frase` y `estilo_tarjeta` |
| `007_informes_diarios.sql` | Informes diarios: tabla nueva `informes_diarios` (rango desde/hasta con fecha y hora, texto y todos los datos juntados) |

```bash
for f in migracionesNuevas/0*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

- Se pueden correr más de una vez (todo es `IF NOT EXISTS`) y cada archivo va en una transacción.
- Probadas en una base vacía con las tablas de antes: la primera vez crean todo, la segunda no
  cambian nada.
- El backend igual crea o completa estas tablas solo al arrancar; correr las migraciones antes
  del deploy deja la base lista y documentada.
- Requieren que ya existan `alerta_temprana.usuarios`, `alertas_meteo_publicaciones`,
  `avisos_corto_plazo`, `avisos_especiales` y `pronostico_placas` (ya están en producción).
