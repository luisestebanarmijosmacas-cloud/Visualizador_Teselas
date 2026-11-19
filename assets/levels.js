/* GeoBIM Viewer v6 · Cotas puntuales y capas de curvas de nivel (GeoJSON 3D).
 * La geometría no se recalcula a partir de la textura; las curvas se generan a partir de un DEM externo.
 * Cotas: h elipsoidal WGS84 + corrección manual opcional SOLO para el texto/CSV.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let Cesium, viewer, getTileset, notify, stopMeasurements;
  let active = false;
  let spots = [];
  let spotEntities = [];
  let contourEntities = [];
  let contourCount = 0;
  let offset = 0;
  const maxSpots = 500;
  const f = (v, dp=2) => Number(v).toLocaleString('es-EC',{minimumFractionDigits:dp,maximumFractionDigits:dp});

  function showStatus(text, type='') {
    $('levelsStatus').textContent = text;
    $('levelsStatus').dataset.level = type;
  }
  function getHeight(point) {
    const carto = Cesium.Cartographic.fromCartesian(point, Cesium.Ellipsoid.WGS84);
    if (!carto || !Number.isFinite(carto.height)) throw new Error('Altura no válida.');
    return carto;
  }
  function isTilesetHit(pick) {
    const t = getTileset();
    if (!t || !Cesium.defined(pick)) return false;
    return (
      pick.tileset === t ||
      pick.content?.tileset === t ||
      pick.primitive === t ||
      pick.primitive?.tileset === t ||
      (typeof Cesium.Cesium3DTileFeature==='function' &&
       pick instanceof Cesium.Cesium3DTileFeature && pick.content?.tileset===t)
    );
  }
  function removeEntities(entities) {
    if (viewer && !viewer.isDestroyed()) for (const item of entities) viewer.entities.remove(item);
    entities.length=0;
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }
  function drawSpots() {
    removeEntities(spotEntities);
    for (let i=0; i<spots.length; i++) {
      const s=spots[i], name='P'+String(i+1).padStart(3,'0');
      spotEntities.push(viewer.entities.add({
        position:s.position,
        point:{pixelSize:9,color:Cesium.Color.CYAN,outlineColor:Cesium.Color.BLACK,
          outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{
          text:name+'  '+f(s.height+offset)+' m',
          font:'bold 13px sans-serif',fillColor:Cesium.Color.fromCssColorString('#ecfbff'),
          outlineColor:Cesium.Color.BLACK,outlineWidth:3,
          style:Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:new Cesium.Cartesian2(0,-21),
          verticalOrigin:Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance:Number.POSITIVE_INFINITY
        }
      }));
    }
    $('levelsCount').textContent=spots.length+' '+(spots.length===1?'cota':'cotas');
    $('levelsUndo').disabled=!spots.length;
    $('levelsExport').disabled=!spots.length;
    if(viewer) viewer.scene.requestRender();
  }
  function pick(screenPosition) {
    if (!active || !getTileset() || !viewer.scene.pickPositionSupported) return;
    try {
      const hit=viewer.scene.pick(screenPosition);
      if (!isTilesetHit(hit)) {notify('Selecciona directamente la malla 3D Tiles.'); return;}
      const position=viewer.scene.pickPosition(screenPosition);
      if (!Cesium.defined(position)) {notify('No se pudo obtener la posición sobre el modelo.');return;}
      if (spots.length>=maxSpots) {notify('Máximo 500 cotas. Exporta y limpia antes de continuar.');return;}
      const c=getHeight(position);
      spots.push({position:Cesium.Cartesian3.clone(position),height:c.height,lat:Cesium.Math.toDegrees(c.latitude),lon:Cesium.Math.toDegrees(c.longitude)});
      drawSpots();
      showStatus('P'+String(spots.length).padStart(3,'0')+' · h WGS84 '+f(c.height)+' m. Haz clic para añadir otra cota.', 'success');
    } catch(e){console.error('Error al colocar cota',e);notify('No se pudo colocar la cota en ese punto.');}
  }
  function clearSpots() {
    spots=[];
    drawSpots();
    showStatus('Haz clic sobre el modelo 3D para colocar cotas.');
  }
  function exportSpots() {
    if (!spots.length) return;
    const sep=';';
    const rows=[['punto','latitud_wgs84','longitud_wgs84','h_elipsoidal_wgs84_m','ajuste_manual_m','cota_mostrada_m'].join(sep)];
    for(let i=0;i<spots.length;i++){
      const s=spots[i];rows.push([
        'P'+String(i+1).padStart(3,'0'),s.lat.toFixed(9),s.lon.toFixed(9),
        s.height.toFixed(3),offset.toFixed(3),(s.height+offset).toFixed(3)
      ].join(sep));
    }
    const blob=new Blob(['\uFEFF'+rows.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;
    a.download='GeoBIM_Cotas_'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function updateOffset() {
    const value=Number($('levelsOffset').value);
    if(!Number.isFinite(value) || Math.abs(value)>10000){
      showStatus('Introduce un ajuste finito entre -10.000 y +10.000 m.','error');
      return;
    }
    offset=value;
    drawSpots();
    showStatus('Ajuste de visualización: '+f(offset)+' m. No modifica la geometría.', 'warning');
  }

  function clearContours() {
    removeEntities(contourEntities);
    contourCount=0;
    $('levelsContoursCount').textContent='Sin curvas cargadas';
    $('levelsContoursVisible').checked=true;
    $('levelsContoursClear').disabled=true;
    $('levelsContoursVisible').disabled=true;
  }
  function parseContourAltitude(properties) {
    const names=['elevation','ELEVATION','elev','ELEV','elev_m','height','HEIGHT','altitude','ALTITUDE','altura','ALTURA','cota','COTA','z','Z','contour','CONTOUR'];
    for(const name of names) {
      const n=Number(properties?.[name]);
      if (properties?.[name] !== undefined && properties?.[name] !== null && properties?.[name] !== '' && Number.isFinite(n)) return n;
    }
    return null;
  }
  function extractContours(data) {
    if(!data || typeof data!=='object')throw new Error('El JSON no es válido.');
    const features=data.type==='FeatureCollection'?data.features :
      data.type==='Feature'?[data]:
      data.type==='LineString'||data.type==='MultiLineString'?[{geometry:data,properties:{}}]:[];
    if(!Array.isArray(features)||!features.length)throw new Error('No contiene líneas GeoJSON.');
    const segments=[];
    let vertexCount=0, excluded=0;
    for(const feature of features){
      if(!feature?.geometry)continue;
      const g=feature.geometry, collections=g.type==='LineString'?[g.coordinates]:
        g.type==='MultiLineString'?g.coordinates:[];
      const propZ=parseContourAltitude(feature.properties);
      for(const line of collections){
        if(!Array.isArray(line)||line.length<2)continue;
        const positions=[];
        let zSum=0;
        for(const xyz of line){
          if(!Array.isArray(xyz)||xyz.length<2)throw new Error('Geometría incompleta.');
          const lon=Number(xyz[0]),lat=Number(xyz[1]);
          const z=xyz.length>2 && xyz[2]!==null && xyz[2]!=='' ? Number(xyz[2]) : propZ;
          if(!Number.isFinite(lon)||!Number.isFinite(lat)||!Number.isFinite(z)||
             lon < -180||lon > 180||lat < -90||lat>90) {positions.length=0;break;}
          positions.push(Cesium.Cartesian3.fromDegrees(lon,lat,z+0.15));
          zSum+=z;
        }
        if(positions.length<2){excluded++;continue;}
        vertexCount+=positions.length;
        if(segments.length>=1400||vertexCount>80000) throw new Error('Archivo grande: simplifica las curvas a menos de 1.400 líneas y 80.000 vértices.');
        segments.push({positions, elevation:zSum/positions.length});
      }
    }
    if(!segments.length)throw new Error('No hay líneas con elevación Z o atributo ELEV/cota válido.');
    return {segments,excluded,vertexCount};
  }
  async function loadContours(event) {
    const file=event.target.files?.[0];
    if(!file)return;
    if(file.size>15_000_000){showStatus('GeoJSON demasiado grande. Limita el archivo a 15 MB.','error');event.target.value='';return;}
    if(!getTileset()){showStatus('Primero abre un modelo 3D.','error');event.target.value='';return;}
    try {
      showStatus('Leyendo curvas GeoJSON…');
      const geojson=JSON.parse(await file.text());
      const result=extractContours(geojson);
      // Mantener la capa anterior si falló la validación.
      clearContours();
      const color=Cesium.Color.fromCssColorString('#ffda7a');
      const labels=result.segments.length<=90 ? 1 : Math.ceil(result.segments.length/90);
      for(let i=0;i<result.segments.length;i++){
        const seg=result.segments[i];
        contourEntities.push(viewer.entities.add({polyline:{
          positions:seg.positions,width:2,arcType:Cesium.ArcType.NONE,material:color
        }}));
        if(i%labels===0){
          contourEntities.push(viewer.entities.add({
            position:seg.positions[Math.floor(seg.positions.length/2)],
            label:{
              text:f(seg.elevation+offset,1)+' m',
              font:'bold 11px sans-serif',fillColor:color,
              outlineColor:Cesium.Color.BLACK,outlineWidth:3,
              style:Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset:new Cesium.Cartesian2(0,-8),
              disableDepthTestDistance:Number.POSITIVE_INFINITY
            }
          }));
        }
      }
      contourCount=result.segments.length;
      $('levelsContoursCount').textContent=contourCount+' curvas · '+result.vertexCount+' vértices';
      $('levelsContoursClear').disabled=false;
      $('levelsContoursVisible').disabled=false;
      showStatus('Curvas importadas. Z debe tener el mismo datum vertical del modelo; '+result.excluded+' líneas omitidas.','success');
      viewer.scene.requestRender();
    }catch(e){
      console.warn('Error al importar curvas',e);
      showStatus('No se cargaron las curvas: '+e.message,'error');
    } finally {event.target.value='';}
  }
  function setContoursVisible(visible) {
    for(const entity of contourEntities)entity.show=visible;
    viewer.scene.requestRender();
  }
  function close() {
    active=false;
    $('levelsPanel').hidden=true;
    $('levelsBtn').classList.remove('active');
  }
  function resetForModel() {
    close();
    clearSpots();
    clearContours();
  }
  function toggle() {
    if(active){close();return;}
    if(!getTileset()){notify('Abre un modelo antes de colocar cotas.');return;}
    stopMeasurements();
    window.GeoBIMProfiles?.close();
    window.GeoBIMTopo?.close();
    active=true;
    $('levelsPanel').hidden=false;
    $('levelsBtn').classList.add('active');
    showStatus('Haz clic sobre el modelo para colocar varias cotas.');
  }
  function init(options){
    ({Cesium,viewer,getTileset,notify,stopMeasurements}=options);
    $('levelsBtn').addEventListener('click',toggle);
    $('levelsClose').addEventListener('click',close);
    $('levelsUndo').addEventListener('click',()=>{
      if(!spots.length)return;
      spots.pop();drawSpots();
      showStatus('Última cota eliminada.');
    });
    $('levelsClear').addEventListener('click',clearSpots);
    $('levelsExport').addEventListener('click',exportSpots);
    $('levelsOffset').addEventListener('change',updateOffset);
    $('levelsContoursFile').addEventListener('change',loadContours);
    $('levelsContoursClear').addEventListener('click',clearContours);
    $('levelsContoursVisible').addEventListener('change',e=>setContoursVisible(e.target.checked));
    resetForModel();
  }
  window.GeoBIMLevels={init,pick,toggle,close,resetForModel,isPicking:()=>active};
})();
