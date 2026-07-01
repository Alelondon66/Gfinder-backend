const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';

// CONEXIONES
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// FUNCIÓN PARA VALIDAR FORMATO (Excluye letras conflictivas: I, O, Q, S, Z)
function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
    // Expresión regular: 2 letras válidas, 4 números, 2 letras válidas
    const regexFormato = /^[A-HJKLNPRT-VX-Y]{2}[0-9]{4}[A-HJKLNPRT-VX-Y]{2}$/;
    return regexFormato.test(clean); 
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
        console.error('❌ Error Meta:', error.response?.data || error.message);
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

            // Filtro contra bucles
            if (value.statuses || from === process.env.WA_PHONE_NUMBER_ID) {
                return res.status(200).send('EVENT_RECEIVED');
            }

            if (messageData.type === 'text') {
                const text = messageData.text.body.trim().toUpperCase();
                console.log(`💬 Mensaje de [${from}]: "${text}"`);

                const { data: usuarioProceso } = await supabase
                    .from('llaveros')
                    .select('*')
                    .eq('telefono_usuario', from)
                    .neq('estado', 'completado')
                    .order('fecha_registro', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                // MENÚ PRINCIPAL
                if (!usuarioProceso) {
                    if (text === 'HOLA' || text === 'MENU' || text === 'INICIO' || text === 'CANCELAR') {
                        const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nPor favor, elegí una opción respondiendo con el número:\n\n*1.* Activar llavero\n*2.* Encontré un llavero`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                    } 
                    else if (text === '1') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "💾 ¡Perfecto! Vamos a registrar tu llavero. Por favor, ingresá el código de 8 caracteres (ejemplo: AA0000AB).");
                    } 
                    else if (text === '2') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🔍 ¡Muchas gracias por reportarlo! Por favor, indícanos el código de 8 caracteres del llavero encontrado.");
                    } 
                    else if (text === '9') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_sucursal_personal', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "⛽ *Acceso Personal AXION*\n\nPor favor, ingresá el número de sucursal (4 dígitos):");
                    } 
                    else {
                        await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú de opciones.");
                    }
                } 
                
                // SUBMENÚS ACTIVOS
                else {
                    if (text === 'CANCELAR' || text === 'MENU') {
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🔄 Proceso cancelado. Escribí *Hola* para volver a empezar.");
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    // OPCIÓN 1: ACTIVAR
                    if (usuarioProceso.estado === 'esperando_codigo_registro') {
                        if (!validarCodigoGFinder(text)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido o contiene letras no permitidas (I, O, Q, S, Z). Intentá de nuevo:");
                        } else {
                            await supabase.from('llaveros').update({ codigo_llavero: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "🎉 ¡Espectacular! Tu llavero ha sido activado con éxito. Tu información ya está protegida.");
                        }
                    }

                    // OPCIÓN 2: ENCONTRÉ
                    else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                        if (!validarCodigoGFinder(text)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Recordá que no se usan las letras I, O, Q, S, Z. Intentá de nuevo:");
                        } else {
                            await supabase.from('llaveros').update({ codigo_llavero: text, estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id);
                            const subMenuEncuentro = `✅ ¡Código verificado!\n\n¿Qué deseas hacer ahora? Selecciona el número:\n\n*1.* Donde devolverlo\n*2.* Contactar al dueño`;
                            await enviarMensajeWhatsApp(from, subMenuEncuentro);
                        }
                    }

                    // OPCIÓN 2.1: SUBMENÚ ENCONTRÉ
                    else if (usuarioProceso.estado === 'esperando_subopcion_encuentro') {
                        if (text === '1') {
                            await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📍 Podés acercar el llavero a cualquiera de nuestras estaciones de servicio AXION oficiales. ¡El personal se encargará del resto! Muchas gracias.");
                        } else if (text === '2') {
                            await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📲 Entendido. El sistema procesará la solicitud de forma segura. ¡Gracias por tu enorme ayuda!");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Opción inválida. Respondé con *1* o *2*.");
                        }
                    }

                    // OPCIÓN 9: SUCURSAL (PERSONAL)
                    else if (usuarioProceso.estado === 'esperando_sucursal_personal') {
                        const regexSucursal = /^[0-9]{4}$/;
                        if (!regexSucursal.test(text)) {
                            await enviarMensajeWhatsApp(from, "❌ El número de sucursal debe ser exactamente de 4 números. Intentá de nuevo:");
                        } else {
                            await supabase.from('llaveros').update({ estado: `esperando_codigo_personal_suc_${text}` }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${text}] registrada.\n\nAhora, ingresá el código de 8 caracteres del llavero custodiado:`);
                        }
                    }

                    // OPCIÓN 9.1: CÓDIGO FINAL DE SUCURSAL -> ALERTA AL DUEÑO
                    else if (usuarioProceso.estado.startsWith('esperando_codigo_personal_suc_')) {
                        const sucursalId = usuarioProceso.estado.replace('esperando_codigo_personal_suc_', '');
                        
                        if (!validarCodigoGFinder(text)) {
                            await enviarMensajeWhatsApp(from, "❌ Código de llavero inválido. Por favor, ingresalo de nuevo:");
                        } else {
                            // 1. Guardar el registro del playero
                            await supabase.from('llaveros').update({ codigo_llavero: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, `⚙️ Registro completado para Sucursal ${sucursalId}. Buscando al dueño...`);

                            // 2. Buscar la dirección de la sucursal en Supabase
                            const { data: datosSucursal } = await supabase
                                .from('sucursales')
                                .select('direccion')
                                .eq('id_sucursal', sucursalId)
                                .maybeSingle();

                            const direccionEstacion = datosSucursal?.direccion || `Sucursal N° ${sucursalId}`;

                            // 3. Buscar si el dueño real está registrado con ese código de llavero
                            const { data: dueñoLlavero } = await supabase
                                .from('llaveros')
                                .select('telefono_usuario')
                                .eq('codigo_llavero', text)
                                .eq('estado', 'completado')
                                .order('fecha_registro', { ascending: false })
                                .limit(1)
                                .maybeSingle();

                            if (dueñoLlavero && dueñoLlavero.telefono_usuario) {
                                // 4. Generar código aleatorio de retiro (Ej: 4721)
                                const codigoRetiro = Math.floor(1000 + Math.random() * 9000);
                                
                                // 5. Enviar mensaje automático al dueño original
                                const mensajeDueño = `🚨 *¡Buenas noticias de GFinder AXION!*\n\nTu llavero con código *${text}* fue encontrado y ya se encuentra resguardado de forma segura.\n\n📍 *¿Dónde retirar?:* ${direccionEstacion}\n🔑 *Código de Retiro Secreto:* ${codigoRetiro}\n\nPresentale este código al personal de la estación para que te hagan la entrega. ¡Nos alegra ayudarte!`;
                                
                                await enviarMensajeWhatsApp(dueñoLlavero.telefono_usuario, mensajeDueño);
                                console.log(`📢 Notificación enviada con éxito al dueño: ${dueñoLlavero.telefono_usuario}`);
                            } else {
                                console.log(`⚠️ El código ${text} fue recibido en la sucursal, pero no tiene un dueño registrado en la app.`);
                            }
                        }
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
    console.log(`🚀 Servidor GFinder Automatizado corriendo en puerto ${PORT}`);
});
