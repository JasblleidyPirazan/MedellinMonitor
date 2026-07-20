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

## Actualización automática con GitHub Actions

Si el repo está en GitHub, el workflow `.github/workflows/update_data.yml` corre automáticamente cada lunes a las 8am UTC y actualiza `data/contratos.json`.

Para activarlo: haz push del repo a GitHub y activa los workflows en la pestaña Actions.

---

## Fuente de datos

- **Dataset**: SECOP II Contratos Electrónicos — `jbjy-vk9h`
- **API**: Socrata Open Data API (SODA) — `datos.gov.co`
- **Filtro**: `ciudad='Medellín'` desde `2024-01-01`
- **Operador**: Colombia Compra Eficiente / MinTIC
- **Licencia**: Datos abiertos — uso libre con atribución

---

## Tecnología

- HTML5 + CSS3 + JavaScript (vanilla, sin frameworks)
- Sin base de datos, sin backend, sin dependencias de build
- Costo de hosting: $0 (compatible con plan gratuito de cualquier CDN o cPanel)
