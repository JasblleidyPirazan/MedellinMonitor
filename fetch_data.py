#!/usr/bin/env python3
"""
Descarga contratos de Medellín desde SECOP II (datos.gov.co) y guarda
el resultado en data/contratos.json para servirlo como archivo estático.

Ventaja: la página carga los datos del archivo local (instantáneo)
en vez de hacer fetch a la API externa en cada visita.

Uso:
    pip install requests
    python fetch_data.py

Luego sube data/contratos.json junto con index.html, assets/ al cPanel.

Para automatización semanal, ver .github/workflows/update_data.yml
"""

import json
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
CIUDAD       = 'Medellín'
FECHA_INICIO = '2024-01-01T00:00:00.000'   # gobierno Fico
BATCH_SIZE   = 5000
OUTPUT_FILE  = Path(__file__).parent / 'data' / 'contratos.json'

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
        'esPyme':         raw.get('es_pyme') in ('Sí', 'Si', '1', True),
        'duracion':       raw.get('duración_del_contrato') or raw.get('duraci_n_del_contrato', '—'),
        'url':            url,
        'ciudad':         raw.get('ciudad', CIUDAD),
    }

# ─── FETCH ────────────────────────────────────────────────────────────────────
def fetch_batch(session: requests.Session, offset: int) -> list:
    params = {
        '$where':  f"ciudad='{CIUDAD}' AND fecha_de_firma >= '{FECHA_INICIO}'",
        '$limit':  BATCH_SIZE,
        '$offset': offset,
        '$order':  'fecha_de_firma DESC',
    }
    resp = session.get(SECOP_URL, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()

def fetch_all() -> list:
    session   = requests.Session()
    all_raw   = []
    offset    = 0

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

# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    print(f'Descargando contratos — ciudad="{CIUDAD}" desde {FECHA_INICIO[:10]}')
    OUTPUT_FILE.parent.mkdir(exist_ok=True)

    raw_records = fetch_all()

    print(f'Normalizando {len(raw_records):,} registros…')
    contracts = [normalize(r) for r in raw_records]

    payload = {
        'updated':   datetime.now(timezone.utc).isoformat(),
        'total':     len(contracts),
        'ciudad':    CIUDAD,
        'contracts': contracts,
    }

    OUTPUT_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f'✓ {OUTPUT_FILE}  ({size_kb:,.0f} KB, {len(contracts):,} contratos)')
    print()
    print('Próximo paso: sube data/contratos.json junto con index.html y assets/ al cPanel.')

if __name__ == '__main__':
    main()
