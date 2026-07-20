# Arquitectura — Monitor de Contratación Medellín

Documentación técnica del proyecto. Para instrucciones de despliegue rápido, ver el [README](../README.md).

---

## 1. ¿Qué es este proyecto?

Un **dashboard de veeduría ciudadana** que muestra los contratos públicos firmados por entidades de Medellín durante el gobierno 2024–2027 ("gobierno Fico"). Es producido por [Venseremos](https://venseremos.co) y consume datos abiertos de **SECOP II** publicados en `datos.gov.co` por Colombia Compra Eficiente.

Principios de diseño:

- **100% estático**: solo HTML + CSS + JavaScript vanilla. Sin frameworks, sin build, sin backend, sin base de datos.
- **Hosting de costo $0**: funciona en cualquier hosting compartido (cPanel), CDN o GitHub Pages.
- **Datos siempre públicos**: la fuente es la API abierta SODA de datos.gov.co; cualquiera puede verificar los datos.

---

## 2. Estructura de archivos

```
MedellinMonitor/
├── index.html                      # Única página del sitio (estructura del dashboard)
├── assets/
│   ├── app.js                      # Toda la lógica: fetch, normalización, filtros, render
│   └── styles.css                  # Estilos "terminal" (tema oscuro, JetBrains Mono)
├── fetch_data.py                   # Script Python: pre-genera data/contratos.json
├── data/
│   └── contratos.json              # (generado) snapshot de contratos — no versionado por defecto
└── .github/workflows/
    └── update_data.yml             # GitHub Action: actualiza el snapshot cada lunes
```

No hay `package.json`, `node_modules` ni paso de compilación. Abrir `index.html` en un navegador (o servirlo con cualquier servidor estático) es suficiente.

---

## 3. Fuente de datos

| Aspecto | Valor |
|---|---|
| Dataset | SECOP II — Contratos Electrónicos (`jbjy-vk9h`) |
| API | Socrata Open Data API (SODA) — `https://www.datos.gov.co/resource/jbjy-vk9h.json` |
| Filtro | `ciudad='Medellín' AND fecha_de_firma >= '2024-01-01'` |
| Orden | `fecha_de_firma DESC` |
| Operador | Colombia Compra Eficiente / MinTIC |
| Licencia | Datos abiertos, uso libre con atribución |

La consulta se hace con parámetros SoQL (`$where`, `$limit`, `$offset`, `$order`) directamente sobre el endpoint JSON, sin necesidad de token de aplicación.

### Particularidades del dataset (importantes al mantener el código)

- El campo del contratista es **`proveedor_adjudicado`** (no `nombre_del_contratista_proveedor`, que existe en otros datasets de SECOP).
- El campo de duración tiene tilde en el nombre original, así que la API puede exponerlo como `duración_del_contrato` **o** `duraci_n_del_contrato` — el código contempla ambos.
- `urlproceso` a veces llega como string y a veces como objeto `{ url: "..." }` — la normalización maneja los dos casos.
- `es_pyme` llega como texto (`'Sí'`, `'Si'`, `'1'`), no como booleano.
- El identificador puede venir en `id_contrato` o en `referencia_del_contrato`.

---

## 4. Flujo de datos

El frontend (`assets/app.js`) intenta cargar los contratos en **tres niveles, en orden de prioridad**:

```
┌─────────────────────────────┐
│ 1. data/contratos.json      │  Snapshot local pre-generado. Carga instantánea.
│    (si existe y tiene datos)│  Ya viene normalizado por fetch_data.py.
└──────────────┬──────────────┘
               │ no existe / vacío
               ▼
┌─────────────────────────────┐
│ 2. sessionStorage           │  Caché de sesión del navegador (TTL 30 min).
│    'medellin_contracts'     │  Evita re-consultar la API al recargar.
└──────────────┬──────────────┘
               │ no hay caché válido
               ▼
┌─────────────────────────────┐
│ 3. API SODA en vivo         │  fetch directo a datos.gov.co desde el navegador
│    (límite 5.000 registros) │  ($limit=5000, sin paginación en el cliente).
└─────────────────────────────┘
```

Diferencia clave entre las rutas: el script Python (`fetch_data.py`) **pagina** en lotes de 5.000 hasta traer todos los registros; el fetch en vivo del navegador trae **solo los 5.000 más recientes**. Por eso el snapshot pre-generado es la ruta recomendada para producción.

### Modelo de datos normalizado

Tanto `fetch_data.py` como `app.js` implementan la misma función `normalize()` que convierte un registro crudo de SECOP II a este esquema:

| Campo | Origen (SECOP II) | Tipo |
|---|---|---|
| `id` | `id_contrato` ∥ `referencia_del_contrato` | string |
| `entidad` | `nombre_entidad` | string |
| `sector` | `sector` | string |
| `objeto` | `objeto_del_contrato` ∥ `descripcion_del_proceso` | string |
| `tipo` | `tipo_de_contrato` | string |
| `modalidad` | `modalidad_de_contratacion` | string |
| `estado` | `estado_contrato` | string |
| `valor` | `valor_del_contrato` | number (COP) |
| `valorPagado` | `valor_pagado` | number (COP) |
| `valorPendiente` | `valor_pendiente_de_ejecucion` | number (COP) |
| `fechaFirma` / `fechaInicio` / `fechaFin` | `fecha_de_firma` / `fecha_de_inicio_del_contrato` / `fecha_de_fin_del_contrato` | string ISO |
| `proveedor` | `proveedor_adjudicado` | string |
| `esPyme` | `es_pyme` (`'Sí'`/`'Si'`/`'1'`) | boolean |
| `duracion` | `duración_del_contrato` ∥ `duraci_n_del_contrato` | string |
| `url` | `urlproceso` (string u objeto `{url}`) | string |
| `ciudad` | `ciudad` | string |

**Si se modifica el esquema, hay que cambiarlo en los dos sitios** (`fetch_data.py` y `app.js`) para que el snapshot y el fetch en vivo sigan siendo intercambiables.

El archivo `data/contratos.json` generado tiene esta envoltura:

```json
{
  "updated": "2026-07-20T08:00:00+00:00",
  "total": 12345,
  "ciudad": "Medellín",
  "contracts": [ { ...contrato normalizado... } ]
}
```

---

## 5. Frontend (`assets/app.js`)

Un solo archivo, sin dependencias, organizado en secciones:

- **CONFIG**: URL de la API, ciudad, fecha de inicio, `FETCH_LIMIT` (5.000), `PAGE_SIZE` (50 filas por página), `CACHE_TTL` (30 min).
- **STATE**: tres variables globales — `allContracts`, `filteredContracts`, `currentPage`.
- **NORMALIZE**: mapeo de campos SECOP → esquema interno (ver tabla anterior).
- **UTILS**: `formatCOP` (abrevia valores: `K` miles, `M` millones, `MM` miles de millones, `B` billones), `formatDate` (locale `es-CO`), `estadoColor` (colorea el estado del contrato), `esc` (escape HTML contra XSS — todo dato de la API pasa por aquí antes de insertarse en el DOM).
- **FETCH**: la cascada de tres niveles descrita arriba.
- **STATS**: `computeStats` agrega totales, contratos activos (estado contiene "activo" o "ejecuci"), conteo PyME y distribuciones por tipo y modalidad.
- **RENDER**: KPIs (4 tarjetas), gráficos de barras horizontales (top 8 por tipo y por modalidad, generados como HTML/CSS puro, sin librería de gráficos), tabla paginada y paginador.
- **FILTERS**: cuatro selects (entidad, tipo, modalidad, estado — poblados dinámicamente con los valores únicos de los datos) más búsqueda de texto libre (con debounce de 200 ms) sobre proveedor, objeto y entidad. Todos los KPIs y gráficos se recalculan sobre el subconjunto filtrado.
- **INIT**: orquesta todo y maneja el estado de error (overlay con mensaje si la API falla).

### UI (`index.html` + `assets/styles.css`)

Estética de "terminal": fondo casi negro, tipografía monoespaciada (JetBrains Mono desde Google Fonts — única dependencia externa además de la API), paneles con títulos `▶`, y la paleta de marca de Venseremos definida como variables CSS (`--purple: #7010a6`, `--yellow: #fcd700`). Los colores de estado (`--green`, `--orange`, `--red`, etc.) codifican el estado del contrato en la tabla y los KPIs.

Secciones de la página, en orden: overlay de carga → header con marca y fecha de actualización → 4 KPIs (contratos, valor total, activos, PyME) → 2 gráficos de barras → panel de filtros → tabla de contratos con enlace a la ficha del proceso en SECOP → footer con atribución de fuente.

---

## 6. Generación del snapshot (`fetch_data.py`)

Script de Python 3 (única dependencia: `requests`):

1. Descarga **todos** los contratos que cumplen el filtro, paginando con `$offset` en lotes de 5.000 y esperando 0,5 s entre lotes (cortesía con la API pública).
2. Normaliza cada registro con la misma lógica del frontend.
3. Escribe `data/contratos.json` (UTF-8, indentado, con metadatos `updated`/`total`).

Uso manual:

```bash
pip install requests
python fetch_data.py
```

## 7. Actualización automática (`.github/workflows/update_data.yml`)

GitHub Action que:

- Corre **cada lunes a las 8:00 UTC** (3:00 a.m. hora de Medellín) y también manualmente vía `workflow_dispatch`.
- Ejecuta `fetch_data.py` en Python 3.11 y hace commit automático de `data/contratos.json` (con `[skip ci]`) usando `stefanzweifel/git-auto-commit-action`.

Así, un despliegue que sirva el repo directamente (p. ej. GitHub Pages) se mantiene actualizado sin intervención.

---

## 8. Despliegue

Dos modalidades (detalladas en el README):

- **Opción A — solo estáticos**: subir `index.html` + `assets/` a cualquier hosting. El navegador consulta la API en vivo (limitado a los 5.000 contratos más recientes).
- **Opción B — con snapshot** (recomendada): además subir `data/contratos.json` generado por `fetch_data.py`. Carga instantánea y dataset completo.

No hay variables de entorno, secretos ni configuración de servidor. El único requisito es que el hosting sirva archivos estáticos y que el navegador del visitante pueda alcanzar `datos.gov.co` (solo en la opción A).

---

## 9. Mantenimiento y evolución

Puntos a tener en cuenta al modificar el proyecto:

- **Doble implementación de `normalize()`**: cualquier cambio de esquema debe aplicarse en `fetch_data.py` **y** en `assets/app.js`.
- **Cambio de ciudad o periodo**: ajustar las constantes `CIUDAD` y `FECHA_INICIO` en ambos archivos (el proyecto es un fork conceptual de "CaliMonitor" — mismo patrón aplicado a otra ciudad).
- **Límites de la API**: la ruta en vivo trae máximo 5.000 registros; si Medellín supera ese volumen visible, la única ruta completa es el snapshot.
- **Cambios en el dataset de SECOP**: los nombres de campo están verificados contra `jbjy-vk9h`; si Colombia Compra Eficiente renombra campos, se rompe la normalización silenciosamente (los campos caen al valor por defecto `'—'` o `0`).
- **Seguridad**: todo dato externo se escapa con `esc()` antes de insertarse con `innerHTML`. Mantener esa disciplina en cualquier render nuevo.
- **Sin tests ni linters**: el proyecto no tiene suite de pruebas; la verificación es manual (abrir `index.html` y comprobar carga, filtros y tabla).
