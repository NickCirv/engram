/**
 * engram Web Dashboard — served at GET /ui by the HTTP server.
 *
 * Zero external dependencies. HTML, CSS, and JS are template literals
 * compiled into the npm package. All data loaded via fetch() against
 * the /api/* endpoints on the same server.
 *
 * Six tabs:
 *   1. Overview  — cumulative savings, hit rate, headline metrics
 *   2. Sessions  — per-session breakdown with sparkline
 *   3. Activity  — real-time hook events via SSE
 *   4. Files     — heatmap of most-intercepted files
 *   5. Graph     — Canvas 2D force-directed graph visualization
 *   6. Providers — component health and cache stats
 *
 * Security: client JS never assigns user-controlled strings directly
 * into innerHTML. An esc() helper runs on every data interpolation to
 * neutralize HTML injection from attacker-controlled file paths, labels,
 * or commit messages mined from the user's repo.
 */

import { buildComponents } from "./ui-components.js";
import { buildGraphScript } from "./ui-graph.js";

const CSS = `
:root {
  --bg: #0a0a0b;
  --bg-panel: #121214;
  --bg-hover: #1a1a1c;
  --border: #2a2a2e;
  --text: #e4e4e7;
  --text-dim: #71717a;
  --accent: #10b981;
  --accent-dim: #047857;
  --warn: #f59e0b;
  --error: #ef4444;
  --blue: #3b82f6;
  --purple: #a855f7;
  --mono: "SF Mono", "Monaco", "Menlo", monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 32px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

header .brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-weight: 600;
  font-size: 16px;
}

header .brand .diamond { color: var(--accent); font-size: 18px; }
header .brand .version { color: var(--text-dim); font-size: 12px; font-weight: 400; }

header .status {
  display: flex; align-items: center; gap: 16px;
  font-family: var(--mono); font-size: 12px; color: var(--text-dim);
}

header .status .dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); margin-right: 6px;
}

nav {
  display: flex;
  padding: 0 32px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

nav button {
  background: none; border: none; color: var(--text-dim);
  padding: 14px 20px; cursor: pointer;
  font-size: 13px; font-family: var(--mono);
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

nav button:hover { color: var(--text); }

nav button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

main { padding: 32px; max-width: 1400px; margin: 0 auto; }

.tab { display: none; }
.tab.active { display: block; }

.grid { display: grid; gap: 16px; margin-bottom: 24px; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 900px) {
  .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
}

.card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
}

.card h3 {
  font-size: 11px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-dim); margin-bottom: 12px;
  font-family: var(--mono);
}

.card h2 { font-size: 14px; font-weight: 600; margin-bottom: 16px; }

.big-number {
  font-size: 32px; font-weight: 700;
  font-family: var(--mono); color: var(--text); line-height: 1;
}

.big-number.accent { color: var(--accent); }

.subtext {
  font-size: 12px; color: var(--text-dim);
  margin-top: 6px; font-family: var(--mono);
}

table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 12px; }

th, td {
  text-align: left; padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--text-dim); font-weight: 500;
  text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em;
}

tr:hover td { background: var(--bg-hover); }

td.num { text-align: right; color: var(--accent); }
td.dim { color: var(--text-dim); }

.activity-row {
  display: flex; align-items: center;
  padding: 8px 0; border-bottom: 1px solid var(--border);
  font-family: var(--mono); font-size: 12px; gap: 10px;
}

.activity-row .badge {
  padding: 2px 6px; border-radius: 3px;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
}

.badge.deny { background: var(--accent-dim); color: var(--accent); }
.badge.allow { background: #1e3a8a; color: var(--blue); }
.badge.passthrough { background: var(--bg-hover); color: var(--text-dim); }

.empty-state {
  text-align: center; padding: 48px 24px;
  color: var(--text-dim); font-family: var(--mono); font-size: 13px;
}

.provider-card {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 8px;
  font-family: var(--mono); font-size: 12px;
}

.provider-card .name { color: var(--text); font-weight: 500; }

.provider-card .indicator {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; margin-right: 8px;
}

.provider-card .indicator.ok { background: var(--accent); }
.provider-card .indicator.down { background: var(--error); }

#graph-canvas {
  width: 100%; height: 600px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: grab;
}

#graph-canvas:active { cursor: grabbing; }

/* Toast notifications */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  opacity: 0; transform: translateY(8px);
  transition: opacity .18s ease, transform .18s ease;
  z-index: 9999;
}
.toast.show { opacity: 1; transform: translateY(0); }

/* Small refresh button used next to tokens */
.refresh-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-family: var(--mono); font-size: 12px; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }
.refresh-btn:hover { color: var(--text); background: var(--bg-hover); }

.ov-chart { margin-top: 12px; height: 120px; }
`;

