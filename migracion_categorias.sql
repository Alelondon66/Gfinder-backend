-- Agrega la categoria del objeto (llavero, celular, etc.) para poder tener
-- varios servicios (VUELVE TU LLAVERO, MICELU...) conviviendo en el mismo
-- bot. Las filas existentes quedan como 'llavero' (comportamiento actual).

ALTER TABLE llaveros
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'llavero';

ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'llavero';
