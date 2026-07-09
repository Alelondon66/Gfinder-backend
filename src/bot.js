const repo = require('./repositorio');
const { enviarMensajeWhatsApp, enviarEmailAlternativo, registrarNotificacionPendienteEvento } = require('./notificaciones');
const { validarCodigoGFinder, validarEmail, calcularDistancia } = require('./validaciones');
const { EMAIL_ADMINISTRACION, TIMEOUT_SESION_SEGUNDOS, MAX_INTENTOS_CODIGO_RETIRO, supabase } = require('./config');

function nombreParaTemplate(llavero) {
    return llavero.alias || llavero.codigo_llavero;
}

async function buscarNotificacionPendientePorDueno(from) {
    const llavero = await repo.obtenerLlaveroPorDueno(from);
    if (!llavero) return null;

    const eventos = await repo.dbRead(supabase
        .from('eventos')
        .select('id, notificacion_pendiente')
        .eq('llavero_id', llavero.id)
        .not('notificacion_pendiente', 'is', null)
        .order('notificacion_enviada_en', { ascending: false })
        .limit(1), 'select eventos (notificacion pendiente por dueño)');

    return eventos && eventos.length > 0 ? eventos[0] : null;
}

async function manejarAtajoF(from) {
    const llavero = await repo.obtenerLlaveroPorDueno(from);
    if (!llavero) return false;

    const evento = await repo.obtenerEventoAbierto(llavero.codigo_llavero, 'encuentro');
    if (!evento || !evento.telefono_finder) return false;

    await repo.cerrarEvento(evento.id, { motivo_cierre: 'dueño_cerro_chat' });
    await enviarMensajeWhatsApp(evento.telefono_finder, "🔒 *Chat finalizado por el dueño.*");
    await enviarMensajeWhatsApp(from, "🔒 *Chat cerrado.*");
    return true;
}

async function manejarAtajoH(from, mensaje) {
    const llavero = await repo.obtenerLlaveroPorDueno(from);
    if (!llavero) return false;

    const evento = await repo.obtenerEventoAbierto(llavero.codigo_llavero, 'encuentro');
    if (!evento || !evento.telefono_finder) return false;

    const textoFinal = `💬 *Dueño:* "${mensaje}"\n_(Responder con: H mensaje)_`;
    await enviarMensajeWhatsApp(evento.telefono_finder, textoFinal);
    return true;
}

