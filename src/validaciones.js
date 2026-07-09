function validarCodigoGFinder(codigo) {
    const clean = codigo.toUpperCase().trim();
    const regexFormato = /^[A-HJKLNPRT-VX-Y]{2}[0-9]{4}[A-HJKLNPRT-VX-Y]{2}$/;
    if (!regexFormato.test(clean)) return false;

    const letrasValidas = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N', 'P', 'R', 'T', 'U', 'V', 'W', 'X', 'Y'];

    const numeros = clean.substring(2, 6);
    const letraVerificadoraReal = clean.charAt(7);

    const n1 = parseInt(numeros.charAt(0));
    const n2 = parseInt(numeros.charAt(1));
    const n3 = parseInt(numeros.charAt(2));
    const n4 = parseInt(numeros.charAt(3));

    const sumaVerificacion = (n1 * 5) + (n2 * 4) + (n3 * 3) + (n4 * 2);
    const indiceCalculado = sumaVerificacion % 20;
    const letraEsperada = letrasValidas[indiceCalculado];

    return letraVerificadoraReal === letraEsperada;
}

function validarEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

module.exports = { validarCodigoGFinder, validarEmail, calcularDistancia };
