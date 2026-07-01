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

        else if (text === '1') {
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
                
                else if (text === '2') {
                    const { error } = await supabase
                        .from('llaveros') 
                        .insert([{ telefono_usuario: from, estado: 'encontre_perdido', fecha_registro: new Date() }]);

                    if (error) {
                        console.error('❌ Error Supabase Opcion 2:', error.message);
                        await enviarMensajeWhatsApp(from, "⚠️ Hubo un problema técnico. Por favor, intenta de nuevo.");
                    } else {
                        await enviarMensajeWhatsApp(from, "🔍 ¡Muchas gracias por reportarlo! Por favor, indícanos el código alfanumérico que figura en el llavero que encontraste.");
                    }
                }

                else if (text === '3') {
                    const { error } = await supabase
                        .from('llaveros') 
                        .insert([{ telefono_usuario: from, estado: 'reporte_extravio', fecha_registro: new Date() }]);

                    if (error) {
                        console.error('❌ Error Supabase Opcion 3:', error.message);
                        await enviarMensajeWhatsApp(from, "⚠️ Hubo un problema técnico. Por favor, intenta de nuevo.");
                    } else {
                        await enviarMensajeWhatsApp(from, "🚨 Lamentamos el inconveniente. Vamos a ayudarte a encontrarlo. Por favor, ingresá el código de tu llavero extraviado.");
                    }
                }
                
                else {
                    await enviarMensajeWhatsApp(from, "🤖 No entendí esa opción. Escribí *Hola* para volver al menú principal.");
                }                    const { error } = await supabase
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
// 3. ENDPOINT DE PRUEBA SIMULADA (Para saltear a Meta temporalmente)
app.get('/debug-test', async (req, res) => {
    const numeroPrueba = "5491123456789"; // Un número de teléfono simulado
    console.log(`🧪 SIMULACIÓN -> Forzando registro de llavero para ${numeroPrueba}`);
    
    // Intentamos inyectar el dato en Supabase exactamente como lo haría el bot
    const { data, error } = await supabase
        .from('llaveros') 
        .insert([
            { 
                telefono_usuario: numeroPrueba, 
                estado: 'proceso_registro_simulado',
                fecha_registro: new Date()
            }
        ]);

    if (error) {
        console.error('❌ Error en simulación de Supabase:', error.message);
        return res.status(500).json({ status: "Error", detalle: error.message });
    }
    
    return res.json({ 
        status: "Éxito", 
        mensaje: "Se envió la orden de guardado a Supabase correctamente.",
        datos_enviados: { telefono_usuario: numeroPrueba }
    });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor GFinder 100% interactivo corriendo en puerto ${PORT}`);
});
