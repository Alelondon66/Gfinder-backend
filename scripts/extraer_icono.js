// Extrae solo el ícono (el tilde verde) de logovuelve_vertical_blanco.png.jpeg,
// le saca el fondo blanco y el texto "VUELVE", y lo recorta ajustado.
// Uso: node scripts/extraer_icono.js

const path = require('path');
const { Jimp } = require('jimp');

const ORIGEN = path.join(__dirname, '..', 'logo', 'logovuelve_vertical_blanco.png.jpeg');
const DESTINO = path.join(__dirname, '..', 'logo', 'vuelve_icono_transparente.png');

function esBlanco(r, g, b) {
    return r > 225 && g > 225 && b > 225;
}

function esNegroONoVerde(r, g, b) {
    // Texto "VUELVE" (negro) y cualquier píxel que no tenga un verde
    // claramente dominante se descarta, para quedarnos solo con el tilde.
    const esOscuro = r < 70 && g < 70 && b < 70;
    const verdeDominante = g > r + 15 && g > b + 15;
    return esOscuro || !verdeDominante;
}

async function main() {
    const img = await Jimp.read(ORIGEN);
    const { width, height } = img.bitmap;

    let minX = width, minY = height, maxX = 0, maxY = 0;

    img.scan(0, 0, width, height, (x, y, idx) => {
        const r = img.bitmap.data[idx];
        const g = img.bitmap.data[idx + 1];
        const b = img.bitmap.data[idx + 2];

        if (esBlanco(r, g, b) || esNegroONoVerde(r, g, b)) {
            img.bitmap.data[idx + 3] = 0; // transparente
        } else {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    });

    const margen = 4;
    const cropX = Math.max(0, minX - margen);
    const cropY = Math.max(0, minY - margen);
    const cropW = Math.min(width - cropX, (maxX - minX) + margen * 2);
    const cropH = Math.min(height - cropY, (maxY - minY) + margen * 2);

    img.crop({ x: cropX, y: cropY, w: cropW, h: cropH });
    await img.write(DESTINO);

    console.log(`✅ Ícono extraído: ${DESTINO} (${cropW}x${cropH}px)`);
}

main().catch(err => {
    console.error('❌ Error extrayendo el ícono:', err.message);
    process.exit(1);
});
