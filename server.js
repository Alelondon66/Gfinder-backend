const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';

// Historial temporal en memoria para auditoría interna rápida
const logsMensajes = [];

// 1. ENDPOINT DE VERIFICACIÓN (HANDSHAKE)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            console.log('✅ Webhook verificado con éxito.');
            return res.status(200).send(challenge);
        } else {
            return res.status(403).sendStatus(403);
        }
    }
});

// 2. ENDPOINT DE RECEPCIÓN Y ENRUTADOR LÓGICO
app.post('/webhook', (req, res) => {
    const body = req.body;

    // Guardamos el log exacto para auditoría visual en Railway o endpoint de control
    logsMensajes.push({ fecha: new Date(), data: body });

    if (body.object === 'whatsapp_business_account') {
        
        // Estructura tolerante a variaciones de versión de la API de Meta
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages[0]) {
            const messageData = messages[0];
            const from = messageData.from; // Teléfono del usuario
            
            console.log(`📩 PROCESANDO EVENTO -> De: ${from} | Tipo: ${messageData.type}`);

            // LÓGICA DEL ENRUTADOR DE ESTADOS (BETA MVP)
            if (messageData.type === 'text') {
                const text = messageData.text.body.trim().toLowerCase();
                console.log(`💬 Texto recibido de [${from}]: "${text}"`);
                
                // Respuesta simulada en consola según el flujo GFinder
                if (text === 'hola' || text === 'menu' || text === 'inicio') {
                    console.log(`🤖 ENRUTADOR -> Enviando Menú Principal a ${from}`);
                    /* TODO: Llamar a la API de Meta para enviar el mensaje de texto:
                       "¡Bienvenido a GFinder AXION! 🔑🔍
                        Por favor, elegí una opción:
                        1. Registrar mi llavero nuevo.
                        2. Encontré un llavero perdido.
                        3. Reportar mi llavero extraviado." */
                } else if (text === '1') {
                    console.log(`🤖 ENRUTADOR -> Flujo de Registro iniciado para ${from}`);
                } else if (text === '2') {
                    console.log(`🤖 ENRUTADOR -> Flujo de Hallazgo iniciado para ${from}`);
                } else {
                    console.log(`🤖 ENRUTADOR -> Texto no reconocido. Enviando ayuda.`);
                }
            } 
            
            else if (messageData.type === 'location') {
                const latitude = messageData.location.latitude;
                const longitude = messageData.location.longitude;
                console.log(`📍 Ubicación recibida de [${from}]: Lat ${latitude}, Lng ${longitude}`);
            }
        }
        
        return res.status(200).send('EVENT_RECEIVED');
    } else {
        return res.sendStatus(404);
    }
});

// 3. ENDPOINT AUXILIAR DE CONTROL (Para ver si entran datos sin mirar la consola)
app.get('/debug-logs', (req, res) => {
    res.json({
        total_recibidos: logsMensajes.length,
        logs: logsMensajes
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor GFinder escuchando en puerto ${PORT}`);
});
