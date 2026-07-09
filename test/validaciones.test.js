const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarCodigoGFinder, validarEmail, calcularDistancia } = require('../src/validaciones');

test('validarCodigoGFinder acepta códigos con dígito verificador correcto', () => {
    // Generados con el mismo algoritmo: suma ponderada de los 4 números % 20 -> letra.
    assert.equal(validarCodigoGFinder('AA1111AT'), true);
    assert.equal(validarCodigoGFinder('PP1111PT'), true);
});

test('validarCodigoGFinder acepta en minúsculas y con espacios (normaliza)', () => {
    assert.equal(validarCodigoGFinder('aa1111at'), true);
    assert.equal(validarCodigoGFinder('  AA1111AT  '), true);
});

test('validarCodigoGFinder rechaza formato inválido', () => {
    assert.equal(validarCodigoGFinder('1234ABCD'), false); // no empieza con 2 letras
    assert.equal(validarCodigoGFinder('AAAA1111'), false); // orden incorrecto
    assert.equal(validarCodigoGFinder('AA111AA'), false);  // longitud incorrecta
    assert.equal(validarCodigoGFinder('AIAA1111'), false); // usa letra prohibida (I)
});

test('validarCodigoGFinder rechaza dígito verificador incorrecto', () => {
    // AA1111AT es válido; cambiamos solo la letra verificadora final.
    assert.equal(validarCodigoGFinder('AA1111AB'), false);
});

test('validarEmail acepta emails con formato correcto', () => {
    assert.equal(validarEmail('nombre@dominio.com'), true);
    assert.equal(validarEmail('a.b+c@sub.dominio.com.ar'), true);
});

test('validarEmail rechaza formatos inválidos', () => {
    assert.equal(validarEmail('sin-arroba.com'), false);
    assert.equal(validarEmail('con espacio@dominio.com'), false);
    assert.equal(validarEmail('sin-dominio@'), false);
});

test('calcularDistancia da 0 para el mismo punto', () => {
    const d = calcularDistancia(-34.6, -58.4, -34.6, -58.4);
    assert.equal(d, 0);
});

test('calcularDistancia da un valor razonable entre dos puntos conocidos (CABA-La Plata, ~55km)', () => {
    const d = calcularDistancia(-34.6037, -58.3816, -34.9214, -57.9544);
    assert.ok(d > 45 && d < 65, `esperaba ~55km, dio ${d}`);
});
