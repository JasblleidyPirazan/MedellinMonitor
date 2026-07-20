#!/usr/bin/env python3
"""
Descarga contratos de Medellín desde SECOP II (datos.gov.co) y guarda
el resultado en data/contratos.json para servirlo como archivo estático.

Ventaja: la página carga los datos del archivo local (instantáneo)
en vez de hacer fetch a la API externa en cada visita.

Uso:
    pip install requests
    python fetch_data.py

Opcional: exporta SOCRATA_APP_TOKEN para evitar límites de velocidad
de la API pública (token gratuito en https://dev.socrata.com/).

Luego sube data/contratos.json junto con index.html, assets/ al cPanel.

Para automatización semanal, ver .github/workflows/update_data.yml
"""

import json
import os
import re
import time
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("Instala requests primero:  pip install requests")
    sys.exit(1)

# ─── CONFIG ──────────────────────────────────────────────────────────────────
SECOP_URL    = 'https://www.datos.gov.co/resource/jbjy-vk9h.json'
FECHA_INICIO = '2024-01-01T00:00:00.000'   # gobierno Fico
BATCH_SIZE   = 5000
MAX_RETRIES  = 4
DATA_DIR     = Path(__file__).parent / 'data'
OUTPUT_FILE  = DATA_DIR / 'contratos.json'   # subconjunto reciente para la tabla
RESUMEN_FILE = DATA_DIR / 'resumen.json'     # agregados sobre el dataset COMPLETO

# El dataset completo de Medellín supera los 100.000 contratos (>100 MB en
# JSON — GitHub rechaza archivos así y el navegador no podría cargarlos).
# Estrategia: resumen.json lleva las estadísticas globales pre-agregadas;
# contratos.json lleva solo los más recientes para la tabla navegable.
RECENT_LIMIT = 10_000
OBJETO_MAX   = 240   # truncar objetos larguísimos en el subconjunto

# Medellín aparece en SECOP II con varios nombres según cómo registró la
# entidad su ubicación: "Medellín", "Medellin" (sin tilde) y, tras el cambio
# de categoría del municipio (Ley 2286 de 2023), "Distrito Especial de
# Ciencia, Tecnología e Innovación de Medellín". Un igual exacto pierde
# contratos; el LIKE sobre upper() captura todas las variantes.
WHERE = (
    "upper(ciudad) like '%MEDELL%' "
    f"AND fecha_de_firma >= '{FECHA_INICIO}'"
)

# ─── NORMALIZE ────────────────────────────────────────────────────────────────
# Field names exactos de SECOP II (jbjy-vk9h) — verificados contra la API
def normalize(raw: dict) -> dict:
    url = raw.get('urlproceso', '')
    if isinstance(url, dict):
        url = url.get('url', '')
    return {
        'id':             raw.get('id_contrato') or raw.get('referencia_del_contrato', ''),
        'entidad':        raw.get('nombre_entidad', '—'),
        'sector':         raw.get('sector', '—'),
        'objeto':         raw.get('objeto_del_contrato') or raw.get('descripcion_del_proceso', '—'),
        'tipo':           raw.get('tipo_de_contrato', '—'),
        'modalidad':      raw.get('modalidad_de_contratacion', '—'),
        'estado':         raw.get('estado_contrato', '—'),
        'valor':          float(raw.get('valor_del_contrato') or 0),
        'valorPagado':    float(raw.get('valor_pagado') or 0),
        'valorPendiente': float(raw.get('valor_pendiente_de_ejecucion') or 0),
        'fechaFirma':     raw.get('fecha_de_firma', ''),
        'fechaInicio':    raw.get('fecha_de_inicio_del_contrato', ''),
        'fechaFin':       raw.get('fecha_de_fin_del_contrato', ''),
        # SECOP II usa "proveedor_adjudicado", no "nombre_del_contratista_proveedor"
        'proveedor':      raw.get('proveedor_adjudicado', '—'),
        'docProveedor':   raw.get('documento_proveedor', ''),
        'esPyme':         raw.get('es_pyme') in ('Sí', 'Si', '1', True),
        'duracion':       raw.get('duración_del_contrato') or raw.get('duraci_n_del_contrato', '—'),
        'url':            url,
        'ciudad':         raw.get('ciudad', 'Medellín'),
    }

