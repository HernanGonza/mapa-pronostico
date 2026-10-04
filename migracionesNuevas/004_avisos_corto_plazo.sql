-- Avisos a muy corto plazo (ACP): nivel, textos por partes y con qué color salió la placa.
-- Sólo esquema alerta_temprana (nunca public). Se puede correr más de una vez.
BEGIN;

-- Nivel que traía el titular del aviso del SMN ("AVISO NARANJA…"); NULL si no lo decía o se dibujó a mano.
ALTER TABLE alerta_temprana.avisos_corto_plazo ADD COLUMN IF NOT EXISTS nivel text;

-- El aviso por partes, como lo arma el asistente: { fenomeno, emision, validez, zonas }.
-- `texto` sigue guardando el texto completo. NULL en los de texto libre.
ALTER TABLE alerta_temprana.avisos_corto_plazo ADD COLUMN IF NOT EXISTS partes jsonb;

-- Con qué nivel salió la placa y de dónde: 'titular' (lo decía el SMN), 'alerta' (cruce con la
-- alerta vigente) o NULL (sin alerta: violeta).
ALTER TABLE alerta_temprana.avisos_corto_plazo ADD COLUMN IF NOT EXISTS nivel_placa text;
ALTER TABLE alerta_temprana.avisos_corto_plazo ADD COLUMN IF NOT EXISTS nivel_origen text;

COMMIT;
