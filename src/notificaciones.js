const { axios, axiosWhatsApp, WA_TEMPLATE_NOTIFICACION, WA_TEMPLATE_LANG, EMAIL_ADMINISTRACION } = require('./config');
const repositorio = require('./repositorio');

async function conReintentos(fn, descripcion, intentos = 3) {
    let ultimoError;
    for (let intento = 1; intento <= intentos; intento++) {
        try {
            return await fn();
        } catch (error) {
            ultimoError = error;
            console.error(`⚠️ Intento ${intento}/${intentos} falló (${descripcion}):`, error.response?.data || error.message);
            if (intento < intentos) {
                await new Promise(resolve => setTimeout(resolve, 1000 * intento));
            }
        }
    }
    throw ultimoError;
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
        await conReintentos(() => axiosWhatsApp.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }), `WhatsApp texto a ${telefonoDestino}`);
        console.log(`📤 Mensaje enviado a [${telefonoDestino}]`);
    } catch (error) {
        console.error('❌ Error Meta (agotados los reintentos):', error.response?.data || error.message);
        await enviarEmailAlternativo(
            EMAIL_ADMINISTRACION,
            'VUELVE - Fallo al enviar WhatsApp',
            `No se pudo enviar un mensaje de WhatsApp a ${telefonoDestino} tras varios intentos.\n\nTexto: ${textoEnviar}\n\nError: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`
        );
    }
}

async function enviarPlantillaWhatsApp(telefonoDestino, textoParametro) {
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
                parameters: [{ type: "text", text: textoParametro }]
            }]
        }
    };

    try {
        await conReintentos(() => axiosWhatsApp.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }), `WhatsApp plantilla a ${telefonoDestino}`);
        console.log(`📤 Plantilla enviada a [${telefonoDestino}]`);
    } catch (error) {
        console.error('❌ Error Meta (plantilla, agotados los reintentos):', error.response?.data || error.message);
        await enviarEmailAlternativo(
            EMAIL_ADMINISTRACION,
            'VUELVE - Fallo al enviar plantilla de WhatsApp',
            `No se pudo enviar la plantilla de WhatsApp a ${telefonoDestino} (parámetro: ${textoParametro}) tras varios intentos.\n\nError: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`
        );
    }
}

async function enviarEmailAlternativo(destinatario, asunto, cuerpo) {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        console.log(`✉️  Email pendiente (Resend no configurado todavía) para ${destinatario}: ${asunto}`);
        return false;
    }
    try {
        await conReintentos(() => axios.post('https://api.resend.com/emails', {
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
        }), `Email a ${destinatario}`);
        console.log(`✉️  Email enviado a [${destinatario}]`);
        return true;
    } catch (error) {
        console.error('❌ Error Resend (agotados los reintentos):', error.response?.data || error.message);
        return false;
    }
}

// Manda la plantilla aprobada (abre la ventana de 24hs) y deja guardado el detalle
// que se le va a revelar al dueño en texto libre recién cuando responda.
async function registrarNotificacionPendienteEvento(eventoId, telefonoDueno, textoParametroPlantilla, detalleTexto) {
    await enviarPlantillaWhatsApp(telefonoDueno, textoParametroPlantilla);
    await repositorio.actualizarEvento(eventoId, {
        notificacion_pendiente: detalleTexto,
        notificacion_enviada_en: new Date()
    });
}

module.exports = { enviarMensajeWhatsApp, enviarPlantillaWhatsApp, enviarEmailAlternativo, registrarNotificacionPendienteEvento };
