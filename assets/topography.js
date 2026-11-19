/* GeoBIM Viewer v5 · Instrumentos topográficos, WGS84/ECEF/UTM, pendiente y desnivel.
 * Puntos extraídos de Cesium pickPosition sobre las teselas, no del elipsoide base.
 * Distancias horizontales locales en el plano ENU tangente al punto A.
 * Alturas ELIPSOIDALES WGS84; no equivalen a cotas ortométricas.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let Cesium, viewer, getTileset, notify, stopMeasurements;
  let active = false, points = [], entities = [];
  const format = (n, decimals = 3) => Number(n).toLocaleString('es-EC', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
  const rad2deg = radians => radians * 180 / Math.PI;
  const deg2rad = degrees => degrees * Math.PI / 180;

  function utmCoordinates(cartographic) {
    // WGS84 → UTM (aproximación Transversa de Mercator, serie estándar Snyder).
    // Solo válido entre 80°S y 84°N; no transforma al sistema local de obra.
    const latDeg = rad2deg(cartographic.latitude), lonDeg = rad2deg(cartographic.longitude);
    if (latDeg < -80 || latDeg > 84) return null;
    const normalizedLon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
    let zone = Math.min(60, Math.max(1, Math.floor((normalizedLon + 180) / 6) + 1));
    if (latDeg >= 56 && latDeg < 64 && normalizedLon >= 3 && normalizedLon < 12) zone = 32;
    if (latDeg >= 72 && latDeg < 84 && normalizedLon >= 0 && normalizedLon < 42)
      zone = [31, 33, 35, 37][Math.min(3, Math.floor(normalizedLon / 12))];
    const a = 6378137, f = 1 / 298.257223563;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996;
    const phi = cartographic.latitude;
    const lambda = deg2rad(normalizedLon);
    const lambda0 = deg2rad(6 * zone - 183);
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi);
    const sin2 = sinPhi * sinPhi;
    const N = a / Math.sqrt(1 - e2 * sin2);
    const T = tanPhi * tanPhi, C = ep2 * cosPhi * cosPhi, A = cosPhi * (lambda - lambda0);
    const M = a * (
      (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi)
    );
    const easting = 500000 + k0 * N * (
      A + (1 - T + C) * A ** 3 / 6 +
      (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120
    );
    let northing = k0 * (M + N * tanPhi * (
      A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 +
      (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720
    ));
    if (latDeg < 0) northing += 10000000;
    return {easting, northing, zone, hemisphere: latDeg < 0 ? 'S' : 'N',
      epsg: (latDeg < 0 ? 32700 : 32600) + zone};
  }
  function data(point) {
    const c = Cesium.Cartographic.fromCartesian(point, Cesium.Ellipsoid.WGS84);
    if (!c) throw new Error('No se pudo obtener la coordenada geográfica del punto.');
    return {point, cartographic:c, lat:rad2deg(c.latitude), lon:rad2deg(c.longitude),
      h:c.height, utm:utmCoordinates(c)};
  }
  function difference(a, b) {
    const origin = Cesium.Transforms.eastNorthUpToFixedFrame(a.point, Cesium.Ellipsoid.WGS84);
    const inverse = Cesium.Matrix4.inverseTransformation(origin, new Cesium.Matrix4());
    const enu = Cesium.Matrix4.multiplyByPoint(inverse, b.point, new Cesium.Cartesian3());
    const horizontal = Math.hypot(enu.x, enu.y), delta = b.h - a.h;
    const spatial = Cesium.Cartesian3.distance(a.point,b.point);
    const slope = horizontal > 0.001 ? 100 * delta / horizontal : null;
    const angle = horizontal > 0.001 ? rad2deg(Math.atan2(delta,horizontal)) : null;
    const azimuth = horizontal > 0.001 ? (rad2deg(Math.atan2(enu.x, enu.y)) + 360) % 360 : null;
    return {enu, horizontal, spatial, delta, slope, angle, azimuth};
  }
  function coordinateText(label,d) {
    if (!d) return label + '\nSelecciona este punto sobre la superficie del modelo.';
    const u = d.utm;
    return label + '\n' +
      'Latitud: ' + format(d.lat,8) + '°\n' +
      'Longitud: ' + format(d.lon,8) + '°\n' +
      'h elipsoidal WGS84: ' + format(d.h) + ' m\n' +
      (u ? 'UTM ' + u.zone + u.hemisphere + ' (EPSG:' + u.epsg + ')\n' +
        'E: ' + format(u.easting) + ' m · N: ' + format(u.northing) + ' m\n' : 'Fuera de zona UTM\n') +
      'ECEF X: ' + format(d.point.x) + ' m\n' +
      'ECEF Y: ' + format(d.point.y) + ' m\n' +
      'ECEF Z: ' + format(d.point.z) + ' m';
  }
  function removeGraphics() {
    if (viewer) for (const entity of entities) viewer.entities.remove(entity);
    entities = [];
    if (viewer) viewer.scene.requestRender();
  }
  function draw() {
    removeGraphics();
    if (!viewer) return;
    points.forEach((p,i) => {
      const color = i===0 ? Cesium.Color.CYAN : Cesium.Color.YELLOW;
      entities.push(viewer.entities.add({
        position:p,
        point:{pixelSize:11,color,outlineColor:Cesium.Color.BLACK,outlineWidth:2,
          disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{text:i===0?'A':'B',font:'bold 14px sans-serif',
          fillColor:color,outlineColor:Cesium.Color.BLACK,outlineWidth:3,
          style:Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:new Cesium.Cartesian2(13,-16),
          disableDepthTestDistance:Number.POSITIVE_INFINITY}
      }));
    });
    if (points.length===2) {
      entities.push(viewer.entities.add({polyline:{positions:[...points],width:3,
        material:Cesium.Color.YELLOW,depthFailMaterial:Cesium.Color.YELLOW}}));
    }
    viewer.scene.requestRender();
  }
  function reset(keepOpen=true) {
    points=[];removeGraphics();
    if (!keepOpen) active=false;
    $('topoPanel').hidden=!active;
    $('topoBtn').classList.toggle('active',active);
    $('topoPointA').textContent=coordinateText('PUNTO A',null);
    $('topoPointB').textContent=coordinateText('PUNTO B',null);
    $('topoSummary').textContent='Selecciona el punto A y después el punto B.';
    $('topoDelta').textContent='—';
    $('topoHorizontal').textContent='—';
    $('topoSpatial').textContent='—';
    $('topoSlope').textContent='—';
    $('topoAngle').textContent='—';
    $('topoAzimuth').textContent='—';
    $('topoEnu').textContent='—';
    $('topoExportBtn').disabled=true;
    $('topoUndoBtn').disabled=true;
    if (viewer) viewer.scene.requestRender();
  }
  function close() {reset(false);}
  function toggle() {
    if (active) {close();return;}
    if (!getTileset()) {notify('Abre un modelo 3D antes de usar Topografía.');return;}
    stopMeasurements();
    window.GeoBIMProfiles?.close();
    active=true; reset(true);
    notify('Selecciona el punto A y luego el punto B sobre el modelo.');
  }
  function render() {
    let a = null, b = null, d = null;
    try {
      if (points[0]) a=data(points[0]);
      if (points[1]) b=data(points[1]);
      if (a&&b) d=difference(a,b);
    } catch (e) {
      console.error('Error de coordenadas topográficas',e);
      notify('No se pudo calcular la coordenada del punto.');
    }
    $('topoPointA').textContent=coordinateText('PUNTO A',a);
    $('topoPointB').textContent=coordinateText('PUNTO B',b);
    $('topoUndoBtn').disabled=points.length===0;
    $('topoExportBtn').disabled=!points.length;
    if (!d) {
      $('topoSummary').textContent=points.length===1 ?
        'Punto A registrado. Selecciona el punto B.' : 'Selecciona el punto A y después el punto B.';
      for (const id of ['topoDelta','topoHorizontal','topoSpatial','topoSlope','topoAngle','topoAzimuth','topoEnu']) $(id).textContent='—';
      return;
    }
    $('topoSummary').textContent='Segmento A → B calculado sobre el modelo.';
    $('topoDelta').textContent=(d.delta>=0?'+':'')+format(d.delta)+' m';
    $('topoHorizontal').textContent=format(d.horizontal)+' m';
    $('topoSpatial').textContent=format(d.spatial)+' m';
    $('topoSlope').textContent=d.slope===null?'Indefinida':(d.slope>=0?'+':'')+format(d.slope,2)+' %';
    $('topoAngle').textContent=d.angle===null?'—':(d.angle>=0?'+':'')+format(d.angle,2)+'°';
    $('topoAzimuth').textContent=d.azimuth===null?'—':format(d.azimuth,2)+'° (norte local)';
    $('topoEnu').textContent='ΔE: '+format(d.enu.x)+' m · ΔN: '+format(d.enu.y)+' m · ΔU: '+format(d.enu.z)+' m';
  }
  function pick(screenPosition) {
    if (!active || !getTileset()) return;
    const scene=viewer.scene;
    if (!scene.pickPositionSupported) {
      notify('Este navegador no admite seleccionar profundidad de la geometría.');
      return;
    }
    try {
      const picked=scene.pick(screenPosition);
      const tileset=getTileset();
      const isTile=Cesium.defined(picked) && (
        (typeof Cesium.Cesium3DTileFeature==='function' && picked instanceof Cesium.Cesium3DTileFeature)
        || picked.tileset===tileset || picked.content?.tileset===tileset
        || picked.primitive===tileset || picked.primitive?.tileset===tileset
      );
      if (!isTile) {
        notify('Haz clic sobre la malla 3D Tiles (no sobre el globo ni las etiquetas).');
        return;
      }
      const position=scene.pickPosition(screenPosition);
      if (!Cesium.defined(position)) {notify('No se pudo obtener el punto sobre la malla.');return;}
      if (points.length>=2) points=[];
      points.push(Cesium.Cartesian3.clone(position));
      if (points.length===2 && Cesium.Cartesian3.distance(points[0],points[1])<0.01) {
        points.pop();notify('Los puntos deben estar separados al menos 1 cm.');
      }
      draw();render();
    } catch (e) {
      console.error('Error de selección topográfica',e);
      notify('No se pudo seleccionar la superficie en esa posición.');
    }
  }
  function undo() {
    if (!active || !points.length) return;
    points.pop();draw();render();
  }
  function csv() {
    if (!points.length) return;
    const abc=points.map(data), d=abc.length===2?difference(abc[0],abc[1]):null;
    const header=['punto','latitud_wgs84_grados','longitud_wgs84_grados','altura_elipsoidal_wgs84_m',
      'utm_zona','utm_epsg','utm_este_m','utm_norte_m','ecef_x_m','ecef_y_m','ecef_z_m',
      'delta_h_b_m','dist_horizontal_enu_m','dist_espacial_m','pendiente_porcentaje',
      'angulo_grados','azimut_norte_local_grados','delta_este_local_m','delta_norte_local_m','delta_up_local_m'];
    const rows=abc.map((p,i)=>{
      const u=p.utm;
      return [i===0?'A':'B',p.lat.toFixed(9),p.lon.toFixed(9),p.h.toFixed(4),
        u?u.zone+u.hemisphere:'',u?u.epsg:'',u?u.easting.toFixed(4):'',u?u.northing.toFixed(4):'',
        p.point.x.toFixed(4),p.point.y.toFixed(4),p.point.z.toFixed(4),
        i===1&&d?d.delta.toFixed(4):'',i===1&&d?d.horizontal.toFixed(4):'',
        i===1&&d?d.spatial.toFixed(4):'',i===1&&d&&d.slope!==null?d.slope.toFixed(4):'',
        i===1&&d&&d.angle!==null?d.angle.toFixed(4):'',
        i===1&&d&&d.azimuth!==null?d.azimuth.toFixed(4):'',
        i===1&&d?d.enu.x.toFixed(4):'',i===1&&d?d.enu.y.toFixed(4):'',
        i===1&&d?d.enu.z.toFixed(4):''].join(';');
    });
    const content='\uFEFF'+header.join(';')+'\r\n'+rows.join('\r\n')+'\r\n';
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='GeoBIM_Topografia_'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function init(options) {
    ({Cesium,viewer,getTileset,notify,stopMeasurements}=options);
    $('topoBtn').addEventListener('click',toggle);
    $('topoUndoBtn').addEventListener('click',undo);
    $('topoClearBtn').addEventListener('click',()=>reset(true));
    $('topoCloseBtn').addEventListener('click',close);
    $('topoExportBtn').addEventListener('click',csv);
    reset(false);
  }
  window.GeoBIMTopo={init,toggle,pick,close,isPicking:()=>active,resetForModel:()=>reset(true)};
})();
