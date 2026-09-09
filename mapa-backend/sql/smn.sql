-- Se conserva el contrato real del SMN como JSONB, incluidos GeoJSON y períodos.
-- No requiere instalar PostGIS ni modifica las publicaciones manuales.
CREATE TABLE IF NOT EXISTS smn_estado (
  fuente varchar(3) PRIMARY KEY CHECK (fuente IN ('SAT', 'ACP')),
  consultado_en timestamptz NOT NULL,
  revision char(64) NOT NULL,
  datos jsonb NOT NULL CHECK (jsonb_typeof(datos) = 'array'),
  imagen bytea NOT NULL
);
CREATE TABLE IF NOT EXISTS smn_historial (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fuente varchar(3) NOT NULL CHECK (fuente IN ('SAT', 'ACP')),
  recibido_en timestamptz NOT NULL DEFAULT now(),
  revision char(64) NOT NULL,
  datos jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS smn_historial_fuente_fecha ON smn_historial (fuente, recibido_en DESC);
