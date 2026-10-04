-- Alertas meteorológicas manuales: alertas en fila, fijar en el mapa público y última actualización.
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

-- En fila: no aparece en el mapa público hasta que deja de estar vigente la publicación en_fila_de.
ALTER TABLE alerta_temprana.alertas_meteo_publicaciones
  ADD COLUMN IF NOT EXISTS en_fila_de bigint REFERENCES alerta_temprana.alertas_meteo_publicaciones(id);

-- Fijada a mano desde el panel: mientras esté vigente, el mapa público muestra sólo ésta.
ALTER TABLE alerta_temprana.alertas_meteo_publicaciones
  ADD COLUMN IF NOT EXISTS fijada boolean NOT NULL DEFAULT false;

-- Última vez que se le cambió la vigencia desde el panel (NULL = nunca).
ALTER TABLE alerta_temprana.alertas_meteo_publicaciones
  ADD COLUMN IF NOT EXISTS actualizada_en timestamptz;

COMMIT;
