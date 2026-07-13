const repo = require('./repositorio');
const { enviarMensajeWhatsApp, enviarEmailAlternativo, registrarNotificacionPendienteEvento } = require('./notificaciones');
const { validarCodigoGFinder, validarEmail, calcularDistancia } = require('./validaciones');
const { EMAIL_ADMINISTRACION, TIMEOUT_SESION_SEGUNDOS, MAX_INTENTOS_CODIGO_RETIRO, supabase } = require('./config');

function nombreParaTemplate(llavero) {
    return llavero.alias || llavero.codigo_llavero;
}

async function buscarNotificacionPendientePorDueno(from) {
    const llaveros = await repo.obtenerLlaverosPorDueno(from);
    if (!llaveros || llaveros.length === 0) return null;

    const idsLlaveros = llaveros.map(l => l.id);
    const eventos = await repo.dbRead(supabase
        .from('eventos')
        .select('id, notificacion_pendiente')
        .in('llavero_id', idsLlaveros)
        .not('notificacion_pendiente', 'is', null)
        .order('notificacion_enviada_en', { ascending: false })
        .limit(1), 'select eventos (notificacion pendiente por dueño)');

    return eventos && eventos.length > 0 ? eventos[0] : null;
}

// Una persona puede tener más de un llavero activo. Esto busca, entre TODOS
// los suyos, cuáles tienen un evento abierto del tipo pedido (custodia,
// encuentro, etc.) — así no asumimos "el más reciente" cuando hay varios.
async function buscarEventosAbiertosDelDueno(from, tipo) {
    const llaveros = await repo.obtenerLlaverosPorDueno(from);
    if (!llaveros || llaveros.length === 0) return { llaveros: [], coincidencias: [] };

    const coincidencias = [];
    for (const llavero of llaveros) {
        const evento = await repo.obtenerEventoAbierto(llavero.codigo_llavero, tipo);
        if (evento) coincidencias.push({ llavero, evento });
    }
    return { llaveros, coincidencias };
}

function formatearOpcionesLlavero(items) {
    return items.map(({ llavero }) => `• *${nombreParaTemplate(llavero)}* (código ${llavero.codigo_llavero})`).join('\n');
}

function formatearOpcionesConversacion(items) {
    return items.map(c => `• *${c.nombre}* (código ${c.codigo})`).join('\n');
}

// F y H son bidireccionales: sirven tanto para el dueño respondiéndole al
// finder, como para el finder respondiéndole al dueño (ej. un segundo
// mensaje después del primero que mandó desde el submenú D/H/F). Por eso acá
// se buscan las conversaciones abiertas en los dos roles, no solo "dueño".
async function buscarConversacionesAbiertas(from, tipo) {
    const conversaciones = [];

    const { coincidencias: comoDueño } = await buscarEventosAbiertosDelDueno(from, tipo);
    for (const { llavero, evento } of comoDueño) {
        conversaciones.push({ codigo: llavero.codigo_llavero, nombre: nombreParaTemplate(llavero), evento, destinatario: evento.telefono_finder, rolPropio: 'dueño' });
    }

    const eventosComoFinder = await repo.obtenerEventosAbiertosPorFinder(from, tipo);
    for (const evento of (eventosComoFinder || [])) {
        const llavero = await repo.dbRead(supabase.from('llaveros').select('*').eq('id', evento.llavero_id).maybeSingle(), 'select llaveros (atajo del finder)');
        if (llavero) {
            conversaciones.push({ codigo: llavero.codigo_llavero, nombre: nombreParaTemplate(llavero), evento, destinatario: llavero.telefono_dueno, rolPropio: 'finder' });
        }
    }

    return conversaciones;
}

