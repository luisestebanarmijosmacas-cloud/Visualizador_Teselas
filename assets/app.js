/* GeoBIM Viewer v2.0. CesiumJS 1.138.0 | GitHub Pages. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const models = Array.isArray(window.GEOBIM_MODELS) ? [...window.GEOBIM_MODELS] : [];
  let viewer, currentTileset = null, currentModel = null;
  let toastTimer = null, measuring = false, measurePoints = [], measureEntities = [];
  let clicks;

  // Escala de renderizado + refinamiento de teselas; el LOD no inventa detalles.
  const QUALITY = [
    {name: 'Rápida', scale: 0.60, sse: 48},
    {name: 'Equilibrada', scale: 0.80, sse: 24},
    {name: 'Alta', scale: 1.00, sse: 10},
    {name: 'Máxima', scale: 1.25, sse: 4}
  ];
  const VIEW_DIRECTIONS = {
    top:   {name: 'Planta',    heading: 0,                  pitch: -Math.PI / 2},
    north: {name: 'Norte',     heading: Math.PI,            pitch: -0.08},
    south: {name: 'Sur',       heading: 0,                  pitch: -0.08},
    east:  {name: 'Este',      heading: -Math.PI / 2,       pitch: -0.08},
    west:  {name: 'Oeste',     heading: Math.PI / 2,        pitch: -0.08},
    iso:   {name: 'Isométrica',heading: -Math.PI / 4,       pitch: -Math.PI / 4}
  };
  let orthographic = false;

  function notify(message) {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }
  function showLoading(title, detail) {
    $('loadingLayer').hidden = false;
    $('loadingTitle').textContent = title;
    $('loadingDetail').textContent = detail;
    $('stateText').textContent = 'Cargando datos…';
  }
  function hideLoading() { $('loadingLayer').hidden = true; }

  function normalizeTilesetUrl(value) {
    const url = new URL(value, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La URL debe utilizar HTTPS o HTTP.');
    if (!url.pathname.toLowerCase().endsWith('/tileset.json')) {
      throw new Error('Introduce la dirección del archivo tileset.json (no la carpeta ni un archivo ZIP).');
    }
    return url.href;
  }

  function renderModels(query = '') {
    const list = $('modelList');
    list.replaceChildren();
    const term = query.toLowerCase().trim();
    const filtered = models.filter(m => [m.name, m.category, m.location].join(' ').toLowerCase().includes(term));
    $('modelCount').textContent = `${filtered.length} modelo${filtered.length === 1 ? '' : 's'}`;
    if (!filtered.length) {
      const empty = document.createElement('div'); empty.className = 'empty-search'; empty.textContent = 'No se encontraron modelos.';
      list.append(empty);
    }
    for (const m of filtered) {
      const btn = document.createElement('button');
      btn.className = `model-card${currentModel?.id === m.id ? ' active' : ''}`;
      btn.type = 'button'; btn.setAttribute('aria-pressed', String(currentModel?.id === m.id));
      const category = document.createElement('span'); category.className = 'card-category'; category.textContent = m.category || 'MODELO';
      const name = document.createElement('strong'); name.textContent = m.name;
      const loc = document.createElement('div'); loc.className = 'card-sub'; loc.textContent = m.location || 'Sin ubicación especificada';
      const footer = document.createElement('div'); footer.className = 'card-footer';
      for (const label of [m.year, m.format || '3D Tiles']) {
        if (!label) continue;
        const el = document.createElement('span'); el.className = 'tag'; el.textContent = label; footer.append(el);
      }
      btn.append(category, name, loc, footer);
      btn.addEventListener('click', () => {
        loadModel(m);
        $('sidebar').classList.remove('open');
      });
      list.append(btn);
    }
  }

  function removeCurrentModel() {
    if (currentTileset && !currentTileset.isDestroyed()) {
      viewer.scene.primitives.remove(currentTileset);
    }
    currentTileset = null;
    resetMeasure();
  }

  async function loadModel(model, updateHistory = true) {
    const previous = currentModel;
    currentModel = model;
    renderModels($('modelSearch').value);
    $('modelTitle').textContent = model.name;
    $('modelType').textContent = model.format || '3D TILES';
    $('modelDescription').textContent = model.description || 'Modelo 3D de alta resolución.';
    $('footerFormat').textContent = model.format || '3D Tiles';
    $('footerProjection').textContent = model.projection || 'No especificada';
    showLoading('Cargando modelo 3D…', model.name);

    try {
      const url = normalizeTilesetUrl(model.url);
      // Este modelo puede estar en GitHub Pages o en almacenamiento externo con CORS.
      const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
        maximumScreenSpaceError: QUALITY[Number($('qualityRange').value)].sse,
        enableDebugWireframe: false
      });
      // Si la selección cambió mientras descargábamos, descartar la carga antigua.
      if (currentModel !== model) { tileset.destroy(); return; }
      removeCurrentModel();
      currentTileset = viewer.scene.primitives.add(tileset);
      await viewer.zoomTo(tileset);
      $('stateText').textContent = 'Modelo cargado correctamente';
      hideLoading();
      if (updateHistory) {
        const u = new URL(window.location.href);
        u.searchParams.delete('tileset'); u.searchParams.delete('model');
        if (model.id.startsWith('url-')) u.searchParams.set('tileset', url);
        else u.searchParams.set('model', model.id);
        history.replaceState({}, '', u);
      }
      viewer.scene.requestRender();
    } catch (e) {
      if (currentModel !== model) return;
      currentModel = previous === model ? null : model;
      hideLoading();
      $('stateText').textContent = 'Error al abrir el tileset';
      $('modelDescription').textContent = `${e?.message || 'No se pudo cargar el modelo.'} Comprueba tileset.json, los archivos vinculados y los permisos CORS.`;
      notify('No se pudo abrir el tileset. Revisa la ruta y CORS.');
      console.error('Error cargando 3D Tiles:', e);
    }
  }

  function resetMeasure() {
    if (viewer) for (const entity of measureEntities) viewer.entities.remove(entity);
    measureEntities = []; measurePoints = []; measuring = false;
    $('measureBtn').classList.remove('active');
    $('cesiumContainer').style.cursor = 'auto';
    if (viewer) viewer.scene.requestRender();
  }
  function beginMeasure() {
    resetMeasure();
    measuring = true;
    $('measureBtn').classList.add('active');
    $('cesiumContainer').style.cursor = 'crosshair';
    notify('Selecciona dos puntos sobre el modelo para medir la distancia 3D.');
  }
  function pickedPosition(screenPosition) {
    let point;
    try {
      if (viewer.scene.pickPositionSupported && viewer.scene.pick(screenPosition)) {
        point = viewer.scene.pickPosition(screenPosition);
      }
    } catch (_e) { /* Ignorar y probar posición sobre el elipsoide */ }
    if (!Cesium.defined(point)) point = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid);
    return point;
  }
  function addMeasurementPoint(point) {
    const entity = viewer.entities.add({position: point, point: {pixelSize: 10, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY}});
    measureEntities.push(entity);
    measurePoints.push(point);
    if (measurePoints.length === 2) {
      const a = measurePoints[0], b = measurePoints[1];
      const distance = Cesium.Cartesian3.distance(a, b);
      const middle = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3());
      measureEntities.push(viewer.entities.add({
        polyline: {positions: [a,b], width: 3, material: Cesium.Color.CYAN, depthFailMaterial: Cesium.Color.CYAN},
        position: middle,
        label: {text: distance >= 1000 ? `${(distance / 1000).toFixed(3)} km` : `${distance.toFixed(2)} m`, font: 'bold 15px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 4, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -24), disableDepthTestDistance: Number.POSITIVE_INFINITY}
      }));
      measuring = false;
      $('measureBtn').classList.remove('active');
      $('cesiumContainer').style.cursor = 'auto';
      $('stateText').textContent = `Distancia entre puntos: ${distance.toFixed(2)} m`;
    }
    viewer.scene.requestRender();
  }

  async function share() {
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); notify('¡Enlace copiado! Puedes compartir este visor.'); }
    catch (_e) { window.prompt('Copia la URL del visor:', url); }
  }
  function setQuality() {
    const preset = QUALITY[Number($('qualityRange').value)] || QUALITY[2];
    $('qualityLabel').textContent = preset.name;
    $('qualityDetails').textContent = 'Resolución ' + Math.round(preset.scale * 100) + '% · umbral LOD ' + preset.sse + ' px';
    $('qualityRange').setAttribute('aria-valuetext', preset.name + ', resolución ' + Math.round(preset.scale * 100) + ' por ciento');
    if (currentTileset) currentTileset.maximumScreenSpaceError = preset.sse;
    if (viewer) {
      viewer.resolutionScale = preset.scale;
      viewer.scene.requestRender();
    }
  }

  function updateViewCube() {
    if (!viewer) return;
    // Cesium entrega rumbo y elevación de cámara; el cubo sigue la orientación real.
    const heading = Cesium.Math.toDegrees(viewer.camera.heading);
    const pitch = Cesium.Math.toDegrees(viewer.camera.pitch);
    $('viewCube').style.transform = 'rotateX(' + pitch.toFixed(2) + 'deg) rotateY(' + heading.toFixed(2) + 'deg)';
  }

  function selectView(viewName) {
    if (!viewer || !currentTileset) {
      notify('Carga un modelo 3D antes de elegir una vista.');
      return;
    }
    const preset = VIEW_DIRECTIONS[viewName];
    if (!preset) return;
    const sphere = currentTileset.boundingSphere;
    const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, sphere.center);
    const range = Math.max(sphere.radius * 1.65, Number.isFinite(distance) ? distance : 0, 25);

    // HeadingPitchRange está definido en coordenadas locales Este-Norte-Arriba.
    // La vista Planta mira verticalmente hacia abajo, con el norte arriba.
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 0.85,
      offset: new Cesium.HeadingPitchRange(preset.heading, preset.pitch, range),
      complete: () => viewer.scene.requestRender()
    });
    $('viewLabel').textContent = 'VISTA · ' + preset.name.toUpperCase();
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === viewName));
    });
  }

  function setProjection(isOrtho) {
    if (!viewer) return;
    orthographic = isOrtho;
    if (orthographic) viewer.camera.switchToOrthographicFrustum();
    else viewer.camera.switchToPerspectiveFrustum();
    $('projectionToggle').setAttribute('aria-pressed', String(orthographic));
    $('projectionToggle').textContent = orthographic ? 'Ortográfica: activada' : 'Ortográfica: desactivada';
    viewer.scene.requestRender();
  }

  function bootstrap() {
    if (typeof Cesium === 'undefined') { $('loadingTitle').textContent = 'CesiumJS no se pudo descargar'; $('loadingDetail').textContent = 'Revisa tu conexión a Internet o el bloqueo del CDN.'; return; }
    try {
      viewer = new Cesium.Viewer('cesiumContainer', {
        animation: false, timeline: false, geocoder: false, homeButton: false,
        baseLayerPicker: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, selectionIndicator: false, infoBox: false,
        scene3DOnly: true, baseLayer: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        requestRenderMode: true, maximumRenderTimeChange: Infinity,
        contextOptions: {webgl: {alpha: false, preserveDrawingBuffer: true}}
      });
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#29475c');
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#111e30');
      viewer.scene.globe.show = true;
      // Utilizamos elipsoide sin Cesium ion ni tokens. La escena de ejemplo es independiente.
      viewer.camera.setView({destination: Cesium.Cartesian3.fromDegrees(-78.91, -0.34, 15000)});
      clicks = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clicks.setInputAction(event => {
        if (!measuring) return;
        const point = pickedPosition(event.position);
        if (!Cesium.defined(point)) { notify('Haz clic sobre una superficie visible.'); return; }
        addMeasurementPoint(point);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      $('modelSearch').addEventListener('input', e => renderModels(e.target.value));
      $('urlForm').addEventListener('submit', e => {
        e.preventDefault();
        let url;
        try { url = normalizeTilesetUrl($('tilesetUrl').value.trim()); }
        catch (e) { notify(e.message); return; }
        const model = {id: `url-${Date.now()}`, name: 'Modelo externo · URL personalizada', category: 'TILESET EXTERNO', location: new URL(url).hostname, year: '', format: '3D Tiles', projection: 'Según archivo', description: 'Modelo abierto mediante URL. Su alojamiento debe permitir solicitudes CORS si está en otro dominio.', url};
        models.unshift(model); $('modelSearch').value = ''; loadModel(model);
      });
      $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
      $('zoomBtn').addEventListener('click', () => { if (currentTileset) viewer.zoomTo(currentTileset); else notify('Selecciona primero un modelo.'); });
      $('measureBtn').addEventListener('click', () => measuring ? resetMeasure() : beginMeasure());
      $('resetMeasureBtn').addEventListener('click', () => { resetMeasure(); notify('Mediciones eliminadas.'); });
      $('qualityRange').addEventListener('input', setQuality);
      document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => selectView(btn.dataset.view));
      });
      $('projectionToggle').addEventListener('click', () => setProjection(!orthographic));
      $('cesiumContainer').addEventListener('pointerdown', () => {
        $('viewLabel').textContent = 'VISTA · LIBRE';
        document.querySelectorAll('[data-view]').forEach(btn => btn.setAttribute('aria-pressed', 'false'));
      }, {passive: true});
      $('globeToggle').addEventListener('change', e => { viewer.scene.globe.show = e.target.checked; viewer.scene.requestRender(); });
      $('shareBtn').addEventListener('click', share);
      viewer.camera.changed.addEventListener(() => {
        const position = viewer.camera.positionCartographic;
        if (!position) return;
        const lat = Cesium.Math.toDegrees(position.latitude).toFixed(4);
        const lon = Cesium.Math.toDegrees(position.longitude).toFixed(4);
        $('coords').textContent = `CÁMARA · ${lat}°, ${lon}° · ${Math.max(0, position.height).toFixed(0)} m`;
        updateViewCube();
      });
      renderModels(); setQuality(); updateViewCube();
      const params = new URLSearchParams(window.location.search);
      const external = params.get('tileset');
      if (external) {
        $('tilesetUrl').value = external;
        $('urlForm').requestSubmit();
      } else {
        const id = params.get('model');
        if (models.length) loadModel(models.find(m => m.id === id) || models[0], false);
        else { hideLoading(); $('stateText').textContent = 'Agrega un modelo en assets/models.js'; }
      }
    } catch (e) {
      console.error('Fallo al iniciar el visor:', e);
      $('loadingTitle').textContent = 'Error inicializando CesiumJS';
      $('loadingDetail').textContent = e.message || 'Comprueba que tu navegador tenga WebGL habilitado.';
    }
  }
  bootstrap();
})();
