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
├── index.html                      # Dashboard principal (KPIs, alertas, tops, filtros, tabla)
├── graficos.html                   # Página de gráficos claves (serie mensual, modalidad, tops)
├── assets/
│   ├── app.js                      # Lógica del dashboard: fetch, normalización, filtros, render
│   ├── graficos.js                 # Lógica de la página de gráficos (consume data/resumen.json)
│   └── styles.css                  # Tema claro, paleta Venseremos, JetBrains Mono
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
| Filtro | `upper(ciudad) like '%MEDELL%' AND fecha_de_firma >= '2024-01-01'` |
| Orden | `fecha_de_firma DESC` (el script añade `id_contrato DESC` para paginación estable) |
| Operador | Colombia Compra Eficiente / MinTIC |
| Licencia | Datos abiertos, uso libre con atribución |

La consulta se hace con parámetros SoQL (`$where`, `$limit`, `$offset`, `$order`) directamente sobre el endpoint JSON. No requiere token, pero `fetch_data.py` acepta uno opcional vía la variable de entorno `SOCRATA_APP_TOKEN` (evita límites de velocidad; token gratuito en dev.socrata.com).

### El nombre de Medellín en el dataset (crítico)

Medellín **no aparece con un único nombre** en el campo `ciudad`. Según cómo registró cada entidad su ubicación, puede aparecer como:

- `Medellín`
- `Medellin` (sin tilde)
- `Distrito Especial de Ciencia, Tecnología e Innovación de Medellín` (nuevo nombre oficial tras la Ley 2286 de 2023)

Por eso el filtro usa `upper(ciudad) LIKE '%MEDELL%'` en lugar de una igualdad exacta — **un `ciudad='Medellín'` exacto pierde contratos**. Si se toca el filtro, mantener este criterio en ambos sitios (`fetch_data.py` y `assets/app.js`).

### Particularidades del dataset (importantes al mantener el código)

- El campo del contratista es **`proveedor_adjudicado`** (no `nombre_del_contratista_proveedor`, que existe en otros datasets de SECOP). El NIT/documento está en `documento_proveedor`.
- El campo de duración tiene tilde en el nombre original, así que la API puede exponerlo como `duración_del_contrato` **o** `duraci_n_del_contrato` — el código contempla ambos.
- `urlproceso` a veces llega como string y a veces como objeto `{ url: "..." }` — la normalización maneja los dos casos.
- `es_pyme` llega como texto (`'Sí'`, `'Si'`, `'1'`), no como booleano.
- El identificador puede venir en `id_contrato` o en `referencia_del_contrato`.

---

## 4. Flujo de datos

### Dos archivos de datos (importante)

El dataset completo de Medellín supera los **100.000 contratos**: un solo JSON pesa >100 MB, que GitHub rechaza (límite de 100 MB por archivo) y ningún navegador debería descargar. Por eso `fetch_data.py` genera **dos archivos**:

- **`data/resumen.json`** (~KB): KPIs, distribuciones, top contratistas y alertas **pre-agregados sobre el dataset completo**. Cuando no hay filtros activos, los paneles del dashboard muestran estas cifras globales exactas. Incluye además la clave **`alcaldia`** — el mismo resumen calculado solo sobre los contratos cuya entidad es la Alcaldía/Municipio/Distrito de Medellín — que alimenta el **selector de ámbito** del tablero y de la página de gráficos («Toda la contratación» ↔ «Solo Alcaldía»). El matcher (`es_alcaldia`/`esAlcaldia`, duplicado en Python y JS) exige que el nombre de la entidad *empiece* por una de las tres formas, para no arrastrar entes adscritos como el Fondo de Valorización.
- **`data/contratos.json`** (~MB): los **10.000 contratos más recientes** en JSON compacto (objeto truncado a 240 caracteres), para la tabla navegable, los filtros y la exportación CSV. Incluye `totalGlobal` para que la UI indique "N más recientes de M en total".

Al aplicar un filtro o búsqueda, los paneles se recalculan sobre el subconjunto cargado (el contador de resultados lo aclara). La función `build_resumen()` de `fetch_data.py` replica la semántica de `computeStats`/`computeTopContratistas`/`computeAlertas` de `app.js` — mantener sincronizadas.

### Cascada de carga

El frontend (`assets/app.js`) intenta cargar los contratos en **tres niveles, en orden de prioridad** (y además intenta `data/resumen.json` para las cifras globales):

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
| `docProveedor` | `documento_proveedor` | string |
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
- **STATS**: `computeStats` agrega totales, contratos activos (estado contiene "activo" o "ejecuci"), conteo PyME y distribuciones por tipo y modalidad (entradas `[etiqueta, nº, valor]`). `computeTopContratistas` calcula el top 10 de contratistas **agrupando por NIT** (`documento_proveedor`) — un mismo contratista aparece en SECOP con varias grafías del nombre (p. ej. «ITM» / «INSTITUCIÓN UNIVERSITARIA ITM») y el NIT las unifica; se muestra la grafía más larga vista y el NIT. Sin NIT válido, el nombre hace de clave. Se excluyen placeholders ("No Definido" / "No Adjudicado").
- **Búsqueda por palabras clave**: todas las palabras del cuadro de búsqueda deben aparecer (en cualquier orden) en contratista, NIT, objeto o entidad.
- **ALERTAS DE VEEDURÍA**: `computeAlertas` calcula cuatro indicadores derivados de las normas de contratación colombiana, presentados con semáforo (verde/amarillo/rojo según umbrales):
  1. **% del valor por contratación directa** — mecanismo excepcional según Ley 1150 de 2007, art. 2 (media ≥30 %, alta ≥50 %).
  2. **Concentración**: % del valor total en el top 10 contratistas — pluralidad de oferentes, Ley 80 de 1993 (media ≥40 %, alta ≥60 %).
  3. **Contratos firmados en diciembre** — riesgo de ejecución afanada al cierre de vigencia (media ≥15 %, alta ≥25 % del total).
  4. **Posible fraccionamiento**: contratistas con 5+ contratos por contratación directa o mínima cuantía — el fraccionamiento para eludir licitación viola el principio de transparencia (Ley 80 de 1993). Muestra los 3 principales, clicables.
  Las alertas son indicadores estadísticos para investigar, no acusaciones (así se aclara en el footer).
