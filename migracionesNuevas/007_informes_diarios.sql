-- Informes diarios (en desarrollo): qué pasó un día según las estaciones oficiales (INTA y
-- SiNaRaMe, cada 10 min), lo que emitió el SMN y lo que publicamos. Uno por informe guardado.
--   fecha / desde        inicio del informe: día y hora "HH:MM" (hora de Misiones)
--   fecha_hasta / hasta  fin del informe (fecha_hasta NULL = el mismo día). Ej.: ayer 00:00 → hoy 09:00
--   resumen        el texto final (editado en la pantalla)
--   datos          todo lo juntado: resúmenes y series de 10 min por estación, avisos del SMN, publicaciones
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

CREATE TABLE IF NOT EXISTS alerta_temprana.informes_diarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha          date NOT NULL,
  fecha_hasta    date,
  desde          text NOT NULL,
  hasta          text NOT NULL,
  titulo         text NOT NULL,
  resumen        text NOT NULL,
  datos          jsonb NOT NULL,
  generado_por   bigint REFERENCES alerta_temprana.usuarios(id),
  generado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz
);
-- Por si la tabla se creó antes de que existiera el rango de fechas.
ALTER TABLE alerta_temprana.informes_diarios ADD COLUMN IF NOT EXISTS fecha_hasta date;
CREATE INDEX IF NOT EXISTS informes_diarios_fecha_idx ON alerta_temprana.informes_diarios (fecha);

COMMIT;
