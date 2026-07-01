const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';

// CONEXIONES
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// FUNCIÓN PARA VALIDAR EL DÍGITO VERIFICADOR (ALGORITMO GFINDER)
function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
    // Expresión regular: 3 letras (A-Z), 4 números, 1 letra verificadora (A-Z) = 8 caracteres
    const regexFormato = /^[A-Z]{3}[0-9]{4}[A-Z]$/;
    if (!regexFormato.test(clean)) return false;

    const letras = clean.substring(0, 3);
    const numeros = clean.substring(3, 7);
    const digitoRecibido = clean.charAt(7);

    // Algoritmo matemático para calcular el dígito verificador teórico
    let suma = 0;
    // Ponderar las letras según su posición en el abecedario (A=1, B=2...)
    for (let i = 0; i < 3; i++) {
        suma += (letras.charCodeAt(i) - 64) * (i + 1);
    }
    // Ponderar los números
    for (let i = 0; i < 4; i++) {
        suma += parseInt(numeros.charAt(i)) * (i + 4);
    }

    // Convertir el resultado de la suma en una letra verificadora (A-Z)
    const resto = (suma % 26);
    const digitoTeorico = String.fromCharCode(65 + resto); // 65 es 'A' en ASCII

    return digitoRecibido === digitoTeorico;
}

// FUNCIÓN PARA ENVIAR WHATSAPP
async function enviarMensajeWhatsApp(telefonoDestino, textoEnviar) {
    const url = `https://graph.facebook.com/v25.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: telefonoDestino,
        type: "text",
        text: { preview_url: false, body: textoEnviar }
    };

    try {
        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`📤 Mensaje enviado a [${telefonoDestino}]`);
    } catch (error) {
        console.error('❌ Error enviando mensaje por Meta:', error.response?.data || error.message);
    }
}

// 1. ENDPOINT DE VERIFICACIÓN (WEBHOOK)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.status(403).sendStatus(403);
});

// 2. ENDPOINT PRINCIPAL
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages[0]) {
            const messageData = messages[0];
            const from = messageData.from; 

            if (messageData.type === 'text') {
                const text = messageData.text.body.trim().toUpperCase();
                console.log(`💬 Mensaje entrante de [${from}]: "${text}"`);

                // Buscar si este usuario ya inició un proceso que no esté completado
                const { data: usuarioProceso, error: errorBuscar } = await supabase
                    .from('llaveros')
                    .select('*')
                    .eq('telefono_usuario', from)
                    .neq('estado', 'completado')
                    .order('fecha_registro', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                // SI NO TIENE NINGÚN PROCESO ACTIVO -> LE MOSTRAMOS EL MENÚ PRINCIPAL
                if (!usuarioProceso) {
                    if (text === 'HOLA' || text === 'MENU' || text === 'INICIO') {
                        const menuTexto = `¡Bienvenido a *GFinder*! 🔑🔍\n\nPor favor, elegí una opción respondiendo con el número:\n\n*1.* Registrar mi llavero nuevo.\n*2.* Encontré un llavero perdido.\n*3.* Reportar mi llavero extraviado.`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                    } else if (text === '1') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "💾 ¡Perfecto! Vamos a registrar tu llavero. Por favor, ingresá el código de 8 caracteres (ejemplo: ABC1234X).");
                    } else if (text === '2') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🔍 ¡Muchas gracias por tu solidaridad! Por favor, ingresá el código de 8 caracteres que figura en el llavero encontrado.");
                    } else if (text === '3') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_extravio', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🚨 Vamos a ayudarte a encontrarlo. Por favor, ingresá el código de 8 caracteres de tu llavero extraviado.");
                    } else {
                        await enviarMensajeWhatsApp(from, "🤖 Hola! Para comenzar escribe *Hola* para ver nuestro menú de opciones.");
                    }
                } 
                
                // SI YA TIENE UN PROCESO ACTIVO -> EL MENSAJE ES EL CÓDIGO DEL LLAVERO
                else {
                    // Si el usuario quiere cancelar el flujo actual
                    if (text === 'CANCELAR' || text === 'HOLA' || text === 'MENU') {
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id); // Borramos el estado incompleto
                        const menuTexto = `Fluxo cancelado. Volvemos al menú principal:\n\n*1.* Registrar mi llavero nuevo.\n*2.* Encontré un llavero perdido.\n*3.* Reportar mi llavero extraviado.`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    // Validamos la autenticidad matemática del código
                    const esCodigoValido = validarCodigoGFinder(text);

                    if (!esCodigoValido) {
                        await enviarMensajeWhatsApp(from, "❌ *Código inválido o mal tipeado.*\n\nVerificá que tenga 3 letras, 4 números y la letra final de control (Ej: ABC1234X). Si querés volver al inicio, escribí *Cancelar*.");
                    } else {
                        // El código pasó el filtro de seguridad, lo guardamos y cerramos el caso
                        let respuestaFinal = "";
                        if (usuarioProceso.estado === 'esperando_codigo_registro') {
                            respuestaFinal = "🎉 ¡Espectacular! Tu llavero ha sido registrado con éxito. Tu información ya está protegida en nuestro sistema.";
                        } else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                            respuestaFinal = "🤝 ¡Código verificado! Registramos el hallazgo. Si el dueño reporta el extravío, el sistema los conectará de inmediato. ¡Gracias!";
                        } else if (usuarioProceso.estado === 'esperando_codigo_extravio') {
                            respuestaFinal = "🚨 Reporte de extravío asentado correctamente. Si alguien encuentra tu llavero y lo reporta, te avisaremos al instante por este medio.";
                        }

                        // Actualizamos la fila en Supabase con el código real y el estado completado
                        await supabase
                            .from('llaveros')
                            .update({ codigo_llavero: text, estado: 'completado' })
                            .eq('id', usuarioProceso.id);

                        await enviarMensajeWhatsApp(from, respuestaFinal);
                    }
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor GFinder Inteligente corriendo en puerto ${PORT}`);
});
