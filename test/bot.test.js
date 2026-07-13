const { test, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Cargamos los módulos reales UNA vez y reemplazamos sus funciones por mocks
// antes de cargar bot.js. Como bot.js usa `repo.algo(...)` (namespace, no
// desestructurado), los reemplazos siguen "vivos" en cada test. notificaciones.js
// sí se desestructura en bot.js, así que ahí reusamos siempre la misma
// referencia de función y solo cambiamos su implementación entre tests.
const repositorio = require('../src/repositorio');
const notificaciones = require('../src/notificaciones');

for (const nombre of Object.keys(repositorio)) {
    repositorio[nombre] = mock.fn(repositorio[nombre]);
}
for (const nombre of Object.keys(notificaciones)) {
    notificaciones[nombre] = mock.fn(notificaciones[nombre]);
}

const { procesarMensajeWebhook } = require('../src/bot');

function crearReq(from, texto) {
    return {
        body: {
            object: 'whatsapp_business_account',
            entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body: texto } }] } }] }]
        }
    };
}

function crearRes() {
    return {
        _status: null,
        _body: null,
        status(code) { this._status = code; return this; },
        send(body) { this._body = body; return this; },
        sendStatus(code) { this._status = code; return this; }
    };
}

beforeEach(() => {
    Object.values(repositorio).forEach(fn => fn.mock.resetCalls());
    Object.values(notificaciones).forEach(fn => fn.mock.resetCalls());

    // Defaults seguros para no pegarle a la red real en ningún test.
    repositorio.dbRead.mock.mockImplementation(async () => null);
    repositorio.dbWrite.mock.mockImplementation(async () => true);
    repositorio.obtenerLlaveroPorDueno.mock.mockImplementation(async () => null);
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => []);
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => null);
    repositorio.crearSesion.mock.mockImplementation(async () => ({ id: 100 }));
    repositorio.actualizarSesion.mock.mockImplementation(async () => true);
    repositorio.cancelarSesion.mock.mockImplementation(async () => true);
    repositorio.cerrarSesion.mock.mockImplementation(async () => true);
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);
    repositorio.crearLlavero.mock.mockImplementation(async () => ({ id: 1 }));
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => null);
    repositorio.obtenerEventoPorId.mock.mockImplementation(async () => null);
    repositorio.crearEvento.mock.mockImplementation(async () => ({ id: 200 }));
    repositorio.actualizarEvento.mock.mockImplementation(async () => true);
    repositorio.cerrarEvento.mock.mockImplementation(async () => true);

    notificaciones.enviarMensajeWhatsApp.mock.mockImplementation(async () => {});
    notificaciones.enviarEmailAlternativo.mock.mockImplementation(async () => true);
    notificaciones.registrarNotificacionPendienteEvento.mock.mockImplementation(async () => {});
});

test('sin sesión, un agradecimiento ("gracias") recibe una respuesta cálida, no el genérico', async () => {
    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'Gracias!'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /De nada/);
});

test('al revelar una notificación pendiente, se agrega una nota de cierre para no invitar a responder', async () => {
    repositorio.obtenerLlaveroPorDueno.mock.mockImplementation(async () => ({ id: 5, telefono_dueno: '5491111111' }));
    repositorio.dbRead.mock.mockImplementation(async () => [{ id: 300, notificacion_pendiente: 'Tu llavero está en la sucursal X.' }]);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'hola'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Tu llavero está en la sucursal X/);
    assert.match(texto, /No hace falta que respondas/);
});

test('sin sesión, un mensaje no reconocido muestra el menú directo (sin pedir que escriba Hola)', async () => {
    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'no entiendo qué hago'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Bienvenido/);
});

test('"P" sin llavero activo avisa que no encontró nada a tu nombre', async () => {
    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'P'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 0);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /No encontramos ningún llavero/);
});

test('"P" con llavero activo registra el evento de pérdida y tranquiliza al dueño', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => null);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'P'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 1);
    const [datos] = repositorio.crearEvento.mock.calls[0].arguments;
    assert.equal(datos.tipo, 'perdida_reportada');
    assert.equal(datos.codigo_llavero, 'AA1111AT');
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Auto de Ale/);
    assert.match(texto, /quedate tranquilo/i);
});

test('"P" repetido sobre un llavero ya reportado no duplica el evento', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({ id: 900 }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'P'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 0);
});

