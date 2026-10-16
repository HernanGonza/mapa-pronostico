-- Tabla online de precipitaciones (/embed/precipitaciones): una fila por estación y período, cargada desde el
-- informe de precipitaciones. Volver a publicar el mismo período actualiza la fila (UNIQUE clave + fechas).
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

CREATE TABLE IF NOT EXISTS alerta_temprana.precipitaciones_registros (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave          text NOT NULL,
  estacion       text NOT NULL,
  red            text NOT NULL,
  fuente         text,
  lat            double precision,
  lng            double precision,
  fecha_desde    date NOT NULL,
  fecha_hasta    date NOT NULL,
  lluvia_mm      numeric(7,1),
  max_mm         numeric(7,1),
  max_minutos    smallint,
  mes_mm         numeric(7,1),
  media_mm       numeric(7,1),
  anomalia_mm    numeric(7,1),
  cargado_por    bigint REFERENCES alerta_temprana.usuarios(id),
  cargado_en     timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clave, fecha_desde, fecha_hasta)
);
CREATE INDEX IF NOT EXISTS precipitaciones_registros_fecha_idx ON alerta_temprana.precipitaciones_registros (fecha_hasta);

COMMIT;