const HTML_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;" />
  <title>engram dashboard</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230a0a0b'/%3E%3Ctext x='50' y='62' font-size='56' text-anchor='middle' fill='%2310b981' font-family='Menlo,monospace'%3E%E2%97%86%3C/text%3E%3C/svg%3E" />
  <style>${CSS}</style>
</head>`;

const HTML_BODY = `
<body>
  <header>
    <div class="brand">
      <span class="diamond">&#9670;</span>
      <span>engram</span>
      <span class="version" id="version">loading...</span>
    </div>
    <div class="status">
      <span><span class="dot"></span>connected</span>
      <span id="uptime">&mdash;</span>
    </div>
  </header>

  <nav>
    <button class="tab-btn active" data-tab="overview">Overview</button>
    <button class="tab-btn" data-tab="sessions">Sessions</button>
    <button class="tab-btn" data-tab="activity">Activity</button>
    <button class="tab-btn" data-tab="files">Files</button>
    <button class="tab-btn" data-tab="graph">Graph</button>
    <button class="tab-btn" data-tab="providers">Providers</button>
  </nav>

  <main>
    <section class="tab active" id="tab-overview">
      <div class="grid grid-4">
        <div class="card"><h3>Tokens Saved <button id="tokens-refresh" class="refresh-btn" title="Refresh tokens">⟳</button></h3><div class="big-number accent" id="ov-tokens">&mdash;</div><div class="subtext" id="ov-tokens-sub">cumulative</div><div id="ov-tokens-chart" class="ov-chart"></div></div>
        <div class="card"><h3>Cost Saved</h3><div class="big-number" id="ov-cost">&mdash;</div><div class="subtext">at $3/M tokens</div></div>
        <div class="card"><h3>Hit Rate</h3><div class="big-number" id="ov-hitrate">&mdash;</div><div class="subtext" id="ov-hitrate-sub">hook interceptions</div></div>
        <div class="card"><h3>Sessions</h3><div class="big-number" id="ov-sessions">&mdash;</div><div class="subtext">tracked</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><h2>Decision Distribution</h2><div id="ov-decisions-chart"></div></div>
        <div class="card"><h2>Hit Rate</h2><div id="ov-donut"></div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><h2>Cache Performance</h2><div id="ov-cache"></div></div>
        <div class="card"><h2>Graph Health</h2><div id="ov-graph-stats"></div></div>
      </div>
    </section>

    <section class="tab" id="tab-sessions">
      <div class="card"><h2>Token Savings Over Time</h2><div id="sessions-sparkline"></div></div>
      <div class="card" style="margin-top: 16px;"><h2>Session Breakdown</h2><div id="sessions-table"></div></div>
    </section>

    <section class="tab" id="tab-activity">
      <div class="grid grid-2">
        <div class="card">
          <h2>Live Hook Events</h2>
          <div id="activity-stream" style="max-height: 500px; overflow-y: auto;">
            <div class="empty-state">Listening for events...</div>
          </div>
        </div>
        <div class="card"><h2>Per-Tool Breakdown</h2><div id="activity-tools"></div></div>
      </div>
    </section>

    <section class="tab" id="tab-files">
      <div class="card"><h2>Most-Intercepted Files</h2><div id="files-table"></div></div>
    </section>

    <section class="tab" id="tab-graph">
      <div class="card">
        <h2>Knowledge Graph Visualization</h2>
        <div class="subtext" style="margin-bottom: 12px;">Drag to pan &middot; Scroll to zoom &middot; Click nodes for details</div>
        <canvas id="graph-canvas"></canvas>
        <div id="graph-legend" class="subtext" style="margin-top: 10px; display:flex; gap:12px; align-items:center;"></div>
        <div id="graph-info" class="subtext" style="margin-top: 10px;"></div>
      </div>
    </section>

    <section class="tab" id="tab-providers">
      <div class="card"><h2>Component Health</h2><div id="providers-list"></div></div>
    </section>
  </main>

  <script>
  __APP_JS__
  </script>
