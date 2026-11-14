'use strict';
const $ = id => document.getElementById(id);
const model = ChirpModel;
const data = model.sample();
const locations = [
  {lat:60.3164,lng:24.5018},{lat:60.3119,lng:24.5129},
  {lat:60.3196,lng:24.5187},{lat:60.3072,lng:24.5046},
  {lat:60.3091,lng:24.5242},{lat:60.3221,lng:24.5091}
]; // Illustrative stations near Nuuksio, Finland.
let selected = 0;
let refreshGoogle = null;
const fmt = n => new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n);
const reading = p => model.rate(p,$('species').value,$('period').value);
function colour(value) {
  if (value === null) return '#eef0ed';
  const css = getComputedStyle(document.documentElement);
  const rgb = name => css.getPropertyValue(name).trim().slice(1).match(/../g).map(x=>parseInt(x,16));
  const low = rgb('--low'), high = rgb('--high'), t = Math.min(1,value/data.scaleMax);
  return 'rgb('+low.map((v,i)=>Math.round(v+(high[i]-v)*t)).join(',')+')';
}
function makePoint(i) {
  const p=data.points[i], r=reading(p);
  const button=document.createElement('button');
  button.className='pin';
  button.style.setProperty('--point',colour(r.value));
  button.textContent=r.value===null?'–':i+1;
  button.setAttribute('aria-label',p.name+(r.value===null?', no listening data':', '+fmt(r.value)+' detections per listening hour'));
  button.setAttribute('aria-pressed',String(i===selected));
  button.onclick=()=>{selected=i;render();};
  const glow=document.createElement('span');
  glow.className='glow';
  glow.style.setProperty('--point',colour(r.value));
  glow.hidden=!$('heat').checked||r.value===null||r.value===0;
  return [glow,button];
}
function render() {
  const focusedPin=document.activeElement?.getAttribute('aria-pressed')!==null && document.activeElement?.classList.contains('pin');
  const p=data.points[selected], r=reading(p);
  $('station-name').textContent=p.name;
  $('station-info').textContent=r.value===null?'No listening data in this period.':fmt(r.count)+' detections in '+fmt(r.hours)+' listening hours';
  $('rate').textContent=r.value===null?'No data':fmt(r.value)+' / hour';
  $('trend').textContent='Week B vs A: '+model.change(p,$('species').value);
  $('sample-points').replaceChildren(...data.points.flatMap((point,i)=>makePoint(i).map(el=>{
    el.style.left=point.x*100+'%';el.style.top=point.y*100+'%';return el;
  })));
  refreshGoogle?.();
  if(focusedPin) document.querySelector('#'+($('google-map').hidden?'sample':'google-map')+' .pin[aria-pressed=true]')?.focus({preventScroll:true});
}
function googleFallback(message) {
  refreshGoogle=null;
  $('google-map').hidden=true;
  $('sample').hidden=false;
  $('map-status').textContent=message;
}
function connectGoogle(key) {
  if(!key) return;
  let failed=false, overlay;
  const fail=()=>{failed=true;clearTimeout(timeout);overlay?.setMap(null);googleFallback('Sample map · Google Maps unavailable');};
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
      const map=new maps.Map(target,{center:{lat:60.315,lng:24.513},zoom:13,mapTypeId:'terrain',streetViewControl:false,mapTypeControl:false,fullscreenControl:false});
      overlay=new class extends maps.OverlayView {
        onAdd() {
          this.root=document.createElement('div');
          this.getPanes().overlayMouseTarget.append(this.root);
          refreshGoogle=()=>{this.root.replaceChildren(...data.points.flatMap((_,i)=>{
            const items=makePoint(i);
            maps.OverlayView.preventMapHitsAndGesturesFrom(items[1]);
            return items;
          }));this.draw();};
          refreshGoogle();
        }
        draw() {
          const projection=this.getProjection();
          if(!projection||!this.root) return;
          locations.forEach((point,i)=>{
            const xy=projection.fromLatLngToDivPixel(new maps.LatLng(point));
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
        $('map-status').textContent='Google Maps · sample stations';
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
for(const item of [{id:'all',name:'All birds'},...data.species]) $('species').add(new Option(item.name,item.id));
$('species').value='robin';
for(const id of ['species','period','heat']) $(id).onchange=render;
$('theme').onchange=()=>{
  document.documentElement.dataset.theme=$('theme').value;
  try{localStorage.setItem('chirp-theme',$('theme').value);}catch{}
  render();
};
try {
  const saved=localStorage.getItem('chirp-theme');
  if([...$('theme').options].some(o=>o.value===saved)) {
    $('theme').value=saved;
    document.documentElement.dataset.theme=saved;
  }
}catch{}
render();
connectGoogle((window.CHIRP_MAPS_KEY||'').trim());