test('al encontrarse un llavero con una pérdida reportada abierta, esa pérdida se cierra sola', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5492222222', estado: 'esperando_codigo_encuentro', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', nombre_dueno: 'Ale'
    }));
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({ id: 900 }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'AA1111AT'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 900);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[1].motivo_cierre, 'llavero_encontrado');
});

test('"P" con dos llaveros activos pregunta cuál perdiste, en vez de asumir el más reciente', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'P'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 0);
    assert.equal(repositorio.crearSesion.mock.calls.length, 1);
    assert.equal(repositorio.crearSesion.mock.calls[0].arguments[0].estado, 'esperando_codigo_perdida_ambiguo');
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Moto/);
    assert.match(texto, /Auto de Ale/);
});

test('al responder el código en la desambiguación de "P", reporta la pérdida del llavero correcto', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_perdida_ambiguo', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'BB2222BW'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 1);
    assert.equal(repositorio.crearEvento.mock.calls[0].arguments[0].codigo_llavero, 'BB2222BW');
});

test('"R" con dos llaveros esperando en sucursal pregunta cuál retirar', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({ id: 900, codigo_retiro: 1234 }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'R'), res);

    assert.equal(repositorio.crearSesion.mock.calls.length, 1);
    assert.equal(repositorio.crearSesion.mock.calls[0].arguments[0].estado, 'esperando_codigo_retiro_ambiguo');
});

test('atajo "F" con dos conversaciones abiertas pide especificar el código', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({ id: 300, telefono_finder: '5492222222' }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'F'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 0);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /más de una conversación/i);
});

test('atajo "F CODIGO" con dos conversaciones abiertas cierra la correcta sin ambigüedad', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async (codigo) =>
        codigo === 'AA1111AT' ? { id: 300, telefono_finder: '5492222222' } : { id: 301, telefono_finder: '5493333333' }
    );

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'F AA1111AT'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 300);
});

test('sin sesión, "Hola" muestra el menú con las 4 opciones', async () => {
    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'Hola'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /\*A\.\*/);
    assert.match(texto, /\*E\.\*/);
    assert.match(texto, /\*R\.\*/);
    assert.match(texto, /\*C\.\*/);
});

test('sin sesión, "A" crea una sesión de registro', async () => {
    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'A'), res);

    assert.equal(repositorio.crearSesion.mock.calls.length, 1);
    const [args] = repositorio.crearSesion.mock.calls[0].arguments;
    assert.equal(args.estado, 'esperando_codigo_registro');
});

test('esperando_codigo_registro con código inválido reprompt sin cambiar de estado', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_registro', ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'XXXXXXXX'), res);

    // Solo debe registrarse el "touch" de ultima_interaccion, sin cambio de estado.
    assert.equal(repositorio.actualizarSesion.mock.calls.length, 1);
    assert.deepEqual(repositorio.actualizarSesion.mock.calls[0].arguments[1], {});
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Código inválido/);
});

test('esperando_codigo_registro con código ya activado cancela la sesión', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_registro', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({ id: 5, codigo_llavero: 'AA1111AT' }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'AA1111AT'), res);

    assert.equal(repositorio.cancelarSesion.mock.calls.length, 1);
    assert.equal(repositorio.cancelarSesion.mock.calls[0].arguments[1], 'codigo_ya_activado');
});

test('esperando_codigo_registro con código libre avanza a pedir nombre', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_registro', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'AA1111AT'), res);

    // Dos llamadas: el "touch" de ultima_interaccion y el cambio de estado real.
    assert.equal(repositorio.actualizarSesion.mock.calls.length, 2);
    const [, campos] = repositorio.actualizarSesion.mock.calls[1].arguments;
    assert.equal(campos.estado, 'esperando_nombre_registro');
    assert.equal(campos.codigo_llavero, 'AA1111AT');
});

test('confirmación "1" crea el llavero con el alias cargado y cierra la sesión', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_confirmacion_alta',
        codigo_llavero: 'AA1111AT', nombre_borrador: 'Ale', alias_borrador: 'Auto de Ale',
        email_borrador: 'ale@test.com', ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '1'), res);

    assert.equal(repositorio.crearLlavero.mock.calls.length, 1);
    const [datos] = repositorio.crearLlavero.mock.calls[0].arguments;
    assert.equal(datos.codigo_llavero, 'AA1111AT');
    assert.equal(datos.alias, 'Auto de Ale');
    assert.equal(datos.telefono_dueno, '5491111111');
    assert.equal(repositorio.cerrarSesion.mock.calls.length, 1);
});

