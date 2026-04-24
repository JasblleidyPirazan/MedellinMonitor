// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SECOP_URL   = 'https://www.datos.gov.co/resource/jbjy-vk9h.json';
const CIUDAD      = 'Medellín';           // "Medellín"
const FECHA_INICIO = '2024-01-01T00:00:00.000'; // gobierno Fico
const FETCH_LIMIT = 5000;
const PAGE_SIZE   = 50;
const CACHE_TTL   = 30 * 60 * 1000; // 30 min, igual que CaliMonitor

// ─── STATE ────────────────────────────────────────────────────────────────────
let allContracts      = [];
let filteredContracts = [];
let currentPage       = 0;

// ─── NORMALIZE ────────────────────────────────────────────────────────────────
// Field names verified against SECOP II (jbjy-vk9h) via CaliMonitor lib/contracts.ts
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
    esPyme:        raw.es_pyme === 'Sí' || raw.es_pyme === 'Si' || raw.es_pyme === '1',
    // Nota: el campo tiene tilde en el nombre → 'duraci_n_del_contrato' en la API
    duracion:      raw['duración_del_contrato'] ?? raw['duraci_n_del_contrato'] ?? '—',
    url,
    ciudad:        raw.ciudad ?? CIUDAD,
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

function setLoading(text, sub) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-sub').textContent  = sub;
}

// ─── FETCH ────────────────────────────────────────────────────────────────────
async function fetchContracts() {
  // 1) Intentar archivo estático pre-generado (más rápido, para cPanel)
  try {
    const res = await fetch('data/contratos.json');
    if (res.ok) {
      const payload = await res.json();
      if (payload.contracts && payload.contracts.length > 0) {
        setLoading(`Cargando ${payload.contracts.length.toLocaleString('es-CO')} contratos desde archivo local…`, '');
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
    return data;
  }

  // 3) API en vivo
  setLoading('Consultando SECOP II en datos.gov.co…', `Filtrando por ciudad="${CIUDAD}" desde ${FECHA_INICIO.slice(0,10)}`);

  const params = new URLSearchParams({
    '$where': `ciudad='${CIUDAD}' AND fecha_de_firma >= '${FECHA_INICIO}'`,
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
    el.innerHTML = '<p style="color:var(--text-muted);font-size:11px">Sin datos</p>';
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

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable(contracts, page) {
  const start = page * PAGE_SIZE;
  const slice = contracts.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('table-body');

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">Sin resultados para los filtros seleccionados.</td></tr>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = slice.map(c => {
    const color   = estadoColor(c.estado);
    const objHtml = c.url
      ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.objeto)}">› ${esc(c.objeto)}</a>`
      : `<span title="${esc(c.objeto)}">› ${esc(c.objeto)}</span>`;
    const linkHtml = c.url
      ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">↗ SECOP</a>`
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

  let html = `<button class="page-btn" onclick="goPage(${page - 1})" ${page === 0 ? 'disabled' : ''}>‹</button>`;
  if (start > 0) html += `<button class="page-btn" onclick="goPage(0)">1</button><span style="color:var(--text-muted);font-size:12px">…</span>`;
  for (let i = start; i < end; i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goPage(${i})">${i + 1}</button>`;
  }
  if (end < pages) html += `<span style="color:var(--text-muted);font-size:12px">…</span><button class="page-btn" onclick="goPage(${pages - 1})">${pages}</button>`;
  html += `<button class="page-btn" onclick="goPage(${page + 1})" ${page >= pages - 1 ? 'disabled' : ''}>›</button>`;
  html += `<span class="page-info">${total.toLocaleString('es-CO')} contratos &middot; p&aacute;g. ${page + 1}/${pages}</span>`;

  el.innerHTML = html;
}

window.goPage = function(page) {
  currentPage = page;
  renderTable(filteredContracts, currentPage);
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

function applyFilters() {
  const entidad  = document.getElementById('filter-entidad').value;
  const tipo     = document.getElementById('filter-tipo').value;
  const modalidad = document.getElementById('filter-modalidad').value;
  const estado   = document.getElementById('filter-estado').value;
  const search   = document.getElementById('search-input').value.trim().toLowerCase();

  filteredContracts = allContracts.filter(c => {
    if (entidad   && c.entidad   !== entidad)   return false;
    if (tipo      && c.tipo      !== tipo)       return false;
    if (modalidad && c.modalidad !== modalidad)  return false;
    if (estado    && c.estado    !== estado)     return false;
    if (search) {
      const hay = c.proveedor.toLowerCase().includes(search) ||
                  c.objeto.toLowerCase().includes(search)    ||
                  c.entidad.toLowerCase().includes(search);
      if (!hay) return false;
    }
    return true;
  });

  currentPage = 0;
  const stats = computeStats(filteredContracts);
  renderKPIs(stats);
  renderBars('chart-tipo-bars',      stats.porTipo,      '');
  renderBars('chart-modalidad-bars', stats.porModalidad, 'bar-fill--purple');
  renderTable(filteredContracts, currentPage);
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
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    allContracts      = await fetchContracts();
    filteredContracts = [...allContracts];

    const stats = computeStats(allContracts);
    renderKPIs(stats);
    renderBars('chart-tipo-bars',      stats.porTipo,      '');
    renderBars('chart-modalidad-bars', stats.porModalidad, 'bar-fill--purple');
    setupFilters();
    renderTable(filteredContracts, currentPage);
    document.getElementById('results-count').textContent =
      `${filteredContracts.length.toLocaleString('es-CO')} contratos`;

    const now = new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('last-updated').textContent = `// actualizado ${now}`;

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
