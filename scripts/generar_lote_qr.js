// Genera un lote de códigos VUELVE válidos + su QR + una hoja lista para
// imprimir. Uso: node scripts/generar_lote_qr.js [cantidad]
//
// Cada QR apunta a BASE_URL/q/CODIGO — esa dirección decide en el momento
// (según si el código ya está activado o no) si abre WhatsApp con "A" o "E".

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { validarCodigoGFinder } = require('../src/validaciones');

const BASE_URL = process.env.QR_BASE_URL || 'https://wapp.vuelve.ar';

const CANTIDAD = parseInt(process.argv[2], 10) || 50;
const CARPETA_SALIDA = path.join(__dirname, '..', 'qr_lote_prueba');

const LETRAS_VALIDAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N', 'P', 'R', 'T', 'U', 'V', 'W', 'X', 'Y'];

function letraAleatoria() {
    return LETRAS_VALIDAS[Math.floor(Math.random() * LETRAS_VALIDAS.length)];
}

function digitoAleatorio() {
    return Math.floor(Math.random() * 10);
}

function generarCodigoCandidato() {
    const l1 = letraAleatoria();
    const l2 = letraAleatoria();
    const n1 = digitoAleatorio();
    const n2 = digitoAleatorio();
    const n3 = digitoAleatorio();
    const n4 = digitoAleatorio();

    const suma = (n1 * 5) + (n2 * 4) + (n3 * 3) + (n4 * 2);
    const letraVerificadora = LETRAS_VALIDAS[suma % 20];

    return `${l1}${l2}${n1}${n2}${n3}${n4}${l1}${letraVerificadora}`;
}

// Genera candidatos y descarta los que no pasen la validación REAL del bot
// (hay combinaciones que la tabla de verificación permite pero el formato
// final rechaza — más simple filtrar con la fuente de verdad que reimplementar).
function generarCodigoValido() {
    let candidato;
    do {
        candidato = generarCodigoCandidato();
    } while (!validarCodigoGFinder(candidato));
    return candidato;
}

function generarCodigosUnicos(cantidad) {
    const codigos = new Set();
    while (codigos.size < cantidad) {
        codigos.add(generarCodigoValido());
    }
    return [...codigos];
}

async function main() {
    if (!fs.existsSync(CARPETA_SALIDA)) fs.mkdirSync(CARPETA_SALIDA, { recursive: true });
    const carpetaQR = path.join(CARPETA_SALIDA, 'qr');
    if (!fs.existsSync(carpetaQR)) fs.mkdirSync(carpetaQR, { recursive: true });

    const codigos = generarCodigosUnicos(CANTIDAD);
    const filasCSV = ['codigo,url'];
    const celdasHTML = [];

    for (const codigo of codigos) {
        const url = `${BASE_URL}/q/${codigo}`;
        const archivoQR = path.join(carpetaQR, `${codigo}.png`);
        await QRCode.toFile(archivoQR, url, { width: 300, margin: 1 });

        filasCSV.push(`${codigo},${url}`);
        celdasHTML.push(`
            <div class="tarjeta">
                <img src="qr/${codigo}.png" alt="QR ${codigo}">
                <div class="codigo">${codigo}</div>
            </div>`);
    }

    fs.writeFileSync(path.join(CARPETA_SALIDA, 'codigos.csv'), filasCSV.join('\n'), 'utf-8');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>VUELVE - Lote de códigos de prueba</title>
<style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .grilla { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
    .tarjeta { border: 1px dashed #999; border-radius: 8px; padding: 10px; text-align: center; page-break-inside: avoid; }
    .tarjeta img { width: 100%; max-width: 140px; }
    .codigo { font-weight: bold; font-size: 14px; margin-top: 6px; letter-spacing: 1px; }
    h1 { font-size: 18px; }
</style>
</head>
<body>
    <h1>VUELVE — Lote de prueba (${codigos.length} códigos)</h1>
    <div class="grilla">${celdasHTML.join('')}
    </div>
</body>
</html>`;

    fs.writeFileSync(path.join(CARPETA_SALIDA, 'hoja_para_imprimir.html'), html, 'utf-8');

    console.log(`✅ Listo: ${codigos.length} códigos generados en "${CARPETA_SALIDA}"`);
    console.log(`   - codigos.csv (lista simple)`);
    console.log(`   - qr/ (${codigos.length} imágenes PNG, una por código)`);
    console.log(`   - hoja_para_imprimir.html (abrir en el navegador e imprimir)`);
}

main().catch(err => {
    console.error('❌ Error generando el lote:', err.message);
    process.exit(1);
});