# ─── FETCH ────────────────────────────────────────────────────────────────────
def fetch_batch(session: requests.Session, offset: int) -> list:
    params = {
        '$where':  WHERE,
        '$limit':  BATCH_SIZE,
        '$offset': offset,
        # Orden estable (fecha + id) para que la paginación no duplique
        # ni salte registros si el dataset cambia entre lotes.
        '$order':  'fecha_de_firma DESC, id_contrato DESC',
    }
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(SECOP_URL, params=params, timeout=120)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            last_error = e
            wait = 2 ** (attempt + 1)
            print(f'\n  ⚠ intento {attempt + 1}/{MAX_RETRIES} falló ({e}); reintentando en {wait}s…')
            time.sleep(wait)
    raise RuntimeError(f'API no disponible tras {MAX_RETRIES} intentos: {last_error}')

def fetch_all() -> list:
    session = requests.Session()
    token = os.environ.get('SOCRATA_APP_TOKEN')
    if token:
        session.headers['X-App-Token'] = token
        print('Usando SOCRATA_APP_TOKEN')

    all_raw = []
    offset  = 0

    while True:
        print(f'  lote offset={offset:,}… ', end='', flush=True)
        batch = fetch_batch(session, offset)
        print(f'{len(batch):,} registros')
        all_raw.extend(batch)
        if len(batch) < BATCH_SIZE:
            break
        offset += BATCH_SIZE
        time.sleep(0.5)   # cortesía con la API pública

    return all_raw

def dedupe(contracts: list) -> list:
    """Elimina duplicados (la paginación puede repetir registros)."""
    seen, unique = set(), []
    for c in contracts:
        key = (c['id'], c['proveedor'], c['fechaFirma'], c['valor'])
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique

# ─── RESUMEN GLOBAL ──────────────────────────────────────────────────────────
# Misma semántica que computeStats/computeTopContratistas/computeAlertas en
# assets/app.js — mantener sincronizados.
PROVEEDOR_INVALIDO = re.compile(r'^(—|-|n/?a|no definido|no adjudicado|no aplica)$', re.I)
RE_DIRECTA         = re.compile(r'directa', re.I)
RE_MINIMA          = re.compile(r'm[ií]nima cuant', re.I)

def proveedor_valido(nombre: str) -> bool:
    return bool(nombre) and not PROVEEDOR_INVALIDO.match(nombre.strip())

def build_resumen(contracts: list) -> dict:
    valor_total = sum(c['valor'] for c in contracts)
    activos = sum(1 for c in contracts
                  if 'activo' in c['estado'].lower() or 'ejecuci' in c['estado'].lower())
    pymes = sum(1 for c in contracts if c['esPyme'])

    por_tipo, por_modalidad = {}, {}      # etiqueta → [count, valor]
    entidades = {}                        # entidad → [count, valor]
    proveedores = {}                      # clave NIT → {'nit','name','count','valor','frac'}
    meses = {}                            # 'YYYY-MM' → [count, valor]
    directa_count = directa_valor = 0
    diciembre = 0

    for c in contracts:
        e = por_tipo.setdefault(c['tipo'], [0, 0.0])
        e[0] += 1; e[1] += c['valor']
        e = por_modalidad.setdefault(c['modalidad'], [0, 0.0])
        e[0] += 1; e[1] += c['valor']
        e = entidades.setdefault(c['entidad'], [0, 0.0])
        e[0] += 1; e[1] += c['valor']

        es_directa = bool(RE_DIRECTA.search(c['modalidad']))
        if es_directa:
            directa_count += 1
            directa_valor += c['valor']

        mes = c['fechaFirma'][:7]
        if len(mes) == 7:
            e = meses.setdefault(mes, [0, 0.0])
            e[0] += 1; e[1] += c['valor']
        if c['fechaFirma'][5:7] == '12':
            diciembre += 1

        # Agregación por NIT: el mismo contratista aparece con varias grafías
        # del nombre (p. ej. «ITM» / «INSTITUCIÓN UNIVERSITARIA ITM»); el
        # documento_proveedor los unifica. Sin NIT válido, el nombre es la clave.
        nit = (c.get('docProveedor') or '').strip()
        key = nit if nit and not PROVEEDOR_INVALIDO.match(nit) else None
        if key is None and proveedor_valido(c['proveedor']):
            key = f'nombre:{c["proveedor"]}'
            nit = ''
        if key is not None:
            p = proveedores.setdefault(key, {'nit': nit, 'name': c['proveedor'],
                                             'count': 0, 'valor': 0.0, 'frac': 0})
            p['count'] += 1
            p['valor'] += c['valor']
            # nombre más descriptivo (el más largo visto para ese NIT)
            if len(c['proveedor']) > len(p['name']):
                p['name'] = c['proveedor']
            if es_directa or RE_MINIMA.search(c['modalidad']):
                p['frac'] += 1

    tops = [{'nit': p['nit'], 'name': p['name'], 'count': p['count'], 'valor': p['valor']}
            for p in proveedores.values()]
    top_numero = sorted(tops, key=lambda t: -t['count'])[:10]
    top_valor  = sorted(tops, key=lambda t: -t['valor'])[:10]
    top10_valor = sum(t['valor'] for t in top_valor)
    fraccionamiento = sorted(
        ({'nit': p['nit'], 'name': p['name'], 'count': p['frac']}
         for p in proveedores.values() if p['frac'] >= 5),
        key=lambda x: -x['count'])[:10]

    triples = lambda d: sorted(([k, v[0], v[1]] for k, v in d.items()), key=lambda x: -x[1])

    return {
        'total':        len(contracts),
        'valorTotal':   valor_total,
        'activos':      activos,
        'pymes':        pymes,
        'porTipo':      triples(por_tipo),
        'porModalidad': triples(por_modalidad),
        'topEntidades': sorted(([k, v[0], v[1]] for k, v in entidades.items()),
                               key=lambda x: -x[2])[:10],
        'serieMensual': sorted(([m, v[0], v[1]] for m, v in meses.items()
                                if m >= '2024-01'), key=lambda x: x[0]),
        'topNumero':    top_numero,
        'topValor':     top_valor,
        'alertas': {
            'directaCount':    directa_count,
            'directaValor':    directa_valor,
            'top10Valor':      top10_valor,
            'diciembreCount':  diciembre,
            'fraccionamiento': fraccionamiento,
        },
    }

# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    print(f'Descargando contratos de Medellín (todas las variantes del nombre) desde {FECHA_INICIO[:10]}')
    OUTPUT_FILE.parent.mkdir(exist_ok=True)

    raw_records = fetch_all()

    print(f'Normalizando {len(raw_records):,} registros…')
    contracts = dedupe([normalize(r) for r in raw_records])

    # Nunca sobrescribir un snapshot bueno con uno vacío (p. ej. si la API
    # respondió pero el filtro no trajo nada): fallar en voz alta.
    if not contracts:
        print('✗ La API devolvió 0 contratos — se conserva el snapshot anterior.')
        sys.exit(1)

    ciudades = sorted({c['ciudad'] for c in contracts})
    print(f'Variantes de ciudad encontradas: {ciudades}')

    updated = datetime.now(timezone.utc).isoformat()

    # 1) Resumen global: estadísticas sobre el dataset COMPLETO (archivo pequeño)
    print(f'Agregando estadísticas globales de {len(contracts):,} contratos…')
    resumen = build_resumen(contracts)
    resumen.update({'updated': updated, 'ciudad': 'Medellín', 'ciudades': ciudades})
    RESUMEN_FILE.write_text(
        json.dumps(resumen, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8',
    )
    print(f'✓ {RESUMEN_FILE}  ({RESUMEN_FILE.stat().st_size / 1024:,.0f} KB)')

    # 2) Subconjunto reciente para la tabla (JSON compacto, objeto truncado).
    #    El dataset completo pesa >100 MB — inviable en git y en el navegador.
    contracts.sort(key=lambda c: c['fechaFirma'], reverse=True)
    recent = contracts[:RECENT_LIMIT]
    for c in recent:
        if len(c['objeto']) > OBJETO_MAX:
            c['objeto'] = c['objeto'][:OBJETO_MAX - 1] + '…'

    payload = {
        'updated':     updated,
        'total':       len(recent),
        'totalGlobal': len(contracts),
        'ciudad':      'Medellín',
        'ciudades':    ciudades,
        'contracts':   recent,
    }
    OUTPUT_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8',
    )
    size_mb = OUTPUT_FILE.stat().st_size / 1024 / 1024
    print(f'✓ {OUTPUT_FILE}  ({size_mb:,.1f} MB, {len(recent):,} de {len(contracts):,} contratos)')
    print()
    print('Próximo paso: sube data/*.json junto con index.html y assets/ al cPanel.')

if __name__ == '__main__':
    main()