test('confirmación "2" cancela la sesión sin crear el llavero', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_confirmacion_alta', ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '2'), res);

    assert.equal(repositorio.crearLlavero.mock.calls.length, 0);
    assert.equal(repositorio.cancelarSesion.mock.calls.length, 1);
    assert.equal(repositorio.cancelarSesion.mock.calls[0].arguments[1], 'usuario_rechazo_confirmacion');
});

test('código de encuentro válido crea un evento tipo "encuentro" con el finder', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5492222222', estado: 'esperando_codigo_encuentro', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', nombre_dueno: 'Ale'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'AA1111AT'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 1);
    const [datos] = repositorio.crearEvento.mock.calls[0].arguments;
    assert.equal(datos.tipo, 'encuentro');
    assert.equal(datos.telefono_finder, '5492222222');
    assert.equal(notificaciones.registrarNotificacionPendienteEvento.mock.calls.length, 1);
});

test('código de encuentro inexistente no crea evento', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5492222222', estado: 'esperando_codigo_encuentro', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'AA1111AT'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 0);
});

test('atajo "F" del dueño cierra el evento abierto y avisa a ambas partes', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({
        id: 300, telefono_finder: '5492222222'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'F'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 300);
    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
});

test('atajo "H" del dueño funciona aunque el mensaje venga en otra línea (bug reportado)', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({
        id: 300, telefono_finder: '5492222222'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'H\nMuchas gracias, ¿dónde estás?'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [destino, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.equal(destino, '5492222222');
    assert.match(texto, /Muchas gracias/);
});

test('"H" solo, sin sesión activa, pide el formato correcto', async () => {
    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'H'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /seguido de tu mensaje/);
});

test('"H" solo, con sesión activa en el submenú de encuentro, se procesa como elección del submenú (no como atajo)', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5492222222', estado: 'esperando_subopcion_encuentro',
        evento_id: 300, ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'H'), res);

    assert.equal(repositorio.actualizarSesion.mock.calls.length, 2);
    assert.equal(repositorio.actualizarSesion.mock.calls[1].arguments[1].estado, 'esperando_mensaje_anonimo');
});

test('código incorrecto en el retiro descuenta intentos y bloquea al tercer error', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_retiro',
        codigo_llavero: 'AA1111AT', evento_id: 300, intentos_codigo_retiro: 2,
        ultima_interaccion: new Date()
    }));
    repositorio.obtenerEventoPorId.mock.mockImplementation(async () => ({ id: 300, codigo_retiro: 9999 }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '1234'), res);

    assert.equal(repositorio.cancelarSesion.mock.calls.length, 1);
    assert.equal(repositorio.cancelarSesion.mock.calls[0].arguments[1], 'retiro_bloqueado_intentos');
    assert.equal(notificaciones.enviarEmailAlternativo.mock.calls.length, 1);
});

test('código correcto en el retiro avanza a pedir confirmación', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_retiro',
        codigo_llavero: 'AA1111AT', evento_id: 300, intentos_codigo_retiro: 0,
        ultima_interaccion: new Date()
    }));
    repositorio.obtenerEventoPorId.mock.mockImplementation(async () => ({ id: 300, codigo_retiro: 4321 }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '4321'), res);

    assert.equal(repositorio.actualizarSesion.mock.calls.length, 2);
    assert.equal(repositorio.actualizarSesion.mock.calls[1].arguments[1].estado, 'esperando_confirmacion_retiro');
});

test('sesión con más de 5 minutos sin interacción se cancela por timeout', async () => {
    const hace10min = new Date(Date.now() - 10 * 60 * 1000);
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_registro', ultima_interaccion: hace10min
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'HOLA'), res);

    assert.equal(repositorio.cancelarSesion.mock.calls.length, 1);
    assert.equal(repositorio.cancelarSesion.mock.calls[0].arguments[1], 'timeout_5min');
    // Al quedar sin sesión, "HOLA" debe mostrar el menú (no seguir en el flujo viejo).
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Bienvenido/);
});
