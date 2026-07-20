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
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => []);
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => null);
    repositorio.crearSesion.mock.mockImplementation(async () => ({ id: 100 }));
    repositorio.actualizarSesion.mock.mockImplementation(async () => true);
    repositorio.cancelarSesion.mock.mockImplementation(async () => true);
    repositorio.cerrarSesion.mock.mockImplementation(async () => true);
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);
    repositorio.crearLlavero.mock.mockImplementation(async () => ({ id: 1 }));
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => null);
    repositorio.obtenerEventosAbiertosPorFinder.mock.mockImplementation(async () => []);
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

test('al revelar una notificación pendiente, se agrega una nota de cierre', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [{ id: 5, telefono_dueno: '5491111111' }]);
    repositorio.dbRead.mock.mockImplementation(async () => [{ id: 300, notificacion_pendiente: 'Tu llavero está en la sucursal X.' }]);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'hola'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Tu llavero está en la sucursal X/);
    assert.match(texto, /escribí \*Hola\*/);
});

test('la notificación pendiente se encuentra aunque esté en un llavero que NO es el más reciente (bug reportado)', async () => {
    // El dueño tiene dos llaveros; el aviso pendiente pertenece al primero (el más viejo).
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, telefono_dueno: '5491111111' }, // más reciente, sin nada pendiente
        { id: 5, telefono_dueno: '5491111111' }  // más viejo, con el aviso pendiente
    ]);
    repositorio.dbRead.mock.mockImplementation(async (promesa, contexto) => {
        if (contexto === 'select eventos (notificacion pendiente por dueño)') {
            return [{ id: 300, notificacion_pendiente: 'Perdiste tu llavero? Parece que lo encontraron.' }];
        }
        return null;
    });

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'HOLA'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Parece que lo encontraron/);
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
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async (codigo, tipo) =>
        tipo === 'perdida_reportada' ? { id: 900 } : null
    );

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'AA1111AT'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 900);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[1].motivo_cierre, 'objeto_encontrado');
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

test('al responder con el NÚMERO en la desambiguación de "P", reporta la pérdida del llavero correcto', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_perdida_ambiguo', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '2'), res);

    // El "2" corresponde al segundo de la lista mostrada: AA1111AT.
    assert.equal(repositorio.crearEvento.mock.calls.length, 1);
    assert.equal(repositorio.crearEvento.mock.calls[0].arguments[0].codigo_llavero, 'AA1111AT');
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
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /\*1\.\*/);
    assert.match(texto, /\*2\.\*/);
});

test('al responder con el NÚMERO en la desambiguación de "R", arranca el retiro del llavero correcto', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_codigo_retiro_ambiguo', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({ id: 900, codigo_retiro: 1234 }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '1'), res);

    assert.equal(repositorio.actualizarSesion.mock.calls.length, 2);
    assert.equal(repositorio.actualizarSesion.mock.calls[1].arguments[1].codigo_llavero, 'BB2222BW');
    assert.equal(repositorio.actualizarSesion.mock.calls[1].arguments[1].estado, 'esperando_codigo_retiro');
});

test('atajo "F" con dos conversaciones abiertas pide especificar el número', async () => {
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

test('atajo "F 2" (por número) con dos conversaciones abiertas cierra la correcta', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async (codigo) =>
        codigo === 'AA1111AT' ? { id: 300, telefono_finder: '5492222222' } : { id: 301, telefono_finder: '5493333333' }
    );

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'F 2'), res);

    // La opción 2 de la lista es AA1111AT (segundo llavero devuelto).
    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 300);
});

