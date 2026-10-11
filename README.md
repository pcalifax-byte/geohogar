# MapMarket

Aplicación web de bienes raíces en Costa Rica con navegación 100% centrada en el mapa (Leaflet + Tailwind + JavaScript puro, en un solo `index.html`).

- Demo: https://mapmarketapp.com/
- Datos: anuncios publicados por usuarios (Supabase, con moderación) y 40 propiedades de ejemplo ficticias marcadas como [DEMO].
- Tipo de cambio aproximado: 1 USD = ₡455.
- Base de datos: `schema.sql` (PostgreSQL + PostGIS) y `schema.json`.
- Backend y escalado: ver `BACKEND.md`.

![Vista de escritorio](app_preview_desktop.png)

## Datos y actualización
Los datos viven en `data/` y se actualizan con `python3 scripts/update.py` (commit + push solo si hay cambios). Ver `BACKEND.md` §9–10.

> Nota: la marca es **MapMarket**, pero el repositorio y la URL siguen siendo `geohogar` a propósito. Renombrar el repo cambiaría la URL de GitHub Pages (`…/geohogar/` → `…/mapmarket/`) y rompería las Redirect URLs configuradas en Supabase y las URLs de retorno de Tilopay. Si algún día se renombra, actualiza esas configuraciones al mismo tiempo.


## Contenido de terceros (11 oct 2026)
El sitio público ya no incluye anuncios, remates, adjudicados ni medianas obtenidos de otros portales. La captura del 10 oct 2026 se conserva solo en tablas privadas de Supabase (`privado_propiedades`, `privado_remates`) visibles únicamente para `rol=admin` (admin.html → Datos privados y capa privada en el mapa). El historial de git anterior aún contiene esos archivos.
