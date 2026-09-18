'use strict';

const state = {
  data: null,
  metric: 'view',
  keyword: '',
  sortKey: null,
  sortDesc: true,
  day: null,
};

let chart = null;
let chartEl = null;

const $ = (id) => document.getElementById(id);

function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

function fmtDelta(n) {
  const v = Number(n) || 0;
  if (v > 0) return `+${v.toLocaleString('en-US')}`;
  if (v < 0) return v.toLocaleString('en-US');
  return '0';
}

function deltaClass(n) {
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

function fmtTime(t) {
  if (!t) return '-';
  const d = new Date(t * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDay(t) {
  if (!t) return '';
  const d = new Date(t * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fetchData() {
  try {
    const res = await fetch('./latest.json', { cache: 'no-store' });
    state.data = await res.json();
    render();
  } catch (e) {
    const el = $('statusText');
    if (el) el.textContent = '连接失败：' + e.message;
  }
}

function updateStatus() {
  const d = state.data;
  if (!d) return;
  const el = document.getElementById('statusText');
  if (el) el.textContent =
    `上次采集：${fmtTime(d.lastCollect)} · 共 ${d.videoCount} 个视频 · 每 30 分钟自动采集`;
}

/* ------------------------------ 汇总卡片 ------------------------------ */

function renderCards() {
  const d = state.data;
  const wrap = $('cards');
  wrap.innerHTML = '';
  const top = d.top || {};

  const renderTop = (label, item) => {
    const card = document.createElement('div');
    card.className = 'card';
    if (!item) {
      card.innerHTML = `<div class="label">${label}</div><div class="value">暂无数据</div>`;
    } else {
      card.innerHTML = `
        <div class="label">${label}</div>
        <div class="top-title" title="${escapeHtml(item.title)}">${escapeHtml(truncate(item.title, 20))}</div>
        <div class="top-owner">${item.owner ? 'UP主：' + escapeHtml(item.owner) : ''}</div>
        <div class="delta ${deltaClass(item.delta)}">播放 ${fmtDelta(item.delta)}</div>
      `;
    }
    wrap.appendChild(card);
  };

  renderTop('时段涨幅最多', top.interval);
  renderTop('当天涨幅最多', top.today);
}

/* ------------------------------ 指标 tab ------------------------------ */

function renderTabs() {
  const d = state.data;
  const wrap = $('metricTabs');
  wrap.innerHTML = '';
  for (const key of d.metrics) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (key === state.metric ? ' active' : '');
    btn.textContent = d.metricNames[key];
    btn.onclick = () => {
      state.metric = key;
      renderTabs();
      renderChart();
    };
    wrap.appendChild(btn);
  }
}

/* ------------------------------ 按天筛选 ------------------------------ */

function collectDays(videos) {
  const set = new Set();
  for (const v of videos) for (const p of v.history || []) set.add(fmtDay(p.t));
  return [...set].sort().reverse();
}

function renderDayFilters() {
  const d = state.data;
  if (!d) return;
  const days = collectDays(d.videos || []);
  if (state.day === null && days.length) state.day = days[0];
  const el = document.getElementById('daySelect');
  if (!el) return;
  el.innerHTML = '';
  const opt = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    el.appendChild(o);
  };
  opt('all', '全部日期');
  for (const day of days) opt(day, day);
  el.value = state.day;
  el.onchange = () => {
    state.day = el.value;
    renderChart();
  };
}

/* ------------------------------ 折线图 ------------------------------ */

function initChart() {
  if (chart) return;
  if (!window.echarts) {
    chartEl.innerHTML = '<p style="color:#b3859a">图表库加载失败，请检查网络（ECharts CDN）。</p>';
    return;
  }
  chart = window.echarts.init(chartEl);
  window.addEventListener('resize', () => chart && chart.resize());
}

function renderChart() {
  const d = state.data;
  if (!d) return;
  chartEl = chartEl || $('chart');
  initChart();
  if (!chart) return;

  const key = state.metric;
  const name = d.metricNames[key];

  const visibleVideos = filterVideos(d);
  const dayKey = state.day;

  const tSet = new Set();
  for (const v of visibleVideos) for (const p of v.history) {
    if (dayKey !== 'all' && fmtDay(p.t) !== dayKey) continue;
    tSet.add(p.t);
  }
  const times = [...tSet].sort((a, b) => a - b);

  const seriesData = visibleVideos.map((v) => {
    const map = new Map();
    const hist = [...(v.history || [])]
      .filter((p) => dayKey === 'all' || fmtDay(p.t) === dayKey)
      .sort((a, b) => (a.t || 0) - (b.t || 0));
    let prev = null;
    for (const p of hist) {
      const delta = prev ? (Number(p[key]) || 0) - (Number(prev[key]) || 0) : 0;
      map.set(p.t, delta);
      prev = p;
    }
    return { title: v.title, bvid: v.bvid, map };
  });

  const lines = seriesData.map((s) => ({
    name: truncate(s.title, 25),
    type: 'line',
    symbol: 'none',
    lineStyle: { width: 1, opacity: 0.75 },
    emphasis: { focus: 'series' },
    data: times.map((t) => (s.map.has(t) ? s.map.get(t) : null)),
  }));

  const allDeltas = [];
  for (const s of seriesData) for (const v of s.map.values()) {
    if (v !== null && v !== undefined) allDeltas.push(v);
  }
  const avg = allDeltas.length
    ? Math.round(allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length)
    : 0;
  if (lines.length) {
    lines[0].markLine = {
      symbol: 'none',
      z: 100,
      lineStyle: { color: 'rgba(236,72,153,0.75)', type: 'dashed', width: 1.5 },
      label: { formatter: '日均 ' + fmt(avg), color: 'rgba(236,72,153,0.95)', position: 'start', fontWeight: 'bold' },
      data: [{ yAxis: avg }],
    };
  }

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: axisTooltip,
    },
    legend: {
      type: 'plain',
      bottom: 0,
      textStyle: { color: '#b3859a', fontSize: 11 },
      pageTextStyle: { color: '#b3859a' },
    },
    grid: { left: 70, right: 30, top: 40, bottom: 80 },
    xAxis: {
      type: 'category',
      data: times.map((t) => fmtTime(t)),
      axisLine: { lineStyle: { color: 'rgba(90,58,75,.15)' } },
      axisLabel: { color: '#b3859a' },
    },
    yAxis: {
      type: 'value',
      name: name + '涨幅',
      nameTextStyle: { color: '#b3859a' },
      axisLabel: { color: '#b3859a' },
      splitLine: { lineStyle: { color: 'rgba(90,58,75,.08)' } },
    },
    series: lines,
  };
  chart.setOption(option, true);
}

/* ------------------------------ 明细表格 ------------------------------ */

function filterVideos(d) {
  const keywords = state.keyword
    .split(/[,，]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!keywords.length) return d.videos;
  return d.videos.filter((v) => {
    const title = v.title.toLowerCase();
    const bvid = v.bvid.toLowerCase();
    return keywords.some((k) => title.includes(k) || bvid.includes(k));
  });
}

function videoStat(v, key) {
  const h = v.history || [];
  if (!h.length) return { cur: 0, delta: 0, total: 0 };
  const cur = h[h.length - 1][key] || 0;
  const prev = h.length > 1 ? h[h.length - 2][key] || 0 : 0;
  const base = h[0][key] || 0;
  return { cur, delta: cur - prev, total: cur - base };
}

function renderTable() {
  const d = state.data;
  const thead = document.querySelector('#table thead');
  const tbody = document.querySelector('#table tbody');

  thead.innerHTML = `
    <tr>
      <th class="title-col">标题</th>
      ${d.metrics
        .map((k) => {
          const active = state.sortKey === k;
          const arrow = active ? (state.sortDesc ? ' ▼' : ' ▲') : '';
          return `<th class="sortable${active ? ' active' : ''}" data-sort="${k}" title="点击按${d.metricNames[k]}排序">${d.metricNames[k]}${arrow}</th>`;
        })
        .join('')}
    </tr>
  `;

  const list = filterVideos(d);
  let visible = list;
  if (state.sortKey) {
    const key = state.sortKey;
    visible = visible.slice().sort((a, b) => {
      const va = videoStat(a, key).cur;
      const vb = videoStat(b, key).cur;
      return state.sortDesc ? vb - va : va - vb;
    });
  }

  tbody.innerHTML = '';
  for (const v of visible) {
    const tr = document.createElement('tr');
    let cells = `
      <td class="title-cell">
        <div title="${escapeHtml(v.title)}">${escapeHtml(truncate(v.title, 20))}</div>
        <div class="bv">${v.bvid}${v.owner ? ' · UP主：' + escapeHtml(v.owner) : ''}</div>
      </td>`;
    for (const key of d.metrics) {
      const s = videoStat(v, key);
      cells += `
        <td>
          <div>${fmt(s.cur)}</div>
          <div class="delta ${deltaClass(s.delta)}">${fmtDelta(s.delta)}</div>
        </td>`;
    }
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  }

  thead.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = () => {
      const k = th.getAttribute('data-sort');
      if (state.sortKey === k) {
        state.sortDesc = !state.sortDesc;
      } else {
        state.sortKey = k;
        state.sortDesc = true;
      }
      renderTable();
    };
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function axisTooltip(params) {
  const raw = Array.isArray(params) ? params : [params];
  const p = raw
    .filter((it) => it.value !== null && it.value !== undefined && it.value !== '')
    .slice()
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  if (!p.length) return '';
  let html = '<div style="margin-bottom:4px;font-weight:600">' + p[0].axisValue + '</div>';
  for (const item of p) {
    html +=
      '<div style="display:flex;justify-content:space-between;gap:16px;min-width:200px">' +
      '<span>' + item.marker + escapeHtml(item.seriesName) + '</span>' +
      '<span style="text-align:right;font-variant-numeric:tabular-nums">' + fmt(item.value) + '</span>' +
      '</div>';
  }
  return html;
}

/* ------------------------------ 渲染入口 ------------------------------ */

function render() {
  updateStatus();
  renderCards();
  renderTabs();
  renderDayFilters();
  renderChart();
  renderTable();
}

/* ------------------------------ 事件 ------------------------------ */

const refreshBtn = document.getElementById('btnRefresh');
if (refreshBtn) refreshBtn.onclick = fetchData;
const searchEl = $('search');
if (searchEl) searchEl.oninput = (e) => {
  state.keyword = e.target.value;
  renderTable();
  renderChart();
};

fetchData();
setInterval(fetchData, 60000); // 数据 30 分钟采集一次，60 秒轮询即可