test('atajo "H 2 mensaje" (por número) con dos conversaciones abiertas llega al finder correcto', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 6, codigo_llavero: 'BB2222BW', alias: 'Moto', telefono_dueno: '5491111111' },
        { id: 5, codigo_llavero: 'AA1111AT', alias: 'Auto de Ale', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async (codigo) =>
        codigo === 'AA1111AT' ? { id: 300, telefono_finder: '5492222222' } : { id: 301, telefono_finder: '5493333333' }
    );

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'H 2 Ya salgo para allá'), res);

    // Un mensaje al finder con el contenido, y uno de confirmación de vuelta al remitente.
    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
    const [destino, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.equal(destino, '5492222222');
    assert.match(texto, /Ya salgo para allá/);
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

test('"A CODIGO" en un solo mensaje (como manda el QR) activa el registro directo (bug reportado)', async () => {
    repositorio.crearSesion.mock.mockImplementation(async ({ estado }) => ({ id: 100, estado }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'A AA1111AT'), res);

    // Primero crea la sesión "esperando_codigo_registro", después la hace
    // avanzar directo a "esperando_nombre_registro" con el código ya cargado.
    assert.equal(repositorio.crearSesion.mock.calls.length, 1);
    assert.equal(repositorio.actualizarSesion.mock.calls.length, 1);
    const [, campos] = repositorio.actualizarSesion.mock.calls[0].arguments;
    assert.equal(campos.estado, 'esperando_nombre_registro');
    assert.equal(campos.codigo_llavero, 'AA1111AT');
});

test('"E CODIGO" en un solo mensaje (como manda el QR) reporta el encuentro directo', async () => {
    repositorio.crearSesion.mock.mockImplementation(async ({ estado }) => ({ id: 100, estado }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', nombre_dueno: 'Ale'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'E AA1111AT'), res);

    assert.equal(repositorio.crearSesion.mock.calls.length, 1);
    assert.equal(repositorio.crearEvento.mock.calls.length, 1);
    assert.equal(repositorio.crearEvento.mock.calls[0].arguments[0].tipo, 'encuentro');
});

test('"ACELU CODIGO" activa el registro de MICELU con el texto de celular', async () => {
    repositorio.crearSesion.mock.mockImplementation(async ({ estado, categoria }) => ({ id: 100, estado, categoria }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'ACELU AA1111AT'), res);

    assert.equal(repositorio.crearSesion.mock.calls.length, 1);
    assert.equal(repositorio.crearSesion.mock.calls[0].arguments[0].categoria, 'celular');
    assert.equal(repositorio.actualizarSesion.mock.calls.length, 1);
    assert.equal(repositorio.actualizarSesion.mock.calls[0].arguments[1].estado, 'esperando_nombre_registro');
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /¿Cómo es tu nombre\?/);
});

test('"ECELU CODIGO" encuentra un celular y salta directo a escribirle al dueño (sin D\\/H\\/F)', async () => {
    repositorio.crearSesion.mock.mockImplementation(async ({ estado, categoria }) => ({ id: 100, estado, categoria }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', nombre_dueno: 'Ale', categoria: 'celular'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'ECELU AA1111AT'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 1);
    assert.equal(repositorio.actualizarSesion.mock.calls.length, 1);
    assert.equal(repositorio.actualizarSesion.mock.calls[0].arguments[1].estado, 'esperando_mensaje_anonimo');
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /Gracias por ayudarnos/);
    assert.doesNotMatch(texto, /\*D\.\*/);
});

test('"E CODIGO" (sin CELU) sobre un objeto que en realidad es celular igual usa la categoría real, no la del comando (bug reportado)', async () => {
    repositorio.crearSesion.mock.mockImplementation(async ({ estado, categoria }) => ({ id: 100, estado, categoria }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', alias: 'Celu de Gabi', telefono_dueno: '5491111111', nombre_dueno: 'Gabi', categoria: 'celular'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'E AA1111AT'), res);

    // Salta directo a escribir el mensaje (nada de D/H/F), como corresponde a un celular.
    assert.equal(repositorio.actualizarSesion.mock.calls[0].arguments[1].estado, 'esperando_mensaje_anonimo');
    const [, textoFinder] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(textoFinder, /Gracias por ayudarnos/);

    // La plantilla al dueño también debe decir "celular", no "llavero".
    assert.equal(notificaciones.registrarNotificacionPendienteEvento.mock.calls.length, 1);
    const [, , objetoPlantilla] = notificaciones.registrarNotificacionPendienteEvento.mock.calls[0].arguments;
    assert.equal(objetoPlantilla, 'celular');
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

test('esperando_alias_registro rechaza un alias vacío y no avanza', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_alias_registro', ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', '   '), res);

    // Solo el "touch" de ultima_interaccion, sin cambio de estado.
    assert.equal(repositorio.actualizarSesion.mock.calls.length, 1);
    const [, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(texto, /no puede estar vacío/);
});

test('esperando_alias_registro con texto avanza a pedir el email', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5491111111', estado: 'esperando_alias_registro', ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'Celular de mamá'), res);

    assert.equal(repositorio.actualizarSesion.mock.calls.length, 2);
    const [, campos] = repositorio.actualizarSesion.mock.calls[1].arguments;
    assert.equal(campos.estado, 'esperando_email_alternativo');
    assert.equal(campos.alias_borrador, 'Celular de mamá');
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

test('reingresar el mismo código de encuentro reutiliza la conversación abierta en vez de duplicarla (bug reportado)', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5492222222', estado: 'esperando_codigo_encuentro', ultima_interaccion: new Date()
    }));
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', nombre_dueno: 'Ale'
    }));
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async (codigo, tipo) =>
        tipo === 'encuentro' ? { id: 777, telefono_finder: '5492222222' } : null
    );

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'AA1111AT'), res);

    assert.equal(repositorio.crearEvento.mock.calls.length, 0);
    assert.equal(repositorio.actualizarEvento.mock.calls.length, 1);
    assert.equal(repositorio.actualizarEvento.mock.calls[0].arguments[0], 777);
    // No se vuelve a mandar la plantilla/alerta al dueño para no duplicar avisos.
    assert.equal(notificaciones.registrarNotificacionPendienteEvento.mock.calls.length, 0);
});

