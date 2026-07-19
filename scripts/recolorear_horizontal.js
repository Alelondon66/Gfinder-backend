// Genera una version con texto oscuro del logo horizontal transparente,
// para usar sobre fondo blanco (la version original tiene texto blanco,
// pensada para fondo negro).
const path = require('path');
const { Jimp } = require('jimp');

const ORIGEN = path.join(__dirname, '..', 'logo', 'vuelve_horizontal_transparente.png');
const DESTINO = path.join(__dirname, '..', 'logo', 'vuelve_horizontal_transparente_oscuro.png');

function esBlancoOClaro(r, g, b) {
    return r > 150 && g > 150 && b > 150;
}

async function main() {
    const img = await Jimp.read(ORIGEN);
    const { width, height } = img.bitmap;

    img.scan(0, 0, width, height, (x, y, idx) => {
        const r = img.bitmap.data[idx];
        const g = img.bitmap.data[idx + 1];
        const b = img.bitmap.data[idx + 2];
        const a = img.bitmap.data[idx + 3];

        if (a > 0 && esBlancoOClaro(r, g, b)) {
            img.bitmap.data[idx] = 30;
            img.bitmap.data[idx + 1] = 30;
            img.bitmap.data[idx + 2] = 30;
        }
    });

    await img.write(DESTINO);
    console.log(`OK: ${DESTINO}`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
