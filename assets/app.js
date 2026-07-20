// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SECOP_URL    = 'https://www.datos.gov.co/resource/jbjy-vk9h.json';
const FECHA_INICIO = '2024-01-01T00:00:00.000'; // gobierno Fico
const FETCH_LIMIT  = 5000;
const PAGE_SIZE    = 50;
const CACHE_TTL    = 30 * 60 * 1000; // 30 min

// Medellín aparece en SECOP II con varios nombres: "Medellín", "Medellin"
// (sin tilde) y "Distrito Especial de Ciencia, Tecnología e Innovación de
// Medellín" (Ley 2286 de 2023). El LIKE sobre upper() captura todas.
const WHERE_CIUDAD = "upper(ciudad) like '%MEDELL%'";

// Valores de proveedor que no son un contratista real
const PROVEEDOR_INVALIDO = /^(—|-|n\/?a|no definido|no adjudicado|no aplica)$/i;

// ─── STATE ────────────────────────────────────────────────────────────────────
let allContracts      = [];
let filteredContracts = [];
let currentPage       = 0;
let sortKey           = null;  // 'valor' | 'fechaFirma' | null (orden de la API)
let sortDir           = -1;    // -1 desc, 1 asc

// ─── NORMALIZE ────────────────────────────────────────────────────────────────
// Field names verificados contra SECOP II (jbjy-vk9h)
function normalize(raw) {
  const urlRaw = raw.urlproceso;
  const url = typeof urlRaw === 'object' && urlRaw !== null
    ? (urlRaw.url ?? '')
    : (urlRaw ?? '');
  return {
    id:            raw.id_contrato ?? raw.referencia_del_contrato ?? String(Math.random()),
    entidad:       raw.nombre_entidad ?? '—',
    sector:        raw.sector ?? '—',
    objeto:        raw.objeto_del_contrato ?? raw.descripcion_del_proceso ?? '—',
    tipo:          raw.tipo_de_contrato ?? '—',
    modalidad:     raw.modalidad_de_contratacion ?? '—',
    estado:        raw.estado_contrato ?? '—',
    valor:         Number(raw.valor_del_contrato) || 0,
    valorPagado:   Number(raw.valor_pagado) || 0,
    valorPendiente:Number(raw.valor_pendiente_de_ejecucion) || 0,
    fechaFirma:    raw.fecha_de_firma ?? '',
    fechaInicio:   raw.fecha_de_inicio_del_contrato ?? '',
    fechaFin:      raw.fecha_de_fin_del_contrato ?? '',
    // SECOP II usa "proveedor_adjudicado", no "nombre_del_contratista_proveedor"
    proveedor:     raw.proveedor_adjudicado ?? '—',
    docProveedor:  raw.documento_proveedor ?? '',
    esPyme:        raw.es_pyme === 'Sí' || raw.es_pyme === 'Si' || raw.es_pyme === '1',
    // Nota: el campo tiene tilde en el nombre → 'duraci_n_del_contrato' en la API
    duracion:      raw['duración_del_contrato'] ?? raw['duraci_n_del_contrato'] ?? '—',
    url,
    ciudad:        raw.ciudad ?? 'Medellín',
  };
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function formatCOP(val) {
  if (!val) return '$0';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}B`;
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(2)}MM`;
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3)  return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toLocaleString('es-CO')}`;
}

function formatPct(part, total) {
  if (!total) return '0%';
  return `${(part / total * 100).toFixed(1)}%`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      year: 'numeric', month: 'short', day: '2-digit',
    });
  } catch { return iso.slice(0, 10); }
}

function estadoColor(estado) {
  const s = estado.toLowerCase();
  if (s.includes('activo') || s.includes('ejecuci')) return 'var(--green)';
  if (s.includes('cerrado'))                          return 'var(--yellow)';
  if (s.includes('terminado'))                        return 'var(--orange)';
  if (s.includes('liquidado'))                        return 'var(--text-muted)';
  if (s.includes('suspendido'))                       return 'var(--red)';
  return 'var(--white)';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function proveedorValido(nombre) {
  return nombre && !PROVEEDOR_INVALIDO.test(nombre.trim());
}

function esDirecta(modalidad) {
  return /directa/i.test(modalidad);
}

function setLoading(text, sub) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-sub').textContent  = sub;
}

function setUpdatedBadge(isoDate) {
  const badge = document.getElementById('last-updated');
  if (isoDate) {
    const d = new Date(isoDate).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    badge.textContent = `// datos actualizados: ${d}`;
  } else {
    const now = new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    badge.textContent = `// consultado en vivo: ${now}`;
  }
}

