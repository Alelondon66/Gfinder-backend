const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // Usaremos axios para pegarle a Meta de forma limpia
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';

// CONEXIONES
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const logsMensajes = [];

// FUNCIÓN PARA ENVIAR WHATSAPP (LA VOZ DEL BOT)
async function enviarMensajeWhatsApp(telefonoDestino, textoEnviar) {
    const url = `https://graph.facebook.com/v25.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: telefonoDestino,
        type: "text",
        text: {
            preview_url: false,
            body: textoEnviar
        }
    };

    try {
        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`📤 Mensaje enviado con éxito a [${telefonoDestino}]`);
    } catch (error) {
        console.error('❌ Error enviando mensaje por Meta:', error.response?.data || error.message);
    }
}

// 1. ENDPOINT DE VERIFICACIÓN
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.status(403).sendStatus(403);
});

// 2. ENDPOINT PRINCIPAL (RECEPCIÓN, ENRUTADOR Y RESPUESTA)
app.post('/webhook', async (req, res) => {
    const body = req.body;
    logsMensajes.push({ fecha: new Date(), data: body });

    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages[0]) {
            const messageData = messages[0];
            const from = messageData.from; 

            if (messageData.type === 'text') {
                const text = messageData.text.body.trim().toLowerCase();
                console.log(`💬 Mensaje entrante de [${from}]: "${text}"`);

                // 🤖 RESPUESTA INTERACTIVA
                if (text === 'hola' || text === 'menu' || text === 'inicio') {
                    const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nPor favor, elegí una opción respondiendo con el número:\n\n*1.* Registrar mi llavero nuevo.\n*2.* Encontré un llavero perdido.\n*3.* Reportar mi llavero extraviado.`;
                    await enviarMensajeWhatsApp(from, menuTexto);
                } 
                
                else if (text === '1') {
                    // Simulación de guardado rápido en Supabase
                    const { error } = await supabase
                        .from('llaveros') 
                        .insert([{ telefono_usuario: from, estado: 'proceso_registro', fecha_registro: new Date() }]);

                    if (error) {
                        console.error('❌ Error Supabase:', error.message);
                        await enviarMensajeWhatsApp(from, "⚠️ Hubo un problema al iniciar el registro. Por favor, intenta de nuevo.");
                    } else {
                        await enviarMensajeWhatsApp(from, "💾 ¡Perfecto! Iniciamos el registro de tu llavero. Por favor, escribí el código alfanumérico que figura en tu tarjeta.");
                    }
                } 
                
                else {
                    await enviarMensajeWhatsApp(from, "🤖 No entendí esa opción. Escribí *Hola* para volver al menú principal.");
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

// DEBUG
app.get('/debug-logs', (req, res) => {
    res.json({ total_recibidos: logsMensajes.length, logs: logsMensajes });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor GFinder 100% interactivo corriendo en puerto ${PORT}`);
});
