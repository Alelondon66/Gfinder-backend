const repo = require('./repositorio');
const { enviarEmailAlternativo, registrarNotificacionPendienteEvento } = require('./notificaciones');
const { supabase, EMAIL_ADMINISTRACION, NOTIFICACION_TIMEOUT_MS, DIA_RESUMEN_SEMANAL, MAX_RECORDATORIOS_RETIRO } = require('./config');

// Corre cada 10 min: si pasó más de 1 hora sin que el dueño responda a la
// plantilla de WhatsApp, le avisamos al contacto alternativo por email.
async function revisarNotificacionesVencidas() {
    const limite = new Date(Date.now() - NOTIFICACION_TIMEOUT_MS).toISOString();
    const vencidas = await repo.obtenerEventosConNotificacionVencida(limite);

    if (!vencidas || vencidas.length === 0) return;

    for (const evento of vencidas) {
        const llavero = await repo.dbRead(supabase.from('llaveros').select('email_alternativo, nombre_dueno').eq('id', evento.llavero_id).maybeSingle(), 'select llaveros (notificacion vencida)');
        if (!llavero || !llavero.email_alternativo) continue;

        const asunto = 'VUELVE - Novedades sobre un llavero registrado';
        const cuerpo = `Hola,\n\nNo pudimos contactar por WhatsApp a ${llavero.nombre_dueno || 'quien registró este llavero'} para avisarle lo siguiente:\n\n${evento.notificacion_pendiente}\n\nTe llega este correo como contacto alternativo registrado en VUELVE, por si podés ayudar a contactarlo/a.\n\n— Equipo VUELVE`;

        const enviado = await enviarEmailAlternativo(llavero.email_alternativo, asunto, cuerpo);
        if (enviado) {
            await repo.actualizarEvento(evento.id, { notificacion_pendiente: null, notificacion_enviada_en: null });
        }
    }
}

// Corre una vez al día; los lunes junta todas las sesiones canceladas/
// abandonadas de la semana, manda un resumen por email y las purga de la base.
// Es idempotente: si corre más de una vez el mismo lunes, la segunda vez no
// encuentra sesiones canceladas pendientes y no hace nada.
async function enviarResumenYPurgarCancelados() {
    if (new Date().getDay() !== DIA_RESUMEN_SEMANAL) return;

    const canceladas = await repo.listarSesionesCanceladas();
    if (!canceladas || canceladas.length === 0) return;

    const filas = canceladas.map(s =>
        `- ${s.codigo_llavero || '(sin código)'} | ${s.telefono} | estado: ${s.estado} | motivo: ${s.motivo_cancelacion || 'desconocido'} | ${s.cancelado_en ? new Date(s.cancelado_en).toLocaleString('es-AR') : '-'}`
    ).join('\n');

    const cuerpo = `Resumen semanal de sesiones canceladas o abandonadas (${canceladas.length} registros):\n\n${filas}\n\nEstos registros se eliminan de la base luego de este envío.`;

    const enviado = await enviarEmailAlternativo(EMAIL_ADMINISTRACION, `VUELVE - Resumen semanal de cancelaciones (${canceladas.length})`, cuerpo);

    if (enviado) {
        await repo.purgarSesiones(canceladas.map(s => s.id));
    }
}

// Corre una vez al día. Mientras un llavero esté en custodia AXION sin
// retirar, manda un recordatorio (WhatsApp + email) los primeros 2 días.
// Al 3er chequeo sin retiro, avisa a administración para que un operador
// llame directamente, y deja de insistir solo.
async function revisarRecordatoriosRetiro() {
    const enCustodia = await repo.obtenerEventosCustodiaSinAvisoOperador();
    if (!enCustodia || enCustodia.length === 0) return;

    for (const custodia of enCustodia) {
        const enviados = custodia.recordatorios_retiro_enviados || 0;
        const llavero = await repo.dbRead(supabase.from('llaveros').select('telefono_dueno, email_alternativo, nombre_dueno, alias, codigo_llavero').eq('id', custodia.llavero_id).maybeSingle(), 'select llaveros (recordatorio retiro)');
        if (!llavero) continue;

        if (enviados < MAX_RECORDATORIOS_RETIRO) {
            const filasSucursal = await repo.dbRead(supabase.from('sucursales').select('direccion').eq('id_sucursal', String(custodia.sucursal_id).trim()), 'select sucursales (recordatorio retiro)');
            const direccionEstacion = (filasSucursal && filasSucursal.length > 0) ? filasSucursal[0].direccion : `Sucursal N° ${custodia.sucursal_id}`;
            const nombrePropietario = llavero.nombre_dueno ? ` ${llavero.nombre_dueno}` : "";

            const mensajeRecordatorio = `⏰ *Recordatorio VUELVE:* Hola${nombrePropietario}, tu llavero *${llavero.alias || custodia.codigo_llavero}* sigue esperando en:\n\n📍 ${direccionEstacion}\n🔑 *Código de Retiro:* ${custodia.codigo_retiro}`;
            await registrarNotificacionPendienteEvento(custodia.id, llavero.telefono_dueno, llavero.alias || custodia.codigo_llavero, mensajeRecordatorio);

            if (llavero.email_alternativo) {
                await enviarEmailAlternativo(
                    llavero.email_alternativo,
                    'VUELVE - Recordatorio: llavero esperando en sucursal',
                    `Hola,\n\nEl llavero ${custodia.codigo_llavero} de ${llavero.nombre_dueno || 'quien lo registró'} todavía está esperando ser retirado en sucursal.\n\nTe llega este correo como contacto alternativo registrado en VUELVE.\n\n— Equipo VUELVE`
                );
            }

            await repo.actualizarEvento(custodia.id, { recordatorios_retiro_enviados: enviados + 1, ultimo_recordatorio_retiro_en: new Date() });
        } else {
            await enviarEmailAlternativo(
                EMAIL_ADMINISTRACION,
                'VUELVE - Llavero sin retirar hace 2 días: requiere llamado',
                `El llavero ${custodia.codigo_llavero} (dueño: ${llavero.nombre_dueno || '-'}, tel. ${llavero.telefono_dueno}) sigue en la sucursal ${custodia.sucursal_id} sin retirar hace 2 días.\n\nRequiere que un operador llame directamente para coordinar el retiro.`
            );
            await repo.actualizarEvento(custodia.id, { aviso_operador_enviado_en: new Date() });
        }
    }
}

function iniciarJobs() {
    setInterval(() => {
        revisarNotificacionesVencidas().catch(err => console.error('❌ Error revisando notificaciones vencidas:', err.message));
    }, 10 * 60 * 1000);

    setInterval(() => {
        enviarResumenYPurgarCancelados().catch(err => console.error('❌ Error en resumen semanal de cancelados:', err.message));
    }, 24 * 60 * 60 * 1000);

    setInterval(() => {
        revisarRecordatoriosRetiro().catch(err => console.error('❌ Error en recordatorios de retiro:', err.message));
    }, 24 * 60 * 60 * 1000);
}

module.exports = { iniciarJobs };