// ─── FETCH ────────────────────────────────────────────────────────────────────
async function fetchContracts() {
  // 1) Intentar archivo estático pre-generado (más rápido, dataset completo)
  try {
    const res = await fetch('data/contratos.json');
    if (res.ok) {
      const payload = await res.json();
      if (payload.contracts && payload.contracts.length > 0) {
        setLoading(`Cargando ${payload.contracts.length.toLocaleString('es-CO')} contratos desde archivo local…`, '');
        setUpdatedBadge(payload.updated);
        return payload.contracts;
      }
    }
  } catch {
    // archivo no existe → continuar con API en vivo
  }

  // 2) Cache de sesión (evita re-fetch en 30 min)
  const cached     = sessionStorage.getItem('medellin_contracts');
  const cachedTime = sessionStorage.getItem('medellin_contracts_ts');
  if (cached && cachedTime && Date.now() - Number(cachedTime) < CACHE_TTL) {
    const data = JSON.parse(cached);
    setLoading(`Desde caché: ${data.length.toLocaleString('es-CO')} contratos`, '');
    setUpdatedBadge(new Date(Number(cachedTime)).toISOString());
    return data;
  }

  // 3) API en vivo (trae solo los FETCH_LIMIT contratos más recientes)
  setLoading('Consultando SECOP II en datos.gov.co…', `Contratos de Medellín (todas las variantes del nombre) desde ${FECHA_INICIO.slice(0, 10)}`);

  const params = new URLSearchParams({
    '$where': `${WHERE_CIUDAD} AND fecha_de_firma >= '${FECHA_INICIO}'`,
    '$limit': String(FETCH_LIMIT),
    '$order': 'fecha_de_firma DESC',
  });

  const res = await fetch(`${SECOP_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`SECOP API respondió ${res.status} — intenta de nuevo`);

  const raw = await res.json();
  setLoading(`Procesando ${raw.length.toLocaleString('es-CO')} contratos…`, '');

  const contracts = raw.map(normalize);
  try {
    sessionStorage.setItem('medellin_contracts', JSON.stringify(contracts));
    sessionStorage.setItem('medellin_contracts_ts', String(Date.now()));
  } catch { /* storage lleno, ignorar */ }

  setUpdatedBadge(null);
  return contracts;
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function computeStats(contracts) {
  const valorTotal = contracts.reduce((s, c) => s + c.valor, 0);
  const activos    = contracts.filter(c => {
    const s = c.estado.toLowerCase();
    return s.includes('activo') || s.includes('ejecuci');
  }).length;
  const pymes = contracts.filter(c => c.esPyme).length;

  const tipoMap      = new Map();
  const modalidadMap = new Map();
  for (const c of contracts) {
    tipoMap.set(c.tipo, (tipoMap.get(c.tipo) ?? 0) + 1);
    modalidadMap.set(c.modalidad, (modalidadMap.get(c.modalidad) ?? 0) + 1);
  }

  return {
    total: contracts.length,
    valorTotal,
    activos,
    pymes,
    porTipo:      [...tipoMap.entries()].sort((a, b) => b[1] - a[1]),
    porModalidad: [...modalidadMap.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function computeTopContratistas(contracts) {
  const map = new Map(); // proveedor → { count, valor }
  for (const c of contracts) {
    if (!proveedorValido(c.proveedor)) continue;
    const e = map.get(c.proveedor) ?? { count: 0, valor: 0 };
    e.count += 1;
    e.valor += c.valor;
    map.set(c.proveedor, e);
  }
  const arr = [...map.entries()].map(([name, e]) => ({ name, ...e }));
  return {
    porNumero: [...arr].sort((a, b) => b.count - a.count).slice(0, 10),
    porValor:  [...arr].sort((a, b) => b.valor - a.valor).slice(0, 10),
    totalProveedores: arr.length,
  };
}

// ─── ALERTAS DE VEEDURÍA ──────────────────────────────────────────────────────
// Señales de alerta derivadas de las normas de contratación colombiana
// (Ley 80/1993, Ley 1150/2007, Decreto 1082/2015). Son indicadores para
// investigar, no acusaciones: cada cifra invita a revisar los contratos.
function computeAlertas(contracts, top) {
  const valorTotal = contracts.reduce((s, c) => s + c.valor, 0);

  // 1. Contratación directa (excepcional según Ley 1150/2007, art. 2 num. 4)
  const directa      = contracts.filter(c => esDirecta(c.modalidad));
  const directaValor = directa.reduce((s, c) => s + c.valor, 0);

  // 2. Concentración: participación del top 10 contratistas en el valor total
  const top10Valor = top.porValor.reduce((s, t) => s + t.valor, 0);

  // 3. Contratos firmados en diciembre (riesgo de ejecución afanada de
  //    presupuesto al cierre de vigencia)
  const diciembre = contracts.filter(c => {
    if (!c.fechaFirma) return false;
    const d = new Date(c.fechaFirma);
    return !isNaN(d) && d.getMonth() === 11;
  });

  // 4. Posible fraccionamiento: un mismo contratista con 5+ contratos por
  //    contratación directa o mínima cuantía (eludir licitación fraccionando
  //    contratos viola el principio de transparencia de la Ley 80/1993)
  const fracMap = new Map();
  for (const c of contracts) {
    if (!proveedorValido(c.proveedor)) continue;
    if (!(esDirecta(c.modalidad) || /m[ií]nima cuant/i.test(c.modalidad))) continue;
    fracMap.set(c.proveedor, (fracMap.get(c.proveedor) ?? 0) + 1);
  }
  const fraccionamiento = [...fracMap.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1]);

  return { valorTotal, directa, directaValor, top10Valor, diciembre, fraccionamiento };
}

function nivelAlerta(pct, medio, alto) {
  if (pct >= alto)  return 'alerta--alta';
  if (pct >= medio) return 'alerta--media';
  return 'alerta--baja';
}

function renderAlertas(a, totalContratos) {
  const el = document.getElementById('alertas-grid');
  if (!totalContratos) { el.innerHTML = ''; return; }

  const pctDirectaValor = a.valorTotal ? a.directaValor / a.valorTotal * 100 : 0;
  const pctTop10        = a.valorTotal ? a.top10Valor / a.valorTotal * 100 : 0;
  const pctDiciembre    = a.diciembre.length / totalContratos * 100;

  const topFrac = a.fraccionamiento.slice(0, 3)
    .map(([name, n]) => `<button class="link-contratista" data-proveedor="${esc(name)}">${esc(name)} (${n})</button>`)
    .join(', ');

  el.innerHTML = `
    <div class="alerta-card ${nivelAlerta(pctDirectaValor, 30, 50)}">
      <span class="alerta-valor">${formatPct(a.directaValor, a.valorTotal)}</span>
      <span class="alerta-titulo">del dinero por contratación directa</span>
      <p class="alerta-desc">${a.directa.length.toLocaleString('es-CO')} contratos (${formatCOP(a.directaValor)}).
      La contratación directa es un mecanismo excepcional — la regla general es la licitación pública
      (Ley 1150 de 2007, art. 2).</p>
    </div>
    <div class="alerta-card ${nivelAlerta(pctTop10, 40, 60)}">
      <span class="alerta-valor">${formatPct(a.top10Valor, a.valorTotal)}</span>
      <span class="alerta-titulo">del dinero en solo 10 contratistas</span>
      <p class="alerta-desc">${formatCOP(a.top10Valor)} concentrados en el top 10.
      Alta concentración puede indicar baja pluralidad de oferentes, un principio de la
      contratación estatal (Ley 80 de 1993).</p>
    </div>
    <div class="alerta-card ${nivelAlerta(pctDiciembre, 15, 25)}">
      <span class="alerta-valor">${a.diciembre.length.toLocaleString('es-CO')}</span>
      <span class="alerta-titulo">contratos firmados en diciembre</span>
      <p class="alerta-desc">${formatPct(a.diciembre.length, totalContratos)} del total.
      Concentración de firmas al cierre de vigencia puede señalar ejecución afanada del
      presupuesto (principio de planeación).</p>
    </div>
    <div class="alerta-card ${a.fraccionamiento.length ? 'alerta--media' : 'alerta--baja'}">
      <span class="alerta-valor">${a.fraccionamiento.length.toLocaleString('es-CO')}</span>
      <span class="alerta-titulo">contratistas con 5+ contratos directos</span>
      <p class="alerta-desc">Muchos contratos pequeños al mismo proveedor pueden indicar
      fraccionamiento para eludir licitación, prohibido por el principio de transparencia
      (Ley 80 de 1993).${topFrac ? ` Revisar: ${topFrac}.` : ''}</p>
    </div>`;

  el.querySelectorAll('.link-contratista').forEach(btn => {
    btn.addEventListener('click', () => filtrarPorProveedor(btn.dataset.proveedor));
  });
}

// ─── RENDER KPIs ──────────────────────────────────────────────────────────────
function renderKPIs(stats) {
  document.getElementById('kpi-total').textContent   = stats.total.toLocaleString('es-CO');
  document.getElementById('kpi-valor').textContent   = formatCOP(stats.valorTotal);
  document.getElementById('kpi-activos').textContent = stats.activos.toLocaleString('es-CO');
  document.getElementById('kpi-pyme').textContent    = stats.pymes.toLocaleString('es-CO');
}

// ─── RENDER BARS ─────────────────────────────────────────────────────────────
function renderBars(containerId, entries, fillClass) {
  const el = document.getElementById(containerId);
  if (!entries.length) {
    el.innerHTML = '<p class="sin-datos">Sin datos</p>';
    return;
  }
  const max = entries[0][1];
  el.innerHTML = entries.slice(0, 8).map(([label, count]) => `
    <div class="bar-item">
      <div class="bar-meta">
        <span class="bar-name" title="${esc(label)}">${esc(label)}</span>
        <span class="bar-count">${count}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${fillClass}" style="width:${Math.round(count / max * 100)}%"></div>
      </div>
    </div>`).join('');
}

// ─── RENDER TOP CONTRATISTAS ──────────────────────────────────────────────────
function renderTopList(containerId, items, metricFn) {
  const el = document.getElementById(containerId);
  if (!items.length) {
    el.innerHTML = '<p class="sin-datos">Sin datos</p>';
    return;
  }
  el.innerHTML = items.map((t, i) => `
    <li class="top-item">
      <span class="top-rank">${String(i + 1).padStart(2, '0')}</span>
      <button class="top-name link-contratista" data-proveedor="${esc(t.name)}" title="Filtrar por ${esc(t.name)}">${esc(t.name)}</button>
      <span class="top-metric">${metricFn(t)}</span>
    </li>`).join('');
  el.querySelectorAll('.link-contratista').forEach(btn => {
    btn.addEventListener('click', () => filtrarPorProveedor(btn.dataset.proveedor));
  });
}

function filtrarPorProveedor(nombre) {
  document.getElementById('search-input').value = nombre;
  applyFilters();
  document.getElementById('contracts-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── SORT ─────────────────────────────────────────────────────────────────────
function sortContracts(contracts) {
  if (!sortKey) return contracts;
  return [...contracts].sort((a, b) => {
    const va = sortKey === 'valor' ? a.valor : (a.fechaFirma || '');
    const vb = sortKey === 'valor' ? b.valor : (b.fechaFirma || '');
    if (va < vb) return -sortDir;
    if (va > vb) return sortDir;
    return 0;
  });
}

function setupSort() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = -sortDir;
      } else {
        sortKey = key;
        sortDir = -1;
      }
      document.querySelectorAll('th[data-sort]').forEach(t => {
        t.setAttribute('aria-sort', t.dataset.sort === sortKey
          ? (sortDir === -1 ? 'descending' : 'ascending')
          : 'none');
        t.querySelector('.sort-indicator').textContent =
          t.dataset.sort === sortKey ? (sortDir === -1 ? '▼' : '▲') : '↕';
      });
      currentPage = 0;
      renderTable(sortContracts(filteredContracts), currentPage);
    });
  });
}

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  const cols = [
    ['entidad', 'Entidad'], ['objeto', 'Objeto'], ['proveedor', 'Contratista'],
    ['tipo', 'Tipo'], ['modalidad', 'Modalidad'], ['estado', 'Estado'],
    ['valor', 'Valor (COP)'], ['valorPagado', 'Valor pagado (COP)'],
    ['fechaFirma', 'Fecha firma'], ['fechaInicio', 'Fecha inicio'], ['fechaFin', 'Fecha fin'],
    ['esPyme', 'PyME'], ['ciudad', 'Ciudad'], ['url', 'URL SECOP'],
  ];
  const escCsv = v => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    cols.map(([, label]) => escCsv(label)).join(';'),
    ...filteredContracts.map(c =>
      cols.map(([key]) => escCsv(key === 'esPyme' ? (c.esPyme ? 'Sí' : 'No') : c[key])).join(';')),
  ];
  // BOM para que Excel abra el UTF-8 correctamente; ';' como separador (locale es-CO)
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `contratos-medellin-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable(contracts, page) {
  const start = page * PAGE_SIZE;
  const slice = contracts.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('table-body');

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Sin resultados para los filtros seleccionados.</td></tr>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = slice.map(c => {
    const color   = estadoColor(c.estado);
    const objHtml = c.url
      ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.objeto)}">› ${esc(c.objeto)}</a>`
      : `<span title="${esc(c.objeto)}">› ${esc(c.objeto)}</span>`;
    const linkHtml = c.url
      ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" aria-label="Ver ficha en SECOP">↗ SECOP</a>`
      : '';
    return `
      <tr>
        <td class="td-entidad" title="${esc(c.entidad)}">${esc(c.entidad)}</td>
        <td class="td-objeto">${objHtml}</td>
        <td class="td-contratista" title="${esc(c.proveedor)}">${esc(c.proveedor)}</td>
        <td class="td-modalidad" title="${esc(c.modalidad)}">${esc(c.modalidad)}</td>
        <td class="td-valor" style="color:${color}">${formatCOP(c.valor)}</td>
        <td class="td-fecha">${formatDate(c.fechaFirma)}</td>
        <td><span class="badge-estado" style="background:${color}">${esc(c.estado)}</span></td>
        <td class="td-link">${linkHtml}</td>
      </tr>`;
  }).join('');

  renderPagination(contracts.length, page);
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
function renderPagination(total, page) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const el    = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }

  const start = Math.max(0, page - 2);
  const end   = Math.min(pages, page + 3);

  let html = `<button class="page-btn" onclick="goPage(${page - 1})" ${page === 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button>`;
  if (start > 0) html += `<button class="page-btn" onclick="goPage(0)">1</button><span class="page-dots">…</span>`;
  for (let i = start; i < end; i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goPage(${i})" ${i === page ? 'aria-current="page"' : ''}>${i + 1}</button>`;
  }
  if (end < pages) html += `<span class="page-dots">…</span><button class="page-btn" onclick="goPage(${pages - 1})">${pages}</button>`;
  html += `<button class="page-btn" onclick="goPage(${page + 1})" ${page >= pages - 1 ? 'disabled' : ''} aria-label="Página siguiente">›</button>`;
  html += `<span class="page-info">${total.toLocaleString('es-CO')} contratos &middot; p&aacute;g. ${page + 1}/${pages}</span>`;

  el.innerHTML = html;
}

