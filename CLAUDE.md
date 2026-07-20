# CLAUDE.md

Guía para trabajar en este repositorio.

## Qué es

Dashboard estático de veeduría ciudadana sobre la contratación pública de Medellín (gobierno 2024–2027), producido por Venseremos. Consume el dataset SECOP II `jbjy-vk9h` de datos.gov.co vía la API SODA. Documentación técnica completa en `docs/ARQUITECTURA.md`.

## Stack y comandos

- HTML + CSS + JavaScript vanilla. **Sin build, sin npm, sin tests.** No hay `package.json`.
- Ejecutar localmente: servir la raíz con cualquier servidor estático, p. ej. `python3 -m http.server 8000` y abrir `http://localhost:8000`.
- Generar el snapshot de datos: `pip install requests && python fetch_data.py` → escribe `data/contratos.json`.
- Verificación: manual en el navegador (carga, KPIs, filtros, tabla, paginación). No hay suite de pruebas ni linter.

## Arquitectura en una línea por archivo

- `index.html` — única página; estructura del dashboard (KPIs, gráficos, filtros, tabla).
- `assets/app.js` — toda la lógica: cascada de carga (snapshot local → sessionStorage 30 min → API en vivo con `$limit=5000`), normalización, stats, filtros, render.
- `assets/styles.css` — tema oscuro "terminal", variables CSS con la paleta Venseremos (`--purple`, `--yellow`).
- `fetch_data.py` — descarga paginada completa y genera DOS archivos: `data/resumen.json` (estadísticas globales pre-agregadas del dataset completo, >100k contratos) y `data/contratos.json` (solo los 10.000 más recientes, compacto — el dataset completo pesa >100 MB y GitHub lo rechaza).
- `.github/workflows/update_data.yml` — actualiza el snapshot cada lunes 8:00 UTC vía auto-commit.

## Reglas importantes

1. **`normalize()` está duplicada** en `fetch_data.py` y `assets/app.js`. Cualquier cambio al esquema de contrato debe hacerse en ambos archivos, con la misma semántica.
2. **Nombres de campo de SECOP II** (verificados contra `jbjy-vk9h`): el contratista es `proveedor_adjudicado` (NIT en `documento_proveedor`); la duración puede llegar como `duración_del_contrato` o `duraci_n_del_contrato`; `urlproceso` puede ser string u objeto `{url}`; `es_pyme` es texto (`'Sí'`/`'Si'`/`'1'`). No "corregir" estos mapeos sin verificar contra la API real.
3. **Escapar siempre** los datos de la API con `esc()` antes de insertarlos en el DOM con `innerHTML` (prevención XSS).
4. **El filtro de ciudad es `upper(ciudad) LIKE '%MEDELL%'`**, no una igualdad: Medellín aparece como «Medellín», «Medellin» y «Distrito Especial de Ciencia, Tecnología e Innovación de Medellín». El filtro y `FECHA_INICIO` están duplicados en `app.js` (`WHERE_CIUDAD`) y `fetch_data.py` (`WHERE`); cambiarlos en ambos.
5. Mantener el proyecto libre de dependencias/build: la compatibilidad con hosting cPanel básico es un requisito del proyecto.
6. Idioma del proyecto (UI, comentarios, commits, docs): español.
