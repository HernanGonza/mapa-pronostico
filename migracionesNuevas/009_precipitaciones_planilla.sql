-- Monitoreo de lluvias (reemplaza al Excel PRECIPITACIONES.xlsx): estaciones cargadas a mano, lluvia de cada día y media mensual.
-- Totales, anomalías y acumulados se calculan al leer. Un día sin fila = sin dato (no es lo mismo que 0).
--   precipitaciones_estaciones  nombre + red (1 SMN, 2 INTA, 3 Automática, 4 Red Matteo); «Posadas» puede estar en dos redes
--   precipitaciones_medias      media de cada mes (1-12); usa_media_de = «se toma la media de Cerro Azul»
--   precipitaciones_diarias     mm por estación y día
--   *_pub                       copia PUBLICADA de las tres (lo que ven la tabla y el mapa públicos): se actualiza sólo con «Publicar»
--   precipitaciones_publicaciones  quién publicó, cuándo y qué cambió
-- (Si se había creado antes precipitaciones_registros, ya no se usa: se puede borrar.)
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_estaciones (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre    text NOT NULL,
  red       smallint NOT NULL CHECK (red BETWEEN 1 AND 4),
  lat       double precision,
  lng       double precision,
  orden     integer NOT NULL DEFAULT 0,
  activa    boolean NOT NULL DEFAULT true,
  creada_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nombre, red)
);
CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_medias (
  estacion_id  bigint NOT NULL REFERENCES alerta_temprana.precipitaciones_estaciones(id) ON DELETE CASCADE,
  mes          smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  media_mm     numeric(6,1),
  usa_media_de bigint REFERENCES alerta_temprana.precipitaciones_estaciones(id) ON DELETE SET NULL,
  PRIMARY KEY (estacion_id, mes)
);
CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_diarias (
  estacion_id     bigint NOT NULL REFERENCES alerta_temprana.precipitaciones_estaciones(id) ON DELETE CASCADE,
  fecha           date NOT NULL,
  mm              numeric(6,1) NOT NULL CHECK (mm >= 0),
  actualizado_por bigint REFERENCES alerta_temprana.usuarios(id),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, fecha)
);
CREATE INDEX IF NOT EXISTS precipitaciones_diarias_fecha_idx ON alerta_temprana.precipitaciones_diarias (fecha);

CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_estaciones_pub (
  id bigint PRIMARY KEY, nombre text NOT NULL, red smallint NOT NULL, lat double precision, lng double precision, orden integer NOT NULL, activa boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_medias_pub (
  estacion_id bigint NOT NULL, mes smallint NOT NULL, media_mm numeric(6,1), usa_media_de bigint, PRIMARY KEY (estacion_id, mes)
);
CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_diarias_pub (
  estacion_id bigint NOT NULL, fecha date NOT NULL, mm numeric(6,1) NOT NULL, PRIMARY KEY (estacion_id, fecha)
);
CREATE INDEX IF NOT EXISTS precipitaciones_diarias_pub_fecha_idx ON alerta_temprana.precipitaciones_diarias_pub (fecha);
CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_publicaciones (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publicado_en  timestamptz NOT NULL DEFAULT now(),
  publicado_por bigint REFERENCES alerta_temprana.usuarios(id),
  resumen       jsonb NOT NULL
);

COMMIT;
