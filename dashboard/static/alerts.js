'use strict';
// Early warning: one compact row per flagged decline (photo, species, station, drop, 12-week sparkline).
// Clicking a row shows that station and species on the map. The numbers behind each flag are in the
// row's tooltip; the rule is in one shared "How alerts work" note. Honesty: these are changes in
// detected activity, not population loss; weeks without listening are gaps; simulated data is labelled.
(() => {
  const panel = document.createElement('section');
  panel.className = 'card alerts';
  panel.setAttribute('aria-label', 'Early warning');
  const slot = document.getElementById('alerts-slot');
  if (slot) slot.replaceWith(panel);
  else document.querySelector('.panel')?.prepend(panel);

  const RECENT_WEEKS = 2;
  const stations = {};
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const common = label => label.slice(label.indexOf('_') + 1);
  const rate = x => x.toFixed(x < 10 ? 2 : 1);
  const hours = s => Math.round(s / 3600) + ' h';
  const pValue = p => p < 0.001 ? 'p < 0.001' : 'p = ' + p.toFixed(3);

  async function get(path) {
    const r = await fetch(path, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // 12 weekly bars, no axes: grey for earlier weeks, critical for the last two. No listening = a gap.
  function sparkline(weeks) {
    const W = 72, H = 22, n = weeks.length, gap = 1.5;
    const bw = (W - gap * (n - 1)) / n;
    const max = Math.max(...weeks.map(w => w.rate_per_hour || 0), 0.001);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('aria-hidden', 'true');
    weeks.forEach((w, i) => {
      if (w.rate_per_hour == null) return;
      const h = Math.max(1, H * w.rate_per_hour / max);
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', (i * (bw + gap)).toFixed(2));
      r.setAttribute('y', (H - h).toFixed(2));
      r.setAttribute('width', bw.toFixed(2));
      r.setAttribute('height', h.toFixed(2));
      r.setAttribute('rx', '1');
      r.setAttribute('class', i >= n - RECENT_WEEKS ? 'recent' : 'past');
      svg.append(r);
    });
    return svg;
  }

  function detail(a) {
    const lines = [`${rate(a.recent_rate)} detection-min/h in the last 2 weeks vs ${rate(a.baseline_rate)} before`,
      `Listening: ${hours(a.recent_listening_s)} recent, ${hours(a.baseline_listening_s)} baseline · ${pValue(a.p_value)}`];
    if (a.recent_temp_c != null && a.baseline_temp_c != null) {
      const d = a.recent_temp_c - a.baseline_temp_c;
      lines.push(`${a.recent_temp_c.toFixed(1)} °C vs ${a.baseline_temp_c.toFixed(1)} °C`
        + (Math.abs(d) >= 3 ? `: ${Math.abs(d).toFixed(1)} °C ${d < 0 ? 'colder' : 'warmer'}, so weather may explain part of it` : ''));
    }
    return lines.join('\n');
  }

  async function row(a) {
    const st = stations[a.station_id] || {};
    const name = common(a.species);
    const pct = Math.round(a.drop * 100);
    const btn = el('button', 'warn');
    btn.type = 'button';
    btn.title = detail(a) + '\n\nClick to show on the map.';
    btn.setAttribute('aria-label', `${name} at ${st.name || a.station_id}${st.simulated ? ', simulated data' : ''}: `
      + `detected activity down ${pct} percent. ${detail(a)}. Show on the map.`);
    btn.onclick = () => window.chirpFocus?.(a.station_id, a.species);

    const photo = el('span', 'warn-photo');
    photo.innerHTML = window.chirpSpecies?.birdSvg || '';
    window.chirpSpecies?.photoFor(a.species).then(meta => {
      if (!meta.available) return;
      const img = new Image();
      img.alt = '';
      img.onload = () => photo.replaceChildren(img);
      img.src = meta.image;
    });

    const text = el('span', 'warn-text');
    text.append(el('span', 'warn-species', name),
                el('span', 'warn-station', (st.name || a.station_id).replace(/\s*\(simulated\)$/i, '')
                  + (st.simulated ? ' · simulated' : '')));
    // Weather context shown only when it could explain the drop (a 3 °C or larger shift).
    if (a.recent_temp_c != null && a.baseline_temp_c != null && Math.abs(a.recent_temp_c - a.baseline_temp_c) >= 3) {
      const d = a.recent_temp_c - a.baseline_temp_c;
      text.append(el('span', 'warn-temp', `${Math.abs(d).toFixed(1)} °C ${d < 0 ? 'colder' : 'warmer'} than before`));
    }
    const fig = el('span', 'warn-fig');
    fig.append(el('span', 'warn-drop', '−' + pct + '%'));
    try {
      const q = new URLSearchParams({station_id: a.station_id, species: a.species, weeks: 12});
      const weeks = await get('/api/trends?' + q);
      if (weeks.length) fig.append(sparkline(weeks));
    } catch { /* the sparkline is optional */ }
    btn.append(photo, text, fig);
    return btn;
  }

  let stationId, version = 0;
  async function refresh() {
    const request = ++version;
    if (!stationId) return;
    try {
      if (!Object.keys(stations).length) (await get('/api/stations')).forEach(s => stations[s.station_id] = s);
      const alerts = (await get('/api/alerts')).filter(a => a.station_id === stationId);
      if (request !== version) return;
      const head = el('div', 'alerts-head');
      head.append(el('p', 'eyebrow', 'Early warning'));
      if (alerts.length) head.append(el('span', 'count', String(alerts.length)));
      const body = alerts.length ? await Promise.all(alerts.map(row))
        : [el('p', 'warn-none', 'No declines flagged.')];
      const how = el('details', 'alerts-how');
      const list = el('ul');
      [['A drop of at least 30 %', 'in how often the species is detected'],
       ['Enough listening', '5 h in the last two weeks, 15 h in the six before'],
       ['Unlikely to be chance', 'Poisson test, p < 0.01']].forEach(([term, text]) => {
        const li = el('li');
        li.append(el('strong', null, term), document.createTextNode(': ' + text));
        list.append(li);
      });
      how.append(el('summary', null, 'Learn more'),
        el('p', null, 'Each station is compared only with itself: its last two weeks against the six weeks before. A species is flagged when all three hold:'),
        list,
        el('p', null, 'An alert is a reason to look closer, not proof of population loss. Migration, weather or a moved microphone can cause the same change.'));
      const wasOpen = panel.querySelector('.alerts-how')?.open;
      how.open = !!wasOpen;
      if (request === version) panel.replaceChildren(head, ...body, how);
    } catch {
      if (request === version && !panel.childElementCount) panel.textContent = 'Early warning unavailable.';
    }
  }

  window.chirpAlerts = {show(id) {
    stationId = id;
    panel.replaceChildren();
    refresh();
  }};
  setInterval(refresh, 30000);
})();
