const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// FUNCIÓN PARA VALIDAR FORMATO (Excluye letras conflictivas: I, O, Q, S, Z)
function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
    const regexFormato = /^[A-HJKLNPRT-VX-Y]{2}[0-9]{4}[A-HJKLNPRT-VX-Y]{2}$/;
    return regexFormato.test(clean); 
}

// FUNCIÓN PARA CALCULAR DISTANCIA (Fórmula Haversine)
// Devuelve la distancia en kilómetros entre dos coordenadas
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

            if (value.statuses || from === process.env.WA_PHONE_NUMBER_ID) {
                return res.status(200).send('EVENT_RECEIVED');
            }

            // 📩 CONTROL DE RESPUESTA INTERNA DEL DUEÑO (Si empieza con H espacio)
            if (messageData.type === 'text') {
                const textoPlano = messageData.text.body.trim();
                if (textoPlano.toUpperCase().startsWith('H ')) {
                    const mensajeHaciaFinder = textoPlano.substring(2).trim();
                    
                    // Buscar qué llavero le pertenece a este número que está respondiendo
                    const { data: llaveroDueño } = await supabase
                        .from('llaveros')
                        .select('codigo_llavero')
                        .eq('telefono_usuario', from)
                        .eq('estado', 'completado')
                        .order('fecha_registro', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (llaveroDueño) {
                        // Buscar quién fue la última persona que inició el reporte de encuentro de ese llavero
                        const { data: reporteEncuentro } = await supabase
                            .from('llaveros')
                            .select('telefono_usuario')
                            .eq('codigo_llavero', llaveroDueño.codigo_llavero)
                            .eq('estado', 'completado')
                            .not('telefono_usuario', 'eq', from) // Que no sea el dueño mismo
                            .order('fecha_registro', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (reporteEncuentro && reporteEncuentro.telefono_usuario) {
                            const textoFinal = `💬 *El dueño del llavero te responde:*\n\n"${mensajeHaciaFinder}"\n\n_Podés seguir respondiendo este chat iniciando tu mensaje con H (ejemplo: H perfecto, te espero)._`;
                            await enviarMensajeWhatsApp(reporteEncuentro.telefono_usuario, textoFinal);
                            await enviarMensajeWhatsApp(from, "✅ Tu mensaje fue enviado al Finder de forma anónima.");
                            return res.status(200).send('EVENT_RECEIVED');
                        }
                    }
                    await enviarMensajeWhatsApp(from, "⚠️ No pudimos canalizar tu mensaje. Asegurate de que el Finder haya elegido hablar con vos primero.");
                    return res.status(200).send('EVENT_RECEIVED');
                }
            }

            // Buscar si hay algún proceso de menú abierto
            let { data: usuarioProceso } = await supabase
                .from('llaveros')
                .select('*')
                .eq('telefono_usuario', from)
                .neq('estado', 'completado')
                .order('fecha_registro', { ascending: false })
                .limit(1)
                .maybeSingle();

            // ⏱️ REGLA: TIMEOUT DE 1 MINUTO
            if (usuarioProceso && usuarioProceso.ultima_interaccion) {
                const ahora = new Date();
                const ultimaInteraccion = new Date(usuarioProceso.ultima_interaccion);
                const diferenciaSegundos = Math.floor((ahora - ultimaInteraccion) / 1000);

                if (diferenciaSegundos > 60) {
                    await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                    usuarioProceso = null; 
                    console.log(`⏱️ Timeout de 1 minuto cumplido para [${from}].`);
                }
            }

            // 🗺️ PROCESAMIENTO DE GEOLOCALIZACIÓN (Si el usuario mandó una ubicación)
            if (messageData.type === 'location' && usuarioProceso && usuarioProceso.estado === 'esperando_ubicacion_finder') {
                const latFinder = messageData.location.latitude;
                const lonFinder = messageData.location.longitude;

                // Traer todas las sucursales de Supabase
                const { data: sucursales } = await supabase.from('sucursales').select('*');

                if (!sucursales || sucursales.length === 0) {
                    await enviarMensajeWhatsApp(from, "📍 Podés acercar el llavero a cualquier estación oficial de AXION. (Error: No hay sucursales cargadas).");
                } else {
                    let sucursalMasCercana = null;
                    let distanciaMinima = Infinity;

                    sucursales.forEach(suc => {
                        if (suc.latitud && sec.longitud) {
                            const dist = calcularDistancia(latFinder, lonFinder, parseFloat(suc.latitud), parseFloat(suc.longitud));
                            if (dist < distanciaMinima) {
                                distanciaMinima = dist;
                                sucursalMasCercana = suc;
                            }
                        }
                    });

                    if (sucursalMasCercana) {
                        await enviarMensajeWhatsApp(from, `📍 ¡Excelente! La estación AXION más cercana a tu posición es:\n\n🏠 *${sucursalMasCercana.direccion}*\n🏁 Está a aprox. ${distanciaMinima.toFixed(1)} km de vos. El personal te recibirá el llavero de inmediato. ¡Muchas gracias!`);
                    } else {
                        await enviarMensajeWhatsApp(from, `📍 La sucursal configurada más cercana es:\n\n🏠 *${sucursales[0].direccion}*\n\n¡Muchas gracias por acercarte!`);
                    }
                }

                await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                return res.status(200).send('EVENT_RECEIVED');
            }

            // PROCESAMIENTO DE TEXTO NORMAL DEL MENÚ
            if (messageData.type === 'text') {
                const text = messageData.text.body.trim();
                const textUpper = text.toUpperCase();

                // MENÚ PRINCIPAL
                if (!usuarioProceso) {
                    if (textUpper === 'HOLA' || textUpper === 'MENU' || textUpper === 'INICIO' || textUpper === 'CANCELAR') {
                        const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nPor favor, seleccioná una opción respondiendo con la letra correspondiente:\n\n*A.* Activar un nuevo llavero\n*E.* Encontré un llavero\n*C.* Consultas o Reclamos`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                    } 
                    else if (textUpper === 'A') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "💾 ¡Perfecto! Vamos a registrar tu llavero. Por favor, ingresá el código de 8 caracteres (ejemplo: AA0000AB).");
                    } 
                    else if (textUpper === 'E') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🔍 ¡Muchas gracias por reportarlo! Por favor, indícanos el código de 8 caracteres del llavero encontrado.");
                    } 
                    else if (textUpper === 'C') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_texto_soporte', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🩺 *Canal de Consultas y Reclamos*\n\nPor favor, escribí en un solo mensaje detalladamente tu consulta, inconveniente o cambio de datos que necesites:");
                    }
                    else if (textUpper === '9') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_sucursal_personal', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "⛽ *Acceso Personal AXION*\n\nPor favor, ingresá el número de sucursal (4 dígitos):");
                    } 
                    else {
                        await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú de opciones por letras.");
                    }
                } 
                
                // SUBMENÚS CON PROCESOS ACTIVOS
                else {
                    await supabase.from('llaveros').update({ ultima_interaccion: new Date() }).eq('id', usuarioProceso.id);

                    if (textUpper === 'CANCELAR' || textUpper === 'MENU') {
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🔄 Proceso cancelado. Escribí *Hola* para volver a empezar.");
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    // OPCIÓN A: FLUJO DE ALTA
                    if (usuarioProceso.estado === 'esperando_codigo_registro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido o contiene letras prohibidas (I, O, Q, S, Z). Intentá de nuevo:");
                        } else {
                            const { data: existente } = await supabase.from('llaveros').select('id').eq('codigo_llavero', textUpper).eq('estado', 'completado');
                            if (existente && existente.length > 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ Este código ya se encuentra activado por otro usuario. Si crees que es un error, seleccioná la Opción C en el menú principal.");
                                await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_nombre_registro' }).eq('id', usuarioProceso.id);
                                await enviarMensajeWhatsApp(from, "👤 ¡Código verificado! Ahora decinos: ¿Cómo es tu nombre para dirigirnos a vos?");
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_nombre_registro') {
                        await supabase.from('llaveros').update({ nombre_usuario: text, estado: 'esperando_celular_alternativo' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, `🤝 Gracias ${text}. Por último, ingresá un número de teléfono alternativo:`);
                    }
                    else if (usuarioProceso.estado === 'esperando_celular_alternativo') {
                        await supabase.from('llaveros').update({ telefono_alternativo: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🎉 ¡Espectacular! Tu llavero ha sido activado con éxito.");
                    }

                    // OPCIÓN E: ENCONTRÉ LLAVERO
                    else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Recordá el formato AA0000AB. Intentá de nuevo:");
                        } else {
                            const { data: activados } = await supabase.from('llaveros').select('*').eq('codigo_llavero', textUpper).eq('estado', 'completado');

                            if (!activados || activados.length === 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código ingresado no corresponde a un llavero activo en nuestro sistema. Por favor, verifícalo e ingresalo de nuevo:");
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id);
                                
                                // 🔔 ALERTA INMEDIATA AL DUEÑO
                                const dueñoLegitimo = activados[0];
                                const nombrePropietario = dueñoLegitimo.nombre_usuario ? ` *${dueñoLegitimo.nombre_usuario}*` : "";
                                const alertaInmediata = `🚨 *¡Alerta de GFinder AXION!*\n\nHola${nombrePropietario}, alguien acaba de ingresar el código de tu llavero *${textUpper}* en el sistema. Te notificaremos de inmediato en cuanto defina si lo dejará en una sucursal o si te enviará un mensaje directo.`;
                                await enviarMensajeWhatsApp(dueñoLegitimo.telefono_usuario, alertaInmediata);

                                const subMenuEncuentro = `✅ ¡Llavero localizado!\n\n¿Qué deseas hacer ahora? Selecciona la letra correspondiente:\n\n*D.* Ver dónde devolverlo\n*H.* Hablar de forma segura con el dueño`;
                                await enviarMensajeWhatsApp(from, subMenuEncuentro);
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_subopcion_encuentro') {
                        if (textUpper === 'D') {
                            await supabase.from('llaveros').update({ estado: 'esperando_ubicacion_finder' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📍 Por favor, compartinos tu ubicación actual mediante el botón de adjuntar (Clip ➡️ Ubicación) de WhatsApp y te indicaremos la estación AXION más cercana:");
                        } else if (textUpper === 'H') {
                            await supabase.from('llaveros').update({ estado: 'esperando_mensaje_anonimo' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📝 Escribí en un solo mensaje el texto que querés hacerle llegar al dueño de forma segura:");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Opción inválida. Respondé con *D* (Devolverlo) o *H* (Hablar).");
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_mensaje_anonimo') {
                        const { data: dueños } = await supabase.from('llaveros').select('*').eq('codigo_llavero', usuarioProceso.codigo_llavero).eq('estado', 'completado');

                        if (dueños && dueños.length > 0) {
                            const dueñoOriginal = dueños[0];
                            const mensajeAlDueño = `💬 *Mensaje de la persona que tiene tu llavero [${usuarioProceso.codigo_llavero}]:*\n\n"${text}"\n\n⚠️ *¿Querés responderle?:* Podés contestarle de forma directa y segura respondiendo a este mismo chat iniciando tu mensaje con la letra *H* seguida de un espacio (Ejemplo: H Hola, muchas gracias, ¿dónde nos vemos?)`;
                            await enviarMensajeWhatsApp(dueñoOriginal.telefono_usuario, mensajeAlDueño);
                        }

                        // Al completar el proceso, guardamos el teléfono del finder en la fila del proceso para futuras referencias cruzadas
                        await supabase.from('llaveros').update({ estado: 'completado', telefono_finder: from }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "📲 Tu mensaje ha sido transmitido al dueño del llavero de forma segura. Si el dueño te responde, te llegará un aviso por acá. ¡Muchas gracias!");
                    }

                    // OPCIÓN C: RECLAMOS
                    else if (usuarioProceso.estado === 'esperando_texto_soporte') {
                        await supabase.from('soporte').insert([{ telefono_usuario: from, mensaje: text }]);
                        await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "✅ Tu consulta ha sido registrada. Nos pondremos en contacto a este número a la brevedad.");
                    }

                    // OPCIÓN 9: ACCESO SUCURSAL PERSONAL
                    else if (usuarioProceso.estado === 'esperando_sucursal_personal') {
                        const regexSucursal = /^[0-9]{4}$/;
                        if (!regexSucursal.test(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ La sucursal debe ser de 4 números. Intentá de nuevo:");
                        } else {
                            await supabase.from('llaveros').update({ estado: `esperando_codigo_personal_suc_${textUpper}` }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${textUpper}] registrada.\n\nAhora, ingresá el código de 8 caracteres del llavero:`);
                        }
                    }
                    else if (usuarioProceso.estado.startsWith('esperando_codigo_personal_suc_')) {
                        const sucursalId = usuarioProceso.estado.replace('esperando_codigo_personal_suc_', '');
                        
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Por favor, ingresalo de nuevo:");
                        } else {
                            const { data: dueños } = await supabase.from('llaveros').select('*').eq('codigo_llavero', textUpper).eq('estado', 'completado');

                            if (!dueños || dueños.length === 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código de llavero ingresado no existe o no está registrado como activo.");
                            } else {
                                const dueñoLlavero = dueños[0];
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'completado' }).eq('id', usuarioProceso.id);
                                await enviarMensajeWhatsApp(from, `⚙️ Custodia completada para Sucursal ${sucursalId}.`);

                                const { data: filasSucursal } = await supabase.from('sucursales').select('direccion').eq('id_sucursal', sucursalId.toString().trim());
                                const direccionEstacion = (filasSucursal && filasSucursal.length > 0) ? filasSucursal[0].direccion : `Sucursal N° ${sucursalId}`;

                                const codigoRetiro = Math.floor(1000 + Math.random() * 9000);
                                const nombrePropietario = dueñoLlavero.nombre_usuario ? ` *${dueñoLlavero.nombre_usuario}*` : "";

                                const mensajeDueño = `🚨 *¡Buenas noticias de GFinder AXION!*\n\nHola${nombrePropietario}, tu llavero con código *${textUpper}* fue entregado en una sucursal.\n\n📍 *¿Dónde retirar?:* ${direccionEstacion}\n🔑 *Código de Retiro Secreto:* ${codigoRetiro}`;
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
    console.log(`🚀 Servidor GFinder Letras y Chat Bidireccional corriendo en puerto ${PORT}`);
});
