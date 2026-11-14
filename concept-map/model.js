/* Shared, dependency-free data model. Usable in the browser and Node tests. */
(function (root) {
  'use strict';
  const periods = ['previous', 'current'];
  function rate(point, species, period) {
    let hours = 0, count = 0;
    for (const key of period === 'both' ? periods : [period]) {
      const reading = point.readings[key];
      // Counts without valid effort cannot enter either numerator or denominator.
      if (reading.hours > 0) {
        hours += reading.hours;
        count += species === 'all' ? Object.values(reading.counts).reduce((a, b) => a + b, 0) : (reading.counts[species] || 0);
      }
    }
    return { hours, count, value: hours > 0 ? count / hours : null };
  }
  function change(point, species) {
    const a = rate(point, species, 'previous').value, b = rate(point, species, 'current').value;
    if (a === null || b === null) return 'Not enough listening data to compare';
    if (a === 0) return b === 0 ? 'No detections in either period' : 'New activity from a zero baseline';
    const pct = (b - a) / a * 100;
    return Math.abs(pct) < .05 ? 'Unchanged from period A' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% activity vs period A`;
  }
  function sample() {
    const seed = [
      ['p1','Willow grove',.27,.31,'Woodland edge',8,[147,43,18,8],8,[112,38,28,10],'Sheltered canopy beside the western trail.'],
      ['p2','Creek bend',.53,.52,'Waterside',6,[62,20,36,9],6,[85,26,24,4],'A quiet listening spot above the water.'],
      ['p3','North meadow',.68,.24,'Open meadow',7,[42,112,20,14],7,[35,70,22,12],'Open grassland with a scattered tree line.'],
      ['p4','Fern hollow',.31,.72,'Understorey',5,[16,22,65,33],5,[30,18,42,19],'Dense low cover along the southern path.'],
      ['p5','East lookout',.83,.61,'Forest edge',4,[24,16,11,54],4,[24,19,13,28],'Overlooks the transition from meadow to forest.'],
      ['p6','Old oak',.49,.16,'Woodland',0,[0,0,0,0],0,[0,0,0,0],'No listening data yet. Not the same as no birds.']
    ];
    const species = [{id:'robin',name:'European robin'},{id:'great-tit',name:'Great tit'},{id:'blackbird',name:'Common blackbird'},{id:'song-thrush',name:'Song thrush'}];
    const counts = values => Object.fromEntries(species.map((s,i)=>[s.id,values[i]]));
    return {version:1,title:'Willow Creek',provenance:'sample',map:{kind:'demo',image:null,width:1200,height:800},species,
      periodLabels:{previous:'Sample week A',current:'Sample week B'},scaleMax:24,
      points:seed.map(([id,name,x,y,category,h,c,ph,pc,notes])=>({id,name,x,y,category,notes,readings:{current:{hours:h,counts:counts(c)},previous:{hours:ph,counts:counts(pc)}}}))};
  }
  function validate(raw) {
    const fail = message => {throw new Error(message);};
    const text = (v,max) => typeof v === 'string' && v.length <= max;
    const number = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!object(raw) || raw.version !== 1) fail('This is not a supported Chirp project (version 1).');
    if (!text(raw.title,80) || !raw.title.trim() || !['sample','user'].includes(raw.provenance)) fail('The project title or data source is invalid.');
    const m = raw.map;
    if (!object(m) || !['demo','image'].includes(m.kind) || !number(m.width,1,20000) || !number(m.height,1,20000)) fail('The map dimensions are invalid.');
    if (m.kind === 'image' && (typeof m.image !== 'string' || m.image.length > 14500000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.image))) fail('The map must be an embedded PNG, JPEG or WebP image.');
    if (!Array.isArray(raw.species) || !raw.species.length || raw.species.length > 100) fail('Use between 1 and 100 bird species.');
    const ids = new Set();
    for (const s of raw.species) {
      if (!object(s) || !text(s.id,60) || !/^[a-zA-Z0-9_-]+$/.test(s.id) || ['all','__proto__','constructor','prototype'].includes(s.id) || !text(s.name,50) || !s.name.trim() || ids.has(s.id)) fail('Species names or identifiers are invalid or duplicated.');
      ids.add(s.id);
    }
    if (!object(raw.periodLabels) || periods.some(p=>!text(raw.periodLabels[p],40) || !raw.periodLabels[p].trim())) fail('Both comparison periods need a label.');
    if (!number(raw.scaleMax,.01,1000000)) fail('The colour scale maximum must be between 0.01 and 1,000,000.');
    if (!Array.isArray(raw.points) || raw.points.length > 200) fail('A concept supports up to 200 observation points.');
    const pointIds = new Set();
    for (const p of raw.points) {
      if (!object(p) || !text(p.id,80) || !p.id || pointIds.has(p.id) || !text(p.name,60) || !p.name.trim() || !text(p.category,40) || !text(p.notes,500) || !number(p.x,0,1) || !number(p.y,0,1)) fail('A point has an invalid name, identifier or position.');
      pointIds.add(p.id);
      if (!object(p.readings)) fail('A point is missing its listening records.');
      for (const key of periods) {
        const r = p.readings[key];
        if (!object(r) || !number(r.hours,0,1000000) || !object(r.counts)) fail('Listening hours must be a non-negative number.');
        for (const [id,count] of Object.entries(r.counts)) {
          if (!ids.has(id) || !number(count,0,1000000) || !Number.isInteger(count)) fail('Bird counts must be whole numbers for a known species.');
        }
        if (r.hours === 0 && Object.values(r.counts).some(c=>c>0)) fail('A period with bird detections must have positive listening hours.');
      }
    }
    // Return only supported fields; imported objects never become DOM markup.
    return {version:1,title:raw.title,provenance:raw.provenance,map:{kind:m.kind,image:m.kind==='image'?m.image:null,width:m.width,height:m.height},species:raw.species.map(s=>({id:s.id,name:s.name})),periodLabels:{...raw.periodLabels},scaleMax:raw.scaleMax,points:raw.points.map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,category:p.category,notes:p.notes,readings:Object.fromEntries(periods.map(key=>[key,{hours:p.readings[key].hours,counts:{...p.readings[key].counts}}]))}))};
  }
  const api = {rate,change,sample,validate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChirpModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
