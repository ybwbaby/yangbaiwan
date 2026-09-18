'use strict';

const state = {
  data: null,
  keyword: '',
  sortKey: null,
  sortDesc: true,
};

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

/* ------------------------------ 播放进度 ------------------------------ */

const PROGRESS_TARGET = 1000000;

function renderProgress() {
  const d = state.data;
  const wrap = $('progress');
  if (!wrap) return;
  wrap.innerHTML = '';

  const videos = d.videos || [];
  for (const v of videos) {
    const cur = Number(videoStat(v, 'view').cur) || 0;
    const pct = Math.max(0, Math.min(100, (cur / PROGRESS_TARGET) * 100));
    const item = document.createElement('div');
    item.className = 'progress-item';
    item.innerHTML = `
      <div class="progress-info">
        <div class="progress-title" title="${escapeHtml(v.title)}">${escapeHtml(truncate(v.title, 20))}</div>
        <div class="progress-value">${fmt(cur)} / 1,000,000 · ${pct.toFixed(2)}%</div>
      </div>
      <div class="progress-track"><div class="progress-bar" style="width:${pct.toFixed(2)}%"></div></div>
    `;
    wrap.appendChild(item);
  }
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
          ${key === 'view' ? '' : `<div class="delta ${deltaClass(s.delta)}">${fmtDelta(s.delta)}</div>`}
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

/* ------------------------------ 渲染入口 ------------------------------ */

function render() {
  updateStatus();
  renderCards();
  renderProgress();
  renderTable();
}

/* ------------------------------ 事件 ------------------------------ */

const refreshBtn = document.getElementById('btnRefresh');
if (refreshBtn) refreshBtn.onclick = fetchData;
const searchEl = $('search');
if (searchEl) searchEl.oninput = (e) => {
  state.keyword = e.target.value;
  renderTable();
};

fetchData();
setInterval(fetchData, 60000); // 数据 30 分钟采集一次，60 秒轮询即可
