// Genera una muestra de 4 códigos para cada sub-marca (MIBICI, MICELU,
// MICASCO, MILLAVE): título arriba, QR con el ícono verde de VUELVE en el
// centro, código abajo. Son marcas separadas visualmente (sin el logo
// VUELVE completo), pero comparten el mismo ícono como sello común.
const fs = require('fs');
const path = require('path');
const { generarQRConIcono } = require('./qrUtils');
const { validarCodigoGFinder } = require('../src/validaciones');

const BASE_URL = process.env.QR_BASE_URL || 'https://wapp.vuelve.ar';
const CARPETA = path.join(__dirname, '..', 'qr_lote_prueba', 'muestra_submarcas');
const MARCAS = ['MIBICI', 'MICELU', 'MICASCO', 'MILLAVE'];
const POR_MARCA = 4;

// MICELU ya tiene backend funcionando (ruta /celu/:codigo). Las demás
// sub-marcas siguen siendo solo mockups visuales, así que sus QR quedan
// apuntando a la ruta genérica /q/ (todavía no tienen menú propio).
const RUTA_POR_MARCA = { MICELU: 'celu' };

const LETRAS_VALIDAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N', 'P', 'R', 'T', 'U', 'V', 'W', 'X', 'Y'];

function generarCodigoCandidato() {
    const l1 = LETRAS_VALIDAS[Math.floor(Math.random() * LETRAS_VALIDAS.length)];
    const l2 = LETRAS_VALIDAS[Math.floor(Math.random() * LETRAS_VALIDAS.length)];
    const n = [0, 0, 0, 0].map(() => Math.floor(Math.random() * 10));
    const suma = (n[0] * 5) + (n[1] * 4) + (n[2] * 3) + (n[3] * 2);
    const letraVerificadora = LETRAS_VALIDAS[suma % 20];
    return `${l1}${l2}${n[0]}${n[1]}${n[2]}${n[3]}${l1}${letraVerificadora}`;
}

function generarCodigoValido(usados) {
    let candidato;
    do {
        candidato = generarCodigoCandidato();
    } while (!validarCodigoGFinder(candidato) || usados.has(candidato));
    usados.add(candidato);
    return candidato;
}

async function main() {
    if (!fs.existsSync(CARPETA)) fs.mkdirSync(CARPETA, { recursive: true });

    const usados = new Set();
    const filasCSV = ['marca,codigo,url'];
    const secciones = [];

    for (const marca of MARCAS) {
        const celdas = [];
        for (let i = 0; i < POR_MARCA; i++) {
            const codigo = generarCodigoValido(usados);
            const ruta = RUTA_POR_MARCA[marca] || 'q';
            const url = `${BASE_URL}/${ruta}/${codigo}`;
            const archivoQR = path.join(CARPETA, `${marca}_${codigo}.png`);
            await generarQRConIcono(url, archivoQR);

            filasCSV.push(`${marca},${codigo},${url}`);
            celdas.push(`
                <div class="tarjeta">
                    <div class="titulo">${marca}</div>
                    <img class="qr" src="${marca}_${codigo}.png" alt="QR ${codigo}">
                    <div class="codigo">${codigo}</div>
                </div>`);
        }
        secciones.push(`<h2>${marca}</h2><div class="grilla">${celdas.join('')}</div>`);
    }

    fs.writeFileSync(path.join(CARPETA, 'codigos.csv'), filasCSV.join('\n'), 'utf-8');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Sub-marcas - Muestra</title>
<style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #eee; }
    .grilla { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    .tarjeta { background: #fff; border: 1px solid #ccc; border-radius: 12px; padding: 16px 10px; text-align: center; }
    .titulo { font-weight: bold; font-size: 16px; letter-spacing: 1px; margin-bottom: 10px; color: #111; }
    .tarjeta .qr { width: 100%; max-width: 160px; }
    .codigo { font-weight: bold; font-size: 14px; margin-top: 8px; letter-spacing: 1px; color: #111; }
    h1 { font-size: 18px; }
    h2 { font-size: 15px; color: #444; margin-bottom: 8px; }
</style>
</head>
<body>
    <h1>Sub-marcas — Muestra (${POR_MARCA} por marca)</h1>
    ${secciones.join('')}
</body>
</html>`;

    fs.writeFileSync(path.join(CARPETA, 'muestra.html'), html, 'utf-8');
    console.log(`✅ Muestra lista en "${CARPETA}\\muestra.html"`);
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
