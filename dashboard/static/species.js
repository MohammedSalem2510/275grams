'use strict';
// "Species heard here": one card per species at the selected station, with a cached iNaturalist
// photo (credit always shown), detection-minutes, last heard, best model score and the latest clip.
// Clicking a card filters the map and detection list to that species. Self-contained; app.js calls
// chirpSpecies.show(stationId, query) wherever it reloads detections.
(() => {
  const list = document.getElementById('species-cards');
  if (!list) return;
  const photoCache = new Map();  // label -> Promise<meta>
  const featured = document.getElementById('featured-bird');
  let version = 0, shownKey = '', shownStation;
  const playing = () => [...document.querySelectorAll('#species-cards audio, #featured-bird audio')].some(a => !a.paused);

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

  let hourlySelection = '', inspectedHour = null;
  async function showHourly(stationId, query, request) {
    const species = document.getElementById('species').value;
    const panel = document.getElementById('hourly');
    panel.hidden = !stationId || !species;
    if (panel.hidden) return;
    const bars = document.getElementById('hourly-bars');
    const detail = document.getElementById('hourly-detail');
    const selection = JSON.stringify([stationId, species, document.getElementById('period').value]);
    if (selection !== hourlySelection) {
      inspectedHour = null;
      bars.replaceChildren();
      detail.textContent = 'Loading hourly activity…';
      hourlySelection = selection;
    }
    document.getElementById('hourly-caption').textContent = split(species)[0] + ' · detection-minutes per listening hour · Helsinki time';
    const q = new URLSearchParams(query);
    q.set('station_id', stationId);
    q.set('species', species);
    try {
      const response = await fetch('/api/hourly-activity?' + q, {signal: AbortSignal.timeout(8000)});
      if (!response.ok) throw Error();
      const hours = await response.json();
      if (request !== version) return;
      const max = Math.max(1, ...hours.map(h => h.rate_per_hour ?? 0));
      const buttons = hours.map(h => {
        const button = el('button', h.rate_per_hour == null ? 'missing' : '');
        const clock = String(h.hour).padStart(2,'0') + ':00';
        const rate = h.rate_per_hour == null ? 'Insufficient listening' : h.rate_per_hour.toFixed(1) + ' detection-min per listening h';
        button.title = clock + ' · ' + rate + ' · ' + (h.listening_s / 60).toFixed(1) + ' min listened';
        button.setAttribute('aria-label', button.title);
        button.style.setProperty('--level', (100 * (h.rate_per_hour ?? 0) / max) + '%');
        button.onfocus = button.onclick = () => { inspectedHour = h.hour; detail.textContent = button.title; };
        return button;
      });
      const focused = bars.contains(document.activeElement);
      bars.replaceChildren(...buttons);
      detail.textContent = inspectedHour == null ? 'Select an hour for its rate and listening time. Hatched hours have under one minute of listening.' : buttons[inspectedHour].title;
      if (focused && inspectedHour != null) buttons[inspectedHour].focus({preventScroll:true});
    } catch {
      if (request === version) { bars.replaceChildren(); detail.textContent = 'Hourly activity unavailable.'; }
    }
  }

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

  function card(row, prominent = false) {
    const [name, sci] = split(row.species);
    const active = document.getElementById('species')?.value === row.species;
    const box = el('article', 'sp-card' + (active ? ' active' : ''));

    const media = el('div', 'sp-photo');
    media.innerHTML = birdSvg;
    const credit = el('p', 'sp-credit');
    photoFor(row.species).then(meta => {
      if (!meta.available) {
        return;
      }
      const img = new Image();
      img.alt = name;
      // Not loading='lazy': a lazy image that isn't in the page yet never starts loading,
      // and this one is only swapped in once it has loaded.
      img.onload = () => {
        media.replaceChildren(img);
        // Shorten iNaturalist's standard wording while preserving distinct uploader credits.
        const match = meta.credit.match(/^\(c\) (.+?), some rights reserved \((CC [^)]+)\)(?:, uploaded by (.+))?$/i);
        let attribution = meta.credit;
        if (match) {
          const [, author, licence, uploader] = match;
          attribution = '© ' + author + ' · ' + licence;
          if (uploader && uploader !== author) attribution += ' · uploaded by ' + uploader;
        }
        const source = el('a', null, 'iNaturalist');
        Object.assign(source, {href: meta.source, target: '_blank', rel: 'noopener'});
        credit.append('Photo ' + attribution + ' · ', source);
        credit.title = meta.credit;
      };
      img.src = meta.image;
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
    body.append(el('p', 'sp-heard', 'Last heard ' + when(row.last_heard)));
    const details = el('details', 'sp-details');
    details.dataset.species = row.species;
    details.append(el('summary', null, row.evidence_window_id && !prominent ? 'Recording & details' : 'Detection details'));
    const count = row.detection_minutes;
    details.append(el('p', null, 'Heard in ' + count + (count === 1 ? ' distinct minute' : ' distinct minutes') + ' during this period.'));
    details.append(el('p', null, 'Highest model score: ' + row.best_score.toFixed(2) + ' / 1'));
    if (row.evidence_window_id) {
      const audio = el('audio', 'evidence');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = '/api/evidence/' + encodeURIComponent(row.evidence_window_id);
      audio.setAttribute('aria-label', 'Latest recording of ' + name);
      const play = chirpPlayButton(audio, name);  // defined in app.js: the same green pill everywhere
      if (prominent) body.append(play, audio);
      else details.append(play, audio);
    }
    box.append(media, body, details, credit);
    return box;
  }

  async function show(stationId, query) {
    const request = ++version;
    if (stationId !== shownStation) {
      document.querySelectorAll('#species-cards audio, #featured-bird audio').forEach(audio => audio.pause());
      featured.hidden = true;
      featured.replaceChildren();
      list.replaceChildren();
      shownKey = '';
      shownStation = stationId;
    }
    showHourly(stationId, query, request);
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
      const expanded = new Set([...list.querySelectorAll('.sp-details[open]')].map(item => item.dataset.species));
      const filter = document.getElementById('species').value;
      const recent = rows.filter(r => !filter || r.species === filter).sort((a,b) => b.last_heard.localeCompare(a.last_heard));
      const latest = recent.find(r => r.evidence_window_id) || recent[0];
      featured.hidden = !latest || document.getElementById('station-status').classList.contains('status-simulated');
      featured.replaceChildren();
      if (!featured.hidden) {
        featured.append(el('p', 'eyebrow', latest === recent[0] ? 'Latest bird heard' : 'Recently heard · recording available'), card(latest, true));
      }
      list.replaceChildren(...(rows.length ? rows.map(card)
        : [el('p', 'note', 'No birds detected here in this period. Silence is not proof of absence.')]));
      for (const item of list.querySelectorAll('.sp-details')) item.open = expanded.has(item.dataset.species);
    } catch {
      if (request === version && !list.childElementCount) list.replaceChildren(el('p', 'note', 'Species unavailable.'));
    }
  }

  window.chirpSpecies = {show, photoFor, birdSvg};  // photos and the fallback bird are shared with alerts.js
})();
