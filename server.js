const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Token de verificación inventado por vos. 
// Es la contraseña que vas a poner en el panel de Meta para que confíe en tu servidor.
const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';

/**
 * 1. ENDPOINT DE VERIFICACIÓN (HANDSHAKE)
 * Meta llama a este endpoint por método GET para validar que el servidor está activo y seguro.
 */
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            console.log('✅ Webhook verificado con éxito por Meta.');
            return res.status(200).send(challenge);
        } else {
            console.log('❌ Intento de verificación fallido: Token inválido.');
            return res.status(403).sendStatus(403);
        }
    }
});

/**
 * 2. ENDPOINT DE RECEPCIÓN DE MENSAJES
 * Meta llama a este endpoint por método POST cada vez que un usuario envía un WhatsApp.
 */
app.post('/webhook', (req, res) => {
    const body = req.body;

    // Validamos que el evento provenga de una API de WhatsApp
    if (body.object === 'whatsapp_business_account') {
        
        // Estructura segura para capturar el mensaje dentro del JSON de Meta
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const messageData = body.entry[0].changes[0].value.messages[0];
            const from = messageData.from; // Teléfono del usuario (ej: "54911...")
            const messageId = messageData.id;
            
            console.log(`📩 Mensaje recibido de: ${from}`);

            // Procesamos según el tipo de contenido (Texto, Ubicación o Botón)
            if (messageData.type === 'text') {
                const text = messageData.text.body.trim();
                console.log(`💬 Contenido de texto: "${text}"`);
                
                // TODO: Acá llamaremos al Bloque 2 (Enrutador de estados)
            } 
            
            else if (messageData.type === 'location') {
                const latitude = messageData.location.latitude;
                const longitude = messageData.location.longitude;
                console.log(`📍 Ubicación recibida: Lat ${latitude}, Lng ${longitude}`);
                
                // TODO: Acá procesaremos la geolocalización con Supabase
            }
        }
        
        // Respondemos siempre 200 OK a Meta inmediatamente para que no reintente el envío
        return res.status(200).send('EVENT_RECEIVED');
    } else {
        return res.sendStatus(404);
    }
});

// Puerto de escucha del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor GFinder escuchando en puerto ${PORT}`);
});