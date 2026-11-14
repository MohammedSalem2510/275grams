'use strict';

const element = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const fmt = value => number.format(value);
const birdName = label => label.slice(label.indexOf('_') + 1);
let stations = [];
let requestVersion = 0;

function stationName(id) {
  const station = stations.find(entry => entry.station_id === id);
  if (!station) return id;
  return station.simulated && !station.name.toLowerCase().includes('simulated')
    ? station.name + ' (simulated)' : station.name;
}

async function get(endpoint, filters = {}) {
  const query = new URLSearchParams(filters);
  const response = await fetch('/api/' + endpoint + '?' + query, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(endpoint + ' returned HTTP ' + response.status);
  return response.json();
}

function row(values) {
  const tr = document.createElement('tr');
  for (const value of values) {
    const td = tr.insertCell();
    td.textContent = value;
  }
  return tr;
}

function fillRows(id, rows, empty, columns) {
  const placeholder = row([empty]);
  placeholder.firstChild.colSpan = columns;
  element(id).replaceChildren(...(rows.length ? rows : [placeholder]));
}

function rateText(value, lowEffort) {
  if (value == null) return 'Unavailable';
  return fmt(value) + (lowEffort ? ' (low effort)' : '');
}

function renderTrend(station, weeks) {
  const section = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = stationName(station.station_id);
  const chart = document.createElement('div');
  chart.className = 'trend-chart';
  chart.setAttribute('aria-hidden', 'true');
  const max = Math.max(1, ...weeks.map(week => week.rate_per_hour ?? 0));
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Weekly values and listening effort';
  const table = document.createElement('table');
  const header = table.createTHead().insertRow();
  for (const label of ['Week starting (UTC)', 'Detection-minutes', 'Hours', 'Rate / hour']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    header.append(th);
  }
  const body = table.createTBody();
  for (const week of weeks) {
    const bar = document.createElement('span');
    const rate = rateText(week.rate_per_hour, week.low_effort);
    bar.title = week.week_start.slice(0,10) + ' · ' + rate + ' · ' + fmt(week.listening_s / 3600) + ' h';
    if (week.rate_per_hour == null) bar.className = 'missing';
    else {
      bar.style.height = (week.rate_per_hour / max * 100) + '%';
      if (week.low_effort) bar.className = 'low';
    }
    chart.append(bar);
    body.append(row([week.week_start.slice(0,10), fmt(week.detections), fmt(week.listening_s / 3600), rate]));
  }
  const scale = document.createElement('p');
  scale.className = 'note';
  scale.textContent = 'Scale 0–' + fmt(max) + ' per hour · dashed bars show unavailable rates';
  details.append(summary, table);
  section.append(title, chart, scale, details);
  return section;
}

async function refresh() {
  const request = ++requestVersion;
  const species = element('species').value;
  const selected = element('station').value;
  const hours = Number(element('period').value);
  const now = Date.now();
  const dates = hours ? {
    start: new Date(now - hours * 3600000).toISOString(),
    end: new Date(now).toISOString()
  } : {};
  const filter = species ? {species} : {};
  const visible = stations.filter(station => !selected || station.station_id === selected);
  element('status').textContent = 'Loading statistics…';
  element('total-count').textContent = '—';
  element('total-hours').textContent = '—';
  element('total-rate').textContent = '—';
  for (const id of ['stations', 'trends', 'alerts', 'detections']) element(id).replaceChildren();
  try {
    const [rates, detections, alerts, trends] = await Promise.all([
      get('rates', {...dates, ...filter}),
      get('detections', {...dates, ...filter, ...(selected ? {station_id:selected} : {}), limit:200}),
      get('alerts', filter),
      Promise.all(visible.map(station => get('trends', {...filter, station_id:station.station_id, weeks:12})))
    ]);
    if (request !== requestVersion) return;
    const shown = rates.filter(rate => !selected || rate.station_id === selected);
    const total = shown.reduce((sum, rate) => sum + rate.detections, 0);
    const seconds = shown.reduce((sum, rate) => sum + rate.listening_s, 0);
    element('total-count').textContent = fmt(total);
    element('total-hours').textContent = fmt(seconds / 3600);
    element('total-rate').textContent = seconds < 60 ? 'Unavailable' : fmt(total * 3600 / seconds);
    fillRows('stations', shown.map(rate => row([
      stationName(rate.station_id),
      stations.find(station => station.station_id === rate.station_id)?.status ?? 'Unknown',
      fmt(rate.detections), fmt(rate.listening_s / 3600), rateText(rate.rate_per_hour, rate.low_effort)
    ])), 'No stations available.', 5);
    fillRows('detections', detections.map(item => row([
      new Date(item.start).toLocaleString('en-GB',{timeZone:'Europe/Helsinki',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}), birdName(item.species),
      stationName(item.station_id), item.score.toFixed(2)
    ])), 'No detections in this selection.', 4);
    element('trends').replaceChildren(...visible.map((station, index) => renderTrend(station, trends[index])));
    const matchingAlerts = alerts.filter(alert => !selected || alert.station_id === selected);
    element('alerts').replaceChildren(...(matchingAlerts.length ? matchingAlerts.map(alert =>
      birdName(alert.species) + ' · ' + stationName(alert.station_id) + ' · ' +
      fmt(alert.drop * 100) + '% decline (' + fmt(alert.baseline_rate) + ' → ' +
      fmt(alert.recent_rate) + ' / hour), ' + fmt(alert.recent_listening_s / 3600) + ' h recent listening'
    ) : ['No alerts for this selection.']).map(label => {
      const li = document.createElement('li');
      li.textContent = label;
      return li;
    }));
    const simulated = visible.filter(station => station.simulated).length;
    element('status').textContent = simulated
      ? 'Selection includes ' + simulated + ' simulated station' + (simulated === 1 ? '.' : 's.')
      : 'Statistics loaded.';
  } catch {
    if (request === requestVersion) element('status').textContent = 'Could not load statistics. Refresh the page to retry.';
  }
}

async function init() {
  // One theme (pro.css) across the dashboard; saved per-browser themes are retired.
  try {
    const [registry, species] = await Promise.all([get('stations'), get('species')]);
    stations = registry;
    for (const station of stations) element('station').add(new Option(stationName(station.station_id), station.station_id));
    for (const bird of species) element('species').add(new Option(birdName(bird.species), bird.species));
    for (const id of ['species', 'station', 'period']) element(id).addEventListener('change', refresh);
    await refresh();
  } catch {
    element('status').textContent = 'Could not load the station or species list. Refresh the page to retry.';
  }
}
init();
