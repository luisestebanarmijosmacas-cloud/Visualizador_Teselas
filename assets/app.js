/* GeoBIM Viewer v6.0. CesiumJS 1.138.0 | GitHub Pages. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const models = Array.isArray(window.GEOBIM_MODELS) ? [...window.GEOBIM_MODELS] : [];
  let viewer, currentTileset = null, currentModel = null;
  let toastTimer = null, measureMode = null, lastMeasureMode = null;
  let measurePoints = [], measureEntities = [], measureFinished = false;
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
    window.GeoBIMProfiles?.resetForModel();
    window.GeoBIMTopo?.resetForModel();
    window.GeoBIMLevels?.resetForModel();
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

  // Mediciones sobre el 3D Tiles: distancias 3D y áreas horizontales (plano ENU local).
  const MEASURE_MODES = {
    distance: {name: 'Distancia', minimum: 2, instructions: 'Marca dos puntos sobre el modelo.'},
    route: {name: 'Polilínea 3D', minimum: 2, instructions: 'Marca los vértices de la ruta y pulsa Finalizar.'},
    area: {name: 'Área en planta', minimum: 3, instructions: 'Marca el perímetro del polígono y pulsa Finalizar.'}
  };
  const distanceFormat = new Intl.NumberFormat('es-EC', {maximumFractionDigits: 2, minimumFractionDigits: 2});

  function formatLength(metres) {
    return metres >= 1000 ? distanceFormat.format(metres / 1000) + ' km' : distanceFormat.format(metres) + ' m';
  }
  function formatArea(metresSquared) {
    return metresSquared >= 10000
      ? distanceFormat.format(metresSquared) + ' m² (' + distanceFormat.format(metresSquared / 10000) + ' ha)'
      : distanceFormat.format(metresSquared) + ' m²';
  }
  function totalLength(points, closed = false) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Cesium.Cartesian3.distance(points[i - 1], points[i]);
    if (closed && points.length >= 3) total += Cesium.Cartesian3.distance(points[points.length - 1], points[0]);
    return total;
  }
  function localPolygon(points) {
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(points[0]);
    const inverse = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4());
    return points.map(p => {
      const local = Cesium.Matrix4.multiplyByPoint(inverse, p, new Cesium.Cartesian3());
      return {x: local.x, y: local.y};
    });
  }
  function horizontalArea(points) {
    if (points.length < 3) return 0;
    const xy = localPolygon(points);
    let doubleArea = 0;
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i], b = xy[(i + 1) % xy.length];
      doubleArea += a.x * b.y - b.x * a.y;
    }
    return Math.abs(doubleArea) / 2;
  }
  function polygonSelfIntersects(points) {
    if (points.length < 4) return false;
    const xy = localPolygon(points), n = xy.length;
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = xy[i], b = xy[(i + 1) % n], c = xy[j], d = xy[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
    return false;
  }
  function clearMeasurementGraphics() {
    if (viewer) for (const entity of measureEntities) viewer.entities.remove(entity);
    measureEntities = [];
  }
  function resetMeasure() {
    clearMeasurementGraphics();
    measurePoints = [];
    measureMode = null;
    lastMeasureMode = null;
    measureFinished = false;
    for (const id of ['measureBtn', 'routeBtn', 'areaBtn']) $(id).classList.remove('active');
    $('measurePanel').hidden = true;
    $('cesiumContainer').style.cursor = 'auto';
    if (viewer) viewer.scene.requestRender();
  }
  function beginMeasure(mode) {
    window.GeoBIMProfiles?.close();
    window.GeoBIMTopo?.close();
    window.GeoBIMLevels?.close();
    if (!currentTileset) {
      notify('Selecciona un modelo antes de medir.');
      return;
    }
    if (measureMode === mode) { resetMeasure(); return; }
    resetMeasure();
    measureMode = mode;
    lastMeasureMode = mode;
    $('measurePanel').hidden = false;
    $('cesiumContainer').style.cursor = 'crosshair';
    ({distance: $('measureBtn'), route: $('routeBtn'), area: $('areaBtn')})[mode].classList.add('active');
    $('measureModeLabel').textContent = MEASURE_MODES[mode].name;
    $('measureInstruction').textContent = MEASURE_MODES[mode].instructions;
    updateMeasurePanel();
    notify(MEASURE_MODES[mode].instructions);
  }
  function pickedPosition(screenPosition) {
    // No usar pickEllipsoid como alternativa: podría medir el globo en vez del modelo.
    try {
      const scene = viewer.scene;
      if (!scene.pickPositionSupported || !Cesium.defined(scene.pick(screenPosition))) return undefined;
      const point = scene.pickPosition(screenPosition);
      return Cesium.defined(point) ? point : undefined;
    } catch (e) {
      console.warn('No se pudo seleccionar la geometría:', e);
      return undefined;
    }
  }
  function updateMeasurePanel() {
    const mode = lastMeasureMode;
    if (!mode) return;
    const n = measurePoints.length;
    $('measureCount').textContent = n + (n === 1 ? ' punto' : ' puntos');
    const closed = mode === 'area';
    const length = totalLength(measurePoints, closed && n >= 3);
    if (closed) {
      $('measureStats').textContent = n >= 3
        ? 'Área horizontal: ' + formatArea(horizontalArea(measurePoints)) + ' · Perímetro 3D: ' + formatLength(length)
        : 'Selecciona al menos 3 puntos para calcular el área.';
    } else {
      $('measureStats').textContent = n >= 2
        ? 'Longitud 3D acumulada: ' + formatLength(length)
        : 'Selecciona al menos 2 puntos.';
    }
    $('finishMeasureBtn').disabled = measureFinished || !measureMode || n < MEASURE_MODES[mode].minimum;
    $('undoMeasureBtn').disabled = n === 0;
    $('measureInstruction').textContent = measureFinished
      ? 'Medición finalizada. Puedes deshacer el último punto o empezar otra.'
      : MEASURE_MODES[mode].instructions;
  }
  function drawMeasurement() {
    clearMeasurementGraphics();
    const points = measurePoints, mode = lastMeasureMode;
    if (!viewer || !mode || !points.length) return;
    const color = mode === 'area' ? Cesium.Color.YELLOW : Cesium.Color.CYAN;
    if (mode === 'area' && points.length >= 3) {
      measureEntities.push(viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy([...points]),
          perPositionHeight: true,
          material: Cesium.Color.YELLOW.withAlpha(0.19),
          outline: false
        }
      }));
    }
    if (points.length >= 2) {
      const positions = mode === 'area' && points.length >= 3 ? [...points, points[0]] : [...points];
      measureEntities.push(viewer.entities.add({
        polyline: {positions, width: 3, material: color, depthFailMaterial: color}
      }));
      // Longitud individual de cada tramo, con etiquetas hasta 25 tramos.
      if (mode !== 'area' && points.length <= 26) {
        for (let i = 1; i < points.length; i++) {
          const mid = Cesium.Cartesian3.midpoint(points[i - 1], points[i], new Cesium.Cartesian3());
          measureEntities.push(viewer.entities.add({
            position: mid,
            label: {
              text: formatLength(Cesium.Cartesian3.distance(points[i - 1], points[i])),
              font: '12px sans-serif', fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -15),
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          }));
        }
      }
    }
    points.forEach((point, i) => {
      measureEntities.push(viewer.entities.add({
        position: point,
        point: {
          pixelSize: 9, color, outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: String(i + 1), font: 'bold 11px sans-serif',
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(12, 9),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      }));
    });
    if (measureFinished) {
      const result = mode === 'area' ? formatArea(horizontalArea(points)) : formatLength(totalLength(points));
      measureEntities.push(viewer.entities.add({
        position: points[points.length - 1],
        label: {
          text: (mode === 'area' ? 'Área horizontal: ' : 'Total: ') + result,
          font: 'bold 15px sans-serif', fillColor: color,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -34),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      }));
    }
    viewer.scene.requestRender();
  }
  function addMeasurementPoint(point) {
    if (!measureMode) return;
    const previous = measurePoints[measurePoints.length - 1];
    if (previous && Cesium.Cartesian3.distance(previous, point) < 0.02) {
      notify('Selecciona un punto diferente (mínimo 2 cm de separación).');
      return;
    }
    measurePoints.push(point);
    if (measureMode === 'distance' && measurePoints.length === 2) {
      finishMeasurement();
    } else {
      drawMeasurement();
      updateMeasurePanel();
    }
  }
  function finishMeasurement() {
    if (!measureMode) return;
    const mode = measureMode;
    if (measurePoints.length < MEASURE_MODES[mode].minimum) {
      notify('Faltan puntos para finalizar esta medición.');
      return;
    }
    if (mode === 'area' && polygonSelfIntersects(measurePoints)) {
      notify('El perímetro se cruza consigo mismo. Deshaz puntos y corrige el polígono.');
      return;
    }
    measureMode = null;
    measureFinished = true;
    $('cesiumContainer').style.cursor = 'auto';
    for (const id of ['measureBtn', 'routeBtn', 'areaBtn']) $(id).classList.remove('active');
    drawMeasurement();
    updateMeasurePanel();
    $('stateText').textContent = mode === 'area'
      ? 'Área horizontal: ' + formatArea(horizontalArea(measurePoints))
      : 'Distancia 3D: ' + formatLength(totalLength(measurePoints));
    notify('Medición finalizada.');
  }
  function undoMeasurePoint() {
    if (!measurePoints.length || !lastMeasureMode) return;
    if (measureFinished) {
      measureMode = lastMeasureMode;
      measureFinished = false;
      $('cesiumContainer').style.cursor = 'crosshair';
      ({distance: $('measureBtn'), route: $('routeBtn'), area: $('areaBtn')})[measureMode].classList.add('active');
    }
    measurePoints.pop();
    drawMeasurement();
    updateMeasurePanel();
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
        if (window.GeoBIMLevels?.isPicking()) {
          window.GeoBIMLevels.pick(event.position);
          return;
        }
        if (window.GeoBIMTopo?.isPicking()) {
          window.GeoBIMTopo.pick(event.position);
          return;
        }
        if (window.GeoBIMProfiles?.isPicking()) {
          window.GeoBIMProfiles.pick(event.position);
          return;
        }
        if (!measureMode) return;
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
      $('measureBtn').addEventListener('click', () => beginMeasure('distance'));
      $('routeBtn').addEventListener('click', () => beginMeasure('route'));
      $('areaBtn').addEventListener('click', () => beginMeasure('area'));
      $('finishMeasureBtn').addEventListener('click', finishMeasurement);
      $('undoMeasureBtn').addEventListener('click', undoMeasurePoint);
      $('clearMeasureBtn').addEventListener('click', () => { resetMeasure(); notify('Mediciones eliminadas.'); });
      $('resetMeasureBtn').addEventListener('click', () => { resetMeasure(); notify('Mediciones eliminadas.'); });
      document.addEventListener('keydown', event => {
        if (!measureMode || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        if (event.key === 'Enter') { event.preventDefault(); finishMeasurement(); }
        if (event.key === 'Escape') { event.preventDefault(); resetMeasure(); }
        if (event.key === 'Backspace') { event.preventDefault(); undoMeasurePoint(); }
      });
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
      if (window.GeoBIMProfiles) {
        window.GeoBIMProfiles.init({
          Cesium, viewer, getTileset: () => currentTileset, notify
        });
      } else {
        $('profileBtn').disabled = true;
        console.warn('El módulo de perfiles no está disponible.');
      }
      if (window.GeoBIMTopo) {
        window.GeoBIMTopo.init({
          Cesium, viewer, getTileset: () => currentTileset,
          notify, stopMeasurements: resetMeasure
        });
      } else {
        $('topoBtn').disabled = true;
        console.warn('El módulo topográfico no está disponible.');
      }
      if (window.GeoBIMLevels) {
        window.GeoBIMLevels.init({
          Cesium, viewer, getTileset: () => currentTileset,
          notify, stopMeasurements: resetMeasure
        });
      } else {
        $('levelsBtn').disabled=true;
        console.warn('El módulo de cotas no está disponible.');
      }
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
