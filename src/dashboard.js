const { supabase } = require('./config');
const repo = require('./repositorio');

async function contarExacto(query) {
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
}

function escaparHtml(texto) {
    return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function obtenerMetricasDashboard() {
    const [activos, enSucursal, retirados, alertasSoporte, encontrados] = await Promise.all([
        contarExacto(repo.contarLlaverosActivos()),
        contarExacto(repo.contarEventos('custodia', 'en_custodia')),
        contarExacto(repo.contarEventos('custodia', 'retirado')),
        contarExacto(supabase.from('soporte').select('id', { count: 'exact', head: true })),
        contarExacto(repo.contarLlaverosConEventoTipo('encuentro'))
    ]);

    const historicoCustodia = await repo.obtenerEventosCustodiaHistorico();
    const conteoPorSucursal = {};
    (historicoCustodia || []).forEach(fila => {
        const clave = fila.sucursal_id || 'sin_sucursal';
        conteoPorSucursal[clave] = (conteoPorSucursal[clave] || 0) + 1;
    });

    const idsSucursal = Object.keys(conteoPorSucursal).filter(id => id !== 'sin_sucursal');
    const direcciones = idsSucursal.length > 0
        ? await repo.dbRead(supabase.from('sucursales').select('id_sucursal, direccion').in('id_sucursal', idsSucursal), 'select sucursales (dashboard)')
        : [];
    const direccionPorId = {};
    (direcciones || []).forEach(s => { direccionPorId[s.id_sucursal] = s.direccion; });

    const rankingSucursales = Object.entries(conteoPorSucursal)
        .map(([id, total]) => ({ sucursal: direccionPorId[id] || `Sucursal ${id}`, entregas: total }))
        .sort((a, b) => b.entregas - a.entregas);

    const tasaRecuperacion = activos > 0 ? ((encontrados / activos) * 100).toFixed(1) : "0.0";

    return {
        status: 'success',
        timestamp: new Date(),
        termometro_negocio: {
            total_llaveros_activos: activos,
            total_llaveros_encontrados: encontrados,
            tasa_recuperacion_porcentaje: `${tasaRecuperacion}%`
        },
        comportamiento_canales: {
            devoluciones_via_axion_geo: retirados,
            devoluciones_via_chat_directo: Math.max(encontrados - retirados, 0)
        },
        auditoria: {
            alertas_soporte_pendientes: alertasSoporte
        },
        estado_llaveros: {
            activados: activos,
            esperando_en_sucursal: enSucursal,
            retirados: retirados
        },
        reporte_corporativo_axion: rankingSucursales
    };
}

function renderizarPaginaDashboard(m) {
    const filasSucursales = (m.reporte_corporativo_axion || []).map(s => `
        <tr>
            <td>${escaparHtml(s.sucursal)}</td>
            <td>${escaparHtml(s.entregas)}</td>
        </tr>
    `).join('') || '<tr><td colspan="2">Sin datos todavía</td></tr>';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VUELVE - Estado de llaveros</title>
<style>
    body { font-family: -apple-system, Arial, sans-serif; background: #f4f4f2; color: #222; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card .valor { font-size: 32px; font-weight: 700; }
    .card .etiqueta { font-size: 13px; color: #666; margin-top: 4px; }
    .card.activados .valor { color: #1d9e75; }
    .card.sucursal .valor { color: #ba7517; }
    .card.retirados .valor { color: #185fa5; }
    .card.soporte .valor { color: #d85a30; }
    h2 { font-size: 16px; margin: 24px 0 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    th, td { text-align: left; padding: 10px 14px; font-size: 14px; border-bottom: 1px solid #eee; }
    th { background: #fafafa; color: #666; font-weight: 600; }
    .refrescar { font-size: 13px; color: #888; margin-top: 24px; }
</style>
</head>
<body>
    <h1>VUELVE — Estado de llaveros</h1>
    <div class="sub">Actualizado: ${new Date(m.timestamp).toLocaleString('es-AR')}</div>

    <div class="grid">
        <div class="card activados">
            <div class="valor">${m.estado_llaveros.activados}</div>
            <div class="etiqueta">Llaveros activados</div>
        </div>
        <div class="card sucursal">
            <div class="valor">${m.estado_llaveros.esperando_en_sucursal}</div>
            <div class="etiqueta">Esperando en sucursal</div>
        </div>
        <div class="card retirados">
            <div class="valor">${m.estado_llaveros.retirados}</div>
            <div class="etiqueta">Retirados de sucursal</div>
        </div>
        <div class="card soporte">
            <div class="valor">${m.auditoria.alertas_soporte_pendientes}</div>
            <div class="etiqueta">Consultas de soporte</div>
        </div>
    </div>

    <h2>Tasa de recuperación general</h2>
    <div class="grid">
        <div class="card">
            <div class="valor">${m.termometro_negocio.tasa_recuperacion_porcentaje}</div>
            <div class="etiqueta">${m.termometro_negocio.total_llaveros_encontrados} encontrados de ${m.termometro_negocio.total_llaveros_activos} activos</div>
        </div>
        <div class="card">
            <div class="valor">${m.comportamiento_canales.devoluciones_via_axion_geo}</div>
            <div class="etiqueta">Devoluciones vía sucursal YPF</div>
        </div>
        <div class="card">
            <div class="valor">${m.comportamiento_canales.devoluciones_via_chat_directo}</div>
            <div class="etiqueta">Devoluciones por chat directo</div>
        </div>
    </div>

    <h2>Ranking de sucursales</h2>
    <table>
        <thead><tr><th>Sucursal</th><th>Entregas</th></tr></thead>
        <tbody>${filasSucursales}</tbody>
    </table>

    <div class="refrescar">Esta página no se actualiza sola — recargala para ver datos nuevos.</div>
</body>
</html>`;
}

module.exports = { obtenerMetricasDashboard, renderizarPaginaDashboard };
