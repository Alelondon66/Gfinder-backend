const path = require('path');
const QRCode = require('qrcode');
const { Jimp } = require('jimp');

const ICONO = path.join(__dirname, '..', 'logo', 'vuelve_icono_transparente.png');

// Genera un QR (alta corrección de errores, para poder taparle el centro
// con el ícono sin que deje de leerse) y le compone el ícono de VUELVE
// centrado, dejando un margen blanco alrededor para que no se mezcle con
// los módulos del QR.
async function generarQRConIcono(url, archivoDestino, tamano = 400) {
    const bufferQR = await QRCode.toBuffer(url, {
        width: tamano,
        margin: 1,
        errorCorrectionLevel: 'H'
    });

    const qr = await Jimp.read(bufferQR);
    const icono = await Jimp.read(ICONO);

    const anchoIcono = Math.round(tamano * 0.22);
    const altoIcono = Math.round(anchoIcono * (icono.bitmap.height / icono.bitmap.width));
    icono.resize({ w: anchoIcono, h: altoIcono });

    // Placa blanca detrás del ícono para no perder contraste con los módulos del QR.
    const placaPad = 10;
    const placa = new Jimp({ width: anchoIcono + placaPad * 2, height: altoIcono + placaPad * 2, color: 0xFFFFFFFF });

    const cx = Math.round((tamano - placa.bitmap.width) / 2);
    const cy = Math.round((tamano - placa.bitmap.height) / 2);
    qr.composite(placa, cx, cy);
    qr.composite(icono, cx + placaPad, cy + placaPad);

    await qr.write(archivoDestino);
}

module.exports = { generarQRConIcono };