test('el finder puede seguir la conversación con "H mensaje" después de su primer mensaje (bug reportado)', async () => {
    // El finder NO es dueño de ningún llavero (obtenerLlaverosPorDueno -> []
    // por default), pero SÍ tiene un evento de encuentro abierto como finder.
    repositorio.obtenerEventosAbiertosPorFinder.mock.mockImplementation(async () => [
        { id: 300, llavero_id: 5, telefono_finder: '5492222222' }
    ]);
    repositorio.dbRead.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', alias: 'Auto de Ale'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'H te lo dejo en la maceta'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
    const [destino, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.equal(destino, '5491111111');
    assert.match(texto, /te lo dejo en la maceta/);
    assert.match(texto, /La persona que encontró tu llavero/);
    // El remitente también recibe confirmación de que se mandó.
    const [destinoConfirmacion] = notificaciones.enviarMensajeWhatsApp.mock.calls[1].arguments;
    assert.equal(destinoConfirmacion, '5492222222');
});

test('el finder puede cerrar la conversación con "F"', async () => {
    repositorio.obtenerEventosAbiertosPorFinder.mock.mockImplementation(async () => [
        { id: 300, llavero_id: 5, telefono_finder: '5492222222' }
    ]);
    repositorio.dbRead.mock.mockImplementation(async () => ({
        id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111', alias: 'Auto de Ale'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'F'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 300);
    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
});

test('atajo "F" del dueño solo cierra el chat (no implica recuperación)', async () => {
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
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[1].motivo_cierre, 'dueño_cerro_chat');
    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
});

test('atajo "RECUPERADO" del dueño confirma la recuperación y avisa a ambas partes (distinto de F)', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 5, codigo_llavero: 'AA1111AT', categoria: 'celular', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({
        id: 300, telefono_finder: '5492222222'
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'RECUPERADO'), res);

    assert.equal(repositorio.cerrarEvento.mock.calls.length, 1);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[0], 300);
    assert.equal(repositorio.cerrarEvento.mock.calls[0].arguments[1].motivo_cierre, 'dueño_confirmo_recuperacion');
    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
    const [, textoParaFinder] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.match(textoParaFinder, /recuperó/);
    const [, textoParaDueño] = notificaciones.enviarMensajeWhatsApp.mock.calls[1].arguments;
    assert.match(textoParaDueño, /recuperado/);
});

test('"F" del finder no debe ser confundido con "RECUPERADO" (solo el dueño puede confirmarlo)', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => []);
    repositorio.obtenerEventosAbiertosPorFinder.mock.mockImplementation(async () => []);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'RECUPERADO'), res);

    // El finder no tiene llaveros propios ni conversaciones como dueño -> no hay nada que cerrar.
    assert.equal(repositorio.cerrarEvento.mock.calls.length, 0);
});

test('"H mensaje" del dueño llega al finder aunque haya un backlog de notificaciones pendientes sin revelar (bug reportado)', async () => {
    repositorio.obtenerLlaverosPorDueno.mock.mockImplementation(async () => [
        { id: 5, codigo_llavero: 'AA1111AT', telefono_dueno: '5491111111' }
    ]);
    repositorio.obtenerEventoAbierto.mock.mockImplementation(async () => ({
        id: 300, telefono_finder: '5492222222'
    }));
    // Si esto se llegara a consultar, significa que el backlog "ganó" por error.
    repositorio.dbRead.mock.mockImplementation(async () => [{ id: 999, notificacion_pendiente: 'Notificación vieja sin destrabar' }]);

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5491111111', 'H Ya salgo para allá'), res);

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
    const [destino, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.equal(destino, '5492222222');
    assert.match(texto, /Ya salgo para allá/);
    assert.doesNotMatch(texto, /Notificación vieja/);
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

    assert.equal(notificaciones.enviarMensajeWhatsApp.mock.calls.length, 2);
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

test('"H mensaje" en un solo paso, con sesión activa en el submenú de encuentro, manda el mensaje y cierra (bug reportado)', async () => {
    repositorio.obtenerSesionActiva.mock.mockImplementation(async () => ({
        id: 1, telefono: '5492222222', estado: 'esperando_subopcion_encuentro',
        evento_id: 300, ultima_interaccion: new Date()
    }));

    const res = crearRes();
    await procesarMensajeWebhook(crearReq('5492222222', 'H te lo dejo en lomas'), res);

    assert.equal(repositorio.cerrarSesion.mock.calls.length, 1);
    assert.equal(repositorio.cerrarSesion.mock.calls[0].arguments[0], 1);
    const [destino, texto] = notificaciones.enviarMensajeWhatsApp.mock.calls[0].arguments;
    assert.equal(destino, '5492222222');
    assert.match(texto, /Mensaje enviado/);
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
