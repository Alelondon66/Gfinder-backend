require('dotenv').config();

const crypto = require('crypto');
const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV_VARS = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'WA_PHONE_NUMBER_ID',
    'WA_ACCESS_TOKEN',
    'WA_APP_SECRET',
    'WEBHOOK_VERIFY_TOKEN',
    'DASHBOARD_API_KEY'
];

const faltantes = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
if (faltantes.length > 0) {
    console.error(`❌ Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
    process.exit(1);
}

const WA_TEMPLATE_NOTIFICACION = 'notificacion_llavero_encontrado';
const WA_TEMPLATE_LANG = 'es_AR';
const NOTIFICACION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora

const app = express();

app.use('/webhook', bodyParser.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(bodyParser.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const axiosWhatsApp = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 8000
});

function compararSeguro(valorRecibido, valorEsperado) {
    const bufRecibido = Buffer.from(String(valorRecibido || ''));
    const bufEsperado = Buffer.from(String(valorEsperado || ''));
    if (bufRecibido.length !== bufEsperado.length) return false;
    return crypto.timingSafeEqual(bufRecibido, bufEsperado);
}

function verificarFirmaWebhook(req, res, next) {
    const firma = req.headers['x-hub-signature-256'];
    if (!firma || !req.rawBody) {
        return res.sendStatus(401);
    }

    const hashEsperado = 'sha256=' + crypto
        .createHmac('sha256', process.env.WA_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');

    if (!compararSeguro(firma, hashEsperado)) {
        return res.sendStatus(401);
    }
    next();
}

const limitadorWebhook = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
});

const limitadorDashboard = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
});

async function dbWrite(promise, contexto) {
    const { error } = await promise;
    if (error) {
        console.error(`❌ Supabase [${contexto}]:`, error.message);
        return false;
    }
    return true;
}

async function dbRead(promise, contexto) {
    const { data, error } = await promise;
    if (error) {
        console.error(`❌ Supabase [${contexto}]:`, error.message);
        return null;
    }
    return data;
}

function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
    const regexFormato = /^[A-HJKLNPRT-VX-Y]{2}[0-9]{4}[A-HJKLNPRT-VX-Y]{2}$/;
    if (!regexFormato.test(clean)) return false;

    const letrasValidas = ['A','B','C','D','E','F','G','H','J','K','L','N','P','R','T','U','V','W','X','Y'];

    const numeros = clean.substring(2, 6);
    const letraVerificadoraReal = clean.charAt(7);

    const n1 = parseInt(numeros.charAt(0));
    const n2 = parseInt(numeros.charAt(1));
    const n3 = parseInt(numeros.charAt(2));
    const n4 = parseInt(numeros.charAt(3));

    const sumaVerificacion = (n1 * 5) + (n2 * 4) + (n3 * 3) + (n4 * 2);
    const indiceCalculado = sumaVerificacion % 20;
    const letraEsperada = letrasValidas[indiceCalculado];

    return letraVerificadoraReal === letraEsperada;
}

function validarEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
        await axiosWhatsApp.post(url, payload, {
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

async function enviarPlantillaWhatsApp(telefonoDestino, codigoLlavero) {
    const url = `https://graph.facebook.com/v25.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
    const payload = {
        messaging_product: "whatsapp",
        to: telefonoDestino,
        type: "template",
        template: {
            name: WA_TEMPLATE_NOTIFICACION,
            language: { code: WA_TEMPLATE_LANG },
            components: [{
                type: "body",
                parameters: [{ type: "text", text: codigoLlavero }]
            }]
        }
    };

    try {
        await axiosWhatsApp.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`📤 Plantilla enviada a [${telefonoDestino}]`);
    } catch (error) {
        console.error('❌ Error Meta (plantilla):', error.response?.data || error.message);
    }
}

