-- Historial de cada alerta manual, para estadísticas e histórico: una fila por evento.
--   publicada          detalle: { vigenteHasta, periodo, enFilaDe, reemplaza: [ids] }
--   reemplazada        detalle: { por: id }           (la sacó otra al publicarse)
--   vigencia_cambiada  detalle: { antes, despues, corridas: [{ id, hasta }] }  (las de la fila que se corrieron)
--   fijada / desfijada
--   despublicada       detalle: { ibaHasta }
--   placa_generada / placa_editada / placa_eliminada   detalle: { placaId, tipo, nivel }
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

CREATE TABLE IF NOT EXISTS alerta_temprana.alertas_meteo_eventos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publicacion_id bigint NOT NULL REFERENCES alerta_temprana.alertas_meteo_publicaciones(id),
  evento         text NOT NULL,
  detalle        jsonb NOT NULL DEFAULT '{}'::jsonb,
  usuario_id     bigint REFERENCES alerta_temprana.usuarios(id),
  en             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alertas_meteo_eventos_pub_idx ON alerta_temprana.alertas_meteo_eventos (publicacion_id, en);

COMMIT;
