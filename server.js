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
    const regexFormato = /^[A-Z]{3}[0-9]{4}[A-Z]$/;
    if (!regexFormato.test(clean)) return false;

    const letras = clean.substring(0, 3);
    const numeros = clean.substring(3, 7);
    const digitoRecibido = clean.charAt(7);

    let suma = 0;
    for (let i = 0; i < 3; i++) {
        suma += (letras.charCodeAt(i) - 64) * (i + 1);
    }
    for (let i = 0; i < 4; i++) {
        suma += parseInt(numeros.charAt(i)) * (i + 4);
    }

    const resto = (suma % 26);
    const digitoTeorico = String.fromCharCode(65 + resto);

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

// 2. ENDPOINT PRINCIPAL (RECEPCIÓN Y LÓGICA)
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

            // 🛡️ FILTRO DE SEGURIDAD CONTRA BUCLES INDEVIDOS
            if (value.statuses || from === process.env.WA_PHONE_NUMBER_ID) {
                return res.status(200).send('EVENT_RECEIVED');
            }

            if (messageData.type === 'text') {
                const text = messageData.text.body.trim().toUpperCase();
                console.log(`💬 Mensaje de [${from}]: "${text}"`);

                // Buscar proceso activo (no completado)
                const { data: usuarioProceso } = await supabase
                    .from('llaveros')
                    .select('*')
                    .eq('telefono_usuario', from)
                    .neq('estado', 'completado')
                    .order('fecha_registro', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                // ---------------------------------------------------------
                // FLUJO A: SIN PROCESO ACTIVO (MENÚ PRINCIPAL)
                // ---------------------------------------------------------
                if (!usuarioProceso) {
                    if (text === 'HOLA' || text === 'MENU' || text === 'INICIO' || text === 'CANCELAR') {
                        const menuTexto = `¡Bienvenido a *GFinder AXION*! 🔑🔍\n\nPor favor, elegí una opción respondiendo con el número:\n\n*1.* Activar llavero\n*2.* Encontré un llavero`;
                        await enviarMensajeWhatsApp(from, menuTexto);
                    } 
                    else if (text === '1') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_registro', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "💾 ¡Perfecto! Vamos a registrar tu llavero. Por favor, ingresá el código de 8 caracteres (ejemplo: ABC1234X).");
                    } 
                    else if (text === '2') {
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_codigo_encuentro', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "🔍 ¡Muchas gracias por reportarlo! Por favor, indícanos el código de 8 caracteres del llavero encontrado.");
                    } 
                    else if (text === '9') {
                        // Opción oculta para personal de la estación
                        await supabase.from('llaveros').insert([{ telefono_usuario: from, estado: 'esperando_sucursal_personal', fecha_registro: new Date() }]);
                        await enviarMensajeWhatsApp(from, "⛽ *Acceso Personal AXION*\n\nPor favor, ingresá el número de sucursal (4 dígitos):");
                    } 
                    else {
                        await enviarMensajeWhatsApp(from, "🤖 Escribí *Hola* para ver el menú de opciones.");
                    }
                } 
                
                // ---------------------------------------------------------
                // FLUJO B: CON PROCESO ACTIVO (ACCIONES PASO A PASO)
                // ---------------------------------------------------------
                else {
                    if (text === 'CANCELAR' || text === 'MENU') {
                        await supabase.from('llaveros').delete().eq('id', usuarioProceso.id);
                        await enviarMensajeWhatsApp(from, "🔄 Proceso cancelado. Escribí *Hola* para volver a empezar.");
                        return res.status(200).send('EVENT_RECEIVED');
                    }

                    // --- PASO 1: OPCIÓN 1 (GUARDAR CÓDIGO NUEVO) ---
                    if (usuarioProceso.estado === 'esperando_codigo_registro') {
                        if (!validarCodigoGFinder(text)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Debe tener 3 letras, 4 números y la letra de control final. Intentá de nuevo o escribí *Cancelar*.");
                        } else {
                            await supabase.from('llaveros').update({ codigo_llavero: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "🎉 ¡Espectacular! Tu llavero ha sido activado con éxito. Tu información ya está protegida.");
                        }
                    }

                    // --- PASO 2: OPCIÓN 2 (VALIDAR CÓDIGO ENCONTRADO) ---
                    else if (usuarioProceso.estado === 'esperando_codigo_encuentro') {
                        if (!validarCodigoGFinder(text)) {
                            await enviarMensajeWhatsApp(from, "❌ Código inválido. Intentá de nuevo o escribí *Cancelar*.");
                        } else {
                            // Avanzamos al submenú de la opción 2 guardando temporalmente el código validado
                            await supabase.from('llaveros').update({ codigo_llavero: text, estado: 'esperando_subopcion_encuentro' }).eq('id', usuarioProceso.id);
                            const subMenuEncuentro = `✅ ¡Código verificado!\n\n¿Qué deseas hacer ahora? Selecciona el número:\n\n*1.* Donde devolverlo\n*2.* Contactar al dueño`;
                            await enviarMensajeWhatsApp(from, subMenuEncuentro);
                        }
                    }

                    // --- PASO 2.1: PROCESAR SUBMENÚ DE OPCIÓN 2 ---
                    else if (usuarioProceso.estado === 'esperando_subopcion_encuentro') {
                        if (text === '1') {
                            await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📍 Podés acercar el llavero a cualquiera de nuestras estaciones de servicio AXION oficiales. ¡El personal se encargará del resto! Muchas gracias.");
                        } else if (text === '2') {
                            await supabase.from('llaveros').update({ estado: 'completado' }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, "📲 Entendido. El sistema procesará la solicitud y notificará internamente para coordinar el contacto de forma segura. ¡Gracias por tu enorme ayuda!");
                        } else {
                            await enviarMensajeWhatsApp(from, "⚠️ Opción inválida. Respondé con *1* (Donde devolverlo) o *2* (Contactar al dueño).");
                        }
                    }

                    // --- PASO 3: OPCIÓN 9 (PERSONAL - PASO 1: SUCURSAL) ---
                    else if (usuarioProceso.estado === 'esperando_sucursal_personal') {
                        const regexSucursal = /^[0-9]{4}$/;
                        if (!regexSucursal.test(text)) {
                            await enviarMensajeWhatsApp(from, "❌ El número de sucursal debe ser exactamente de 4 números. Intentá de nuevo:");
                        } else {
                            // Guardamos la sucursal provisoriamente en el estado o notas si tuvieras, por ahora cambiamos estado:
                            await supabase.from('llaveros').update({ estado: `esperando_codigo_personal_suc_${text}` }).eq('id', usuarioProceso.id);
                            await enviarMensajeWhatsApp(from, `⛽ Sucursal [${text}] registrada.\n\nAhora, ingresá o escaneá el código de 8 caracteres del llavero custodiado:`);
                        }
                    }

                    // --- PASO 3.1: OPCIÓN 9 (PERSONAL - PASO 2: CÓDIGO LLAVERO) ---
                    else if (usuarioProceso.estado.startsWith('esperando_codigo_personal_suc_')) {
                        const sucursal = usuarioProceso.estado.replace('esperando_codigo_personal_suc_', '');
                        if (!validarCodigoGFinder(text)) {
                            await enviarMensajeWhatsApp(from, "❌ Código de llavero inválido. Por favor, revísalo e ingresalo de nuevo:");
                        } else {
                            // Completamos el registro del empleado
                            await supabase.from('llaveros').update({ codigo_llavero: text, estado: 'completado' }).eq('id', usuarioProceso.id);
                            
                            // Confirmación al empleado
                            await enviarMensajeWhatsApp(from, `⚙️ Registro completado para Sucursal ${sucursal}. Sistema procesando alertas.`);

                            // 🚨 NOTIFICACIÓN AL DUEÑO (Simulada / Flujo conceptual de aviso)
                            // En una fase posterior buscaremos el celular real del dueño asociado a este código en Supabase.
                            // Por ahora dejamos el aviso listo para desarrollo:
                            console.log(`🚨 ALERTA: Notificar al dueño del llavero ${text} que está en Sucursal ${sucursal}`);
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
    console.log(`🚀 Servidor GFinder 2026 corriendo en puerto ${PORT}`);
});