// Manda la plantilla aprobada (abre la ventana de 24hs) y deja guardado el detalle
// que se le va a revelar al dueño en texto libre recién cuando responda.
async function registrarNotificacionPendiente(llaveroId, telefonoDueño, codigoLlavero, detalleTexto) {
    await enviarPlantillaWhatsApp(telefonoDueño, codigoLlavero);
    await dbWrite(supabase.from('llaveros').update({
        notificacion_pendiente: detalleTexto,
        notificacion_enviada_at: new Date()
    }).eq('id', llaveroId), 'update llaveros (notificacion pendiente)');
}

async function enviarEmailAlternativo(destinatario, asunto, cuerpo) {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.log(`✉️  Email pendiente (Resend no configurado todavía) para ${destinatario}: ${asunto}`);
        return false;
    }
    try {
        await axios.post('https://api.resend.com/emails', {
            from: process.env.RESEND_FROM_EMAIL,
            to: destinatario,
            subject: asunto,
            text: cuerpo
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 8000
        });
        console.log(`✉️  Email enviado a [${destinatario}]`);
        return true;
    } catch (error) {
        console.error('❌ Error Resend:', error.response?.data || error.message);
        return false;
    }
}

// Corre cada 10 min: si pasó más de 1 hora sin que el dueño responda a la
// plantilla de WhatsApp, le avisamos al contacto alternativo por email.
async function revisarNotificacionesVencidas() {
    const limite = new Date(Date.now() - NOTIFICACION_TIMEOUT_MS).toISOString();
    const vencidas = await dbRead(supabase
        .from('llaveros')
        .select('id, email_alternativo, notificacion_pendiente, nombre_usuario')
        .not('notificacion_pendiente', 'is', null)
        .not('email_alternativo', 'is', null)
        .lt('notificacion_enviada_at', limite), 'select llaveros (notificaciones vencidas)');

    if (!vencidas || vencidas.length === 0) return;

    for (const fila of vencidas) {
        const asunto = 'VUELVE - Novedades sobre un llavero registrado';
        const cuerpo = `Hola,\n\nNo pudimos contactar por WhatsApp a ${fila.nombre_usuario || 'quien registró este llavero'} para avisarle lo siguiente:\n\n${fila.notificacion_pendiente}\n\nTe llega este correo como contacto alternativo registrado en VUELVE, por si podés ayudar a contactarlo/a.\n\n— Equipo VUELVE`;

        const enviado = await enviarEmailAlternativo(fila.email_alternativo, asunto, cuerpo);
        if (enviado) {
            await dbWrite(supabase.from('llaveros').update({ notificacion_pendiente: null, notificacion_enviada_at: null }).eq('id', fila.id), 'update llaveros (notificacion escalada a email)');
        }
    }
}

setInterval(() => {
    revisarNotificacionesVencidas().catch(err => console.error('❌ Error revisando notificaciones vencidas:', err.message));
}, 10 * 60 * 1000);

app.get('/webhook', limitadorWebhook, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && compararSeguro(token, process.env.WEBHOOK_VERIFY_TOKEN)) {
        return res.status(200).send(challenge);
    }
    return res.status(403).sendStatus(403);
});

