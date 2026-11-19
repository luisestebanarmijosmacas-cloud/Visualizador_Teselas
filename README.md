# GeoBIM Viewer — Visor de modelos 3D Tiles con GitHub Pages

Sitio web **estático**, adaptable a móvil y escritorio, construido con **CesiumJS 1.138.0**, para mostrar modelos fotogramétricos teselados mediante `tileset.json`. Funciona sin base de datos, servidor de aplicación ni token de Cesium ion (si los archivos ya están en formato 3D Tiles y accesibles por URL).

## 1. Probar en tu computador

Desde la carpeta de este proyecto, abre una terminal y ejecuta:

```bash
python -m http.server 8000
```

Luego visita **http://localhost:8000**. No abras `index.html` con doble clic (`file://`), porque el navegador puede bloquear la lectura de archivos 3D Tiles. El visor incluye un modelo sintético de demostración para verificar el funcionamiento.

> Requiere conexión a Internet para descargar la biblioteca CesiumJS desde jsDelivr. Los modelos propios pueden estar alojados en el mismo dominio o en un servidor externo configurado con CORS.

## 2. Publicar en GitHub Pages

1. Crea en GitHub un repositorio público, por ejemplo `visor-3d-bim`.
2. Sube **el contenido de esta carpeta** a la raíz del repositorio: `index.html`, `assets/`, `modelos/` y `.nojekyll`.
3. En el repositorio abre **Settings → Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**, rama `main` y carpeta `/(root)`. Guarda los cambios.
5. GitHub publicará una URL similar a `https://TU-USUARIO.github.io/visor-3d-bim/`. Sustituye `TU-USUARIO` por tu cuenta. La publicación puede tardar un poco.

## 3. Incorporar modelos de Metashape

En **Metashape Professional**, genera/exporta el modelo teselado como **Cesium 3D Tiles**, según las opciones disponibles en tu versión. El resultado para el visor necesita un archivo raíz `tileset.json` y todos los recursos vinculados (por ejemplo archivos `.b3dm`, `.glb` o teselas hijas).

Colócalos sin modificar sus rutas relativas, por ejemplo:

```
visor-3d-tiles-github/
├── index.html
├── .nojekyll
├── assets/
│   ├── app.js
│   ├── models.js
│   └── style.css
└── modelos/
    ├── demo/
    │   ├── tileset.json
    │   └── demo.glb
    └── presa-toachi/
        ├── tileset.json
        └── ... (teselas y texturas del modelo)
```

> **Atención geoespacial:** prepara correctamente la georreferenciación para 3D Tiles. Un modelo con coordenadas locales TM o sin sistema conocido puede necesitar reproyección/transformación antes de visualizarlo correctamente en un globo WGS84/ECEF. **No basta con renombrar archivos**.

## 4. Registrar cada modelo en el catálogo

Edita `assets/models.js`. Agrega un objeto dentro de `window.GEOBIM_MODELS`:

```javascript
{
  id: "presa-toachi",
  name: "Presa Toachi — Modelo fotogramétrico",
  category: "FOTOGRAMETRÍA",
  location: "Ecuador",
  year: "2026",
  format: "3D Tiles",
  projection: "WGS84 / ECEF",
  description: "Modelo teselado del levantamiento RPAS.",
  url: "modelos/presa-toachi/tileset.json"
}
```

**Importante**: cada objeto debe separarse del anterior con una coma. También puedes abrir un `tileset.json` alojado en un servicio externo directamente desde el formulario lateral.

## 5. Modelos grandes: alojamiento recomendado

Para modelos pequeños puedes subir las teselas al propio repositorio público, respetando los límites de GitHub. GitHub Pages impone un **límite recomendado de 1 GB para el repositorio fuente**, **1 GB para el sitio publicado** y un **límite suave de 100 GB/mes de transferencia** (verifica siempre la documentación vigente). Modelos pesados de varios GB conviene alojarlos en Cesium ion, Amazon S3, Cloudflare R2 u otro almacenamiento de objetos/CDN. Mantén el código del visor en GitHub Pages y configura en `models.js` una URL HTTPS pública a `tileset.json`.

Un servidor externo debe permitir que el navegador descargue `tileset.json` y todas sus teselas mediante CORS (`Access-Control-Allow-Origin`). Los modelos protegidos requieren autenticación/autorización adicional que este prototipo estático **no implementa**. No pongas tokens privados o secretos en el repositorio público ni en JavaScript del navegador.

## 6. Funciones incluidas

- Visor 3D georreferenciado basado en CesiumJS, con navegación mediante ratón/táctil.
- Catálogo de modelos, búsqueda, descripción y metadatos.
- Carga de `tileset.json` de GitHub Pages o alojamiento externo con CORS.
- Ajuste de nivel de detalle (SSE, menor = más calidad), encuadrar modelo y globo activable.
- Distancia espacial **en línea recta** entre dos puntos seleccionados (aproximada, depende de la precisión de la superficie 3D y de la selección gráfica). No equivale a medición topográfica certificada.
- Enlace compartible a un modelo del catálogo o a una URL externa.
- Una escena 3D de demostración diseñada para este proyecto, **no basada en datos reales**.

## 7. Limitaciones

- Este visor está especializado en **3D Tiles**. No admite directamente archivos RCP/RCS, RVT, IFC, LAS/LAZ o un OBJ/FBX sin convertir. Para IFC/GLB nativos se puede incorporar otro módulo de visualización.
- Es necesario WebGL y un navegador reciente.
- Para compartir con terceros, los tilesets externos necesitan un URL válido y permisos de lectura. Pegar una ruta de disco local `C:\...` no funciona.
- La nube de puntos, las secciones BIM, las mediciones precisas y las anotaciones persistentes requerirían funcionalidades adicionales.
- Los modelos de demostración y su ubicación son puramente ilustrativos.

## 8. Documentación

- [CesiumJS](https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html)
- [Metashape Professional (manual)](https://www.agisoft.com/pdf/metashape-pro_2_1_en.pdf)
- [Límites de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
