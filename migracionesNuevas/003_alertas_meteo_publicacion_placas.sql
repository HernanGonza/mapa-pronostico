-- Placas de una alerta publicada (las de la tarjeta en el panel): actualización de vigencia,
-- recomendaciones, aviso de alerta y actualización de nivel.
--   tipo   'mapa' (Crear placa para redes) | 'vigencia' | 'recomendaciones' | 'aviso' | 'nivel'
--   nivel  'Amarillo' | 'Naranja' | 'Rojo'  (el color de la placa)
--   datos  con qué se armó (zonas y horarios, textos, íconos, nivel anterior, etc.)
-- Eliminar no borra la fila (eliminada_en / eliminada_por); editar guarda las imágenes de antes en
-- versiones_anteriores, para seguir sabiendo si alguna versión ya salió en redes
-- (publicaciones_redes.placa_url).
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

CREATE TABLE IF NOT EXISTS alerta_temprana.alertas_meteo_publicacion_placas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publicacion_id bigint NOT NULL REFERENCES alerta_temprana.alertas_meteo_publicaciones(id),
  tipo           text NOT NULL,
  nivel          text NOT NULL,
  datos          jsonb NOT NULL,
  generado_por   bigint REFERENCES alerta_temprana.usuarios(id),
  generado_en    timestamptz NOT NULL DEFAULT now(),
  feed_path      text NOT NULL,
  historias_path text NOT NULL
);
CREATE INDEX IF NOT EXISTS alertas_meteo_publicacion_placas_pub_idx ON alerta_temprana.alertas_meteo_publicacion_placas (publicacion_id);

ALTER TABLE alerta_temprana.alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS eliminada_en timestamptz;
ALTER TABLE alerta_temprana.alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS eliminada_por bigint REFERENCES alerta_temprana.usuarios(id);
ALTER TABLE alerta_temprana.alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS versiones_anteriores jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE alerta_temprana.alertas_meteo_publicacion_placas ADD COLUMN IF NOT EXISTS editado_en timestamptz;

COMMIT;
