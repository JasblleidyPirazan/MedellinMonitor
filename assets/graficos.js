// Página de gráficos claves. Lee data/resumen.json (estadísticas pre-agregadas
// del dataset completo por fetch_data.py). Sin librerías: SVG y HTML puros.
// Paleta validada sobre fondo claro: morado #7010A6 (conteos) y dorado #9A7B00
// (valores en COP); el amarillo de marca #FCD700 solo se usa como fondo.

// ─── UTILS (compartidos conceptualmente con app.js) ──────────────────────────
function formatCOP(val) {
  if (!val) return '$0';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}B`;
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(2)}MM`;
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3)  return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toLocaleString('es-CO')}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                      'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function labelMes(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return `${MESES_CORTOS[Number(m) - 1]} ${y.slice(2)}`;
}

// ─── BARRAS HORIZONTALES (lista con etiquetas directas) ──────────────────────
function renderBarList(containerId, rows, { gold = false, pctBase = null } = {}) {
  const el = document.getElementById(containerId);
  if (!rows.length) { el.innerHTML = '<p class="sin-datos">Sin datos</p>'; return; }
  const max = Math.max(...rows.map(r => r.value));
  el.innerHTML = rows.map(r => `
    <div class="bar-item">
      <div class="bar-meta">
        <span class="bar-name" title="${esc(r.title ?? r.label)}">${esc(r.label)}${r.sub ? ` <span class="top-nit">${esc(r.sub)}</span>` : ''}</span>
        <span class="bar-count">${esc(r.display)}${pctBase ? ` · ${(r.value / pctBase * 100).toFixed(1)}%` : ''}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${gold ? 'bar-fill--yellow' : ''}" style="width:${Math.max(1, Math.round(r.value / max * 100))}%"></div>
      </div>
    </div>`).join('');
}

