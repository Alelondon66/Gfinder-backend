require('dotenv').config();

const crypto = require('crypto');
const https = require('https');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV_VARS = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'WA_PHONE_NUMBER_ID',
    'WA_ACCESS_TOKEN',
    'WA_APP_SECRET',
    'WEBHOOK_VERIFY_TOKEN',
    'DASHBOARD_API_KEY',
    'WA_PHONE_NUMBER'
];

const faltantes = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
if (faltantes.length > 0) {
    console.error(`❌ Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
    process.exit(1);
}

const WA_TEMPLATE_NOTIFICACION = 'notificacion_llavero_encontrado';
const WA_TEMPLATE_LANG = 'es_AR';
const NOTIFICACION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora
const EMAIL_ADMINISTRACION = 'contacto@vuelve.ar';
const MAX_RECORDATORIOS_RETIRO = 2;
const DIA_RESUMEN_SEMANAL = 1; // 0=domingo, 1=lunes, ...
const TIMEOUT_SESION_SEGUNDOS = 300;
const MAX_INTENTOS_CODIGO_RETIRO = 3;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const axiosWhatsApp = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 8000
});

function compararSeguro(valorRecibido, valorEsperado) {
    const bufRecibido = Buffer.from(String(valorRecibido || ''));
    const bufEsperado = Buffer.from(String(valorEsperado || ''));
    if (bufRecibido.length !== bufEsperado.length) return false;
    return crypto.timingSafeEqual(bufRecibido, bufEsperado);
}

module.exports = {
    supabase,
    axios,
    axiosWhatsApp,
    compararSeguro,
    WA_TEMPLATE_NOTIFICACION,
    WA_TEMPLATE_LANG,
    NOTIFICACION_TIMEOUT_MS,
    EMAIL_ADMINISTRACION,
    MAX_RECORDATORIOS_RETIRO,
    DIA_RESUMEN_SEMANAL,
    TIMEOUT_SESION_SEGUNDOS,
    MAX_INTENTOS_CODIGO_RETIRO,
    WA_PHONE_NUMBER: process.env.WA_PHONE_NUMBER
};