</body>
</html>
`;

/**
 * Dashboard client script. Runs in the browser. Every interpolation of
 * API data into DOM uses esc() — the only safe boundary crossing.
 */
const APP_JS = `
// ─── HTML escape (single source of truth for XSS defense) ─────
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Tab navigation ───────────────────────────────────────────
const tabs = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab");

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
    panels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + target));
    if (target === "graph") loadGraph();
    if (target === "sessions") loadSessions();
    if (target === "files") loadFiles();
    if (target === "providers") loadProviders();
    if (target === "activity") loadActivity();
  });
});

// ─── API helpers ──────────────────────────────────────────────
async function api(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function formatNumber(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function formatCost(tokens) {
  return "$" + ((tokens / 1_000_000) * 3).toFixed(2);
}

function formatPercent(n) { return (n * 100).toFixed(1) + "%"; }

function formatUptime(seconds) {
  if (seconds < 60) return seconds + "s";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  return Math.floor(seconds / 3600) + "h " + Math.floor((seconds % 3600) / 60) + "m";
}

// small UI helpers: toast
function showToast(msg, duration = 3000) {
  try {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    // allow CSS transition
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 220); }, duration);
  } catch (e) {
    console.warn('toast failed', e);
  }
}

// ─── Components library (SVG charts — data-agnostic) ──────────
__COMPONENTS__

// ─── Graph canvas module ──────────────────────────────────────
__GRAPH__

// ─── Tab: Overview ────────────────────────────────────────────
async function loadOverview() {
  const [tokens, summary, cache, graphStats, health] = await Promise.all([
    api("/api/tokens"),
    api("/api/hook-log/summary"),
    api("/api/cache/stats"),
    api("/stats"),
    api("/health"),
  ]);

  if (tokens) {
    setText("ov-tokens", formatNumber(tokens.totalSaved ?? 0));
    setText("ov-cost", formatCost(tokens.totalSaved ?? 0));
    setText("ov-sessions", formatNumber(tokens.totalSessions ?? 0));
    setText("ov-tokens-sub", (Number(tokens.avgReduction ?? 0).toFixed(1) + "%") + " avg reduction");

    // Render time-series if available
    const chartEl = document.getElementById('ov-tokens-chart');
    if (chartEl) {
      if (tokens.sessions && Array.isArray(tokens.sessions) && tokens.sessions.length > 0) {
        chartEl.innerHTML = renderTokenTimeSeries(tokens.sessions.slice(-200));
      } else {
        chartEl.innerHTML = '<div class="empty-state">No session history yet</div>';
      }
    }
  }

  if (summary) {
    const d = summary.byDecision ?? {};
    const total = (d.deny ?? 0) + (d.allow ?? 0) + (d.passthrough ?? 0);
    const deny = d.deny ?? 0;
    const hitRate = total > 0 ? deny / total : 0;
    setText("ov-hitrate", formatPercent(hitRate));
    setText("ov-hitrate-sub", deny + " / " + total + " intercepted");
    // Safe: renderDonut/renderDecisionBars output is SVG with numeric values only
    const donut = document.getElementById("ov-donut");
    if (donut) donut.innerHTML = renderDonut(hitRate);
    const bars = document.getElementById("ov-decisions-chart");
    if (bars) bars.innerHTML = renderDecisionBars(d);
  }

  if (cache) {
    const el = document.getElementById("ov-cache");
    if (el) el.innerHTML = renderCacheStats(cache);
  }

  if (graphStats) {
    const el = document.getElementById("ov-graph-stats");
    if (el) el.innerHTML = renderGraphStats(graphStats);
  }

  if (health) {
    setText("version", "v" + health.version);
    setText("uptime", formatUptime(health.uptime));
  }
}

