# Monitor de Contratación Medellín — Venseremos

Veeduría ciudadana sobre la contratación pública del gobierno de Medellín 2024–2027.  
Datos desde SECOP II (datos.gov.co) · API pública SODA · Colombia Compra Eficiente.

📐 **Documentación técnica**: ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) (estructura, flujo de datos, modelo normalizado, mantenimiento).

---

## Cómo funciona

El dashboard es **100% estático** (HTML + CSS + JS) — compatible con cualquier hosting, incluyendo cPanel.

Los datos se cargan de dos formas (en orden de prioridad):

1. **Archivo local** `data/contratos.json` — si existe, se carga instantáneamente.  
2. **API en vivo** desde `datos.gov.co` — si no hay archivo local, se consulta la API de SECOP II directamente en el navegador. No requiere backend.

---

## Despliegue en cPanel (hosting compartido)

### Opción A — Solo archivos estáticos (API en vivo)

Sube estos archivos a tu cPanel vía FTP o el Administrador de Archivos:

```
index.html
assets/styles.css
assets/app.js
```

Listo. La página consulta datos.gov.co automáticamente al abrirse.

### Opción B — Con datos pre-generados (carga más rápida)

1. Instala Python y `requests`:
   ```bash
   pip install requests
   ```
2. Ejecuta el script de descarga:
   ```bash
   python fetch_data.py
   ```
3. Sube estos archivos al cPanel:
   ```
   index.html
   assets/styles.css
   assets/app.js
   data/contratos.json
   ```

Ejecuta `fetch_data.py` cada semana para mantener los datos actualizados.

---

## Despliegue en Netlify (recomendado para validar visualizaciones)

El sitio es estático, así que Netlify no necesita build. Hay dos formas:

### Opción 1 — Conectar el repo de GitHub (CI continuo)

1. En [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
2. Elige GitHub y selecciona este repositorio.
3. Configuración de build (ya viene en `netlify.toml`, déjalo por defecto):
   - **Build command**: *(vacío)*
   - **Publish directory**: `.`
4. **Deploy site**. Cada push a la rama publicará una nueva versión.

> Netlify publica la rama que configures como producción; usa los
> *Deploy Previews* de las PR para previsualizar ramas de trabajo.

### Opción 2 — Arrastrar y soltar (deploy manual rápido)

1. En Netlify → **Add new site → Deploy manually**.
2. Arrastra la carpeta del proyecto (con `index.html`, `assets/`, `data/`).
3. Listo, queda publicado en una URL `*.netlify.app`.

Los datos se consultan en vivo desde `datos.gov.co` en el navegador del
visitante. Para una carga instantánea, ejecuta `python fetch_data.py` antes de
desplegar para incluir `data/contratos.json`.

---

## Actualización automática con GitHub Actions

Si el repo está en GitHub, el workflow `.github/workflows/update_data.yml` corre automáticamente cada lunes a las 8am UTC y actualiza `data/contratos.json`.

Para activarlo: haz push del repo a GitHub y activa los workflows en la pestaña Actions.

---

## Fuente de datos

- **Dataset**: SECOP II Contratos Electrónicos — `jbjy-vk9h`
- **API**: Socrata Open Data API (SODA) — `datos.gov.co`
- **Filtro**: `upper(ciudad) LIKE '%MEDELL%'` desde `2024-01-01` — cubre «Medellín», «Medellin» y «Distrito Especial de Ciencia, Tecnología e Innovación de Medellín»
- **Operador**: Colombia Compra Eficiente / MinTIC
- **Licencia**: Datos abiertos — uso libre con atribución

## Qué muestra el dashboard

- **KPIs**: número de contratos, valor total, contratos activos y contratos a PyME.
- **Alertas de veeduría** (semáforo verde/amarillo/rojo) basadas en las normas de contratación colombiana (Ley 80 de 1993, Ley 1150 de 2007): % del dinero por contratación directa, concentración del valor en el top 10 de contratistas, contratos firmados en diciembre y posible fraccionamiento (contratistas con 5+ contratos directos).
- **Top contratistas**: por número de contratos y por dinero contratado (clic en un nombre filtra la tabla).
- **Distribuciones** por tipo de contrato y modalidad.
- **Tabla** filtrable (entidad, tipo, modalidad, estado, búsqueda por contratista/NIT/objeto), ordenable por valor y fecha, con exportación a CSV y enlace a la ficha de cada proceso en SECOP.
- **Descarga de la base completa**: el botón «⬇⬇ Base completa (CSV)» baja todo el dataset (~120.000 contratos) directamente desde datos.gov.co a un CSV con NITs de entidad y contratista, listo para análisis local en Excel, pandas o SQLite.

---

## Tecnología

- HTML5 + CSS3 + JavaScript (vanilla, sin frameworks)
- Sin base de datos, sin backend, sin dependencias de build
- Costo de hosting: $0 (compatible con plan gratuito de cualquier CDN o cPanel)
