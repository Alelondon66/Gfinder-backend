const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_VERIFY_TOKEN = 'gfinder_axion_token_seguro_2026';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
    const regexFormato = /^[A-HJKLNPRT-VX-Y]{2}[0-9]{4}[A-HJKLNPRT-VX-Y]{2}$/;
    return regexFormato.test(clean); 
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

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

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.status(403).sendStatus(403);
});

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

            if (messageData.type === 'text') {
                const textoPlano = messageData.text.body.trim();
                const textoUpper = textoPlano.toUpperCase();

                if (textoUpper === 'F') {
                    const { data: llaveroDueño } = await supabase
                        .from('llaveros')
                        .select('codigo_llavero')
                        .eq('telefono_usuario', from)
                        .eq('estado', 'completado')
                        .order('fecha_registro', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (llaveroDueño) {
                        const { data: reporteEncuentro } = await supabase
                            .from('llaveros')
                            .select('id, telefono_usuario')
                            .eq('codigo_llavero', llaveroDueño.codigo_llavero)
                            .eq('estado', 'completado')
                            .not('telefono_usuario', 'eq', from)
                            .order('fecha_registro', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (reporteEncuentro) {
                            await supabase.from('llaveros').delete().eq('id', reporteEncuentro.id);
                            await enviarMensajeWhatsApp(reporteEncuentro.telefono_usuario, "🔒 *Chat finalizado por el dueño.*");
                            await enviarMensajeWhatsApp(from, "🔒 *Chat cerrado.*");
                            return res.status(200).send('EVENT_RECEIVED');
                        }
                    }
                }

                if (textoUpper.startsWith('H ')) {
                    const mensajeHaciaFinder = textoPlano.substring(2).trim();
                    
                    const { data: llaveroDueño } = await supabase
                        .from('llaveros')
                        .select('codigo_llavero')
                        .eq('telefono_usuario', from)
                        .eq('estado', 'completado')
                        .order('fecha_registro', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (llaveroDueño) {
                        const { data: reporteEncuentro } = await supabase
                            .from('llaveros')
                            .select('telefono_usuario')
                            .eq('codigo_llavero', llaveroDueño.codigo_llavero)
                            .eq('estado', 'completado')
                            .not('telefono_usuario', 'eq', from)
                            .order('fecha_registro', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (reporteEncuentro && reporteEncuentro.telefono_usuario) {
                            // Guía breve para el Finder
                            const textoFinal = `💬 *Dueño:* "${mensajeHaciaFinder}"\n_(Responder con: H mensaje)_`;
                            await enviarMensajeWhatsApp(reporteEncuentro.telefono_usuario, textoFinal);
                            return res.status(200).send('EVENT_RECEIVED');
                        }
                    }
                    return res.status(200).send('EVENT_RECEIVED');
                }
            }

            let { data: usuarioProceso } = await supabase
                .from('llaveros')
                .select('*')
                .eq('telefono_usuario', from)
                .neq('estado', 'completado')
                .order('fecha_registro', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (usuarioProceso && usuarioProceso.ultima_interaccion) {
                const ahora = new Date();
                const ultimaInteraccion = new Date(usuarioProceso.ultima_interaccion);
                const diferenciaSegundos = Math.floor((ahora - ultimaInteraccion) / 1000);

                if (diferenciaSegundos > 60) {
                    await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                    usuarioProceso = null; 
                }
            }

            if (messageData.type === 'location' && usuarioProceso && usuarioProceso.estado === 'esperando_ubicacion_finder') {
                const latFinder = messageData.location.latitude;
                const lonFinder = messageData.location.longitude;

                const { data: sucursales } = await supabase.from('sucursales').select('*');

                if (!sucursales || sucursales.length === 0) {
                    await enviarMensajeWhatsApp(from, "📍 Acércalo a cualquier estación AXION.");
                } else {
                    let sucursalMasCercana = null;
                    let distanciaMinima = Infinity;

                    sucursales.forEach(suc => {
                        if (suc.latitud && suc.longitud) {
                            const dist = calcularDistancia(latFinder, lonFinder, parseFloat(suc.latitud), parseFloat(suc.longitud));
                            if (dist < distanciaMinima) {
                                distanciaMinima = dist;
                                sucursalMasCercana = suc;
                            }
                        }
                    });

                    if (sucursalMasCercana) {
                        await enviarMensajeWhatsApp(from, `📍 *Estación AXION más cercana:*\n\n🏠 ${sucursalMasCercana.direccion}\n🏁 A aprox. ${distanciaMinima.toFixed(1)} km.`);
                    } else {
                        await enviarMensajeWhatsApp(from, `📍 *Estación AXION:*\n\n🏠 ${sucursales[0].direccion}`);
                    }
                }

                await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                return res.status(200).send('EVENT_RECEIVED');
            }

            if (messageData.type === 'text') {
                const text = messageData.text.body.trim();
                const textUpper = text.toUpperCase();

                if (!usuarioProceso) {
                    if (textUpper === 'HOLA' || textUpper === 'MENU' || textUpper === 'INICIO' || textUpper === 'CANCELAR') {
                        const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nRespondé con la letra:\n\n*A.* Activar nuevo llavero\n*E.* Encontré un llavero\n*C.* Consultas o Reclamos`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                    } 
                    else if (textUpper === 'A') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "💾 Ingresá el código de 8 caracteres (ej: AA0000AB):");
                    } 
                    else if (textUpper === 'E') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🔍 Ingresá el código de 8 caracteres del llavero encontrado:");
                    } 
                    else if (textUpper === 'C') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_texto_soporte', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🩺 *Consultas y Reclamos*\n\nEscribí tu consulta detallada en un solo mensaje:");
                    }
                    else if (textUpper === '9') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_sucursal_personal', fecha_registro: new Date(), ultima_interaccion: new Date() }]);
                        await enviarMensajeWhatsApp(from, "⛽ *Personal AXION*\n\nIngresá el número de sucursal (4 dígitos):");
                    } 
                    else {
                        await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú.");
                    }
                } 
                else {
                    await supabase.from('llaveros').update({ ultima_interaccion: new Date() }).eq('id', usuarioProceso.id);

                    if (textUpper === 'CANCELAR' || textUpper === 'MENU') {
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🔄 Cancelado. Escribí *Hola* para reiniciar.");
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    if (usuarioProceso.estado === 'esperando_codigo_registro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo:");
                        } else {
                            const { data: existente } = await supabase.from('llaveros').select('id').eq('codigo_llavero', textUpper).eq('estado', 'completado');
                            if (existente && existente.length > 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ Código ya activado. Seleccioná la Opción C.");
                                await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_nombre_registro' }).eq('id', usuarioProceso.id);
                                await enviarMensajeWhatsApp(from, "👤 Código verificado. ¿Cómo es tu nombre?");
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_nombre_registro') {
                        await supabase.from('llaveros').update({ nombre_usuario: text, estado: 'esperando_celular_alternativo' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, `🤝 Gracias ${text}. Ingresá un teléfono alternativo:`);
                    }
                    else if (usuarioProceso.estado === 'esperando_celular_alternativo') {
                        await supabase.from('llaveros').update({ telefono_alternativo: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🎉 ¡Llavero activado con éxito!");
                    }

                    else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo:");
                        } else {
                            const { data: activados } = await supabase.from('llaveros').select('*').eq('codigo_llavero', textUpper).eq('estado', 'completado');

                            if (!activados || activados.length === 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código no corresponde a un llavero activo.");
                            } else {
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id);
                                
                                const dueñoLegitimo = activados[0];
                                const nombrePropietario = dueñoLegitimo.nombre_usuario ? ` *${dueñoLegitimo.nombre_usuario}*` : "";
                                const alertaInmediata = `🚨 *GFinder:* Hola${nombrePropietario}, ingresaron el código de tu llavero *${textUpper}*. Te avisaremos apenas definan la entrega.`;
                                await enviarMensajeWhatsApp(dueñoLegitimo.telefono_usuario, alertaInmediata);

                                const subMenuEncuentro = `✅ ¡Llavero localizado!\n\nSeleccioná:\n*D.* Ver dónde devolverlo\n*H.* Hablar seguro con el dueño`;
                                await enviarMensajeWhatsApp(from, subMenuEncuentro);
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_subopcion_encuentro') {
                        if (textUpper === 'D') {
                            await supabase.from('llaveros').update({ estado: 'esperando_ubicacion_finder' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📍 Compartinos tu ubicación (Clip ➡️ Ubicación) para indicarte la sucursal AXION más cercana:");
                        } else if (textUpper === 'H') {
                            await supabase.from('llaveros').update({ estado: 'esperando_mensaje_anonimo' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📝 Escribí el mensaje para el dueño:");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Respondé con *D* o *H*.");
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_mensaje_anonimo') {
                        const { data: dueños } = await supabase.from('llaveros').select('*').eq('codigo_llavero', usuarioProceso.codigo_llavero).eq('estado', 'completado');

                        if (dueños && dueños.length > 0) {
                            const dueñoOriginal = dueños[0];
                            // Guía ultra breve para el Dueño
                            const mensajeAlDueño = `💬 *Finder:* "${text}"\n\n_(Responder con: H mensaje)_\n_(Terminar chat: F)_`;
                            await enviarMensajeWhatsApp(dueñoOriginal.telefono_usuario, mensajeAlDueño);
                        }

                        await supabase.from('llaveros').update({ estado: 'completado', telefono_finder: from }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "📲 Mensaje enviado. Te avisaremos si el dueño responde.");
                    }

                    else if (usuarioProceso.estado === 'esperando_texto_soporte') {
                        await supabase.from('soporte').insert([{ telefono_usuario: from, mensaje: text }]);
                        await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "✅ Consulta registrada. Nos contactaremos a la brevedad.");
                    }

                    else if (usuarioProceso.estado === 'esperando_sucursal_personal') {
                        const regexSucursal = /^[0-9]{4}$/;
                        if (!regexSucursal.test(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Debe ser de 4 números. Intentá de nuevo:");
                        } else {
                            await supabase.from('llaveros').update({ estado: `esperando_codigo_personal_suc_${textUpper}` }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${textUpper}] registrada. Ingresá el código del llavero:`);
                        }
                    }
                    else if (usuarioProceso.estado.startsWith('esperando_codigo_personal_suc_')) {
                        const sucursalId = usuarioProceso.estado.replace('esperando_codigo_personal_suc_', '');
                        
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido:");
                        } else {
                            const { data: dueños } = await supabase.from('llaveros').select('*').eq('codigo_llavero', textUpper).eq('estado', 'completado');

                            if (!dueños || dueños.length === 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código no existe.");
                            } else {
                                const dueñoLlavero = dueños[0];
                                await supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'completado' }).eq('id', usuarioProceso.id);
                                await enviarMensajeWhatsApp(from, `⚙️ Custodia completada para Sucursal ${sucursalId}.`);

                                const { data: filasSucursal } = await supabase.from('sucursales').select('direccion').eq('id_sucursal', sucursalId.toString().trim());
                                const direccionEstacion = (filasSucursal && filasSucursal.length > 0) ? filasSucursal[0].direccion : `Sucursal N° ${sucursalId}`;

                                const codigoRetiro = Math.floor(1000 + Math.random() * 9000);
                                const nombrePropietario = dueñoLlavero.nombre_usuario ? ` *${dueñoLlavero.nombre_usuario}*` : "";

                                const mensajeDueño = `🚨 *GFinder AXION!*\n\nHola${nombrePropietario}, tu llavero *${textUpper}* está en la sucursal:\n\n📍 ${direccionEstacion}\n🔑 *Código de Retiro:* ${codigoRetiro}`;
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
    console.log(`🚀 Servidor GFinder Compacto corriendo en puerto ${PORT}`);
});