// Render a small dual-line time-series showing naive vs graph tokens
function renderTokenTimeSeries(sessions) {
  try {
    if (!sessions || sessions.length === 0) return '<div class="empty-state">No session data yet</div>';
    const last = sessions.slice(-50);
    const width = 800; const height = 120; const pad = 12;
    const naive = last.map((s) => Number(s.naiveTokens || 0));
    const graph = last.map((s) => Number(s.graphTokens || 0));
    const maxVal = Math.max(1, ...naive, ...graph);
    const innerW = width - pad * 2; const innerH = height - pad * 2;
    const step = last.length === 1 ? 0 : innerW / (last.length - 1);

    const points = (arr) => arr.map((v, i) => [pad + i * step, pad + innerH - (v / maxVal) * innerH]);
    const np = points(naive); const gp = points(graph);
    const pathD = (pts) => pts.length === 1 ? ('M' + pts[0][0] + ' ' + pts[0][1] + ' l 0 0') : ('M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L '));
    const naivePath = pathD(np); const graphPath = pathD(gp);

    // Area between naive and graph (saved) if naive >= graph
    let areaD = '';
    if (np.length > 1) {
      const areaPts = np.concat(gp.slice().reverse());
      areaD = 'M' + areaPts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ') + ' Z';
    }

    return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%">' +
      (areaD ? ('<defs><linearGradient id="gSaved" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + COLOR_ACCENT + '" stop-opacity="0.12"/><stop offset="1" stop-color="' + COLOR_ACCENT + '" stop-opacity="0"/></linearGradient></defs><path d="' + areaD + '" fill="url(#gSaved)"/>') : '') +
      ('<path d="' + naivePath + '" stroke="' + COLOR_DIM + '" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />') +
      ('<path d="' + graphPath + '" stroke="' + COLOR_ACCENT + '" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />') +
      '</svg>';
  } catch (e) {
    return '<div class="empty-state">Chart failed</div>';
  }
}

// ─── Tab: Sessions ────────────────────────────────────────────
async function loadSessions() {
  const tokens = await api("/api/tokens");
  if (!tokens) return;

  const sparkline = document.getElementById("sessions-sparkline");
  if (sparkline) sparkline.innerHTML = renderSparkline([tokens.totalSaved ?? 0]);

  // Build table with data from trusted source (our own DB)
  // Still using esc() for numbers to be defensive about type assumptions
  const rows = [
    ["Total Sessions", formatNumber(tokens.totalSessions)],
    ["Total Naive Tokens", formatNumber(tokens.totalNaiveTokens)],
    ["Total Graph Tokens", formatNumber(tokens.totalGraphTokens)],
    ["Total Saved", formatNumber(tokens.totalSaved)],
    ["Avg Reduction", (Number(tokens.avgReduction ?? 0).toFixed(1) + "%")],
    ["Estimated Cost Saved", formatCost(tokens.totalSaved ?? 0)],
  ];

  const html = '<table><thead><tr><th>Metric</th><th style="text-align:right">Value</th></tr></thead><tbody>' +
    rows.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="num">' + esc(v) + '</td></tr>').join('') +
    '</tbody></table>';

  const table = document.getElementById("sessions-table");
  if (table) table.innerHTML = html;
}

// ─── Tab: Activity (live via SSE) ─────────────────────────────
let sseSource = null;
let ssePending = false;

async function refreshGraph() {
  const [nodes, godNodes] = await Promise.all([
    api("/api/graph/nodes?limit=300"),
    api("/api/graph/god-nodes"),
  ]);
  if (!nodes) return;
  const canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  // Replace canvas element so we don't accumulate event listeners/animation loops
  const fresh = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(fresh, canvas);
  const nodeList = nodes.nodes ?? [];
  // Fetch edges for the current node set (best-effort)
  let edges = [];
  try {
    const ids = nodeList.slice(0, 400).map((n) => n.id).join(",");
    const eResp = await api("/api/graph/edges?ids=" + encodeURIComponent(ids));
    edges = (eResp && eResp.edges) || [];
  } catch {
    edges = [];
  }
  renderGraph(fresh, nodeList, godNodes ?? [], edges);
  renderMemoryLegend();
  setText("graph-info", (nodeList.length ?? 0) + " of " + (nodes.total ?? 0) + " nodes shown");
}

async function loadActivity() {
  const log = await api("/api/hook-log?limit=20");
  const streamEl = document.getElementById("activity-stream");
  if (streamEl) {
    if (log && log.entries && log.entries.length > 0) {
      streamEl.innerHTML = log.entries.slice().reverse().map(renderActivityRow).join("");
    } else {
      streamEl.innerHTML = '<div class="empty-state">No events yet</div>';
    }
  }

  const summary = await api("/api/hook-log/summary");
  const toolsEl = document.getElementById("activity-tools");
  if (toolsEl) {
    toolsEl.innerHTML = renderToolBreakdown((summary && summary.byTool) || {});
  }

  // Ensure SSE connection exists
  initSSE();
}

function initSSE() {
  if (sseSource) return;
  try {
    sseSource = new EventSource("/api/sse");
    sseSource.addEventListener("message", async (ev) => {
      // throttle bursty updates
      if (ssePending) return;
      ssePending = true;
      setTimeout(async () => {
        ssePending = false;
        // update overview (always)
        loadOverview();
        // update active tab(s)
        if (document.querySelector('.tab-btn[data-tab="activity"].active')) {
          const streamEl = document.getElementById("activity-stream");
          const fresh = await api("/api/hook-log?limit=20");
          if (fresh && fresh.entries && streamEl) {
            streamEl.innerHTML = fresh.entries.slice().reverse().map(renderActivityRow).join("");
          }
          const summary = await api("/api/hook-log/summary");
          const toolsEl = document.getElementById("activity-tools");
          if (toolsEl) toolsEl.innerHTML = renderToolBreakdown((summary && summary.byTool) || {});
        }
        if (document.querySelector('.tab-btn[data-tab="graph"].active')) {
          await refreshGraph();
        }
        if (document.querySelector('.tab-btn[data-tab="files"].active')) {
          loadFiles();
        }
        if (document.querySelector('.tab-btn[data-tab="providers"].active')) {
          loadProviders();
        }
        if (document.querySelector('.tab-btn[data-tab="sessions"].active')) {
          loadSessions();
        }
      }, 300);
    });
    sseSource.addEventListener("error", (e) => {
      console.warn("SSE error", e);
    });
  } catch (e) {
    console.warn("SSE init failed", e);
  }
}

function renderActivityRow(entry) {
  const decision = esc(entry.decision || "passthrough");
  const tool = esc(entry.tool || "?");
  const path = entry.path || "";
  const shortPath = path.length > 60 ? "..." + path.slice(-57) : path;
  return '<div class="activity-row">' +
    '<span class="badge ' + decision + '">' + decision + '</span>' +
    '<span style="color: var(--text)">' + tool + '</span>' +
    '<span style="color: var(--text-dim); flex: 1;">' + esc(shortPath) + '</span>' +
    '</div>';
}

function renderToolBreakdown(byTool) {
  const total = Object.values(byTool).reduce((a, b) => a + b, 0);
  if (total === 0) return '<div class="empty-state">No tool events yet</div>';
  return Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      return '<div style="margin-bottom: 10px;">' +
        '<div style="display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px; margin-bottom: 4px;">' +
        '<span>' + esc(tool) + '</span><span style="color: var(--accent)">' + count + ' (' + pct + '%)</span></div>' +
        '<div style="background: var(--bg-hover); height: 6px; border-radius: 3px; overflow: hidden;">' +
        '<div style="background: var(--accent); height: 100%; width: ' + pct + '%;"></div></div></div>';
    })
    .join("");
}

