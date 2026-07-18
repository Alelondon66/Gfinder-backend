const { test, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const repositorio = require('../src/repositorio');
repositorio.obtenerLlaveroPorCodigo = mock.fn(repositorio.obtenerLlaveroPorCodigo);

const { resolverRedireccionQR } = require('../src/qr');

beforeEach(() => {
    repositorio.obtenerLlaveroPorCodigo.mock.resetCalls();
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);
});

test('código sin activar redirige con el comando A (activación)', async () => {
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);

    const url = await resolverRedireccionQR('AA1111AT');

    assert.match(url, /^https:\/\/wa\.me\//);
    assert.match(url, /text=A%20AA1111AT/);
});

test('código ya activado redirige con el comando E (encontré)', async () => {
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => ({ id: 5, codigo_llavero: 'AA1111AT' }));

    const url = await resolverRedireccionQR('AA1111AT');

    assert.match(url, /text=E%20AA1111AT/);
});

test('acepta el código en minúsculas o con espacios', async () => {
    repositorio.obtenerLlaveroPorCodigo.mock.mockImplementation(async () => null);

    const url = await resolverRedireccionQR('  aa1111at  ');

    assert.match(url, /text=A%20AA1111AT/);
});

test('código con formato inválido redirige sin texto pre-cargado (no consulta la base)', async () => {
    const url = await resolverRedireccionQR('NOESVALIDO');

    assert.doesNotMatch(url, /text=/);
    assert.equal(repositorio.obtenerLlaveroPorCodigo.mock.calls.length, 0);
});