// ─── BARRAS VERTICALES SVG (serie mensual) ───────────────────────────────────
function renderMonthlyBars(containerId, serie, { valueIdx, gold = false, format }) {
  const el = document.getElementById(containerId);
  if (!serie.length) { el.innerHTML = '<p class="sin-datos">Sin datos</p>'; return; }

  const W = 720, H = 236, mL = 52, mR = 8, mT = 18, mB = 30;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const max = Math.max(...serie.map(d => d[valueIdx])) || 1;
  const n = serie.length;
  const step = plotW / n;
  const barW = Math.max(3, step * 0.68);

  // rejilla: 3 líneas horizontales recesivas con etiqueta
  let grid = '';
  for (let i = 1; i <= 3; i++) {
    const v = max * i / 3;
    const y = mT + plotH - (plotH * i / 3);
    grid += `<line class="svg-grid" x1="${mL}" y1="${y}" x2="${W - mR}" y2="${y}"></line>
             <text class="svg-axis-label" x="${mL - 6}" y="${y + 3}" text-anchor="end">${format(v)}</text>`;
  }

  // etiquetas de mes: como máximo ~8 para no saturar
  const every = Math.max(1, Math.ceil(n / 8));
  let xLabels = '';
  serie.forEach((d, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    const x = mL + step * i + step / 2;
    xLabels += `<text class="svg-axis-label" x="${x}" y="${H - 10}" text-anchor="middle">${labelMes(d[0])}</text>`;
  });

  const bars = serie.map((d, i) => {
    const v = d[valueIdx];
    const h = Math.max(v > 0 ? 2 : 0, plotH * v / max);
    const x = mL + step * i + (step - barW) / 2;
    const y = mT + plotH - h;
    return `<rect class="svg-bar ${gold ? 'svg-bar--gold' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"
      data-mes="${esc(d[0])}" data-count="${d[1]}" data-valor="${d[2]}"></rect>`;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Serie mensual">
      ${grid}
      <line class="svg-grid" x1="${mL}" y1="${mT + plotH}" x2="${W - mR}" y2="${mT + plotH}"></line>
      ${bars}
      ${xLabels}
    </svg>
    <div class="chart-tooltip" role="status"></div>`;

  // tooltip por barra
  const tooltip = el.querySelector('.chart-tooltip');
  el.querySelectorAll('.svg-bar, .svg-bar--gold').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const c = Number(rect.dataset.count);
      const v = Number(rect.dataset.valor);
      tooltip.textContent = `${labelMes(rect.dataset.mes)}: ${c.toLocaleString('es-CO')} contratos · ${formatCOP(v)}`;
      const svgRect = el.querySelector('svg').getBoundingClientRect();
      const r = rect.getBoundingClientRect();
      tooltip.style.left = `${r.left - svgRect.left + r.width / 2}px`;
      tooltip.style.top  = `${r.top - svgRect.top}px`;
      tooltip.classList.add('visible');
    });
    rect.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
  });
}

// ─── HERO ─────────────────────────────────────────────────────────────────────
function renderHero(r) {
  const pctDirecta = r.valorTotal ? (r.alertas.directaValor / r.valorTotal * 100).toFixed(1) : '0';
  document.getElementById('hero-tiles').innerHTML = `
    <div class="hero-tile">
      <span class="hero-num">${r.total.toLocaleString('es-CO')}</span>
      <span class="hero-label">contratos firmados desde enero de 2024</span>
    </div>
    <div class="hero-tile">
      <span class="hero-num">${formatCOP(r.valorTotal)}</span>
      <span class="hero-label">valor total contratado (COP)</span>
    </div>
    <div class="hero-tile hero-tile--alerta">
      <span class="hero-num">${pctDirecta}%</span>
      <span class="hero-label">del dinero adjudicado por contratación directa — la regla general debería ser la licitación (Ley 1150 de 2007)</span>
    </div>`;
}

// ─── RENDER (todo el tablero para un resumen dado) ───────────────────────────
function renderAll(r) {
  renderHero(r);

  renderMonthlyBars('chart-mes-contratos', r.serieMensual ?? [], {
    valueIdx: 1, gold: false, format: v => Math.round(v).toLocaleString('es-CO'),
  });
  renderMonthlyBars('chart-mes-valor', r.serieMensual ?? [], {
    valueIdx: 2, gold: true, format: formatCOP,
  });

  renderBarList('chart-modalidad',
    [...r.porModalidad]
      .sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0))   // este gráfico muestra VALOR
      .slice(0, 8).map(([label, count, valor]) => ({
      label, value: valor ?? 0,
      display: formatCOP(valor ?? 0),
      title: `${label}: ${count.toLocaleString('es-CO')} contratos`,
    })),
    { gold: true, pctBase: r.valorTotal });

  renderBarList('chart-tipo',
    r.porTipo.slice(0, 8).map(([label, count]) => ({
      label, value: count,
      display: `${count.toLocaleString('es-CO')} contratos`,
    })));

  renderBarList('chart-entidades',
    (r.topEntidades ?? []).map(([label, count, valor]) => ({
      label, value: valor,
      display: formatCOP(valor),
      title: `${label}: ${count.toLocaleString('es-CO')} contratos`,
    })),
    { gold: true, pctBase: r.valorTotal });

  renderBarList('chart-contratistas',
    r.topValor.map(t => ({
      label: t.name,
      sub: t.nit ? `NIT ${t.nit}` : '',
      value: t.valor,
      display: formatCOP(t.valor),
      title: `${t.name}: ${t.count.toLocaleString('es-CO')} contratos`,
    })),
    { gold: true, pctBase: r.valorTotal });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  let resumen = null;
  try {
    const res = await fetch('data/resumen.json');
    if (res.ok) resumen = await res.json();
  } catch { /* sin resumen */ }

  if (!resumen || !resumen.serieMensual) {
    document.getElementById('loading').innerHTML = `
      <div class="error-state">
        <h2>Aún no hay estadísticas pre-generadas</h2>
        <p>Esta página necesita <code>data/resumen.json</code>, que genera
        <code>fetch_data.py</code> (o el workflow semanal de GitHub Actions).<br>
        Vuelve al <a href="index.html">tablero principal</a>, que también funciona
        consultando la API en vivo.</p>
      </div>`;
    return;
  }

  const d = new Date(resumen.updated).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  document.getElementById('last-updated').textContent = `// datos actualizados: ${d}`;

  // Selector de ámbito: toda la contratación ↔ solo Alcaldía/Distrito
  const note = document.getElementById('scope-note');
  document.querySelectorAll('input[name="ambito"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const alcaldia = radio.value === 'alcaldia';
      if (alcaldia && !resumen.alcaldia) {
        note.textContent = 'aún no hay resumen de la Alcaldía — regenera los datos';
        renderAll(resumen);
        return;
      }
      const r = alcaldia ? resumen.alcaldia : resumen;
      note.textContent = alcaldia
        ? `${r.total.toLocaleString('es-CO')} contratos · ${formatCOP(r.valorTotal)}`
        : '';
      renderAll(r);
    });
  });

  renderAll(resumen);
  document.getElementById('loading').classList.add('hidden');
}

init();
