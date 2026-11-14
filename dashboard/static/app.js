'use strict';
const $ = id => document.getElementById(id);
let stations = [], rates = new Map(), selected, version = 0, detectionVersion = 0;
let refreshGoogle;
const fmt = n => new Intl.NumberFormat('en-GB', {maximumFractionDigits:1}).format(n);
const common = label => label.includes('_') ? label.slice(label.indexOf('_')+1) : label;
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
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
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
    items(rows.length ? rows.map(row => common(row.species)+' · '+new Date(row.start).toISOString().slice(0,19).replace('T',' ')+' UTC · score '+row.score.toFixed(2)) : ['No detections in this selection.']);
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
  pin.onclick=()=>{
    selected=station.station_id;
    render();
    detections(filters());
  };
  const glow=document.createElement('span');
  glow.className='glow';
  glow.style.setProperty('--point',colour);
  glow.hidden=!$('heat').checked||!(value>0);
  return [glow,pin];
}
function render() {
  const focusPin=document.activeElement?.classList.contains('pin');
  const station=stations.find(item=>item.station_id===selected);
  const row=rates.get(selected);
  $('station-name').textContent=station?.name??'No stations available';
  $('station-info').textContent=station ? station.status+' · '+(row?.rate_per_hour==null?(row?.listening_s>0?'Not enough listening time for a rate':'No listening data'):fmt(row.detections)+' detections in '+fmt(row.listening_s/60)+' listening minutes') : '';
  $('rate').textContent=row?.rate_per_hour==null?'No data':fmt(row.rate_per_hour)+' / hour'+(row.low_effort?' · Low listening effort':'');
  const lat=stations.map(s=>s.lat), lon=stations.map(s=>s.lon);
  const south=Math.min(...lat)-.001,north=Math.max(...lat)+.001;
  const west=Math.min(...lon)-.001,east=Math.max(...lon)+.001;
  $('sample-points').replaceChildren(...stations.flatMap((s,i)=>makePoint(i).map(el=>{
    el.style.left=(15+70*(s.lon-west)/(east-west))+'%';
    el.style.top=(15+70*(north-s.lat)/(north-south))+'%';
    return el;
  })));
  refreshGoogle?.();
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
      const map = new maps.Map(target, {
        center: { lat: 60.1856, lng: 24.8320 },
        zoom: 13,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        ...window.CHIRP_MAP_OPTIONS,
        // Raster rendering (the default) so CHIRP_MAP_OPTIONS.styles applies; vector
        // maps ignore JSON styles and need a Cloud Map ID.
        mapTypeId: $('map-view').value
      });
      overlay=new class extends maps.OverlayView {
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
        }
        onRemove(){this.root?.remove();refreshGoogle=null;}
      };
      overlay.setMap(map);
      maps.event.addListenerOnce(map,'tilesloaded',()=>{
        if(failed) return;
        clearTimeout(timeout);
        target.style.cssText='';
        $('sample').hidden=true;
        $('map-status').textContent='Google Maps';
        $('map-view').onchange=()=>map.setMapTypeId($('map-view').value);
        $('map-view-control').hidden=false;
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
