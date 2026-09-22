'use strict';

const state = {
  data: null,
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
const MEDALS = ['🥇', '🥈', '🥉'];
const AXIS_LABELS = ['0w', '20w', '40w', '60w', '80w', '100w'];

function renderProgress() {
  const d = state.data;
  const wrap = $('progress');
  if (!wrap) return;
  wrap.innerHTML = '';

  const videos = (d.videos || [])
    .slice()
    .sort((a, b) => (Number(videoStat(b, 'view').cur) || 0) - (Number(videoStat(a, 'view').cur) || 0))
    .slice(0, 8);

  videos.forEach((v, i) => {
    const cur = Number(videoStat(v, 'view').cur) || 0;
    const pct = Math.max(0, Math.min(100, (cur / PROGRESS_TARGET) * 100));
    const pctText = Number(pct.toFixed(2));
    const markerLeft = Math.min(97, Math.max(3, pct));

    const badge = i < MEDALS.length
      ? `<span class="medal">${MEDALS[i]}</span>`
      : `<span class="medal rank">${i + 1}</span>`;

    const seps = Array.from({ length: 9 }, (_, k) =>
      `<span class="psep" style="left:${(k + 1) * 10}%"></span>`
    ).join('');

    const card = document.createElement('div');
    card.className = 'vcard' + (i < 3 ? ' top3' : '');
    card.innerHTML = `
      <div class="vhead">
        ${badge}
        <span class="vtitle" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
      </div>
      <div class="vmeta">
        <span class="bvtag">${escapeHtml(v.bvid)}</span>
        ${v.owner ? `<span class="vowner">UP主：${escapeHtml(v.owner)}</span>` : ''}
      </div>
      <div class="vstats">
        <div class="vstat">
          <div class="vstat-label">当前播放</div>
          <div class="vstat-value">${fmt(cur)}</div>
        </div>
        <div class="vstat">
          <div class="vstat-label">冲刺进度</div>
          <div class="vstat-value">${pctText}%</div>
        </div>
      </div>
      <div class="pbar">
        <div class="pmarker-row"><span class="pmarker" style="left:${markerLeft}%">🐰</span></div>
        <div class="ptrack">
          <div class="pfill" style="width:${pct}%"></div>
          ${seps}
        </div>
        <div class="paxis">${AXIS_LABELS.map((t) => `<span>${t}</span>`).join('')}</div>
      </div>
    `;
    wrap.appendChild(card);
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
}

/* ------------------------------ 事件 ------------------------------ */

const refreshBtn = document.getElementById('btnRefresh');
if (refreshBtn) refreshBtn.onclick = fetchData;

fetchData();
setInterval(fetchData, 60000); // 数据 30 分钟采集一次，60 秒轮询即可
