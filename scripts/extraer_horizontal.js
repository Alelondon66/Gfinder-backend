// Extrae el logo horizontal (tilde + "VUELVE") sacándole el fondo negro,
// para poder usarlo tanto sobre fondo blanco como sobre fondo negro.
const path = require('path');
const { Jimp } = require('jimp');

const ORIGEN = path.join(__dirname, '..', 'logo', 'vuelve_horizontal.png');
const DESTINO = path.join(__dirname, '..', 'logo', 'vuelve_horizontal_transparente.png');

function esFondoNegro(r, g, b) {
    return r < 40 && g < 40 && b < 40;
}

async function main() {
    const img = await Jimp.read(ORIGEN);
    const { width, height } = img.bitmap;

    let minX = width, minY = height, maxX = 0, maxY = 0;

    img.scan(0, 0, width, height, (x, y, idx) => {
        const r = img.bitmap.data[idx];
        const g = img.bitmap.data[idx + 1];
        const b = img.bitmap.data[idx + 2];

        if (esFondoNegro(r, g, b)) {
            img.bitmap.data[idx + 3] = 0;
        } else {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    });

    const margen = 3;
    const cropX = Math.max(0, minX - margen);
    const cropY = Math.max(0, minY - margen);
    const cropW = Math.min(width - cropX, (maxX - minX) + margen * 2);
    const cropH = Math.min(height - cropY, (maxY - minY) + margen * 2);

    img.crop({ x: cropX, y: cropY, w: cropW, h: cropH });
    await img.write(DESTINO);

    console.log(`✅ Logo horizontal extraído: ${DESTINO} (${cropW}x${cropH}px)`);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
