'use strict';
// "Species heard here": one card per species at the selected station, with a cached iNaturalist
// photo (credit always shown), detection-minutes, last heard, best model score and the latest clip.
// Clicking a card filters the map and detection list to that species. Self-contained; app.js calls
// chirpSpecies.show(stationId, query) wherever it reloads detections.
(() => {
  const list = document.getElementById('species-cards');
  if (!list) return;
  const photoCache = new Map();  // label -> Promise<meta>
  let version = 0, shownKey = '';
  const playing = () => [...list.querySelectorAll('audio')].some(a => !a.paused);

  // Fallback: the Lil' Birb (CC0) pixel bird, the same one the station's LED matrix shows.
  const BIRD = ['........', '........', '...##...', '#.##.#..', '#--###o.', '##-###..', '.####...', '..o.o...'];
  const fill = {'#': 'var(--ink-3)', '-': 'var(--rule-strong)', 'o': 'var(--ink-2)'};
  const birdSvg = '<svg viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">'
    + BIRD.flatMap((row, y) => [...row].map((c, x) => fill[c] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill[c]}"/>` : '')).join('')
    + '</svg>';

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const split = label => {
    const i = label.indexOf('_');
    return i < 0 ? [label, label] : [label.slice(i + 1), label.slice(0, i)];
  };
  const when = iso => new Date(iso).toLocaleString('en-GB', {timeZone: 'Europe/Helsinki', day: 'numeric',
    month: 'short', hour: '2-digit', minute: '2-digit'});

  function photoFor(label) {
    if (!photoCache.has(label)) {
      const p = fetch('/api/species-photo?' + new URLSearchParams({species: label}), {signal: AbortSignal.timeout(20000)})
        .then(r => r.ok ? r.json() : {available: false, retry: true})
        .catch(() => ({available: false, retry: true}));
      p.then(meta => { if (meta.retry) photoCache.delete(label); });  // network blip: try again next refresh
      photoCache.set(label, p);
    }
    return photoCache.get(label);
  }

  function card(row) {
    const [name, sci] = split(row.species);
    const active = document.getElementById('species')?.value === row.species;
    const box = el('article', 'sp-card' + (active ? ' active' : ''));

    const media = el('div', 'sp-photo');
    media.innerHTML = birdSvg;
    const credit = el('p', 'sp-credit', 'Photo loading…');
    photoFor(row.species).then(meta => {
      if (!meta.available) {
        credit.textContent = 'No photo available';
        return;
      }
      const img = new Image();
      img.alt = name;
      img.loading = 'lazy';
      img.onload = () => media.replaceChildren(img);
      img.src = meta.image;
      credit.replaceChildren(document.createTextNode(meta.credit + ' · '), Object.assign(el('a', null, 'iNaturalist'),
        {href: meta.source, target: '_blank', rel: 'noopener'}));
    });

    const body = el('div', 'sp-body');
    const pick = el('button', 'sp-name', name);
    pick.type = 'button';
    pick.title = active ? 'Show all birds again' : `Show only ${name} on the map and in the detections`;
    pick.setAttribute('aria-pressed', String(active));
    pick.onclick = () => {
      const select = document.getElementById('species');
      if (![...select.options].some(o => o.value === row.species)) select.add(new Option(name, row.species));
      select.value = active ? '' : row.species;
      select.dispatchEvent(new Event('change'));
    };
    body.append(pick, el('p', 'sp-sci', sci));
    const stats = el('p', 'sp-stats');
    stats.textContent = `${row.detection_minutes} detection-min · last ${when(row.last_heard)} · best score ${row.best_score.toFixed(2)}`;
    body.append(stats);
    if (row.evidence_window_id) {
      const audio = el('audio', 'evidence');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = '/api/evidence/' + encodeURIComponent(row.evidence_window_id);
      audio.setAttribute('aria-label', 'Latest recording of ' + name);
      body.append(audio);
    }
    body.append(credit);
    box.append(media, body);
    return box;
  }

  async function show(stationId, query) {
    const request = ++version;
    if (!stationId) return list.replaceChildren(el('p', 'note', 'Select a station.'));
    const q = new URLSearchParams(query);
    q.delete('species');
    q.set('station_id', stationId);
    try {
      const r = await fetch('/api/station-species?' + q, {signal: AbortSignal.timeout(8000)});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json();
      if (request !== version) return;
      // The dashboard refreshes every 15 s: rebuild only when something changed, and never mid-clip.
      const key = stationId + '|' + (document.getElementById('species')?.value || '') + '|' + JSON.stringify(rows);
      if (key === shownKey || playing()) return;
      shownKey = key;
      list.replaceChildren(...(rows.length ? rows.map(card)
        : [el('p', 'note', 'No birds detected here in this period. Silence is not proof of absence.')]));
    } catch {
      if (request === version && !list.childElementCount) list.replaceChildren(el('p', 'note', 'Species unavailable.'));
    }
  }

  window.chirpSpecies = {show};
})();