window.goPage = function(page) {
  currentPage = page;
  renderTable(sortContracts(filteredContracts), currentPage);
  document.getElementById('contracts-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function populateSelect(id, values) {
  const sel     = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';
  for (const v of [...values].sort()) {
    const opt      = document.createElement('option');
    opt.value      = v;
    opt.textContent = v;
    if (v === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderDerived(contracts) {
  const stats = computeStats(contracts);
  const top   = computeTopContratistas(contracts);

  renderKPIs(stats);
  renderBars('chart-tipo-bars',      stats.porTipo,      '');
  renderBars('chart-modalidad-bars', stats.porModalidad, 'bar-fill--yellow');
  renderTopList('top-numero', top.porNumero, t => `${t.count} contratos`);
  renderTopList('top-valor',  top.porValor,  t => formatCOP(t.valor));
  renderAlertas(computeAlertas(contracts, top), contracts.length);
}

function applyFilters() {
  const entidad   = document.getElementById('filter-entidad').value;
  const tipo      = document.getElementById('filter-tipo').value;
  const modalidad = document.getElementById('filter-modalidad').value;
  const estado    = document.getElementById('filter-estado').value;
  const search    = document.getElementById('search-input').value.trim().toLowerCase();

  filteredContracts = allContracts.filter(c => {
    if (entidad   && c.entidad   !== entidad)   return false;
    if (tipo      && c.tipo      !== tipo)       return false;
    if (modalidad && c.modalidad !== modalidad)  return false;
    if (estado    && c.estado    !== estado)     return false;
    if (search) {
      const hay = c.proveedor.toLowerCase().includes(search) ||
                  c.objeto.toLowerCase().includes(search)    ||
                  c.entidad.toLowerCase().includes(search)   ||
                  c.docProveedor.toLowerCase().includes(search);
      if (!hay) return false;
    }
    return true;
  });

  currentPage = 0;
  renderDerived(filteredContracts);
  renderTable(sortContracts(filteredContracts), currentPage);
  document.getElementById('results-count').textContent =
    `${filteredContracts.length.toLocaleString('es-CO')} contratos`;
}

function setupFilters() {
  const unique = key => [...new Set(allContracts.map(c => c[key]).filter(Boolean))];
  populateSelect('filter-entidad',  unique('entidad'));
  populateSelect('filter-tipo',     unique('tipo'));
  populateSelect('filter-modalidad',unique('modalidad'));
  populateSelect('filter-estado',   unique('estado'));

  for (const id of ['filter-entidad', 'filter-tipo', 'filter-modalidad', 'filter-estado']) {
    document.getElementById(id).addEventListener('change', applyFilters);
  }
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 200);
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    ['filter-entidad','filter-tipo','filter-modalidad','filter-estado'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('search-input').value = '';
    applyFilters();
  });
  document.getElementById('btn-export').addEventListener('click', exportCSV);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    allContracts      = await fetchContracts();
    filteredContracts = [...allContracts];

    renderDerived(allContracts);
    setupFilters();
    setupSort();
    renderTable(filteredContracts, currentPage);
    document.getElementById('results-count').textContent =
      `${filteredContracts.length.toLocaleString('es-CO')} contratos`;

  } catch (err) {
    document.getElementById('loading').innerHTML = `
      <div class="error-state">
        <h2>⚠ Error al cargar los datos</h2>
        <p>${esc(err.message)}</p>
        <p style="margin-top:12px">
          Recarga la página para reintentar.<br>
          Si el problema persiste, el servicio
          <a href="https://www.datos.gov.co" target="_blank" rel="noopener">datos.gov.co</a>
          puede estar temporalmente no disponible.
        </p>
      </div>`;
    return;
  }

  document.getElementById('loading').classList.add('hidden');
}

init();
