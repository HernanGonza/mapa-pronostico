-- Pantalla TV (/tv): si los avisos a muy corto plazo y las alertas cortan la rotación para verse a
-- pantalla completa. urgentes = { "acp": bool, "alertas": bool }; NULL o lo que falte = prendido.
-- El backend también la agrega solo al arrancar.
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

ALTER TABLE alerta_temprana.tv_rotacion ADD COLUMN IF NOT EXISTS urgentes jsonb;

COMMIT;