app.post('/webhook', limitadorWebhook, verificarFirmaWebhook, async (req, res) => {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
        return res.sendStatus(404);
    }

    try {
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

                // Si el que escribe tiene una notificación esperando ser "destrabada"
                // (respondió a la plantilla de WhatsApp), le mandamos el detalle real
                // como texto libre, ya dentro de la ventana de sesión recién abierta.
                const notificacionPendiente = await dbRead(supabase
                    .from('llaveros')
                    .select('id, notificacion_pendiente')
                    .eq('telefono_usuario', from)
                    .eq('estado', 'completado')
                    .not('notificacion_pendiente', 'is', null)
                    .order('notificacion_enviada_at', { ascending: false })
                    .limit(1)
                    .maybeSingle(), 'select llaveros (notificacion pendiente)');

                if (notificacionPendiente) {
                    await dbWrite(supabase.from('llaveros').update({ notificacion_pendiente: null, notificacion_enviada_at: null }).eq('id', notificacionPendiente.id), 'update llaveros (limpiar notificacion pendiente)');
                    await enviarMensajeWhatsApp(from, notificacionPendiente.notificacion_pendiente);
                    return res.status(200).send('EVENT_RECEIVED');
                }

                if (textoUpper === 'F') {
                    const llaveroDueño = await dbRead(supabase
                        .from('llaveros')
                        .select('codigo_llavero')
                        .eq('telefono_usuario', from)
                        .eq('estado', 'completado')
                        .order('fecha_registro', { ascending: false })
                        .limit(1)
                        .maybeSingle(), 'select llaveros (F propio)');

                    if (llaveroDueño) {
                        const reporteEncuentro = await dbRead(supabase
                            .from('llaveros')
                            .select('id, telefono_usuario')
                            .eq('codigo_llavero', llaveroDueño.codigo_llavero)
                            .eq('estado', 'completado')
                            .not('telefono_usuario', 'eq', from)
                            .order('fecha_registro', { ascending: false })
                            .limit(1)
                            .maybeSingle(), 'select llaveros (F encuentro)');

                        if (reporteEncuentro) {
                            await dbWrite(supabase.from('llaveros').delete().eq('id', reporteEncuentro.id), 'delete llaveros (F)');
                            await enviarMensajeWhatsApp(reporteEncuentro.telefono_usuario, "🔒 *Chat finalizado por el dueño.*");
                            await enviarMensajeWhatsApp(from, "🔒 *Chat cerrado.*");
                            return res.status(200).send('EVENT_RECEIVED');
                        }
                    }
                }

                if (textoUpper.startsWith('H ')) {
                    const mensajeHaciaFinder = textoPlano.substring(2).trim();

                    const llaveroDueño = await dbRead(supabase
                        .from('llaveros')
                        .select('codigo_llavero')
                        .eq('telefono_usuario', from)
                        .eq('estado', 'completado')
                        .order('fecha_registro', { ascending: false })
                        .limit(1)
                        .maybeSingle(), 'select llaveros (H propio)');

                    if (llaveroDueño) {
                        const reporteEncuentro = await dbRead(supabase
                            .from('llaveros')
                            .select('telefono_usuario')
                            .eq('codigo_llavero', llaveroDueño.codigo_llavero)
                            .eq('estado', 'completado')
                            .not('telefono_usuario', 'eq', from)
                            .order('fecha_registro', { ascending: false })
                            .limit(1)
                            .maybeSingle(), 'select llaveros (H encuentro)');

                        if (reporteEncuentro && reporteEncuentro.telefono_usuario) {
                            const textoFinal = `💬 *Dueño:* "${mensajeHaciaFinder}"\n_(Responder con: H mensaje)_`;
                            await enviarMensajeWhatsApp(reporteEncuentro.telefono_usuario, textoFinal);
                            return res.status(200).send('EVENT_RECEIVED');
                        }
                    }
                    return res.status(200).send('EVENT_RECEIVED');
                }
            }

            let usuarioProceso = await dbRead(supabase
                .from('llaveros')
                .select('*')
                .eq('telefono_usuario', from)
                .neq('estado', 'completado')
                .order('fecha_registro', { ascending: false })
                .limit(1)
                .maybeSingle(), 'select llaveros (proceso activo)');

            if (usuarioProceso && usuarioProceso.ultima_interaccion) {
                const ahora = new Date();
                const ultimaInteraccion = new Date(usuarioProceso.ultima_interaccion);
                const diferenciaSegundos = Math.floor((ahora - ultimaInteraccion) / 1000);

                if (diferenciaSegundos > 300) {
                    await dbWrite(supabase.from('llaveros').delete().eq('id', usuarioProceso.id), 'delete llaveros (timeout)');
                    usuarioProceso = null;
                }
            }

            // 🗺️ GEOLOCALIZACIÓN CON RESOLUCIÓN EXTENDIDA (MENSAJE O CIERRE)
            if (messageData.type === 'location' && usuarioProceso && usuarioProceso.estado === 'esperando_ubicacion_finder') {
                const latFinder = messageData.location.latitude;
                const lonFinder = messageData.location.longitude;

                const sucursales = await dbRead(supabase.from('sucursales').select('*'), 'select sucursales');
                let textoSucursal = "";

                if (!sucursales || sucursales.length === 0) {
                    textoSucursal = "📍 Acércalo a cualquier estación AXION.";
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
                        textoSucursal = `📍 *Estación AXION más cercana:*\n\n🏠 ${sucursalMasCercana.direccion}\n🏁 A aprox. ${distanciaMinima.toFixed(1)} km.`;
                    } else {
                        textoSucursal = `📍 *Estación AXION:*\n\n🏠 ${sucursales[0].direccion}`;
                    }
                }

                // Modificamos la respuesta para ofrecerle enviar mensaje o terminar
                const resolucionUbicacion = `${textoSucursal}\n\n💬 _¿Querés dejarle un mensaje seguro al dueño antes de ir?_\n\n*H.* Enviar mensaje\n*F.* Finalizar / Lo estoy llevando`;
                await enviarMensajeWhatsApp(from, resolucionUbicacion);

                // Pasamos al estado intermedio para permitirle usar las opciones H o F
                await dbWrite(supabase.from('llaveros').update({ estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id), 'update llaveros (ubicacion->subopcion)');
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
                        await dbWrite(supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date(), ultima_interaccion: new Date() }]), 'insert llaveros (A)');
                        await enviarMensajeWhatsApp(from, "💾 Ingresá el código de 8 caracteres (ej: AA0000AB):");
                    }
                    else if (textUpper === 'E') {
                        await dbWrite(supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date(), ultima_interaccion: new Date() }]), 'insert llaveros (E)');
                        await enviarMensajeWhatsApp(from, "🔍 Ingresá el código de 8 caracteres del llavero encontrado:");
                    }
                    else if (textUpper === 'C') {
                        await dbWrite(supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_texto_soporte', fecha_registro: new Date(), ultima_interaccion: new Date() }]), 'insert llaveros (C)');
                        await enviarMensajeWhatsApp(from, "🩺 *Consultas y Reclamos*\n\nEscribí tu consulta detallada en un solo mensaje:");
                    }
                    else if (textUpper === '9') {
                        await dbWrite(supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_sucursal_personal', fecha_registro: new Date(), ultima_interaccion: new Date() }]), 'insert llaveros (9)');
                        await enviarMensajeWhatsApp(from, "⛽ *Personal AXION*\n\nIngresá el número de sucursal (4 dígitos):");
                    }
                    else {
                        await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú.");
                    }
                }
                else {
                    await dbWrite(supabase.from('llaveros').update({ ultima_interaccion: new Date() }).eq('id', usuarioProceso.id), 'update llaveros (ultima_interaccion)');

                    if (textUpper === 'CANCELAR' || textUpper === 'MENU') {
                        await dbWrite(supabase.from('llaveros').delete().eq('id', usuarioProceso.id), 'delete llaveros (cancelar)');
                        await enviarMensajeWhatsApp(from, "🔄 Cancelado. Escribí *Hola* para reiniciar.");
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    if (usuarioProceso.estado === 'esperando_codigo_registro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo:");
                        } else {
                            const existente = await dbRead(supabase.from('llaveros').select('id').eq('codigo_llavero', textUpper).eq('estado', 'completado'), 'select llaveros (codigo existente)');
                            if (existente && existente.length > 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ Código ya activado. Seleccioná la Opción C.");
                                await dbWrite(supabase.from('llaveros').delete().eq('id', usuarioProceso.id), 'delete llaveros (codigo ya activado)');
                            } else {
                                await dbWrite(supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_nombre_registro' }).eq('id', usuarioProceso.id), 'update llaveros (codigo verificado)');
                                await enviarMensajeWhatsApp(from, "👤 Código verificado. ¿Cómo es tu nombre?");
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_nombre_registro') {
                        await dbWrite(supabase.from('llaveros').update({ nombre_usuario: text, estado: 'esperando_email_alternativo' }).eq('id', usuarioProceso.id), 'update llaveros (nombre)');
                        await enviarMensajeWhatsApp(from, `🤝 Gracias ${text}. Ingresá un email de contacto alternativo (por si no podemos comunicarnos con vos por WhatsApp):`);
                    }
                    else if (usuarioProceso.estado === 'esperando_email_alternativo') {
                        const emailLimpio = text.trim();

                        if (!validarEmail(emailLimpio)) {
                            await enviarMensajeWhatsApp(from, "❌ Ingresá un email válido (ej: nombre@dominio.com):");
                        } else {
                            await dbWrite(supabase.from('llaveros').update({ email_alternativo: emailLimpio, estado: 'esperando_confirmacion_alta' }).eq('id', usuarioProceso.id), 'update llaveros (email alternativo)');

                            const mensajeConfirmacion = `📝 *${usuarioProceso.nombre_usuario || 'Usuario'}*, vamos a activar el llavero *${usuarioProceso.codigo_llavero}* y tu email alternativo es *${emailLimpio}*.\n\nAquí te dejamos un acceso a las condiciones generales del servicio Vuelve: https://vuelve.com/terminos\n\nSi estás de acuerdo, respondé con el número *1*.\nEn caso contrario marcá *2*`;
                            await enviarMensajeWhatsApp(from, mensajeConfirmacion);
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_confirmacion_alta') {
                        if (textUpper === '1') {
                            await dbWrite(supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id), 'update llaveros (confirmacion alta)');
                            await enviarMensajeWhatsApp(from, "🎉 ¡Llavero activado con éxito!");
                        } else if (textUpper === '2') {
                            await dbWrite(supabase.from('llaveros').delete().eq('id', usuarioProceso.id), 'delete llaveros (confirmacion cancelada)');
                            await enviarMensajeWhatsApp(from, "🔄 Registro cancelado correctamente. Escribí *Hola* si querés volver a empezar.");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Opción inválida. Por favor, respondé con *1* para Confirmar o *2* para Cancelar.");
                        }
                    }

                    else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo:");
                        } else {
                            const activados = await dbRead(supabase.from('llaveros').select('*').eq('codigo_llavero', textUpper).eq('estado', 'completado'), 'select llaveros (codigo encuentro)');

                            if (!activados || activados.length === 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código no corresponde a un llavero activo.");
                            } else {
                                await dbWrite(supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id), 'update llaveros (codigo encuentro)');

                                const dueñoLegitimo = activados[0];
                                const nombrePropietario = dueñoLegitimo.nombre_usuario ? ` *${dueñoLegitimo.nombre_usuario}*` : "";

                                const alertaInmediata = `🚨 *GFinder:* Hola${nombrePropietario}, ingresaron el código de tu llavero *${textUpper}*. Te avisaremos apenas definan la entrega.`;
                                await registrarNotificacionPendiente(dueñoLegitimo.id, dueñoLegitimo.telefono_usuario, textUpper, alertaInmediata);

                                const subMenuEncuentro = `✅ ¡Llavero localizado!\n\nSeleccioná:\n*D.* Ver dónde devolverlo\n*H.* Hablar seguro con el dueño`;
                                await enviarMensajeWhatsApp(from, subMenuEncuentro);
                            }
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_subopcion_encuentro') {
                        if (textUpper === 'D') {
                            await dbWrite(supabase.from('llaveros').update({ estado: 'esperando_ubicacion_finder' }).eq('id', usuarioProceso.id), 'update llaveros (subopcion D)');
                            await enviarMensajeWhatsApp(from, "📍 Compartinos tu ubicación (Clip ➡️ Ubicación) para indicarte la sucursal AXION más cercana:");
                        } else if (textUpper === 'H') {
                            await dbWrite(supabase.from('llaveros').update({ estado: 'esperando_mensaje_anonimo' }).eq('id', usuarioProceso.id), 'update llaveros (subopcion H)');
                            await enviarMensajeWhatsApp(from, "📝 Escribí el mensaje para el dueño:");
                        } else if (textUpper === 'F') {
                            // Si presiona F desde la resolución de ubicación, se cierra limpio
                            await dbWrite(supabase.from('llaveros').update({ estado: 'completado', telefono_finder: from }).eq('id', usuarioProceso.id), 'update llaveros (subopcion F)');
                            await enviarMensajeWhatsApp(from, "🔒 *Muchas gracias por tu ayuda.* El proceso ha finalizado.");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Respondé con *D*, *H* o *F*.");
                        }
                    }
                    else if (usuarioProceso.estado === 'esperando_mensaje_anonimo') {
                        const dueños = await dbRead(supabase.from('llaveros').select('*').eq('codigo_llavero', usuarioProceso.codigo_llavero).eq('estado', 'completado'), 'select llaveros (mensaje anonimo)');

                        if (dueños && dueños.length > 0) {
                            const dueñoOriginal = dueños[0];
                            const mensajeAlDueño = `💬 *Finder:* "${text}"\n\n_(Responder con: H mensaje)_\n_(Terminar chat: F)_`;

                            if (dueñoOriginal.notificacion_pendiente) {
                                // El dueño todavía no respondió a la plantilla (sesión no abierta):
                                // guardamos el mensaje para revelárselo recién cuando responda.
                                await dbWrite(supabase.from('llaveros').update({ notificacion_pendiente: mensajeAlDueño }).eq('id', dueñoOriginal.id), 'update llaveros (notificacion pendiente con mensaje finder)');
                            } else {
                                await enviarMensajeWhatsApp(dueñoOriginal.telefono_usuario, mensajeAlDueño);
                            }
                        }

                        await dbWrite(supabase.from('llaveros').update({ estado: 'completado', telefono_finder: from }).eq('id', usuarioProceso.id), 'update llaveros (mensaje anonimo completado)');
                        await enviarMensajeWhatsApp(from, "📲 Mensaje enviado. Te avisaremos si el dueño responde.");
                    }

                    else if (usuarioProceso.estado === 'esperando_texto_soporte') {
                        await dbWrite(supabase.from('soporte').insert([{ telefono_usuario: from, mensaje: text }]), 'insert soporte');
                        await dbWrite(supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id), 'update llaveros (soporte completado)');
                        await enviarMensajeWhatsApp(from, "✅ Consulta registrada. Nos contactaremos a la brevedad.");
                    }

                    else if (usuarioProceso.estado === 'esperando_sucursal_personal') {
                        const regexSucursal = /^[0-9]{4}$/;
                        if (!regexSucursal.test(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Debe ser de 4 números. Intentá de nuevo:");
                        } else {
                            await dbWrite(supabase.from('llaveros').update({ estado: `esperando_codigo_personal_suc_${textUpper}` }).eq('id', usuarioProceso.id), 'update llaveros (sucursal personal)');
                            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${textUpper}] registrada. Ingresá el código del llavero:`);
                        }
                    }
                    else if (usuarioProceso.estado.startsWith('esperando_codigo_personal_suc_')) {
                        const sucursalId = usuarioProceso.estado.replace('esperando_codigo_personal_suc_', '');

                        if (!validarCodigoGFinder(textUpper)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido.");
                        } else {
                            const dueños = await dbRead(supabase.from('llaveros').select('*').eq('codigo_llavero', textUpper).eq('estado', 'completado'), 'select llaveros (codigo personal suc)');

                            if (!dueños || dueños.length === 0) {
                                await enviarMensajeWhatsApp(from, "⚠️ El código no existe.");
                            } else {
                                const dueñoLlavero = dueños[0];
                                await dbWrite(supabase.from('llaveros').update({ codigo_llavero: textUpper, estado: 'completado' }).eq('id', usuarioProceso.id), 'update llaveros (custodia completada)');
                                await enviarMensajeWhatsApp(from, `⚙️ Custodia completada para Sucursal ${sucursalId}.`);

                                const filasSucursal = await dbRead(supabase.from('sucursales').select('direccion').eq('id_sucursal', sucursalId.toString().trim()), 'select sucursales (direccion)');
                                const direccionEstacion = (filasSucursal && filasSucursal.length > 0) ? filasSucursal[0].direccion : `Sucursal N° ${sucursalId}`;

                                const codigoRetiro = Math.floor(1000 + Math.random() * 9000);
                                const nombrePropietario = dueñoLlavero.nombre_usuario ? ` *${dueñoLlavero.nombre_usuario}*` : "";

                                const mensajeDueño = `🚨 *GFinder AXION!*\n\nHola${nombrePropietario}, tu llavero *${textUpper}* está en la sucursal:\n\n📍 ${direccionEstacion}\n🔑 *Código de Retiro:* ${codigoRetiro}`;
                                await registrarNotificacionPendiente(dueñoLlavero.id, dueñoLlavero.telefono_usuario, textUpper, mensajeDueño);
                            }
                        }
                    }
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ Error procesando webhook:', error.message);
        return res.status(200).send('EVENT_RECEIVED');
    }
});

const PORT = process.env.PORT || 3000;
// 📊 ENDPOINT DEL DASHBOARD COMERCIAL (MÉTRICAS GFINDER)
app.get('/api/dashboard/metrics', limitadorDashboard, async (req, res) => {
    const apiKey = req.headers['x-api-key'];

    // Validamos la clave de seguridad en los headers
    if (!apiKey || !compararSeguro(apiKey, process.env.DASHBOARD_API_KEY)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        // 1. Traemos las métricas generales de la primera vista
        const { data: metricasGenerales, error: errGen } = await supabase
            .from('vista_dashboard_gfinder')
            .select('*')
            .maybeSingle();

        if (errGen) throw errGen;

        // 2. Traemos el ranking de sucursales para AXION
        const { data: rankingSucursales, error: errSuc } = await supabase
            .from('vista_ranking_sucursales_axion')
            .select('*');

        if (errSuc) throw errSuc;

        // 3. Calculamos la Tasa de Recuperación
        const activos = metricasGenerales?.total_llaveros_activos || 0;
        const encontrados = metricasGenerales?.total_llaveros_encontrados || 0;
        const tasaRecuperacion = activos > 0 ? ((encontrados / activos) * 100).toFixed(1) : "0.0";

        // Devolvemos la estructura limpia para el Dashboard
        return res.status(200).json({
            status: 'success',
            timestamp: new Date(),
            termometro_negocio: {
                total_llaveros_activos: activos,
                total_llaveros_encontrados: encontrados,
                tasa_recuperacion_porcentaje: `${tasaRecuperacion}%`
            },
            comportamiento_canales: {
                devoluciones_via_axion_geo: metricasGenerales?.encuadres_por_geolocalizacion || 0,
                devoluciones_via_chat_directo: encontrados - (metricasGenerales?.encuadres_por_geolocalizacion || 0)
            },
            auditoria: {
                alertas_soporte_pendientes: metricasGenerales?.total_consultas_soporte || 0
            },
            reporte_corporativo_axion: rankingSucursales || []
        });

    } catch (error) {
        console.error('❌ Error Dashboard:', error.message);
        return res.status(500).json({ error: 'Error interno del servidor al procesar métricas' });
    }
});
app.listen(PORT, () => {
    console.log(`🚀 Servidor VUELVE optimizado con flujo de ubicación corriendo en puerto ${PORT}`);
});
