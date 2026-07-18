const express = require('express');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { compararSeguro, WA_PHONE_NUMBER } = require('./src/config');
const { procesarMensajeWebhook } = require('./src/bot');
const { obtenerMetricasDashboard, renderizarPaginaDashboard } = require('./src/dashboard');
const { iniciarJobs } = require('./src/jobs');
const { resolverRedireccionQR } = require('./src/qr');

const app = express();

// Railway (y la mayoría de los PaaS) corre la app detrás de un proxy
// inverso. Sin esto, Express no confía en el header X-Forwarded-For y
// express-rate-limit tira un ValidationError en cada request.
app.set('trust proxy', 1);

app.use('/webhook', bodyParser.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(bodyParser.json());

function verificarFirmaWebhook(req, res, next) {
    const firma = req.headers['x-hub-signature-256'];
    if (!firma || !req.rawBody) {
        return res.sendStatus(401);
    }

    const hashEsperado = 'sha256=' + crypto
        .createHmac('sha256', process.env.WA_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');

    if (!compararSeguro(firma, hashEsperado)) {
        return res.sendStatus(401);
    }
    next();
}

const limitadorWebhook = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
});

const limitadorDashboard = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
});

const limitadorQR = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
});

app.get('/webhook', limitadorWebhook, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && compararSeguro(token, process.env.WEBHOOK_VERIFY_TOKEN)) {
        return res.status(200).send(challenge);
    }
    return res.status(403).sendStatus(403);
});

app.post('/webhook', limitadorWebhook, verificarFirmaWebhook, procesarMensajeWebhook);

// 🔗 REDIRECCIÓN DEL QR IMPRESO EN CADA LLAVERO
app.get('/q/:codigo', limitadorQR, async (req, res) => {
    try {
        const url = await resolverRedireccionQR(req.params.codigo);
        return res.redirect(302, url);
    } catch (error) {
        console.error('❌ Error redirección QR:', error.message);
        return res.redirect(302, `https://wa.me/${WA_PHONE_NUMBER}`);
    }
});

// 📊 ENDPOINT DEL DASHBOARD COMERCIAL (MÉTRICAS GFINDER, formato JSON para integraciones)
app.get('/api/dashboard/metrics', limitadorDashboard, async (req, res) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || !compararSeguro(apiKey, process.env.DASHBOARD_API_KEY)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const metricas = await obtenerMetricasDashboard();
        return res.status(200).json(metricas);
    } catch (error) {
        console.error('❌ Error Dashboard:', error.message);
        return res.status(500).json({ error: 'Error interno del servidor al procesar métricas' });
    }
});

// 📊 PÁGINA VISUAL DEL DASHBOARD (para ver desde el navegador, sin herramientas técnicas)
app.get('/dashboard', limitadorDashboard, async (req, res) => {
    const clave = req.query.key;

    if (!clave || !compararSeguro(clave, process.env.DASHBOARD_API_KEY)) {
        return res.status(401).send('Acceso no autorizado. Agregá ?key=TU_CLAVE al final de la dirección.');
    }

    try {
        const metricas = await obtenerMetricasDashboard();
        return res.status(200).send(renderizarPaginaDashboard(metricas));
    } catch (error) {
        console.error('❌ Error página Dashboard:', error.message);
        return res.status(500).send('Error interno al cargar el dashboard.');
    }
});

iniciarJobs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor VUELVE optimizado con flujo de ubicación corriendo en puerto ${PORT}`);
});
