// Genera una muestra de 10 tarjetas VUELVE (5 fondo negro + 5 fondo blanco)
// usando los primeros 10 códigos del lote de 50 ya generado, con el ícono
// incrustado en el QR y el logo horizontal arriba. Es una muestra para
// revisar el diseño antes de aplicarlo a los 50 completos.
const fs = require('fs');
const path = require('path');
const { generarQRConIcono } = require('./qrUtils');

const BASE_URL = process.env.QR_BASE_URL || 'https://wapp.vuelve.ar';
const CARPETA = path.join(__dirname, '..', 'qr_lote_prueba', 'muestra_vuelve');
const CSV_ORIGEN = path.join(__dirname, '..', 'qr_lote_prueba', 'codigos.csv');

async function main() {
    if (!fs.existsSync(CSV_ORIGEN)) {
        console.error('❌ No encontré qr_lote_prueba/codigos.csv — corré primero generar_lote_qr.js');
        process.exit(1);
    }
    if (!fs.existsSync(CARPETA)) fs.mkdirSync(CARPETA, { recursive: true });

    const codigos = fs.readFileSync(CSV_ORIGEN, 'utf-8')
        .split(/\r?\n/).slice(1).filter(Boolean)
        .map(linea => linea.split(',')[0])
        .slice(0, 10);

    const celdas = [];

    for (let i = 0; i < codigos.length; i++) {
        const codigo = codigos[i];
        const esNegro = i < 5;
        const url = `${BASE_URL}/q/${codigo}`;
        const archivoQR = path.join(CARPETA, `${codigo}.png`);
        await generarQRConIcono(url, archivoQR);

        const logo = esNegro ? '../../logo/vuelve_horizontal_transparente.png' : '../../logo/vuelve_horizontal_transparente_oscuro.png';

        celdas.push(`
            <div class="tarjeta ${esNegro ? 'negra' : 'blanca'}">
                <img class="logo" src="${logo}" alt="VUELVE">
                <img class="qr" src="${codigo}.png" alt="QR ${codigo}">
                <div class="codigo">${codigo}</div>
            </div>`);
    }

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>VUELVE - Muestra con logo</title>
<style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #eee; }
    .grilla { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
    .tarjeta { border-radius: 12px; padding: 16px 10px; text-align: center; }
    .tarjeta.blanca { background: #fff; border: 1px solid #ccc; }
    .tarjeta.negra { background: #000; }
    .tarjeta .logo { height: 26px; margin-bottom: 10px; }
    .tarjeta .qr { width: 100%; max-width: 160px; }
    .tarjeta.blanca .codigo { color: #111; }
    .tarjeta.negra .codigo { color: #fff; }
    .codigo { font-weight: bold; font-size: 14px; margin-top: 8px; letter-spacing: 1px; }
    h1 { font-size: 18px; font-family: Arial, sans-serif; }
</style>
</head>
<body>
    <h1>VUELVE — Muestra con logo (5 negras + 5 blancas)</h1>
    <div class="grilla">${celdas.join('')}
    </div>
</body>
</html>`;

    fs.writeFileSync(path.join(CARPETA, 'muestra.html'), html, 'utf-8');
    console.log(`✅ Muestra lista en "${CARPETA}\\muestra.html"`);
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