async function manejarAtajoF(from, codigoExplicito) {
    const conversaciones = await buscarConversacionesAbiertas(from, 'encuentro');
    if (conversaciones.length === 0) return false;

    let elegido;
    if (codigoExplicito) {
        elegido = conversaciones.find(c => c.codigo === codigoExplicito);
        if (!elegido) return false;
    } else if (conversaciones.length === 1) {
        elegido = conversaciones[0];
    } else {
        await enviarMensajeWhatsApp(from, `📋 Tenés más de una conversación abierta. Especificá cuál cerrar escribiendo *F* seguido del código:\n\n${formatearOpcionesConversacion(conversaciones)}\n\nEjemplo: *F ${conversaciones[0].codigo}*`);
        return true;
    }

    if (!elegido.destinatario) return false;

    const quienCerro = elegido.rolPropio === 'dueño' ? 'el dueño' : 'quien encontró tu llavero';
    await repo.cerrarEvento(elegido.evento.id, { motivo_cierre: `${elegido.rolPropio}_cerro_chat` });
    await enviarMensajeWhatsApp(elegido.destinatario, `🔒 *Chat finalizado por ${quienCerro}.*`);
    await enviarMensajeWhatsApp(from, "🔒 *Chat cerrado.*");
    return true;
}

async function manejarAtajoH(from, mensaje, codigoExplicito) {
    const conversaciones = await buscarConversacionesAbiertas(from, 'encuentro');
    if (conversaciones.length === 0) return false;

    let elegido;
    if (codigoExplicito) {
        elegido = conversaciones.find(c => c.codigo === codigoExplicito);
        if (!elegido) return false;
    } else if (conversaciones.length === 1) {
        elegido = conversaciones[0];
    } else {
        await enviarMensajeWhatsApp(from, `📋 Tenés más de una conversación abierta. Especificá cuál escribiendo *H*, el código y tu mensaje:\n\n${formatearOpcionesConversacion(conversaciones)}\n\nEjemplo: *H ${conversaciones[0].codigo} Ya salgo para allá*`);
        return true;
    }

    const remitente = elegido.rolPropio === 'dueño' ? 'El dueño' : 'La persona que encontró tu llavero';
    const textoFinal = `💬 *${remitente} te respondió:* "${mensaje}"\n\n✏️ Para seguir la conversación, escribí *H* seguido de tu mensaje. Por ejemplo:\n*H Ya salgo para allá*`;
    await enviarMensajeWhatsApp(elegido.destinatario, textoFinal);
    return true;
}

