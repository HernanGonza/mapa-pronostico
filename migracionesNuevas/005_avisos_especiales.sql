-- Aviso especial con el estilo de las placas de las alertas: título de dos líneas y nivel.
--   titulo     1.ª línea (blanca), por defecto 'AVISO ESPECIAL'
--   subtitulo  2.ª línea (del color del nivel), opcional
--   nivel      'Amarillo' | 'Naranja' | 'Rojo' | NULL (sin nivel: blanco)
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

ALTER TABLE alerta_temprana.avisos_especiales ADD COLUMN IF NOT EXISTS titulo text;
ALTER TABLE alerta_temprana.avisos_especiales ADD COLUMN IF NOT EXISTS subtitulo text;
ALTER TABLE alerta_temprana.avisos_especiales ADD COLUMN IF NOT EXISTS nivel text;

COMMIT;
