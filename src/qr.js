const repo = require('./repositorio');
const { WA_PHONE_NUMBER } = require('./config');
const { validarCodigoGFinder } = require('./validaciones');

// Decide a dónde mandar a alguien que escaneó el QR de un llavero: si el
// código todavía no está activado, es el dueño activándolo por primera vez
// (A). Si ya está activado, es alguien que lo encontró (E). El QR impreso
// nunca cambia — esta decisión se toma en el momento de cada escaneo.
async function resolverRedireccionQR(codigoCrudo) {
    const codigo = (codigoCrudo || '').toUpperCase().trim();

    if (!validarCodigoGFinder(codigo)) {
        return `https://wa.me/${WA_PHONE_NUMBER}`;
    }

    const llavero = await repo.obtenerLlaveroPorCodigo(codigo);
    const comando = llavero ? 'E' : 'A';
    const texto = encodeURIComponent(`${comando} ${codigo}`);
    return `https://wa.me/${WA_PHONE_NUMBER}?text=${texto}`;
}

module.exports = { resolverRedireccionQR };