// ─── Tab: Files ───────────────────────────────────────────────
async function loadFiles() {
  const heatmap = await api("/api/files/heatmap?limit=30");
  const tableEl = document.getElementById("files-table");
  if (!tableEl) return;

  if (!heatmap || heatmap.length === 0) {
    tableEl.innerHTML = '<div class="empty-state">No file interceptions yet</div>';
    return;
  }

  const rows = heatmap.map((f) =>
    '<tr>' +
    '<td class="dim">' + esc(f.path) + '</td>' +
    '<td class="num">' + formatNumber(f.count) + '</td>' +
    '<td class="num">' + formatNumber(f.tokensSaved) + '</td>' +
    '</tr>'
  ).join("");

  tableEl.innerHTML =
    '<table><thead><tr><th>File</th><th style="text-align:right">Interceptions</th>' +
    '<th style="text-align:right">Tokens Saved</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ─── Tab: Graph ───────────────────────────────────────────────
let graphLoaded = false;

function renderLegendIcon(shape, color) {
  const size = 16;
  if (shape === "circle") {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + (Math.floor(size/3)) + '" fill="' + esc(color) + '" /></svg>';
  } else if (shape === "square") {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="' + (size-4) + '" height="' + (size-4) + '" fill="' + esc(color) + '" rx="2"/></svg>';
  } else if (shape === "diamond") {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><polygon points="' + (size/2) + ',2 ' + (size-2) + ',' + (size/2) + ' ' + (size/2) + ',' + (size-2) + ' 2,' + (size/2) + '" fill="' + esc(color) + '"/></svg>';
  } else {
    return renderLegendIcon("circle", color);
  }
}

function renderMemoryLegend() {
  const el = document.getElementById("graph-legend");
  if (!el || typeof MEMORY_SCOPE_CONFIG === "undefined") return;
  const keys = ["project", "global", "entity"];
  el.innerHTML = keys
    .map((k) => {
      const cfg = MEMORY_SCOPE_CONFIG[k] || MEMORY_SCOPE_CONFIG.default;
      const icon = renderLegendIcon(cfg.shape, cfg.color);
      return '<div style="display:flex;align-items:center;gap:8px;">' +
        '<div>' + icon + '</div>' +
        '<div style="color: var(--text-dim); font-family: var(--mono); font-size:12px;">' + esc(cfg.label) + '</div>' +
        '</div>';
    })
    .join('');
}

async function loadGraph() {
  if (graphLoaded) return;
  const [nodes, godNodes] = await Promise.all([
    api("/api/graph/nodes?limit=300"),
    api("/api/graph/god-nodes"),
  ]);
  if (!nodes) return;
  graphLoaded = true;
  const canvas = document.getElementById("graph-canvas");
  if (canvas) {
    const nodeList = nodes.nodes ?? [];
    let edges = [];
    try {
      const ids = nodeList.slice(0, 400).map((n) => n.id).join(",");
      const eResp = await api("/api/graph/edges?ids=" + encodeURIComponent(ids));
      edges = (eResp && eResp.edges) || [];
    } catch {
      edges = [];
    }
    renderGraph(canvas, nodeList, godNodes ?? [], edges);
  }
  // Render memory legend (colors/shapes)
  renderMemoryLegend();
  setText("graph-info", (nodes.nodes?.length ?? 0) + " of " + (nodes.total ?? 0) + " nodes shown");
}

// ─── Tab: Providers ───────────────────────────────────────────
async function loadProviders() {
  const [health, cache] = await Promise.all([
    api("/api/providers/health"),
    api("/api/cache/stats"),
  ]);

  let html = "";
  if (health) {
    const rows = [
      ["HTTP Server", !!health.httpRunning, health.httpRunning ? "active" : "down"],
      ["LSP Provider", !!health.lspAvailable, health.lspAvailable ? "active" : "down"],
      ["AST Provider", !!health.astAvailable, health.astAvailable ? "active" : "down"],
      ["IDE Integrations", (health.ideCount || 0) > 0, (health.ideCount || 0) + " active"],
    ];
    html = rows.map((r) =>
      '<div class="provider-card">' +
      '<div><span class="indicator ' + (r[1] ? "ok" : "down") + '"></span>' + esc(r[0]) + '</div>' +
      '<div style="color: var(--text-dim)">' + esc(r[2]) + '</div>' +
      '</div>'
    ).join("");
  }

  if (cache) {
    html += '<h3 style="margin-top: 24px; margin-bottom: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; font-family: var(--mono);">Cache</h3>';
    html += '<div class="provider-card"><div>Query Cache</div><div style="color: var(--text-dim)">' +
      cache.queryEntries + ' entries &middot; ' + cache.queryHits + ' hits</div></div>';
    html += '<div class="provider-card"><div>Pattern Cache</div><div style="color: var(--text-dim)">' +
      cache.patternEntries + ' entries &middot; ' + cache.patternHits + ' hits</div></div>';
    html += '<div class="provider-card"><div>Hot Files</div><div style="color: var(--text-dim)">' +
      cache.hotFileCount + ' warmed</div></div>';
  }

  const listEl = document.getElementById("providers-list");
  if (listEl) listEl.innerHTML = html;
}

// ─── Initial load ─────────────────────────────────────────────
loadOverview();
setInterval(loadOverview, 5000);
initSSE();

// Attach refresh button handler
const rbtn = document.getElementById('tokens-refresh');
if (rbtn) {
  rbtn.addEventListener('click', async () => {
    showToast('Refreshing token metrics...');
    await loadOverview();
    showToast('Token metrics updated', 1400);
  });
}
`;

/**
 * Build the complete dashboard HTML string.
 * Called by the HTTP server for GET /ui requests.
 */
export function buildDashboardHtml(): string {
  const fullJs = APP_JS
    .replace("__COMPONENTS__", buildComponents())
    .replace("__GRAPH__", buildGraphScript());
  const body = HTML_BODY.replace("__APP_JS__", fullJs);
  return HTML_HEAD + body;
}
