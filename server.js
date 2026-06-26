const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';

// CONEXIÓN SEGURA CON SUPABASE (Usa las variables de entorno de Railway)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const logsMensajes = [];

// 1. ENDPOINT DE VERIFICACIÓN (HANDSHAKE)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
            console.log('✅ Webhook verificado con éxito por Meta.');
            return res.status(200).send(challenge);
        } else {
            return res.status(403).sendStatus(403);
        }
    }
});

// 2. ENDPOINT PRINCIPAL (RECEPCIÓN Y ESCRITURA EN BD)
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
            const from = messageData.from; // Teléfono del usuario

            if (messageData.type === 'text') {
                const text = messageData.text.body.trim().toLowerCase();
                console.log(`💬 Mensaje real de [${from}]: "${text}"`);

                // FLUJO INTERACTIVO GFINDER
                if (text === 'hola' || text === 'menu') {
                    console.log(`🤖 ENRUTADOR -> Desplegando Menú Principal a ${from}`);
                    // Aquí irá la función para enviarle el texto del menú por WhatsApp
                } 
                
                // SIMULACIÓN DE REGISTRO EN BASE DE DATOS (OPCIÓN 1)
                else if (text === '1' || text === 'registrar') {
                    console.log(`💾 BD -> Intentando registrar llavero de prueba para ${from}`);
                    
                    // Grabamos en la tabla de Supabase (asumiendo columnas estándar del MVP)
                    const { data, error } = await supabase
                        .from('llaveros') // Cambiar por el nombre exacto de tu tabla si es diferente
                        .insert([
                            { 
                                telefono_usuario: from, 
                                estado: 'registrado',
                                fecha_registro: new Date()
                            }
                        ]);

                    if (error) {
                        console.error('❌ Error guardando en Supabase:', error.message);
                    } else {
                        console.log('🎉 ¡Llavero guardado con éxito en Supabase!', data);
                    }
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    } else {
        return res.sendStatus(404);
    }
});

// LINK DE AUDITORÍA
app.get('/debug-logs', (req, res) => {
    res.json({
        total_recibidos: logsMensajes.length,
        conexion_supabase: !!supabaseUrl,
        logs: logsMensajes
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor GFinder conectado a Supabase en puerto ${PORT}`);
});
