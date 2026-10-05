-- Pantalla TV (/tv): cómo se muestran los avisos a muy corto plazo y las alertas. urgentes =
-- { "acp": {...}, "alertas": {...} }, cada uno { modo: ciclo|fijo|rotacion, fijoMin, cadaMin, ancla, accion }
-- (ciclo = fijos fijoMin minutos cada cadaMin y el resto en la rotación). NULL = ciclo de 15 cada 60.
-- El backend también la agrega solo al arrancar.
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

ALTER TABLE alerta_temprana.tv_rotacion ADD COLUMN IF NOT EXISTS urgentes jsonb;

COMMIT;
