const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = reportJson = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// FUNCIÓN PARA VALIDAR FORMATO (Excluye letras conflictivas: I, O, Q, S, Z)
function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
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
                const text = messageData.text.body.trim();
                const textUpper = text.toUpperCase();
                console.log(`💬 Mensaje de [${from}]: "${text}"`);

                // Buscar si hay algún proceso activo
                let { data: usuarioProceso } = await supabase
                    .from('llaveros')
                    .select('*')
                    .eq('telefono_usuario', from)
                    .neq('estado', 'completado')
                    .order('fecha_registro', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                // ⏱️ REGLA 1: CONTROL DE TIMEOUT (1 MINUTO)
                if (usuarioProceso && usuarioProceso.ultima_interaccion) {
                    const ahora = new Date();
                    const ultimaInteraccion = new Date(usuarioProceso.ultima_interaccion);
                    const diferenciaSegundos = Math.floor((ahora - ultimaInteraccion) / 1000);

                    if (diferenciaSegundos > 60) {
                        // Pasó más de un minuto, borramos el proceso incompleto para resetear
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                        usuarioProceso = null; 
                        console.log(`⏱️ Timeout activado para [${from}]. Se limpia el estado anterior.`);
                    }
                }

                // MENÚ PRINCIPAL
                if (!usuarioProceso) {
                    if (textUpper === 'HOLA' || textUpper === 'MENU' || textUpper === 'INICIO' || textUpper === 'CANCELAR') {
                        const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nPor favor, elegí una opción respondiendo con el número:\n\n*1.* Activar llavero\n*2.* Encontré un llavero\n*3.* Consultas o Reclamos`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                    } 
                    else if (textUpper === '1') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "💾 ¡Perfecto! Vamos a registrar tu llavero. Por favor, ingresá el código de 8 caracteres (ejemplo: AA0000AB).");
                    } 
                    else if (textUpper === '2') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🔍 ¡Muchas gracias por reportarlo! Por favor, indícanos el código de 8 caracteres del llavero encontrado.");
                    } 
                    else if (textUpper === '3') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_texto_soporte', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🩺 *Canal de Consultas y Reclamos*\n\nPor favor, escribí en un solo mensaje detalladamente tu consulta, inconveniente o cambio de datos que necesites:");
                    }
                    else if (textUpper === '9') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_sucursal_personal', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "⛽ *Acceso Personal AXION*\n\nPor favor, ingresá el número de sucursal (4 dígitos):");
                    } 
                    else {
                        await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú de opciones.");
                    }
                } 
                
                // SUBMENÚS CON PROCESOS ACTIVOS
                else {
                    // Actualizar la hora de última interacción en cada paso para mantener el minuto activo
                    await supabase.from('llaveros').update({ ultima_interaccion: new Date() }).eq('id', usuarioProceso.id);

                    if (textUpper === 'CANCELAR' || textUpper === 'MENU') {
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🔄 Proceso cancelado. Escribí *Hola* para volver a empezar.");
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    // ==========================================
                    // OPCIÓN 1: FLUJO DE ALTA (PASO A PASO)
                    // ==========================================
                    if (usuarioProceso.estado === 'esperando_codigo_registro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido o contiene letras prohibidas (I, O, Q, S, Z). Intentá de nuevo:");
                        } else {
                            // Verificar que el llavero no esté activado previamente
                            const { data: existente } = await supabase
                                .from('llaveros')
                                .select('id')
                                .eq('codigo_llavero', textUpper)
                                .eq('estado', 'completado')
                                .maybeSingle();

                            if (existente) {
                                await enviarMensajeWhatsApp(from, "⚠️ Este código de llavero ya se encuentra activado por otro usuario. Si crees que es un error, por favor comunícate con soporte técnico (Opción 3).");
                                await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_nombre_registro' }).eq('id', usuarioProceso.id);
                                await enviarMensajeWhatsApp(from, "👤 ¡Código verificado! Ahora decinos: ¿Cómo es tu nombre para dirigirnos a vos?");
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_nombre_registro') {
                        await supabase.from('llaveros').update({ nombre_usuario: text, estado: 'esperando_celular_alternativo' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, `🤝 Gracias ${text}. Por último, ingresá un número de teléfono alternativo (de un familiar o amigo) por seguridad en caso de que pierdas tu propio celular:`);
                    }
                    else if (usuarioProceso.estado === 'esperando_celular_alternativo') {
                        await supabase.from('llaveros').update({ telefono_alternativo: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🎉 ¡Espectacular! Tu llavero ha sido activado con éxito, y tus datos de contacto alternativos guardados. Ya estás protegido.");
                    }

                    // ==========================================
                    // OPCIÓN 2: ENCONTRÉ LLAVERO
                    // ==========================================
                    else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Revisalo e intentá de nuevo:");
                        } else {
                            // Verificar si existe el dueño en la base de datos
                            const { data: dueñoLlavero } = await supabase
                                .from('llaveros')
                                .select('*')
                                .eq('codigo_llavero', textUpper)
                                .eq('estado', 'completado')
                                .maybeSingle();

                            if (!dueñoLlavero) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código ingresado no corresponde a un llavero activo en nuestro sistema. Por favor, verifícalo e ingresalo de nuevo:");
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id);
                                const subMenuEncuentro = `✅ ¡Llavero localizado en el sistema!\n\n¿Qué deseas hacer ahora? Selecciona el número:\n\n*1.* Donde devolverlo\n*2.* Contactar al dueño`;
                                await enviarMensajeWhatsApp(from, subMenuEncuentro);
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_subopcion_encuentro') {
                        if (textUpper === '1') {
                            await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📍 Podés acercar el llavero a cualquiera de nuestras estaciones de servicio AXION oficiales. ¡El personal se encargará del resto! Muchas gracias por tu honestidad.");
                        } else if (textUpper === '2') {
                            await supabase.from('llaveros').update({ estado: 'esperando_mensaje_anonimo' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📝 Escribí en un solo mensaje el texto que querés hacerle llegar al dueño de forma segura (ejemplo: 'Tengo tus llaves, podemos vernos en la plaza principal'):");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Opción inválida. Respondé con *1* o *2*.");
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_mensaje_anonimo') {
                        // TRIANGULACIÓN: Enviar el mensaje anónimo del Finder al Dueño
                        const { data: dueñoOriginal } = await supabase
                            .from('llaveros')
                            .select('telefono_usuario, nombre_usuario')
                            .eq('codigo_llavero', usuarioProceso.codigo_llavero)
                            .eq('estado', 'completado')
                            .maybeSingle();

                        if (dueñoOriginal) {
                            const saludoNombre = dueñoOriginal.nombre_usuario ? ` *${dueñoOriginal.nombre_usuario}*` : "";
                            const mensajeAlDueño = `🚨 *¡Buenas noticias de GFinder AXION!*\n\nHola${saludoNombre}, la persona que encontró tu llavero *${usuarioProceso.codigo_llavero}* te ha enviado el siguiente mensaje meditado:\n\n💬 _"${text}"_\n\n⚠️ _Para responderle a la persona, podés hacerlo iniciando soporte técnico (Opción 3) en nuestro menú._`;
                            
                            await enviarMensajeWhatsApp(dueñoOriginal.telefono_usuario, mensajeAlDueño);
                        }

                        await supabase.from('llaveros').update({ estado: 'completado', telefono_finder: from }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "📲 Tu mensaje ha sido transmitido al dueño del llavero de forma segura y anónima. ¡Muchas gracias por tu enorme ayuda!");
                    }

                    // ==========================================
                    // OPCIÓN 3: RECLAMOS Y SOPORTE
                    // ==========================================
                    else if (usuarioProceso.estado === 'esperando_texto_soporte') {
                        // Guardar en la nueva tabla 'soporte'
                        await supabase.from('soporte').insert([
                            { telefono_usuario: from, mensaje: text, fecha_creacion: new Date() }
                        ]);

                        await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "✅ Tu consulta/reclamo ha sido registrado correctamente. Un operador revisará tu caso y se pondrá en contacto con vos a este número a la brevedad. ¡Gracias!");
                    }

                    // ==========================================
                    // OPCIÓN 9: ACCESO SUCURSAL PERSONAL
                    // ==========================================
                    else if (usuarioProceso.estado === 'esperando_sucursal_personal') {
                        const regexSucursal = /^[0-9]{4}$/;
                        if (!regexSucursal.test(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ El número de sucursal debe ser exactamente de 4 números. Intentá de nuevo:");
                        } else {
                            await supabase.from('llaveros').update({ estado: `esperando_codigo_personal_suc_${textUpper}` }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${textUpper}] registrada.\n\nAhora, ingresá el código de 8 caracteres del llavero custodiado:`);
                        }
                    }
                    else if (usuarioProceso.estado.startsWith('esperando_codigo_personal_suc_')) {
                        const sucursalId = usuarioProceso.estado.replace('esperando_codigo_personal_suc_', '');
                        
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código de llavero inválido. Por favor, ingresalo de nuevo:");
                        } else {
                            // Verificar que el llavero esté registrado en la base de datos
                            const { data: dueñoLlavero } = await supabase
                                .from('llaveros')
                                .select('telefono_usuario, nombre_usuario')
                                .eq('codigo_llavero', textUpper)
                                .eq('estado', 'completado')
                                .maybeSingle();

                            if (!dueñoLlavero) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código de llavero ingresado no existe o no está registrado como activo en la base de datos central. Revisalo:");
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'completado' }).eq('id', usuarioProceso.id);
                                await enviarMensajeWhatsApp(from, `⚙️ Custodia completada para Sucursal ${sucursalId}. Alertas procesadas.`);

                                // Buscar la dirección de la sucursal
                                const { data: filasSucursal } = await supabase
                                    .from('sucursales')
                                    .select('direccion')
                                    .eq('id_sucursal', sucursalId.toString().trim());

                                const direccionEstacion = (filasSucursal && filasSucursal.length > 0) 
                                    ? filasSucursal[0].direccion 
                                    : `Sucursal N° ${sucursalId}`;

                                const codigoRetiro = Math.floor(1000 + Math.random() * 9000);
                                const nombrePropietario = dueñoLlavero.nombre_usuario ? ` *${dueñoLlavero.nombre_usuario}*` : "";

                                const mensajeDueño = `🚨 *¡Buenas noticias de GFinder AXION!*\n\nHola${nombrePropietario}, tu llavero con código *${textUpper}* fue entregado en una sucursal oficial.\n\n📍 *¿Dónde retirar?:* ${direccionEstacion}\n🔑 *Código de Retiro Secreto:* ${codigoRetiro}\n\nPresentale este código al personal de la estación para retirar tus pertenencias de inmediato. ¡Nos alegra ayudarte!`;
                                
                                await enviarMensajeWhatsApp(dueñoLlavero.telefono_usuario, mensajeDueño);
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
    console.log(`🚀 Servidor GFinder Inteligente Inteligente corriendo en puerto ${PORT}`);
});