- **RENDER**: KPIs (4 tarjetas), gráficos de barras horizontales (top 8 por tipo y por modalidad, HTML/CSS puro, sin librería de gráficos), listas de top contratistas (clic en un nombre → filtra la tabla por ese contratista), tarjetas de alertas, tabla paginada con encabezado fijo (sticky) y paginador.
- **SORT**: las columnas VALOR y FECHA FIRMA son ordenables (clic alterna asc/desc, con `aria-sort`).
- **EXPORT**: botón "Exportar CSV" descarga los contratos filtrados (separador `;`, BOM UTF-8 para Excel).
- **FILTERS**: cuatro selects (entidad, tipo, modalidad, estado — poblados dinámicamente con los valores únicos de los datos) más búsqueda de texto libre (con debounce de 200 ms) sobre proveedor, NIT (`docProveedor`), objeto y entidad. KPIs, gráficos, tops y alertas se recalculan sobre el subconjunto filtrado.
- **INIT**: orquesta todo y maneja el estado de error (overlay con mensaje si la API falla). El badge del header muestra la fecha real del snapshot (`payload.updated`) cuando se carga desde archivo, o "consultado en vivo" cuando viene de la API.

### UI (`index.html` + `assets/styles.css`)

Estética de "terminal": fondo casi negro, tipografía monoespaciada (JetBrains Mono desde Google Fonts — única dependencia externa además de la API), paneles con títulos `▶`, y la paleta de marca de Venseremos definida como variables CSS (`--purple: #7010a6`, `--yellow: #fcd700`). Los colores de estado (`--green`, `--orange`, `--red`, etc.) codifican el estado del contrato en la tabla y los KPIs.

Secciones de la página, en orden: overlay de carga → header con marca y fecha de actualización → 4 KPIs (contratos, valor total, activos, PyME) → 2 gráficos de barras → panel de filtros → tabla de contratos con enlace a la ficha del proceso en SECOP → footer con atribución de fuente.

---

## 6. Generación del snapshot (`fetch_data.py`)

Script de Python 3 (única dependencia: `requests`):

1. Descarga **todos** los contratos que cumplen el filtro, paginando con `$offset` en lotes de 5.000 y esperando 0,5 s entre lotes (cortesía con la API pública). Cada lote se reintenta hasta 4 veces con backoff exponencial si la API falla.
2. Normaliza cada registro con la misma lógica del frontend y **deduplica** (la paginación puede repetir registros si el dataset cambia entre lotes; por eso el orden incluye `id_contrato` como desempate).
3. **Se niega a escribir un snapshot vacío**: si la API devuelve 0 contratos, sale con error para no sobrescribir datos buenos (protege al workflow automático).
4. Escribe `data/contratos.json` (UTF-8, indentado, con metadatos `updated`/`total`/`ciudades` — esta última lista las variantes del nombre de Medellín encontradas).

Uso manual:

```bash
pip install requests
python fetch_data.py
```

## 7. Actualización automática (`.github/workflows/update_data.yml`)

GitHub Action que:

- Corre **cada lunes a las 8:00 UTC** (3:00 a.m. hora de Medellín) y también manualmente vía `workflow_dispatch`.
- Declara `permissions: contents: write` — **sin esto el push del commit automático falla** (el token por defecto de Actions es de solo lectura en repos nuevos).
- Pasa el secreto opcional `SOCRATA_APP_TOKEN` al script (crearlo en Settings → Secrets del repo si la API limita las peticiones).
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

- **Doble implementación de `normalize()` y del filtro `WHERE`**: cualquier cambio de esquema o de criterio de ciudad debe aplicarse en `fetch_data.py` **y** en `assets/app.js`.
- **Cambio de ciudad o periodo**: ajustar el filtro de ciudad (`WHERE`/`WHERE_CIUDAD`) y `FECHA_INICIO` en ambos archivos (el proyecto es un fork conceptual de "CaliMonitor" — mismo patrón aplicado a otra ciudad). Recordar que las ciudades pueden tener múltiples variantes de nombre en SECOP.
- **Umbrales de las alertas**: los porcentajes de semáforo viven en `renderAlertas`/`nivelAlerta` en `app.js`; son heurísticos y ajustables. Al cambiarlos, documentar el criterio.
- **Límites de la API**: la ruta en vivo trae máximo 5.000 registros; si Medellín supera ese volumen visible, la única ruta completa es el snapshot.
- **Cambios en el dataset de SECOP**: los nombres de campo están verificados contra `jbjy-vk9h`; si Colombia Compra Eficiente renombra campos, se rompe la normalización silenciosamente (los campos caen al valor por defecto `'—'` o `0`).
- **Seguridad**: todo dato externo se escapa con `esc()` antes de insertarse con `innerHTML`. Mantener esa disciplina en cualquier render nuevo.
- **Sin tests ni linters**: el proyecto no tiene suite de pruebas; la verificación es manual (abrir `index.html` y comprobar carga, filtros y tabla).
