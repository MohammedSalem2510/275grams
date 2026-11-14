'use strict';
// Early-warning panel: /api/alerts, one card per alert with a hero number and a 12-week
// trend. Self-contained so app.js (the map) stays untouched; styles live in pro.css.
// Honesty: a flagged change is "detected activity worth investigating", never population loss;
// weeks without listening are gaps, never zeros; simulated stations are labelled.
(() => {
  const panel = document.createElement('section');
  panel.className = 'alerts';
  panel.setAttribute('aria-label', 'Early warnings');
  const slot = document.getElementById('alerts-slot');
  const atlas = document.querySelector('.atlas');
  if (slot) slot.replaceWith(panel);
  else if (atlas) atlas.after(panel);
  else document.body.append(panel);

  const RECENT_WEEKS = 2, BASELINE_WEEKS = 6;  // the rule in protocol/http.md
  const common = label => label.slice(label.indexOf('_') + 1);
  const stations = {};
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const rate = x => x == null ? 'no data' : x.toFixed(x < 10 ? 2 : 1);
  const hours = s => Math.round(s / 3600) + ' h';
  const pValue = p => p < 0.001 ? 'p < 0.001' : 'p = ' + p.toFixed(3);
  const day = iso => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});

  async function get(path) {
    const r = await fetch(path, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function weekText(w) {
    return `Week of ${day(w.week_start)}: ` + (w.rate_per_hour == null
      ? 'no listening, so no data'
      : `${rate(w.rate_per_hour)} detection-min/h over ${(w.listening_s / 3600).toFixed(1)} h`);
  }

  function chart(weeks, baselineRate) {
    const n = weeks.length;
    const recentFrom = n - RECENT_WEEKS, baseFrom = n - RECENT_WEEKS - BASELINE_WEEKS;
    const max = Math.max(baselineRate, ...weeks.map(w => w.rate_per_hour || 0), 0.001) * 1.1;
    const wrap = el('figure', 'trend');
    const plot = el('div', 'trend-plot');
    plot.style.setProperty('--n', n);
    const caption = el('figcaption', 'trend-caption', 'Hover a week for its figures.');
    const reset = () => { caption.textContent = 'Hover a week for its figures.'; };

    const line = el('div', 'trend-baseline');
    line.style.bottom = (100 * baselineRate / max) + '%';
    line.append(el('span', null, `baseline ${rate(baselineRate)}/h`));
    plot.append(line);

    weeks.forEach((w, i) => {
      const bar = el('button', 'bar');
      bar.type = 'button';
      if (w.rate_per_hour == null) bar.classList.add('none');
      else if (i >= recentFrom) bar.classList.add('recent');
      bar.style.height = w.rate_per_hour == null ? '100%' : Math.max(2, 100 * w.rate_per_hour / max) + '%';
      bar.setAttribute('aria-label', weekText(w));
      const show = () => { caption.textContent = weekText(w); };
      bar.addEventListener('mouseenter', show);
      bar.addEventListener('focus', show);
      bar.addEventListener('mouseleave', reset);
      bar.addEventListener('blur', reset);
      plot.append(bar);
    });

    // Labelled windows under the bars, so the comparison never relies on colour alone.
    const windows = el('div', 'trend-windows');
    windows.style.setProperty('--n', n);
    const span = (cls, text, from, count) => {
      const s = el('span', cls, text);
      s.style.gridColumn = `${from + 1} / span ${count}`;
      return s;
    };
    if (baseFrom >= 0) windows.append(span('win', `baseline · ${BASELINE_WEEKS} wk`, baseFrom, BASELINE_WEEKS));
    windows.append(span('win recent', `recent · ${RECENT_WEEKS} wk`, recentFrom, RECENT_WEEKS));

    const axis = el('div', 'trend-axis');
    axis.append(el('span', null, day(weeks[0].week_start)), el('span', null, 'now'));
    wrap.append(plot, windows, axis, caption);
    return wrap;
  }

  function table(weeks) {
    const t = el('table', 'trend-table');
    const head = t.createTHead().insertRow();
    ['Week of', 'Rate /h', 'Listening'].forEach(h => head.append(el('th', null, h)));
    const body = t.createTBody();
    weeks.forEach(w => {
      const row = body.insertRow();
      row.append(el('td', null, day(w.week_start)), el('td', null, rate(w.rate_per_hour)),
                 el('td', null, (w.listening_s / 3600).toFixed(1) + ' h'));
    });
    return t;
  }

  async function card(a) {
    const st = stations[a.station_id] || {};
    const box = el('article', 'alert');
    box.dataset.key = a.station_id + '|' + a.species;

    const top = el('div', 'alert-top');
    const badge = el('span', 'badge critical', 'Decline');
    badge.prepend(el('span', 'badge-icon', '▼ '));
    top.append(badge);
    if (st.simulated) top.append(el('span', 'badge sim', 'Simulated data'));
    box.append(top);

    box.append(el('h3', 'alert-species', common(a.species)));
    box.append(el('p', 'alert-station', st.name || a.station_id));

    const hero = el('div', 'alert-hero');
    hero.append(el('span', 'hero-num', '−' + Math.round(a.drop * 100) + '%'),
                el('span', 'hero-label', `detected activity, last ${RECENT_WEEKS} weeks vs the ${BASELINE_WEEKS} before`));
    box.append(hero);

    const rates = el('div', 'alert-rates');
    const stat = (label, value, cls) => {
      const s = el('div', 'stat' + (cls ? ' ' + cls : ''));
      s.append(el('span', 'stat-label', label), el('span', 'stat-value', `${rate(value)} /h`));
      return s;
    };
    rates.append(stat('Baseline', a.baseline_rate), el('span', 'arrow', '→'), stat('Recent', a.recent_rate, 'recent'));
    box.append(rates);

    let weeks = null;
    try {
      const q = new URLSearchParams({station_id: a.station_id, species: a.species, weeks: 12});
      weeks = await get('/api/trends?' + q);
      if (weeks.length) box.append(chart(weeks, a.baseline_rate));
    } catch { /* the chart is optional; the numbers above still stand */ }

    const meta = el('p', 'alert-meta');
    meta.textContent = `Listening ${hours(a.recent_listening_s)} recent vs ${hours(a.baseline_listening_s)} baseline · ${pValue(a.p_value)}`;
    box.append(meta);
    if (a.recent_temp_c != null && a.baseline_temp_c != null) {
      const diff = a.recent_temp_c - a.baseline_temp_c;
      const ctx = el('p', 'alert-meta');
      ctx.textContent = `${a.recent_temp_c.toFixed(1)} °C recent vs ${a.baseline_temp_c.toFixed(1)} °C baseline`
        + (Math.abs(diff) >= 3 ? ` · ${Math.abs(diff).toFixed(1)} °C ${diff < 0 ? 'colder' : 'warmer'}, so weather may explain part of this.` : '');
      box.append(ctx);
    }

    const more = el('details', 'alert-more');
    more.append(el('summary', null, 'How this is flagged · weekly data'));
    more.append(el('p', null, `Flagged when the rate drops by at least 30 %, with at least 5 h of listening recently `
      + `and 15 h in the baseline, at least 30 baseline detection-minutes, and a Poisson test at p < 0.01. `
      + `It is a change in detected activity worth investigating, not confirmed population loss; `
      + `migration and weather can cause it too.`));
    if (weeks && weeks.length) more.append(table(weeks));
    box.append(more);
    return box;
  }

  async function refresh() {
    try {
      if (!Object.keys(stations).length) (await get('/api/stations')).forEach(s => stations[s.station_id] = s);
      const alerts = await get('/api/alerts');
      const head = el('div', 'alerts-head');
      head.append(el('p', 'eyebrow', 'Early warning'));
      if (alerts.length) head.append(el('span', 'count', String(alerts.length)));
      const items = await Promise.all(alerts.map(card));
      const note = el('p', 'note', alerts.length
        ? 'Changes in detected activity worth investigating, not confirmed population loss.'
        : 'No significant declines. Each station is compared with its own previous 6 weeks.');
      // The 30 s refresh rebuilds the cards; keep any "How this is flagged" section the reader opened.
      const open = new Set([...panel.querySelectorAll('.alert-more[open]')].map(d => d.closest('.alert').dataset.key));
      items.forEach(item => { if (open.has(item.dataset.key)) item.querySelector('.alert-more').open = true; });
      panel.replaceChildren(head, ...items, note);
    } catch {
      if (!panel.childElementCount) panel.textContent = 'Early warnings unavailable.';
    }
  }

  refresh();
  setInterval(refresh, 30000);
})();
