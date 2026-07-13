const { supabase } = require('./config');

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

async function dbInsertUno(promise, contexto) {
    const { data, error } = await promise;
    if (error) {
        console.error(`❌ Supabase [${contexto}]:`, error.message);
        return null;
    }
    return data && data[0] ? data[0] : null;
}

// ---------- Llaveros (el objeto físico + su dueño) ----------

function obtenerLlaveroPorCodigo(codigo) {
    return dbRead(supabase.from('llaveros').select('*').eq('codigo_llavero', codigo).eq('activo', true).maybeSingle(), 'select llaveros (por codigo)');
}

function obtenerLlaveroPorDueno(telefono) {
    return dbRead(supabase.from('llaveros').select('*').eq('telefono_dueno', telefono).eq('activo', true).order('creado_en', { ascending: false }).limit(1).maybeSingle(), 'select llaveros (por dueño)');
}

// A diferencia de obtenerLlaveroPorDueno, trae TODOS los llaveros activos de
// ese teléfono (una persona puede tener más de uno registrado a su nombre).
function obtenerLlaverosPorDueno(telefono) {
    return dbRead(supabase.from('llaveros').select('*').eq('telefono_dueno', telefono).eq('activo', true).order('creado_en', { ascending: false }), 'select llaveros (todos por dueño)');
}

function crearLlavero({ codigo_llavero, alias, telefono_dueno, nombre_dueno, email_alternativo }) {
    return dbInsertUno(supabase.from('llaveros').insert([{ codigo_llavero, alias, telefono_dueno, nombre_dueno, email_alternativo, activo: true, creado_en: new Date() }]).select(), 'insert llaveros');
}

function contarLlaverosActivos() {
    return supabase.from('llaveros').select('id', { count: 'exact', head: true }).eq('activo', true);
}

// ---------- Sesiones (dónde está parado el usuario en la conversación) ----------

function obtenerSesionActiva(telefono) {
    return dbRead(supabase.from('sesiones').select('*').eq('telefono', telefono).is('cancelado_en', null).order('creado_en', { ascending: false }).limit(1).maybeSingle(), 'select sesiones (activa)');
}

function crearSesion({ telefono, estado, codigo_llavero = null, evento_id = null, sucursal_id = null }) {
    return dbInsertUno(supabase.from('sesiones').insert([{
        telefono, estado, codigo_llavero, evento_id, sucursal_id,
        intentos_codigo_retiro: 0,
        ultima_interaccion: new Date(),
        creado_en: new Date()
    }]).select(), 'insert sesiones');
}

function actualizarSesion(id, campos) {
    return dbWrite(supabase.from('sesiones').update({ ...campos, ultima_interaccion: new Date() }).eq('id', id), 'update sesiones');
}

function cancelarSesion(id, motivo) {
    return dbWrite(supabase.from('sesiones').update({ cancelado_en: new Date(), motivo_cancelacion: motivo }).eq('id', id), 'update sesiones (cancelar)');
}

function cerrarSesion(id) {
    return dbWrite(supabase.from('sesiones').delete().eq('id', id), 'delete sesiones (cierre normal)');
}

function listarSesionesCanceladas() {
    return dbRead(supabase.from('sesiones').select('id, telefono, codigo_llavero, estado, motivo_cancelacion, cancelado_en').not('cancelado_en', 'is', null).order('cancelado_en', { ascending: true }), 'select sesiones (canceladas)');
}

function purgarSesiones(ids) {
    return dbWrite(supabase.from('sesiones').delete().in('id', ids), 'delete sesiones (purga)');
}

// ---------- Eventos (cada incidente: alguien encuentra, AXION custodia, se retira) ----------

function obtenerEventoAbierto(codigoLlavero, tipo) {
    return dbRead(supabase.from('eventos').select('*').eq('codigo_llavero', codigoLlavero).eq('tipo', tipo).neq('estado', 'cerrado').neq('estado', 'retirado').order('creado_en', { ascending: false }).limit(1).maybeSingle(), 'select eventos (abierto)');
}

function obtenerEventoPorId(id) {
    return dbRead(supabase.from('eventos').select('*').eq('id', id).maybeSingle(), 'select eventos (por id)');
}

function crearEvento({ llavero_id, codigo_llavero, tipo, estado, telefono_finder = null, sucursal_id = null, codigo_retiro = null }) {
    return dbInsertUno(supabase.from('eventos').insert([{
        llavero_id, codigo_llavero, tipo, estado, telefono_finder, sucursal_id, codigo_retiro,
        recordatorios_retiro_enviados: 0,
        creado_en: new Date()
    }]).select(), 'insert eventos');
}

function actualizarEvento(id, campos) {
    return dbWrite(supabase.from('eventos').update(campos).eq('id', id), 'update eventos');
}

function cerrarEvento(id, camposExtra = {}) {
    return dbWrite(supabase.from('eventos').update({ estado: 'cerrado', cerrado_en: new Date(), ...camposExtra }).eq('id', id), 'update eventos (cerrar)');
}

function obtenerEventosConNotificacionVencida(limiteIso) {
    return dbRead(supabase.from('eventos').select('id, llavero_id, notificacion_pendiente').not('notificacion_pendiente', 'is', null).lt('notificacion_enviada_en', limiteIso), 'select eventos (notificaciones vencidas)');
}

function obtenerEventosCustodiaSinAvisoOperador() {
    return dbRead(supabase.from('eventos').select('id, llavero_id, codigo_llavero, sucursal_id, codigo_retiro, recordatorios_retiro_enviados').eq('tipo', 'custodia').eq('estado', 'en_custodia').is('aviso_operador_enviado_en', null), 'select eventos (custodia pendiente de retiro)');
}

function obtenerEventosCustodiaHistorico() {
    return dbRead(supabase.from('eventos').select('sucursal_id').eq('tipo', 'custodia'), 'select eventos (historico custodia)');
}

function contarEventos(tipo, estado) {
    return supabase.from('eventos').select('id', { count: 'exact', head: true }).eq('tipo', tipo).eq('estado', estado);
}

function contarLlaverosConEventoTipo(tipo) {
    return supabase.from('eventos').select('llavero_id', { count: 'exact', head: true }).eq('tipo', tipo);
}

module.exports = {
    dbRead, dbWrite,
    obtenerLlaveroPorCodigo, obtenerLlaveroPorDueno, obtenerLlaverosPorDueno, crearLlavero, contarLlaverosActivos,
    obtenerSesionActiva, crearSesion, actualizarSesion, cancelarSesion, cerrarSesion, listarSesionesCanceladas, purgarSesiones,
    obtenerEventoAbierto, obtenerEventoPorId, crearEvento, actualizarEvento, cerrarEvento,
    obtenerEventosConNotificacionVencida, obtenerEventosCustodiaSinAvisoOperador, obtenerEventosCustodiaHistorico,
    contarEventos, contarLlaverosConEventoTipo
};
