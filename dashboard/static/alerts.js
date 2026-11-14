'use strict';
// Early-warning panel: /api/alerts + a weekly trend chart per alert. Self-contained so
// app.js (the map) stays untouched; it only reuses style.css variables.
(() => {
  const css = document.createElement('style');
  css.textContent = `
.alerts{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:13px 16px;margin-top:12px}
.alerts h2{display:flex;align-items:center;gap:8px}.alerts .count{background:var(--high);color:#fff;border-radius:999px;padding:1px 9px;font-size:13px}
.alert{border-left:4px solid var(--high);padding:8px 12px;margin:10px 0;background:var(--bg);border-radius:0 10px 10px 0}
.alert strong{font-size:16px}.alert p{margin:3px 0;font-size:13px;color:var(--muted)}
.trend{display:flex;align-items:flex-end;gap:3px;height:70px;margin-top:8px}
.trend i{flex:1;background:var(--low);border-radius:3px 3px 0 0;min-height:2px}.trend i.recent{background:var(--high)}.trend i.none{background:none;border:1px dashed var(--border)}
.trend-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}`;
  document.head.append(css);

  const panel = document.createElement('section');
  panel.className = 'alerts';
  panel.setAttribute('aria-label', 'Early warnings');
  const atlas = document.querySelector('.atlas');
  (atlas ? atlas.after(panel) : document.querySelector('main').append(panel));

  const common = label => label.slice(label.indexOf('_') + 1);
  const names = {};
  const pct = x => Math.round(x * 100) + '%';

  async function get(path) {
    const r = await fetch(path, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function chart(weeks) {
    const max = Math.max(...weeks.map(w => w.rate_per_hour || 0), 0.001);
    const bars = document.createElement('div');
    bars.className = 'trend';
    weeks.forEach((w, i) => {
      const bar = document.createElement('i');
      if (w.rate_per_hour === null) bar.className = 'none';  // no listening: a gap, never a zero
      else if (i >= weeks.length - 2) bar.className = 'recent';
      bar.style.height = w.rate_per_hour === null ? '100%' : (100 * w.rate_per_hour / max) + '%';
      bar.title = w.week_start.slice(0, 10) + ': ' + (w.rate_per_hour === null ? 'no data'
        : w.rate_per_hour.toFixed(2) + ' detection-min/h over ' + (w.listening_s / 3600).toFixed(1) + ' h');
      bars.append(bar);
    });
    const axis = document.createElement('div');
    axis.className = 'trend-axis';
    axis.innerHTML = '<span></span><span>orange = last 2 weeks · dashed = no data</span><span></span>';
    axis.firstChild.textContent = weeks[0].week_start.slice(0, 10);
    axis.lastChild.textContent = 'now';
    return [bars, axis];
  }

  async function refresh() {
    try {
      if (!Object.keys(names).length) (await get('/api/stations')).forEach(s => names[s.station_id] = s.name);
      const alerts = await get('/api/alerts');
      const head = document.createElement('h2');
      head.textContent = 'Early warnings ';
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = alerts.length;
      if (alerts.length) head.append(count);
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = alerts.length
        ? 'Changes in detected activity worth investigating: not confirmed population loss.'
        : 'No significant declines. Each station is compared with its own previous 6 weeks.';
      const items = await Promise.all(alerts.map(async a => {
        const box = document.createElement('div');
        box.className = 'alert';
        const title = document.createElement('strong');
        title.textContent = `⚠ ${common(a.species)} down ${pct(a.drop)} at ${names[a.station_id] || a.station_id}`;
        const detail = document.createElement('p');
        detail.textContent = `${a.recent_rate}/h in the last 2 weeks vs ${a.baseline_rate}/h baseline · `
          + `${(a.recent_listening_s / 3600).toFixed(0)} h vs ${(a.baseline_listening_s / 3600).toFixed(0)} h listening · `
          + `p = ${a.p_value.toExponential(1)}`;
        box.append(title, detail);
        try {
          const q = new URLSearchParams({station_id: a.station_id, species: a.species, weeks: 12});
          box.append(...chart(await get('/api/trends?' + q)));
        } catch { /* chart is optional */ }
        return box;
      }));
      panel.replaceChildren(head, note, ...items);
    } catch {
      if (!panel.childElementCount) panel.textContent = 'Early warnings unavailable.';
    }
  }

  refresh();
  setInterval(refresh, 30000);
})();