async function mostrarMenu(from) {
    const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nRespondé con la letra:\n\n*A.* Activar nuevo llavero\n*E.* Encontré un llavero\n*R.* Recuperar mi llavero en sucursal\n*C.* Consultas o Reclamos`;
    await enviarMensajeWhatsApp(from, menuTexto);
}

async function iniciarRegistro(from) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_registro' });
    await enviarMensajeWhatsApp(from, "💾 Ingresá el código de 8 caracteres (ej: AA0000AB):");
}

async function iniciarEncuentro(from) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_encuentro' });
    await enviarMensajeWhatsApp(from, "🔍 Ingresá el código de 8 caracteres del llavero encontrado:");
}

async function iniciarRecupero(from) {
    const llavero = await repo.obtenerLlaveroPorDueno(from);
    if (!llavero) {
        await enviarMensajeWhatsApp(from, "⚠️ No encontramos ningún llavero activo a tu nombre.");
        return;
    }

    const evento = await repo.obtenerEventoAbierto(llavero.codigo_llavero, 'custodia');
    if (!evento) {
        await enviarMensajeWhatsApp(from, "⚠️ No tenés ningún llavero esperando en sucursal ahora mismo.");
        return;
    }

    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_retiro', codigo_llavero: llavero.codigo_llavero, evento_id: evento.id });
    await enviarMensajeWhatsApp(from, "🔑 Ingresá el código de autorización que recibiste (lo tenés más arriba en este chat):");
}

async function iniciarSoporte(from) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_texto_soporte' });
    await enviarMensajeWhatsApp(from, "🩺 *Consultas y Reclamos*\n\nEscribí tu consulta detallada en un solo mensaje:");
}

async function iniciarPersonalAxion(from) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_sucursal_personal' });
    await enviarMensajeWhatsApp(from, "⛽ *Personal AXION*\n\nIngresá el número de sucursal (4 dígitos):");
}

async function manejarUbicacion(from, sesion, messageData) {
    const latFinder = messageData.location.latitude;
    const lonFinder = messageData.location.longitude;

    const sucursales = await repo.dbRead(supabase.from('sucursales').select('*'), 'select sucursales');
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

        textoSucursal = sucursalMasCercana
            ? `📍 *Estación AXION más cercana:*\n\n🏠 ${sucursalMasCercana.direccion}\n🏁 A aprox. ${distanciaMinima.toFixed(1)} km.`
            : `📍 *Estación AXION:*\n\n🏠 ${sucursales[0].direccion}`;
    }

    const resolucionUbicacion = `${textoSucursal}\n\n💬 _¿Querés dejarle un mensaje seguro al dueño antes de ir?_\n\n*H.* Enviar mensaje\n*F.* Finalizar / Lo estoy llevando`;
    await enviarMensajeWhatsApp(from, resolucionUbicacion);
    await repo.actualizarSesion(sesion.id, { estado: 'esperando_subopcion_encuentro' });
}

async function manejarEstadoSesion(from, sesion, text, textUpper) {
    switch (sesion.estado) {
        case 'esperando_codigo_registro': {
            if (!validarCodigoGFinder(textUpper)) {
                await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo:");
                return;
            }
            const existente = await repo.obtenerLlaveroPorCodigo(textUpper);
            if (existente) {
                await enviarMensajeWhatsApp(from, "⚠️ Código ya activado. Seleccioná la Opción C.");
                await repo.cancelarSesion(sesion.id, 'codigo_ya_activado');
                return;
            }
            await repo.actualizarSesion(sesion.id, { codigo_llavero: textUpper, estado: 'esperando_nombre_registro' });
            await enviarMensajeWhatsApp(from, "👤 Código verificado. ¿Cómo es tu nombre?");
            return;
        }

        case 'esperando_nombre_registro': {
            await repo.actualizarSesion(sesion.id, { nombre_borrador: text, estado: 'esperando_alias_registro' });
            await enviarMensajeWhatsApp(from, `🤝 Gracias ${text}. ¿Querés ponerle un alias a este llavero para reconocerlo fácil (ej: "Auto de Juan")? Si no, respondé *OMITIR*:`);
            return;
        }

        case 'esperando_alias_registro': {
            const alias = textUpper === 'OMITIR' ? null : text;
            await repo.actualizarSesion(sesion.id, { alias_borrador: alias, estado: 'esperando_email_alternativo' });
            await enviarMensajeWhatsApp(from, "📧 Ingresá un email de contacto alternativo (por si no podemos comunicarnos con vos por WhatsApp):");
            return;
        }

        case 'esperando_email_alternativo': {
            const emailLimpio = text.trim();
            if (!validarEmail(emailLimpio)) {
                await enviarMensajeWhatsApp(from, "❌ Ingresá un email válido (ej: nombre@dominio.com):");
                return;
            }
            await repo.actualizarSesion(sesion.id, { email_borrador: emailLimpio, estado: 'esperando_confirmacion_alta' });
            const mensajeConfirmacion = `📝 *${sesion.nombre_borrador || 'Usuario'}*, vamos a activar el llavero *${sesion.codigo_llavero}*${sesion.alias_borrador ? ` ("${sesion.alias_borrador}")` : ''} y tu email alternativo es *${emailLimpio}*.\n\nAquí te dejamos un acceso a las condiciones generales del servicio Vuelve: https://vuelve.com/terminos\n\nSi estás de acuerdo, respondé con el número *1*.\nEn caso contrario marcá *2*`;
            await enviarMensajeWhatsApp(from, mensajeConfirmacion);
            return;
        }

        case 'esperando_confirmacion_alta': {
            if (textUpper === '1') {
                await repo.crearLlavero({
                    codigo_llavero: sesion.codigo_llavero,
                    alias: sesion.alias_borrador,
                    telefono_dueno: from,
                    nombre_dueno: sesion.nombre_borrador,
                    email_alternativo: sesion.email_borrador
                });
                await repo.cerrarSesion(sesion.id);
                await enviarMensajeWhatsApp(from, "🎉 ¡Llavero activado con éxito!");
            } else if (textUpper === '2') {
                await repo.cancelarSesion(sesion.id, 'usuario_rechazo_confirmacion');
                await enviarMensajeWhatsApp(from, "🔄 Registro cancelado correctamente. Escribí *Hola* si querés volver a empezar.");
            } else {
                await enviarMensajeWhatsApp(from, "⚠️ Opción inválida. Por favor, respondé con *1* para Confirmar o *2* para Cancelar.");
            }
            return;
        }

        case 'esperando_codigo_encuentro': {
            if (!validarCodigoGFinder(textUpper)) {
                await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo:");
                return;
            }
            const llavero = await repo.obtenerLlaveroPorCodigo(textUpper);
            if (!llavero) {
                await enviarMensajeWhatsApp(from, "⚠️ El código no corresponde a un llavero activo.");
                return;
            }

            const evento = await repo.crearEvento({
                llavero_id: llavero.id,
                codigo_llavero: textUpper,
                tipo: 'encuentro',
                estado: 'abierto',
                telefono_finder: from
            });

            await repo.actualizarSesion(sesion.id, { codigo_llavero: textUpper, evento_id: evento.id, estado: 'esperando_subopcion_encuentro' });

            const nombrePropietario = llavero.nombre_dueno ? ` *${llavero.nombre_dueno}*` : "";
            const alertaInmediata = `🚨 *GFinder:* Hola${nombrePropietario}, ingresaron el código de tu llavero *${nombreParaTemplate(llavero)}*. Te avisaremos apenas definan la entrega.`;
            await registrarNotificacionPendienteEvento(evento.id, llavero.telefono_dueno, nombreParaTemplate(llavero), alertaInmediata);

            await enviarMensajeWhatsApp(from, `✅ ¡Llavero localizado!\n\nSeleccioná:\n*D.* Ver dónde devolverlo\n*H.* Hablar seguro con el dueño`);
            return;
        }

        case 'esperando_subopcion_encuentro': {
            if (textUpper === 'D') {
                await repo.actualizarSesion(sesion.id, { estado: 'esperando_ubicacion_finder' });
                await enviarMensajeWhatsApp(from, "📍 Compartinos tu ubicación (Clip ➡️ Ubicación) para indicarte la sucursal AXION más cercana:");
            } else if (textUpper === 'H') {
                await repo.actualizarSesion(sesion.id, { estado: 'esperando_mensaje_anonimo' });
                await enviarMensajeWhatsApp(from, "📝 Escribí el mensaje para el dueño:");
            } else if (textUpper === 'F') {
                await repo.cerrarEvento(sesion.evento_id, { motivo_cierre: 'finder_lo_esta_llevando' });
                await repo.cerrarSesion(sesion.id);
                await enviarMensajeWhatsApp(from, "🔒 *Muchas gracias por tu ayuda.* El proceso ha finalizado.");
            } else {
                await enviarMensajeWhatsApp(from, "⚠️ Respondé con *D*, *H* o *F*.");
            }
            return;
        }

        case 'esperando_ubicacion_finder': {
            // El finder escribió texto en vez de compartir ubicación (nota A del análisis de flujo).
            await enviarMensajeWhatsApp(from, "📍 Necesitamos tu ubicación, no texto. Tocá el clip 📎 y elegí *Ubicación* para compartirla:");
            return;
        }

        case 'esperando_mensaje_anonimo': {
            const evento = await repo.obtenerEventoPorId(sesion.evento_id);
            if (evento) {
                const llavero = await repo.dbRead(supabase.from('llaveros').select('*').eq('id', evento.llavero_id).maybeSingle(), 'select llaveros (mensaje anonimo)');
                if (llavero) {
                    const mensajeAlDueño = `💬 *Finder:* "${text}"\n\n_(Responder con: H mensaje)_\n_(Terminar chat: F)_`;
                    if (evento.notificacion_pendiente) {
                        await repo.actualizarEvento(evento.id, { notificacion_pendiente: mensajeAlDueño });
                    } else {
                        await enviarMensajeWhatsApp(llavero.telefono_dueno, mensajeAlDueño);
                    }
                }
            }
            await repo.cerrarSesion(sesion.id);
            await enviarMensajeWhatsApp(from, "📲 Mensaje enviado. Te avisaremos si el dueño responde.");
            return;
        }

        case 'esperando_texto_soporte': {
            await repo.dbWrite(supabase.from('soporte').insert([{ telefono_usuario: from, mensaje: text }]), 'insert soporte');
            await repo.cerrarSesion(sesion.id);
            await enviarMensajeWhatsApp(from, "✅ Consulta registrada. Nos contactaremos a la brevedad.");
            await enviarEmailAlternativo(
                EMAIL_ADMINISTRACION,
                'VUELVE - Nueva consulta/reclamo recibido',
                `Nueva consulta registrada desde WhatsApp.\n\nTeléfono: ${from}\n\nMensaje:\n${text}`
            );
            return;
        }

        case 'esperando_codigo_retiro': {
            const regexRetiro = /^[0-9]{4}$/;
            const intentosPrevios = sesion.intentos_codigo_retiro || 0;
            const codigoCorrecto = regexRetiro.test(textUpper) ? await verificarCodigoRetiro(sesion.evento_id, parseInt(textUpper, 10)) : false;

            if (!codigoCorrecto) {
                const intentos = intentosPrevios + 1;
                if (intentos >= MAX_INTENTOS_CODIGO_RETIRO) {
                    await repo.cancelarSesion(sesion.id, 'retiro_bloqueado_intentos');
                    await enviarMensajeWhatsApp(from, "🔒 Superaste el máximo de intentos. Por seguridad, este retiro quedó bloqueado. Nos vamos a contactar para ayudarte.");
                    await enviarEmailAlternativo(
                        EMAIL_ADMINISTRACION,
                        'VUELVE - Retiro bloqueado por intentos fallidos',
                        `El teléfono ${from} superó los ${MAX_INTENTOS_CODIGO_RETIRO} intentos ingresando el código de retiro del llavero ${sesion.codigo_llavero}. Requiere intervención manual.`
                    );
                } else {
                    await repo.actualizarSesion(sesion.id, { intentos_codigo_retiro: intentos });
                    await enviarMensajeWhatsApp(from, `❌ Código incorrecto. Te quedan ${MAX_INTENTOS_CODIGO_RETIRO - intentos} intento(s):`);
                }
                return;
            }

            await repo.actualizarSesion(sesion.id, { estado: 'esperando_confirmacion_retiro' });
            await enviarMensajeWhatsApp(from, `✅ *Autorizado para retirar el llavero ${sesion.codigo_llavero}.*\n\nMostrale este mensaje al encargado de sucursal.\n\nCuando lo tengas en tus manos, respondé *OK*. Si no te lo entregaron, respondé *NO*.`);
            return;
        }

        case 'esperando_confirmacion_retiro': {
            if (textUpper === 'OK') {
                await repo.cerrarEvento(sesion.evento_id, { estado: 'retirado', retirado_en: new Date() });
                await repo.actualizarSesion(sesion.id, { estado: 'esperando_comentario_retiro' });
                await enviarMensajeWhatsApp(from, "🙌 ¡Listo! Si querés dejarnos un comentario sobre la experiencia, escribilo ahora (o respondé *OMITIR*):");
            } else if (textUpper === 'NO') {
                await repo.cancelarSesion(sesion.id, 'retiro_no_confirmado');
                await enviarMensajeWhatsApp(from, "⚠️ Registramos que no recibiste el llavero. Nos vamos a contactar para resolverlo.");
                await enviarEmailAlternativo(
                    EMAIL_ADMINISTRACION,
                    'VUELVE - Retiro NO confirmado por el dueño',
                    `El dueño autorizado no confirmó haber recibido el llavero ${sesion.codigo_llavero} (teléfono ${from}). Requiere seguimiento.`
                );
            } else {
                await enviarMensajeWhatsApp(from, "⚠️ Respondé *OK* si lo recibiste, o *NO* si no te lo entregaron.");
            }
            return;
        }

        case 'esperando_comentario_retiro': {
            if (textUpper !== 'OMITIR') {
                await repo.actualizarEvento(sesion.evento_id, { comentario_retiro: text });
            }
            await repo.cerrarSesion(sesion.id);
            await enviarMensajeWhatsApp(from, "🎉 ¡Gracias por usar VUELVE!");
            return;
        }

        case 'esperando_sucursal_personal': {
            const regexSucursal = /^[0-9]{4}$/;
            if (!regexSucursal.test(textUpper)) {
                await enviarMensajeWhatsApp(from, "❌ Debe ser de 4 números. Intentá de nuevo:");
                return;
            }
            await repo.actualizarSesion(sesion.id, { sucursal_id: textUpper, estado: 'esperando_codigo_personal_suc' });
            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${textUpper}] registrada. Ingresá el código del llavero:`);
            return;
        }

        case 'esperando_codigo_personal_suc': {
            if (!validarCodigoGFinder(textUpper)) {
                await enviarMensajeWhatsApp(from, "❌ Código inválido.");
                return;
            }
            const llavero = await repo.obtenerLlaveroPorCodigo(textUpper);
            if (!llavero) {
                await enviarMensajeWhatsApp(from, "⚠️ El código no existe.");
                return;
            }

            const codigoRetiro = Math.floor(1000 + Math.random() * 9000);
            const evento = await repo.crearEvento({
                llavero_id: llavero.id,
                codigo_llavero: textUpper,
                tipo: 'custodia',
                estado: 'en_custodia',
                sucursal_id: sesion.sucursal_id,
                codigo_retiro: codigoRetiro
            });

            await repo.cerrarSesion(sesion.id);
            await enviarMensajeWhatsApp(from, `⚙️ Custodia completada para Sucursal ${sesion.sucursal_id}.`);

            const filasSucursal = await repo.dbRead(supabase.from('sucursales').select('direccion').eq('id_sucursal', String(sesion.sucursal_id).trim()), 'select sucursales (direccion)');
            const direccionEstacion = (filasSucursal && filasSucursal.length > 0) ? filasSucursal[0].direccion : `Sucursal N° ${sesion.sucursal_id}`;
            const nombrePropietario = llavero.nombre_dueno ? ` *${llavero.nombre_dueno}*` : "";

            const mensajeDueño = `🚨 *GFinder AXION!*\n\nHola${nombrePropietario}, tu llavero *${nombreParaTemplate(llavero)}* está en la sucursal:\n\n📍 ${direccionEstacion}\n🔑 *Código de Retiro:* ${codigoRetiro}`;
            await registrarNotificacionPendienteEvento(evento.id, llavero.telefono_dueno, nombreParaTemplate(llavero), mensajeDueño);
            return;
        }

        default:
            return;
    }
}

async function verificarCodigoRetiro(eventoId, codigoIngresado) {
    const evento = await repo.obtenerEventoPorId(eventoId);
    return !!evento && evento.codigo_retiro === codigoIngresado;
}

async function procesarMensajeWebhook(req, res) {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
        return res.sendStatus(404);
    }

    try {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages || !messages[0]) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const messageData = messages[0];
        const from = messageData.from;

        if (value.statuses || from === process.env.WA_PHONE_NUMBER_ID) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        if (messageData.type === 'text') {
            const textoPlano = messageData.text.body.trim();
            const textoUpper = textoPlano.toUpperCase();

            const notificacionPendiente = await buscarNotificacionPendientePorDueno(from);
            if (notificacionPendiente) {
                await repo.actualizarEvento(notificacionPendiente.id, { notificacion_pendiente: null, notificacion_enviada_en: null });
                await enviarMensajeWhatsApp(from, notificacionPendiente.notificacion_pendiente);
                return res.status(200).send('EVENT_RECEIVED');
            }

            if (textoUpper === 'F' && await manejarAtajoF(from)) {
                return res.status(200).send('EVENT_RECEIVED');
            }

            if (textoUpper.startsWith('H ')) {
                await manejarAtajoH(from, textoPlano.substring(2).trim());
                return res.status(200).send('EVENT_RECEIVED');
            }
        }

        let sesion = await repo.obtenerSesionActiva(from);

        if (sesion && sesion.ultima_interaccion) {
            const diferenciaSegundos = Math.floor((new Date() - new Date(sesion.ultima_interaccion)) / 1000);
            if (diferenciaSegundos > TIMEOUT_SESION_SEGUNDOS) {
                await repo.cancelarSesion(sesion.id, 'timeout_5min');
                sesion = null;
            }
        }

        if (messageData.type === 'location' && sesion && sesion.estado === 'esperando_ubicacion_finder') {
            await manejarUbicacion(from, sesion, messageData);
            return res.status(200).send('EVENT_RECEIVED');
        }

        if (messageData.type !== 'text') {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const text = messageData.text.body.trim();
        const textUpper = text.toUpperCase();

        if (!sesion) {
            if (textUpper === 'HOLA' || textUpper === 'MENU' || textUpper === 'INICIO' || textUpper === 'CANCELAR') {
                await mostrarMenu(from);
            } else if (textUpper === 'A') {
                await iniciarRegistro(from);
            } else if (textUpper === 'E') {
                await iniciarEncuentro(from);
            } else if (textUpper === 'R') {
                await iniciarRecupero(from);
            } else if (textUpper === 'C') {
                await iniciarSoporte(from);
            } else if (textUpper === '9') {
                await iniciarPersonalAxion(from);
            } else {
                await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú.");
            }
            return res.status(200).send('EVENT_RECEIVED');
        }

        await repo.actualizarSesion(sesion.id, {});

        if (textUpper === 'CANCELAR' || textUpper === 'MENU') {
            await repo.cancelarSesion(sesion.id, 'usuario_cancelo');
            await enviarMensajeWhatsApp(from, "🔄 Cancelado. Escribí *Hola* para reiniciar.");
            return res.status(200).send('EVENT_RECEIVED');
        }

        await manejarEstadoSesion(from, sesion, text, textUpper);
        return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ Error procesando webhook:', error.message);
        return res.status(200).send('EVENT_RECEIVED');
    }
}

module.exports = { procesarMensajeWebhook };
