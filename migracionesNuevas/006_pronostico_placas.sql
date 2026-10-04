-- Placa del pronóstico sobre foto (estilo nuevo): qué foto de fondo, qué etiqueta y qué frase llevó.
--   fondo     número de foto (1 a 33, data/materiales/fondos-pronostico)
--   etiqueta  'tormenta' | 'lluvia' | 'algo-nublado' | 'parcialmente-nublado' | 'nublado' | 'despejado'
--   frase     la frase del día (opcional)
--   estilo_tarjeta  'oscura' (vidrio oscuro) | 'sinCaja' | 'clara' (vidrio claro): las tarjetas de las localidades
-- NULL en las placas de antes (sobre el mapa crema).
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

ALTER TABLE alerta_temprana.pronostico_placas ADD COLUMN IF NOT EXISTS fondo integer;
ALTER TABLE alerta_temprana.pronostico_placas ADD COLUMN IF NOT EXISTS etiqueta text;
ALTER TABLE alerta_temprana.pronostico_placas ADD COLUMN IF NOT EXISTS frase text;
ALTER TABLE alerta_temprana.pronostico_placas ADD COLUMN IF NOT EXISTS estilo_tarjeta text;

COMMIT;
