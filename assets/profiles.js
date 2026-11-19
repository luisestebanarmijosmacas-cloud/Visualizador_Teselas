/* GeoBIM Viewer v4 - perfiles topográficos sobre Cesium 3D Tiles.
   Alturas elipsoidales WGS84, no cotas ortométricas ni superficies interpoladas ficticias.
   Los puntos sin intersección con geometría quedan sin cota (null). */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_SAMPLES = 300;
  let Cesium, viewer, getTileset, notify;
  let active = false, collecting = false, busy = false, mode = 'longitudinal';
  let vertices = [], markers = [], sampled = [], sampleInterval = 2;
  let modelRevision = 0;
  const fmt = (n, digits = 2) => Number(n).toLocaleString('es-EC', {minimumFractionDigits: digits, maximumFractionDigits: digits});

  function svg(tag, attrs = {}, value) {
    const el = document.createElementNS(NS, tag);
    for (const [name, v] of Object.entries(attrs)) el.setAttribute(name, String(v));
    if (value !== undefined) el.textContent = String(value);
    return el;
  }
  function setStatus(message, level = '') {
    const el = $('profileStatus');
    el.textContent = message;
    el.dataset.level = level;
  }
  function emptyPlot(message) {
    const el = $('profileChart');
    el.replaceChildren(svg('text', {x: 300, y: 112, 'text-anchor':'middle', fill:'#a9c0d1', 'font-size':15}, message));
  }
  function clearGraphics() {
    if (viewer) for (const entity of markers) viewer.entities.remove(entity);
    markers = [];
    if (viewer) viewer.scene.requestRender();
  }
  function controls() {
    $('profileGenerateBtn').disabled = busy || vertices.length < 2 || !active;
    $('profileUndoBtn').disabled = busy || !vertices.length;
    $('profileExportBtn').disabled = busy || !sampled.length;
    $('profileNewBtn').disabled = busy || !active;
    $('profileMode').disabled = busy;
    $('profileSpacing').disabled = busy;
  }
  function updateDescription() {
    $('profileCount').textContent = vertices.length + (vertices.length === 1 ? ' vértice' : ' vértices');
    if (busy) return;
    if (!vertices.length) setStatus(mode === 'transversal'
      ? 'Haz clic en los dos extremos de la sección transversal.'
      : 'Marca los vértices del eje, en orden, sobre el modelo 3D.');
    else if (vertices.length === 1) setStatus('Marca al menos un punto más para formar el eje del perfil.');
    else setStatus('Eje listo. Pulsa «Generar perfil» para consultar las alturas del modelo.');
  }
  function drawAxis() {
    clearGraphics();
    if (!vertices.length) return;
    if (vertices.length >= 2) markers.push(viewer.entities.add({
      polyline: {positions: [...vertices], width: 3, material: Cesium.Color.CYAN, depthFailMaterial: Cesium.Color.CYAN}
    }));
    for (let i = 0; i < vertices.length; i++) markers.push(viewer.entities.add({
      position: vertices[i],
      point: {pixelSize: 9, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY},
      label: {text: mode === 'transversal' ? (i === 0 ? 'A' : 'B') : String(i + 1),
        font: 'bold 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(12, -8), disableDepthTestDistance: Number.POSITIVE_INFINITY}
    }));
    viewer.scene.requestRender();
  }
  function resetData(keepOpen = true) {
    modelRevision++;
    busy = false;
    vertices = []; sampled = []; collecting = keepOpen && active;
    clearGraphics();
    $('profileSummary').textContent = 'Sin perfil calculado';
    $('profileStats').textContent = 'Cota mínima: —  ·  Cota máxima: —  ·  Desnivel: —';
    $('profileExportBtn').disabled = true;
    emptyPlot('Dibuja un eje para comenzar');
    updateDescription();
    controls();
    $('profileBtn').classList.toggle('active', active);
  }
  function close() {
    active = false;
    collecting = false;
    $('profilePanel').hidden = true;
    $('profileBtn').classList.remove('active');
    resetData(false);
  }
  function resetForModel() {
    resetData(active);
    if (active) setStatus('Modelo cambiado. Dibuja un nuevo eje.');
  }
  function toggle() {
    if (active) { close(); return; }
    if (!getTileset()) { notify('Abre un modelo antes de generar perfiles.'); return; }
    active = true;
    collecting = true;
    $('profilePanel').hidden = false;
    $('profileBtn').classList.add('active');
    resetData(true);
    notify('Dibuja el eje del perfil sobre el modelo 3D.');
  }
  function selectPoint(screenPosition) {
    if (!active || !collecting || busy || !getTileset()) return;
    if (!viewer.scene.pickPositionSupported) {
      setStatus('Este navegador no permite seleccionar profundidad sobre el modelo.', 'error');
      return;
    }
    let position;
    try {
      const picked = viewer.scene.pick(screenPosition);
      if (!Cesium.defined(picked) || (picked.id && markers.includes(picked.id))) return;
      position = viewer.scene.pickPosition(screenPosition);
    } catch (error) {
      console.warn('No se pudo seleccionar el punto del perfil:', error);
      return;
    }
    if (!Cesium.defined(position)) return;
    if (vertices.length && Cesium.Cartesian3.distance(vertices[vertices.length - 1], position) < 0.05) {
      notify('Selecciona otro punto, separado al menos 5 cm.');
      return;
    }
    if (mode === 'transversal' && vertices.length >= 2) {
      notify('El perfil transversal usa dos extremos. Pulsa Generar perfil.');
      return;
    }
    if (vertices.length >= MAX_SAMPLES - 1) {
      notify('Se alcanzó el máximo de vértices. Genera el perfil.');
      return;
    }
    vertices.push(Cesium.Cartesian3.clone(position));
    sampled = [];
    $('profileSummary').textContent = 'Eje digitizado; pendiente de calcular';
    emptyPlot('Pulsa Generar perfil');
    drawAxis();
    updateDescription();
    controls();
  }
  function undo() {
    if (!vertices.length || busy) return;
    vertices.pop();
    sampled = [];
    $('profileSummary').textContent = 'Eje digitizado; pendiente de calcular';
    emptyPlot('Pulsa Generar perfil');
    collecting = active;
    drawAxis();
    updateDescription();
    controls();
  }
  function fromPolyline() {
    const ellipsoid = Cesium.Ellipsoid.WGS84;
    const cartos = vertices.map(v => ellipsoid.cartesianToCartographic(v));
    const legs = [];
    let total = 0;
    for (let i = 1; i < cartos.length; i++) {
      const geodesic = new Cesium.EllipsoidGeodesic(cartos[i - 1], cartos[i], ellipsoid);
      const length = geodesic.surfaceDistance;
      if (length > 0.0001 && Number.isFinite(length)) {
        legs.push({length, start: total, geo: geodesic});
        total += length;
      }
    }
    if (!legs.length || total < 0.05) throw new Error('El eje debe medir más de 5 centímetros en planta.');
    const requested = Number($('profileSpacing').value);
    const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(total / requested) + 1));
    const actualStep = total / (n - 1);
    const positions = [];
    let legIndex = 0;
    for (let i = 0; i < n; i++) {
      const distance = (i / (n - 1)) * total;
      while (legIndex < legs.length - 1 && distance > legs[legIndex].start + legs[legIndex].length) legIndex++;
      const leg = legs[legIndex];
      const fraction = Math.max(0, Math.min(1, (distance - leg.start) / leg.length));
      const at = leg.geo.interpolateUsingFraction(fraction);
      positions.push({distance, longitude: at.longitude, latitude: at.latitude, height: null});
    }
    return {positions, total, actualStep};
  }
  async function generate() {
    if (!active || busy || vertices.length < 2) return;
    if (!getTileset()) { notify('No hay un modelo 3D activo.'); return; }
    if (!viewer.scene.sampleHeightSupported) {
      setStatus('Tu dispositivo no admite muestrear alturas mediante profundidad WebGL.', 'error'); return;
    }
    let basis;
    try { basis = fromPolyline(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    busy = true; collecting = false;
    sampleInterval = basis.actualStep;
    const revision = ++modelRevision;
    controls();
    setStatus('Consultando ' + basis.positions.length + ' muestras a máximo detalle. No cierres el modelo…');
    // Desactivar el elipsoide base durante el muestreo evita confundirlo con la fotogrametría.
    // Se restaura al terminar, incluso si hay error.
    const visible = viewer.scene.globe.show;
    try {
      viewer.scene.globe.show = false;
      viewer.scene.requestRender();
      const query = basis.positions.map(p => new Cesium.Cartographic(p.longitude, p.latitude));
      const returned = await viewer.scene.sampleHeightMostDetailed(query, [...markers]);
      if (revision !== modelRevision || !active || !getTileset()) return;
      sampled = basis.positions.map((p, i) => {
        const h = returned[i] && returned[i].height;
        return {...p, height: Number.isFinite(h) ? h : null};
      });
      const valid = sampled.filter(p => p.height !== null);
      if (!valid.length) {
        setStatus('No se encontraron cotas sobre el 3D Tiles. Revisa que el eje esté sobre el terreno y las teselas hayan cargado.', 'error');
        sampled = [];
        emptyPlot('No se pudieron muestrear alturas');
        $('profileSummary').textContent = '0 muestras con cota';
      } else {
        drawChart();
        drawSampledTrace();
        const missing = sampled.length - valid.length;
        const msg = missing > 0 ? ' · ' + missing + ' puntos sin cota (huecos)' : '';
        $('profileSummary').textContent = (mode === 'transversal' ? 'Transversal' : 'Longitudinal') +
          ' · ' + fmt(basis.total) + ' m · paso ' + fmt(sampleInterval) + ' m · ' +
          valid.length + '/' + sampled.length + ' cotas' + msg;
        const heights = valid.map(p => p.height);
        const low = Math.min(...heights), high = Math.max(...heights);
        $('profileStats').textContent = 'Mín: ' + fmt(low) + ' m · Máx: ' + fmt(high) +
          ' m · Rango: ' + fmt(high - low) + ' m · WGS84 elipsoidal';
        setStatus('Perfil calculado. Puedes exportarlo a CSV. Los huecos indican falta de geometría.', missing ? 'warning' : 'success');
      }
    } catch (error) {
      if (revision === modelRevision) {
        console.error('Error de muestreo del perfil:', error);
        sampled = [];
        emptyPlot('Error al calcular el perfil');
        setStatus('No se pudo calcular el perfil: ' + (error.message || 'error de escena') + '.', 'error');
      }
    } finally {
      // Si el usuario cambió de modelo durante la solicitud, aun así restaurar el estado.
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.globe.show = $('globeToggle').checked;
        viewer.scene.requestRender();
      }
      if (revision === modelRevision) {
        busy = false;
        controls();
      }
    }
  }
  function drawSampledTrace() {
    // Mostrar solo series consecutivas con cotas válidas: nunca unir a través de huecos.
    let segment = [];
    function flush() {
      if (segment.length >= 2) markers.push(viewer.entities.add({
        polyline: {positions: [...segment], width: 4, material: Cesium.Color.YELLOW.withAlpha(0.85),
          depthFailMaterial: Cesium.Color.YELLOW.withAlpha(0.85)}
      }));
      segment = [];
    }
    for (const p of sampled) {
      if (p.height === null) {flush(); continue;}
      segment.push(Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height + 0.12));
    }
    flush();
    viewer.scene.requestRender();
  }
  function drawChart() {
    const chart = $('profileChart');
    chart.replaceChildren();
    const valid = sampled.filter(p => p.height !== null);
    if (!valid.length) {emptyPlot('Sin datos'); return;}
    const W = 680, H = 255, L = 68, R = 19, T = 16, B = 41;
    const width = W - L - R, height = H - T - B;
    const xmax = sampled[sampled.length - 1].distance;
    const min = Math.min(...valid.map(p => p.height)), max = Math.max(...valid.map(p => p.height));
    const spread = Math.max(max - min, 1);
    const ymin = min - spread * .08, ymax = max + spread * .08;
    const X = d => L + (d / xmax) * width;
    const Y = z => T + (ymax - z) / (ymax - ymin) * height;
    for (let i = 0; i <= 4; i++) {
      const val = ymin + i * (ymax - ymin) / 4;
      const y = Y(val);
      chart.append(svg('line',{x1:L,y1:y,x2:W-R,y2:y,stroke:'#2c4358','stroke-width':1}));
      chart.append(svg('text',{x:L-8,y:y+4,'text-anchor':'end',fill:'#b7cddd','font-size':11},fmt(val,1)));
    }
    for (let i=0; i<=5; i++) {
      const d = xmax * i / 5, x = X(d);
      chart.append(svg('line',{x1:x,y1:T,x2:x,y2:H-B,stroke:'#274157','stroke-width':1}));
      chart.append(svg('text',{x,y:H-20,'text-anchor':'middle',fill:'#bed3e3','font-size':11},fmt(d,0)));
    }
    chart.append(svg('text',{x:W/2,y:H-2,'text-anchor':'middle',fill:'#c9e4f1','font-size':11},'Distancia horizontal (m)'));
    chart.append(svg('text',{x:14,y:H/2,'text-anchor':'middle',fill:'#c9e4f1','font-size':11,
      transform:'rotate(-90 14 '+(H/2)+')'},'Altura elipsoidal (m)'));
    let path = '';
    let started = false;
    for (const p of sampled) {
      if (p.height === null) {started = false;continue;}
      path += (started ? ' L ' : ' M ') + X(p.distance).toFixed(2) + ' ' + Y(p.height).toFixed(2);
      started = true;
    }
    chart.append(svg('path',{d:path,fill:'none',stroke:'#60d5e9','stroke-width':2.5,
      'stroke-linejoin':'round','stroke-linecap':'round'}));
    const first = valid[0], last = valid[valid.length-1];
    for (const item of [{p:first,label:'A'},{p:last,label:'B'}]) {
      chart.append(svg('circle',{cx:X(item.p.distance),cy:Y(item.p.height),r:4,fill:'#f8d17b'}));
      chart.append(svg('text',{x:X(item.p.distance),y:Y(item.p.height)-10,
        'text-anchor':'middle',fill:'#ffe7a6','font-size':12,'font-weight':'bold'},item.label));
    }
    // Indicador al mover el cursor sobre el gráfico, sin interpolar cotas faltantes.
    const cursor = svg('g',{'pointer-events':'none'});
    const line = svg('line',{x1:L,y1:T,x2:L,y2:H-B,stroke:'#ffe5a3','stroke-dasharray':'3 4'});
    const label = svg('text',{x:L+8,y:T+16,fill:'#fff3cd','font-size':12,'font-weight':'bold'},'');
    cursor.append(line,label);
    chart.append(cursor);
    cursor.style.display = 'none';
    chart.onpointermove = event => {
      const rect = chart.getBoundingClientRect();
      const px = (event.clientX - rect.left) * W / rect.width;
      if (px < L || px > W-R) {cursor.style.display='none';return;}
      const dist = (px-L) / width * xmax;
      let nearest;
      for (const p of valid) if (!nearest || Math.abs(p.distance-dist)<Math.abs(nearest.distance-dist)) nearest=p;
      if (!nearest) return;
      const x=X(nearest.distance);
      line.setAttribute('x1',x);line.setAttribute('x2',x);
      label.setAttribute('x',Math.min(W-195,Math.max(L+6,x+7)));
      label.textContent = fmt(nearest.distance)+' m · '+fmt(nearest.height)+' m';
      cursor.style.display='';
    };
    chart.onpointerleave = () => { cursor.style.display='none'; };
  }
  function csv() {
    if (!sampled.length) return;
    const header = 'distancia_horizontal_m;altura_elipsoidal_wgs84_m;longitud_grados;latitud_grados';
    const values = sampled.map(p => [
      p.distance.toFixed(3),
      p.height === null ? '' : p.height.toFixed(3),
      Cesium.Math.toDegrees(p.longitude).toFixed(9),
      Cesium.Math.toDegrees(p.latitude).toFixed(9)
    ].join(';'));
    const blob = new Blob(['\uFEFF',header+'\r\n'+values.join('\r\n')+'\r\n'], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href=url;
    a.download='GeoBIM_Perfil_'+mode+'_'+new Date().toISOString().slice(0,10)+'.csv';
    a.style.display='none';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function init(options) {
    ({Cesium,viewer,getTileset,notify}=options);
    $('profileBtn').addEventListener('click', toggle);
    $('profileMode').addEventListener('change', e => {
      mode=e.target.value;
      resetData(true);
    });
    $('profileSpacing').addEventListener('change', () => {
      if (sampled.length) {
        sampled=[];emptyPlot('Vuelve a generar para aplicar el nuevo intervalo');
        $('profileSummary').textContent='Paso modificado; perfil pendiente de recalcular';
        controls();
      }
    });
    $('profileGenerateBtn').addEventListener('click',generate);
    $('profileUndoBtn').addEventListener('click',undo);
    $('profileNewBtn').addEventListener('click',()=>resetData(true));
    $('profileCloseBtn').addEventListener('click',close);
    $('profileExportBtn').addEventListener('click',csv);
    resetData(false);
  }
  window.GeoBIMProfiles={init, toggle, isPicking:()=>active&&collecting&&!busy, pick:selectPoint,
    close,resetForModel};
})();
