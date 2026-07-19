const repo = require('./repositorio');
const { WA_PHONE_NUMBER } = require('./config');
const { validarCodigoGFinder } = require('./validaciones');

// Decide a dónde mandar a alguien que escaneó el QR de un artículo: si el
// código todavía no está activado, es el dueño activándolo por primera vez
// (A/ACELU). Si ya está activado, es alguien que lo encontró (E/ECELU). El
// QR impreso nunca cambia — esta decisión se toma en el momento de cada
// escaneo. "prefijo" identifica la categoría ('' para llavero, 'CELU' para
// MICELU, etc.) y viene fijo por la ruta desde la que se escaneó el QR.
async function resolverRedireccionQR(codigoCrudo, prefijo = '') {
    const codigo = (codigoCrudo || '').toUpperCase().trim();

    if (!validarCodigoGFinder(codigo)) {
        return `https://wa.me/${WA_PHONE_NUMBER}`;
    }

    const llavero = await repo.obtenerLlaveroPorCodigo(codigo);
    const comando = (llavero ? 'E' : 'A') + prefijo;
    const texto = encodeURIComponent(`${comando} ${codigo}`);
    return `https://wa.me/${WA_PHONE_NUMBER}?text=${texto}`;
}

module.exports = { resolverRedireccionQR };
