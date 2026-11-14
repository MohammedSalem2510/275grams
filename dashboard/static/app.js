'use strict';
const $ = id => document.getElementById(id);
let stations = [], rates = new Map(), selected, version = 0, detectionVersion = 0;
let refreshGoogle;
let heatZoom = 12, heatFrame = 0;
const fieldBounds = [[60.0603391224,24.5558435501],[60.2792946268,24.9241528166]];
const fieldMap = L.map('sample', {zoomControl:false, minZoom:10, maxZoom:15, zoomSnap:0.25,
  maxBounds:L.latLngBounds(fieldBounds).pad(0.35)}).setView([60.17,24.74],12);
L.control.zoom({position:'bottomright'}).addTo(fieldMap);
L.imageOverlay('espoo-field-map.webp', fieldBounds, {attribution:
  '<a href="https://hri.fi/data/dataset/paakaupunkiseudun-yleiskartta">City of Helsinki</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>'}).addTo(fieldMap);
const fieldPins=L.layerGroup().addTo(fieldMap);
let fieldFramed=false;
fieldMap.on('move zoom resize',scheduleHeatmap);
new ResizeObserver(()=>{if(!$('sample').hidden) fieldMap.invalidateSize();}).observe($('sample'));
function scheduleHeatmap() {
  if (!heatFrame) heatFrame = requestAnimationFrame(drawHeatmap);
}
function drawHeatmap() {
  heatFrame = 0;
  const canvas=$('activity-heatmap'), container=canvas.parentElement;
  const bounds=container.getBoundingClientRect(), scale=0.5;
  canvas.width=Math.max(1,Math.round(bounds.width*scale));
  canvas.height=Math.max(1,Math.round(bounds.height*scale));
  const ctx=canvas.getContext('2d');
  if(!$('heat').checked)return;
  const field=new Float32Array(canvas.width*canvas.height);
  const zoom=$('sample').hidden ? heatZoom : fieldMap.getZoom();
  const radius=scale * Math.max(9, Math.min(110, 65 * 2 ** (zoom-12)));
  const host=$('sample').hidden?$('google-map'):$('sample');
  host.querySelectorAll('.pin').forEach((pin,i)=>{
    const rate=rates.get(stations[i]?.station_id)?.rate_per_hour;
    if(!(rate>0))return;
    const rect=pin.getBoundingClientRect(),x=(rect.left+rect.width/2-bounds.left)*scale,y=(rect.top+rect.height/2-bounds.top)*scale;
    const weight=Math.min(1,rate/window.CHIRP_SCALE_MAX);
    for(let py=Math.max(0,Math.floor(y-radius));py<Math.min(canvas.height,y+radius);py++){
      for(let px=Math.max(0,Math.floor(x-radius));px<Math.min(canvas.width,x+radius);px++){
        const d=((px-x)**2+(py-y)**2)/(radius*radius);
        if(d<1) {
          const idx=py*canvas.width+px;
          // Overlapping stations should not amplify the measured activity.
          field[idx]=Math.max(field[idx], weight*Math.exp(-2*d)*(1-d));
        }
      }
    }
  });
  const image=ctx.createImageData(canvas.width,canvas.height);
  const colours=[[90,121,189],[61,161,198],[62,193,181],[166,214,127],[255,215,107]];
  field.forEach((value,i)=>{
    if(value<0.005)return;
    const t=Math.min(1,value),position=t*4,lo=Math.min(3,Math.floor(position)),mix=position-lo;
    for(let c=0;c<3;c++)image.data[i*4+c]=colours[lo][c]*(1-mix)+colours[lo+1][c]*mix;
    image.data[i*4+3]=Math.round(165*Math.sqrt(t));
  });
  ctx.putImageData(image,0,0);
}
const fmt = n => new Intl.NumberFormat('en-GB', {maximumFractionDigits:1}).format(n);
const common = label => label.includes('_') ? label.slice(label.indexOf('_')+1) : label;
function ago(iso) {
  const min=Math.round((Date.now()-new Date(iso))/60000);
  if(min<1) return 'just now';
  if(min<60) return min+' min ago';
  if(min<1440) return Math.round(min/60)+' h ago';
  return new Date(iso).toLocaleDateString('en-GB',{timeZone:'Europe/Helsinki',day:'numeric',month:'short'});
}
function duration(s) {
  const m=Math.round(s/60);
  return m<60?m+' min':Math.floor(m/60)+' h '+String(m%60).padStart(2,'0')+' min';
}
function filters() {
  const query = new URLSearchParams();
  const hours = Number($('period').value);
  if (hours) {
    const now = Date.now();
    query.set('start', new Date(now-hours*3600000).toISOString());
    query.set('end', new Date(now).toISOString());
  }
  return query;
}
async function api(endpoint, query = new URLSearchParams()) {
  const response = await fetch('/api/'+endpoint+'?'+query, {signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('HTTP '+response.status);
  return response.json();
}
function items(lines) {
  $('detections').replaceChildren(...lines.map(line => {
    if (line instanceof Node) return line;
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
}
function detectionItem(row) {
  const li = document.createElement('li');
  li.textContent = common(row.species)+' · '+new Date(row.start).toLocaleString('en-GB',{timeZone:'Europe/Helsinki',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · score '+row.score.toFixed(2);
  if (row.evidence) {  // the 3 s window BirdNET heard, so a person can check the call
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = '/api/evidence/'+encodeURIComponent(row.window_id);
    audio.className = 'evidence';
    audio.setAttribute('aria-label', 'Recording of '+common(row.species));
    li.append(audio);
  }
  return li;
}
async function detections(query) {
  const request = ++detectionVersion;
  const refreshVersion = version;
  if (!selected) return items(['Select a station.']);
  query = new URLSearchParams(query);
  query.set('station_id',selected);
  query.set('limit','10');
  if ($('species').value) query.set('species',$('species').value);
  items(['Loading detections…']);
  try {
    const rows = await api('detections',query);
    if (request!==detectionVersion || refreshVersion!==version) return;
    if ([...$('detections').querySelectorAll('audio')].some(a=>!a.paused)) return;  // never cut off a clip mid-play
    items(rows.length ? rows.map(detectionItem) : ['No detections in this selection.']);
  } catch {
    if (request===detectionVersion && refreshVersion===version) items(['Could not load detections.']);
  }
}
function makePoint(i) {
  const station = stations[i];
  const value = rates.get(station.station_id)?.rate_per_hour;
  const styles = getComputedStyle(document.documentElement);
  const channel = name => styles.getPropertyValue(name).trim().slice(1).match(/../g).map(hex=>parseInt(hex,16));
  const low=channel('--low'), high=channel('--high');
  const colour=value==null?'#eef0ed':'rgb('+low.map((v,j)=>Math.round(v+(high[j]-v)*Math.min(1,value/(window.CHIRP_SCALE_MAX||24)))).join(',')+')';
  const pin=document.createElement('button');
  pin.className='pin';
  pin.style.setProperty('--point',colour);
  pin.classList.toggle('hardware-pin', !station.simulated);
  pin.textContent=value==null?'–':'';
  pin.title=station.name;
  if (!station.simulated) pin.append(Object.assign(document.createElement('span'), {className:'hardware-label',textContent:'UNO Q'}));
  pin.setAttribute('aria-label',station.name+' · '+station.status+' · '+(value==null?'Rate unavailable':fmt(value)+' detections per hour'));
  pin.setAttribute('aria-pressed',String(selected===station.station_id));
  pin.setAttribute('aria-controls','station-panel');
  pin.onclick=()=>{
    openStation(station.station_id);
  };
  const glow=document.createElement('span');
  glow.className='glow';
  glow.style.setProperty('--point',colour);
  glow.hidden=true;
  return [glow,pin];
}
function openStation(id) {
  selected=id;
  $('station-panel').hidden=false;
  window.chirpAlerts?.show(stations.find(station=>station.station_id===id));
  render();
  detections(filters());
  window.chirpSpecies?.show(id,filters());
  $('station-panel').focus();
}
function closeStation() {
  if (!selected) return;
  const previous=selected;
  selected=null;
  $('station-panel').hidden=true;
  window.chirpAlerts?.show(null);
  window.chirpSpecies?.show(null,filters());
  detections(filters());
  render();
  const host=$('sample').hidden?$('google-map'):$('sample');
  host.querySelectorAll('.pin')[stations.findIndex(s=>s.station_id===previous)]?.focus();
}
window.chirpFocus=(id,species)=>{
  const select=$('species');
  if(species && ![...select.options].some(o=>o.value===species)) select.add(new Option(common(species),species));
  select.value=species||'';
  openStation(id);
  refresh();
};
$('popup-close').onclick=closeStation;
document.addEventListener('keydown',event=>{if(event.key==='Escape') closeStation();});
window.addEventListener('resize',scheduleHeatmap);
function render() {
  $('filter-caption').textContent=($('species').selectedOptions[0]?.text || 'All birds')+' · '+$('period').selectedOptions[0].text;
  const focusPin=document.activeElement?.classList.contains('pin');
  const station=stations.find(item=>item.station_id===selected);
  const row=rates.get(selected);
  $('station-name').textContent=station?.name??'No stations available';
  const status=station?.status||'';
  $('station-status').textContent=status?'● '+status[0].toUpperCase()+status.slice(1):'';
  $('station-status').className='badge status-'+status;
  const hasRate=row?.rate_per_hour!=null;
  $('rate').textContent=hasRate?fmt(row.rate_per_hour):'No data';
  $('rate-label').textContent=hasRate?'detection-minutes per listening hour':'';
  $('station-detections').textContent=row?fmt(row.detections):'–';
  $('station-listened').textContent=row?.listening_s?duration(row.listening_s):'–';
  // Air temperature: the station's latest Modulino Thermo reading, with its age so a stale value is obvious.
  const t=station?.temperature_c;
  $('station-temp').textContent=t==null?'–':t.toFixed(1)+' °C';
  $('station-temp-at').textContent=t==null?'':ago(station.temperature_at);
  // Only explain when the number needs a caveat: no listening is "no data", never zero birds.
  $('station-info').textContent=!station?'':!hasRate?(row?.listening_s>0?'Not enough listening yet for a rate (under 1 minute).':'No listening in this period, so no data. That is not zero birds.')
    :row.low_effort?'Low listening effort (under 15 min): treat this rate with caution.':'';
  if (!$('sample').hidden) {
    fieldPins.clearLayers();
    stations.forEach((s,i)=>{
      const [,pin]=makePoint(i);
      L.DomEvent.disableClickPropagation(pin);
      const icon=L.divIcon({className:'field-pin',html:pin,iconSize:[0,0]});
      L.marker([s.lat,s.lon],{icon,keyboard:false}).addTo(fieldPins);
    });
    if (!fieldFramed && stations.length) {
      fieldMap.fitBounds(stations.map(s=>[s.lat,s.lon]),{padding:[40,66],maxZoom:13});
      fieldFramed=true;
    }
  }
  document.querySelectorAll('.station-ref').forEach(el=>el.textContent=station?' · '+station.name:'');
  refreshGoogle?.();
  scheduleHeatmap();
  if(focusPin) document.querySelector('#'+($('google-map').hidden?'sample':'google-map')+' .pin[aria-pressed=true]')?.focus({preventScroll:true});
}
async function refresh() {
  const request=++version;
  const query=filters();
  const chosen=$('species').value;
  try {
    const [registry, species]=await Promise.all([api('stations'),api('species',query)]);
    if(request!==version) return;
    const active=chosen;
    if(chosen && !species.some(row=>row.species===chosen)) species.push({species:chosen});
    const rateQuery=new URLSearchParams(query);
    if(active) rateQuery.set('species',active);
    const values=await api('rates',rateQuery);
    if(request!==version) return;
    stations=registry;
    rates=new Map(values.map(row=>[row.station_id,row]));
    if(selected && !stations.some(s=>s.station_id===selected)) closeStation();
    $('species').replaceChildren(new Option('All birds',''),...species.map(row=>new Option(common(row.species),row.species)));
    $('species').value=active;
    $('connection').textContent='Updated '+new Date().toLocaleTimeString();
    render();
    window.chirpSpecies?.show(selected, query);
    await detections(query);
  } catch {
    if(request!==version) return;
    $('connection').textContent=stations.length?'Connection lost. Showing the last available readings.':'Chirp server unavailable. Retrying…';
  }
}

function googleFallback() {
  refreshGoogle=null;
  $('google-map').hidden=true;
  $('map-view-control').hidden=true;
  $('map-tilt-control').hidden=true;
  $('sample').hidden=false;
  $('map-status').textContent='Espoo · offline map';
  fieldMap.invalidateSize();
  render();
  scheduleHeatmap();
}
function connectGoogle(key) {
  if(!key) return;
  let failed=false, overlay;
  const fail=()=>{failed=true;clearTimeout(timeout);overlay?.setMap(null);googleFallback();};
  const timeout=setTimeout(fail,15000);
  window.gm_authFailure=fail;
  window.chirpInitMap=()=>{
    if(failed) return;
    try {
      const maps=window.google.maps;
      // Keep the map laid out while tiles load, but below the visible sample.
      const target=$('google-map');
      target.hidden=false;
      target.style.cssText='position:absolute;inset:0;visibility:hidden';
      let framedStations=false;
      class StationOverlay extends maps.OverlayView {
        onAdd() {
          this.root=document.createElement('div');
          this.groups=document.createElement('div');
          this.getPanes().overlayMouseTarget.append(this.root,this.groups);
          refreshGoogle=()=>{
            if(!framedStations && stations.length>1){
              const bounds=new maps.LatLngBounds();
              for(const s of stations) bounds.extend({lat:s.lat,lng:s.lon});
              framedStations=true;
              this.getMap().fitBounds(bounds,48);
            }
            this.root.replaceChildren(...stations.flatMap((_,i)=>{
            const items=makePoint(i);
            maps.OverlayView.preventMapHitsAndGesturesFrom(items[1]);
            return items;
          }));this.draw();};
          refreshGoogle();
        }
        draw() {
          const projection=this.getProjection();
          if(!projection||!this.root) return;
          heatZoom=this.getMap().getZoom()??12;
          const groups=[];
          stations.forEach((point,i)=>{
            const xy=projection.fromLatLngToDivPixel(new maps.LatLng(point.lat,point.lon));
            if(!xy) return;
            for(const el of [this.root.children[i*2],this.root.children[i*2+1]]) {
              el.style.left=xy.x+'px';el.style.top=xy.y+'px';
            }
            const group=heatZoom<12 && groups.find(g=>Math.abs(xy.x-g.x)<76 && Math.abs(xy.y-g.y)<38);
            if(group) group.indices.push(i);
            else groups.push({x:xy.x,y:xy.y,indices:[i]});
          });
          const clusters=groups.filter(g=>g.indices.length>1);
          // Keep the buttons (and keyboard focus) while panning the same groups.
          const key=clusters.map(g=>g.indices.join(',')).join('|');
          if(key!==this.groupKey) {
            this.groupKey=key;
            this.groups.replaceChildren(...clusters.map(({indices})=>{
              const button=document.createElement('button');
              button.className='station-group';
              button.textContent=indices.length+' stations';
              button.setAttribute('aria-label','Zoom to '+button.textContent);
              button.onclick=()=>{
                const bounds=new maps.LatLngBounds();
                for(const i of indices) bounds.extend({lat:stations[i].lat,lng:stations[i].lon});
                this.getMap().fitBounds(bounds,60);
              };
              maps.OverlayView.preventMapHitsAndGesturesFrom(button);
              return button;
            }));
          }
          for(const g of groups) for(const i of g.indices)
            this.root.children[2*i+1].style.visibility=g.indices.length>1?'hidden':'';
          clusters.forEach((g,i)=>{
            const button=this.groups.children[i];
            button.style.left=g.x+'px';
            button.style.top=g.y+'px';
          });
          scheduleHeatmap();
        }
        onRemove(){this.root?.remove();this.groups?.remove();refreshGoogle=null;}
      }
      // Street: raster, so the muted CHIRP_MAP_OPTIONS.styles apply (vector maps ignore JSON styles
      // without a Cloud Map ID). Satellite: vector, so Seun's zoom-based 3D tilt works; JSON styles
      // don't affect imagery anyway. The renderer is fixed per map, so switching view rebuilds it.
      let map, camera={center:{lat:60.1856,lng:24.8320},zoom:13};
      const tiltToggle=$('map-tilt');
      const updateTilt=()=>{
        const vector=map?.getRenderingType()===maps.RenderingType.VECTOR;
        $('map-tilt-control').hidden=failed||$('map-view-control').hidden||!vector;
        if(!vector||failed) return;
        const zoom=map.getZoom()??13;
        map.setTilt(tiltToggle.checked?Math.min(60,Math.max(0,(zoom-14)*12)):0);
      };
      const build=()=>{
        if(map) camera={center:map.getCenter(),zoom:map.getZoom()};
        overlay?.setMap(null);
        const view=$('map-view').value;
        const host=document.createElement('div');
        host.style.cssText='position:absolute;inset:0';
        target.replaceChildren(host);
        map=new maps.Map(host,{
          streetViewControl:false,
          mapTypeControl:false,
          fullscreenControl:false,
          ...window.CHIRP_MAP_OPTIONS,
          styles:streetStyles(),
          ...camera,
          mapTypeId:view,
          renderingType:view==='satellite'?maps.RenderingType.VECTOR:maps.RenderingType.RASTER,
          tilt:0
        });
        map.addListener('zoom_changed',updateTilt);
        map.addListener('renderingtype_changed',updateTilt);
        overlay=new StationOverlay();
        overlay.setMap(map);
        updateTilt();
        return map;
      };
      build();
      window.addEventListener('chirp-appearance',()=>{
        if (!failed && map.getMapTypeId()==='roadmap') map.setOptions({styles:streetStyles()});
      });
      maps.event.addListenerOnce(map,'tilesloaded',()=>{
        if(failed) return;
        clearTimeout(timeout);
        target.style.cssText='';
        $('sample').hidden=true;
        $('map-status').textContent='Google Maps';
        $('map-view').onchange=build;
        $('map-view-control').hidden=false;
        tiltToggle.onchange=updateTilt;
        updateTilt();
        scheduleHeatmap();
      });
    } catch {fail();}
  };
  const src=new URL('https://maps.googleapis.com/maps/api/js');
  src.search=new URLSearchParams({key,loading:'async',callback:'chirpInitMap',v:'quarterly'});
  const script=document.createElement('script');
  script.async=true;
  script.src=src.href;
  script.onerror=fail;
  document.head.append(script);
}

$('species').add(new Option('All birds',''));
$('species').onchange=refresh;
$('period').onchange=refresh;
$('heat').onchange=render;
refresh();
setInterval(refresh,15000);
if (location.hostname !== '10.42.0.1' && !new URLSearchParams(location.search).has('offline')) {
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';
  document.head.appendChild(fonts);
  const localMapsConfig = document.createElement('script');
  localMapsConfig.src = 'maps-config.local.js';
  localMapsConfig.onload = localMapsConfig.onerror = () => connectGoogle((window.CHIRP_MAPS_KEY || '').trim());
  document.head.appendChild(localMapsConfig);
}
