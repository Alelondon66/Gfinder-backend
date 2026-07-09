-- Empezamos de cero: los datos actuales son de prueba, no hace falta migrarlos.

DROP TABLE IF EXISTS llaveros CASCADE;
DROP VIEW IF EXISTS vista_dashboard_gfinder;
DROP VIEW IF EXISTS vista_ranking_sucursales_axion;

-- El objeto físico y su dueño. Nada de estados de conversación acá.
CREATE TABLE llaveros (
    id BIGSERIAL PRIMARY KEY,
    codigo_llavero TEXT NOT NULL UNIQUE,
    alias TEXT,
    telefono_dueno TEXT NOT NULL,
    nombre_dueno TEXT,
    email_alternativo TEXT,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dónde está parado cada usuario en la conversación ahora mismo (paso a paso).
CREATE TABLE sesiones (
    id BIGSERIAL PRIMARY KEY,
    telefono TEXT NOT NULL,
    estado TEXT NOT NULL,
    codigo_llavero TEXT,
    nombre_borrador TEXT,
    email_borrador TEXT,
    alias_borrador TEXT,
    sucursal_id TEXT,
    evento_id BIGINT,
    intentos_codigo_retiro INTEGER NOT NULL DEFAULT 0,
    ultima_interaccion TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelado_en TIMESTAMPTZ,
    motivo_cancelacion TEXT
);

-- Cada hecho concreto: alguien lo encuentra, AXION lo custodia, se retira.
CREATE TABLE eventos (
    id BIGSERIAL PRIMARY KEY,
    llavero_id BIGINT NOT NULL REFERENCES llaveros(id) ON DELETE CASCADE,
    codigo_llavero TEXT NOT NULL,
    tipo TEXT NOT NULL,          -- 'encuentro' | 'custodia'
    estado TEXT NOT NULL,        -- 'abierto' | 'cerrado' | 'en_custodia' | 'retirado'
    telefono_finder TEXT,
    sucursal_id TEXT,
    codigo_retiro INTEGER,
    notificacion_pendiente TEXT,
    notificacion_enviada_en TIMESTAMPTZ,
    recordatorios_retiro_enviados INTEGER NOT NULL DEFAULT 0,
    ultimo_recordatorio_retiro_en TIMESTAMPTZ,
    aviso_operador_enviado_en TIMESTAMPTZ,
    comentario_retiro TEXT,
    motivo_cierre TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrado_en TIMESTAMPTZ,
    retirado_en TIMESTAMPTZ
);

CREATE INDEX idx_llaveros_codigo ON llaveros(codigo_llavero);
CREATE INDEX idx_llaveros_dueno ON llaveros(telefono_dueno);
CREATE INDEX idx_sesiones_telefono ON sesiones(telefono);
CREATE INDEX idx_eventos_codigo ON eventos(codigo_llavero);
CREATE INDEX idx_eventos_llavero_id ON eventos(llavero_id);
