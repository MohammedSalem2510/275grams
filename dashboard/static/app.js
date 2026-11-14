'use strict';
const $ = id => document.getElementById(id);
let stations = [], rates = new Map(), selected, version = 0, detectionVersion = 0;
let refreshGoogle;
const fmt = n => new Intl.NumberFormat('en-GB', {maximumFractionDigits:1}).format(n);
const common = label => label.includes('_') ? label.slice(label.indexOf('_')+1) : label;
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
  pin.textContent=value==null?'–':i+1;
  pin.setAttribute('aria-label',station.name+' · '+station.status+' · '+(value==null?'Rate unavailable':fmt(value)+' detections per hour'));
  pin.setAttribute('aria-pressed',String(selected===station.station_id));
  pin.setAttribute('aria-haspopup','dialog');
  pin.onclick=()=>{
    selected=station.station_id;
    $('station-popup').hidden=false;
    render();
    detections(filters());
    window.chirpSpecies?.show(selected, filters());
    $('station-popup').focus({preventScroll:true});
  };
  const glow=document.createElement('span');
  glow.className='glow';
  glow.style.setProperty('--point',colour);
  glow.hidden=!$('heat').checked||!(value>0);
  return [glow,pin];
}
// Station popup: a card on the map next to the selected pin (bottom sheet on narrow screens).
function selectedPin() {
  return document.querySelector('#'+($('google-map').hidden?'sample':'google-map')+' .pin[aria-pressed=true]');
}
function placePopup() {
  const pop=$('station-popup');
  if(pop.hidden) return;
  const pin=selectedPin(), map=pop.parentElement;
  const sheet=!pin||window.innerWidth<=900;
  pop.classList.toggle('sheet',sheet);
  if(sheet) { pop.style.left=pop.style.top=''; return; }
  const m=map.getBoundingClientRect(), p=pin.getBoundingClientRect(), w=pop.offsetWidth, h=pop.offsetHeight, gap=14;
  let left=p.right-m.left+gap;
  if(left+w>m.width-8) left=p.left-m.left-gap-w;  // no room on the right: open to the left of the pin
  left=Math.max(8,Math.min(left,m.width-w-8));
  const top=Math.max(8,Math.min(p.top-m.top+p.height/2-h/2,m.height-h-8));
  pop.style.left=left+'px';
  pop.style.top=top+'px';
}
window.chirpPlacePopup=placePopup;
// Used by the early-warning rows: show one station and species on the map, popup open.
window.chirpFocus=(stationId,species)=>{
  const select=$('species');
  if(species && ![...select.options].some(o=>o.value===species)) select.add(new Option(common(species),species));
  select.value=species||'';
  selected=stationId;
  $('station-popup').hidden=false;
  refresh();
};
function closePopup() {
  const pop=$('station-popup');
  if(pop.hidden) return;
  const hadFocus=pop.contains(document.activeElement);
  pop.hidden=true;
  if(hadFocus) selectedPin()?.focus({preventScroll:true});
}
$('popup-close').onclick=closePopup;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closePopup(); });
window.addEventListener('resize',placePopup);
function render() {
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
  // Only explain when the number needs a caveat: no listening is "no data", never zero birds.
  $('station-info').textContent=!station?'':!hasRate?(row?.listening_s>0?'Not enough listening yet for a rate (under 1 minute).':'No listening in this period, so no data. That is not zero birds.')
    :row.low_effort?'Low listening effort (under 15 min): treat this rate with caution.':'';
  const lat=stations.map(s=>s.lat), lon=stations.map(s=>s.lon);
  const south=Math.min(...lat)-.001,north=Math.max(...lat)+.001;
  const west=Math.min(...lon)-.001,east=Math.max(...lon)+.001;
  $('sample-points').replaceChildren(...stations.flatMap((s,i)=>makePoint(i).map(el=>{
    el.style.left=(15+70*(s.lon-west)/(east-west))+'%';
    el.style.top=(15+70*(north-s.lat)/(north-south))+'%';
    return el;
  })));
  document.querySelectorAll('.station-ref').forEach(el=>el.textContent=station?' · '+station.name:'');
  refreshGoogle?.();
  placePopup();
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
    if(!stations.some(s=>s.station_id===selected)) selected=stations[0]?.station_id;
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

function googleFallback(message) {
  refreshGoogle=null;
  $('google-map').hidden=true;
  $('map-view-control').hidden=true;
  $('map-tilt-control').hidden=true;
  $('sample').hidden=false;
  $('map-status').textContent=message;
}
function connectGoogle(key) {
  if(!key) return;
  let failed=false, overlay;
  const fail=()=>{failed=true;clearTimeout(timeout);overlay?.setMap(null);googleFallback('Station positions · Google Maps unavailable');};
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
      class StationOverlay extends maps.OverlayView {
        onAdd() {
          this.root=document.createElement('div');
          this.getPanes().overlayMouseTarget.append(this.root);
          refreshGoogle=()=>{this.root.replaceChildren(...stations.flatMap((_,i)=>{
            const items=makePoint(i);
            maps.OverlayView.preventMapHitsAndGesturesFrom(items[1]);
            return items;
          }));this.draw();};
          refreshGoogle();
        }
        draw() {
          const projection=this.getProjection();
          if(!projection||!this.root) return;
          stations.forEach((point,i)=>{
            const xy=projection.fromLatLngToDivPixel(new maps.LatLng(point.lat,point.lon));
            if(!xy) return;
            for(const el of [this.root.children[i*2],this.root.children[i*2+1]]) {
              el.style.left=xy.x+'px';el.style.top=xy.y+'px';
            }
          });
          placePopup();  // follow the pin when the Google map pans or zooms
        }
        onRemove(){this.root?.remove();refreshGoogle=null;}
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
$('theme').onchange=()=>{
  document.documentElement.dataset.theme=$('theme').value;
  try { localStorage.setItem('chirp-theme',$('theme').value); } catch {}
  render();
};
try {
  const saved=localStorage.getItem('chirp-theme');
  if([...$('theme').options].some(option=>option.value===saved)) {
    $('theme').value=saved;
    document.documentElement.dataset.theme=saved;
  }
} catch {}
refresh();
setInterval(refresh,15000);
const localMapsConfig = document.createElement('script');
localMapsConfig.src = 'maps-config.local.js';
localMapsConfig.onload = localMapsConfig.onerror = () => {
  connectGoogle((window.CHIRP_MAPS_KEY || '').trim());
};
document.head.appendChild(localMapsConfig);