async function mostrarMenu(from) {
    const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nRespondé con la letra:\n\n*A.* Activar nuevo llavero\n*E.* Encontré un llavero\n*R.* Recuperar mi llavero en sucursal\n*P.* Perdí mi llavero\n*C.* Consultas o Reclamos`;
    await enviarMensajeWhatsApp(from, menuTexto);
}

async function ejecutarReportePerdida(from, llavero) {
    const yaReportado = await repo.obtenerEventoAbierto(llavero.codigo_llavero, 'perdida_reportada');
    if (!yaReportado) {
        await repo.crearEvento({ llavero_id: llavero.id, codigo_llavero: llavero.codigo_llavero, tipo: 'perdida_reportada', estado: 'abierto' });
    }

    const nombreLlavero = nombreParaTemplate(llavero);
    await enviarMensajeWhatsApp(from, `🫂 Quedó registrado que tu llavero *${nombreLlavero}* está perdido.\n\nEn cuanto alguien lo encuentre y escanee el código, te vamos a avisar automáticamente por acá.\n\nMientras tanto, quedate tranquilo/a — el sistema está atento. 💙`);
}

async function reportarPerdida(from) {
    const llaveros = await repo.obtenerLlaverosPorDueno(from);
    if (!llaveros || llaveros.length === 0) {
        await enviarMensajeWhatsApp(from, "⚠️ No encontramos ningún llavero activo a tu nombre.");
        return;
    }

    if (llaveros.length === 1) {
        await ejecutarReportePerdida(from, llaveros[0]);
        return;
    }

    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_perdida_ambiguo' });
    await enviarMensajeWhatsApp(from, `📋 Tenés más de un llavero activo. ¿Cuál perdiste?\n\n${formatearOpcionesLlavero(llaveros.map(llavero => ({ llavero })))}\n\nRespondé con el código de 8 caracteres correspondiente.`);
}

async function iniciarRegistro(from) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_registro' });
    await enviarMensajeWhatsApp(from, "💾 Ingresá el código de 8 caracteres (ej: AA0000AB):");
}

async function iniciarEncuentro(from) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_encuentro' });
    await enviarMensajeWhatsApp(from, "🔍 Ingresá el código de 8 caracteres del llavero encontrado:");
}

async function iniciarSesionRetiro(from, llavero, evento) {
    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_retiro', codigo_llavero: llavero.codigo_llavero, evento_id: evento.id });
    await enviarMensajeWhatsApp(from, "🔑 Ingresá el código de autorización que recibiste (lo tenés más arriba en este chat):");
}

async function iniciarRecupero(from) {
    const { llaveros, coincidencias } = await buscarEventosAbiertosDelDueno(from, 'custodia');
    if (llaveros.length === 0) {
        await enviarMensajeWhatsApp(from, "⚠️ No encontramos ningún llavero activo a tu nombre.");
        return;
    }
    if (coincidencias.length === 0) {
        await enviarMensajeWhatsApp(from, "⚠️ No tenés ningún llavero esperando en sucursal ahora mismo.");
        return;
    }
    if (coincidencias.length === 1) {
        await iniciarSesionRetiro(from, coincidencias[0].llavero, coincidencias[0].evento);
        return;
    }

    await repo.crearSesion({ telefono: from, estado: 'esperando_codigo_retiro_ambiguo' });
    await enviarMensajeWhatsApp(from, `📋 Tenés más de un llavero esperando en sucursal:\n\n${formatearOpcionesLlavero(coincidencias)}\n\nRespondé con el código de 8 caracteres del que querés retirar.`);
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

            const perdidaAbierta = await repo.obtenerEventoAbierto(textUpper, 'perdida_reportada');
            if (perdidaAbierta) {
                await repo.cerrarEvento(perdidaAbierta.id, { motivo_cierre: 'llavero_encontrado' });
            }

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
                    const mensajeAlDueño = `🔒 *Comunicación segura activada*\nEstás hablando con la persona que encontró tu llavero, sin compartir números de teléfono.\n\n💬 *Te escribió:* "${text}"\n\n✏️ Para responderle, escribí *H* seguido de tu mensaje. Por ejemplo:\n*H Gracias, ¿dónde puedo retirarlo?*\n\n🔒 Para terminar esta conversación, escribí *F*.`;
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

        case 'esperando_codigo_retiro_ambiguo': {
            const { coincidencias } = await buscarEventosAbiertosDelDueno(from, 'custodia');
            const elegido = coincidencias.find(c => c.llavero.codigo_llavero === textUpper);
            if (!elegido) {
                await enviarMensajeWhatsApp(from, "❌ Ese código no está entre los que tenés esperando en sucursal. Fijate arriba y probá de nuevo:");
                return;
            }
            await repo.actualizarSesion(sesion.id, { estado: 'esperando_codigo_retiro', codigo_llavero: elegido.llavero.codigo_llavero, evento_id: elegido.evento.id });
            await enviarMensajeWhatsApp(from, "🔑 Ingresá el código de autorización que recibiste (lo tenés más arriba en este chat):");
            return;
        }

        case 'esperando_codigo_perdida_ambiguo': {
            const llaveros = await repo.obtenerLlaverosPorDueno(from);
            const elegido = (llaveros || []).find(l => l.codigo_llavero === textUpper);
            if (!elegido) {
                await enviarMensajeWhatsApp(from, "❌ Ese código no está entre tus llaveros activos. Fijate arriba y probá de nuevo:");
                return;
            }
            await repo.cerrarSesion(sesion.id);
            await ejecutarReportePerdida(from, elegido);
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

            const mensajeDueño = `🚨 *GFinder AXION!*\n\nHola${nombrePropietario}, tu llavero *${nombreParaTemplate(llavero)}* está en la sucursal:\n\n📍 ${direccionEstacion}\n🔑 *Código de Retiro:* ${codigoRetiro}\n\n✅ ¡Ya podés ir a buscarlo! Al llegar a la sucursal, escribí *R* para retirarlo.`;
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

        let sesion = await repo.obtenerSesionActiva(from);

        if (sesion && sesion.ultima_interaccion) {
            const diferenciaSegundos = Math.floor((new Date() - new Date(sesion.ultima_interaccion)) / 1000);
            if (diferenciaSegundos > TIMEOUT_SESION_SEGUNDOS) {
                await repo.cancelarSesion(sesion.id, 'timeout_5min');
                sesion = null;
            }
        }

        // Los atajos F / H son para el dueño respondiendo fuera de cualquier
        // flujo guiado. Si hay una sesión activa (ej. finder eligiendo D/H/F
        // en su propio submenú), NO deben interceptar esas respuestas.
        //
        // Importante: los comandos explícitos (F, H mensaje) se revisan ANTES
        // que la revelación de notificaciones pendientes. Si no fuera así, un
        // backlog de notificaciones sin destrabar (algo común si el dueño no
        // responde seguido) se comería cualquier intento real de usar F/H,
        // revelando siempre "lo próximo de la cola" en vez de procesar el
        // comando — eso pasó en una prueba real.
        if (messageData.type === 'text' && !sesion) {
            const textoPlano = messageData.text.body.trim();
            const textoUpper = textoPlano.toUpperCase();

            const matchAtajoF = textoPlano.match(/^F(?:\s+([A-Za-z0-9]{8}))?$/i);
            if (matchAtajoF && await manejarAtajoF(from, matchAtajoF[1] ? matchAtajoF[1].toUpperCase() : null)) {
                return res.status(200).send('EVENT_RECEIVED');
            }

            const matchAtajoHConCodigo = textoPlano.match(/^H\s+([A-Za-z0-9]{8})\s+([\s\S]+)/i);
            if (matchAtajoHConCodigo && await manejarAtajoH(from, matchAtajoHConCodigo[2].trim(), matchAtajoHConCodigo[1].toUpperCase())) {
                return res.status(200).send('EVENT_RECEIVED');
            }

            const matchAtajoH = textoPlano.match(/^H\s+([\s\S]+)/i);
            if (matchAtajoH && await manejarAtajoH(from, matchAtajoH[1].trim())) {
                return res.status(200).send('EVENT_RECEIVED');
            }
            if (textoUpper === 'H') {
                await enviarMensajeWhatsApp(from, "✏️ Escribí *H* seguido de tu mensaje, por ejemplo:\n*H Gracias, ¿dónde estás?*");
                return res.status(200).send('EVENT_RECEIVED');
            }

            const notificacionPendiente = await buscarNotificacionPendientePorDueno(from);
            if (notificacionPendiente) {
                await repo.actualizarEvento(notificacionPendiente.id, { notificacion_pendiente: null, notificacion_enviada_en: null });
                await enviarMensajeWhatsApp(from, `${notificacionPendiente.notificacion_pendiente}\n\n_No hace falta que respondas nada más. Si necesitás algo, escribí *Hola*._`);
                return res.status(200).send('EVENT_RECEIVED');
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
            } else if (textUpper === 'P') {
                await reportarPerdida(from);
            } else if (textUpper === 'C') {
                await iniciarSoporte(from);
            } else if (textUpper === '9') {
                await iniciarPersonalAxion(from);
            } else if (/^(gracias|graci?as|muchas gracias|muy amable|ok|okay|dale|listo|genial|perfecto|joya|voy|ya voy|👍|🙏)[\s!.]*$/i.test(textUpper)) {
                await enviarMensajeWhatsApp(from, "🙌 ¡De nada! Cualquier cosa, escribí *Hola* para ver el menú.");
            } else {
                await mostrarMenu(from);
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
