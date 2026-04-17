/**
 * SVG chart component library for the web dashboard.
 *
 * All components are pure functions that take numeric data (never strings)
 * and return safe SVG/HTML string markup. Zero external dependencies.
 *
 * Components exposed to the browser:
 *   renderDonut(ratio)                  — hit rate donut chart
 *   renderDecisionBars(byDecision)      — deny/allow/passthrough stacked bar
 *   renderSparkline(values)             — trend line
 *   renderCacheStats(stats)             — cache hit/miss breakdown
 *   renderGraphStats(stats)             — node/edge summary
 *
 * Design goal: each chart fits in ~150px height and looks legible at
 * both 400px and 800px container widths.
 */

/**
 * Returns a self-contained JS string defining all chart renderers.
 * Injected into the client app via template substitution.
 */
export function buildComponents(): string {
  return `
// Colors pulled from CSS custom properties via getComputedStyle would
// hit a FOUC at load — inline them to match the CSS :root values.
const COLOR_ACCENT = "#10b981";
const COLOR_ACCENT_DIM = "#047857";
const COLOR_BLUE = "#3b82f6";
const COLOR_PURPLE = "#a855f7";
const COLOR_DIM = "#71717a";
const COLOR_BG_HOVER = "#1a1a1c";

/**
 * Donut chart showing hit rate as a ratio (0-1).
 * Renders a SVG ring with the percentage centered.
 */
function renderDonut(ratio) {
  const safe = Math.max(0, Math.min(1, Number(ratio) || 0));
  const r = 60;
  const circumference = 2 * Math.PI * r;
  const dashArray = safe * circumference;
  const gapArray = circumference - dashArray;
  const pct = (safe * 100).toFixed(1);

  return '<svg viewBox="0 0 160 160" width="100%" style="max-width: 200px; display: block; margin: 0 auto;">' +
    '<circle cx="80" cy="80" r="' + r + '" fill="none" stroke="' + COLOR_BG_HOVER + '" stroke-width="14" />' +
    '<circle cx="80" cy="80" r="' + r + '" fill="none" stroke="' + COLOR_ACCENT + '" stroke-width="14" ' +
    'stroke-dasharray="' + dashArray.toFixed(2) + ' ' + gapArray.toFixed(2) + '" ' +
    'stroke-linecap="round" transform="rotate(-90 80 80)" />' +
    '<text x="80" y="80" text-anchor="middle" dominant-baseline="central" ' +
    'fill="' + COLOR_ACCENT + '" font-size="24" font-weight="700" ' +
    'font-family="SF Mono, Monaco, monospace">' + pct + '%</text>' +
    '<text x="80" y="105" text-anchor="middle" fill="' + COLOR_DIM + '" font-size="10" ' +
    'font-family="SF Mono, Monaco, monospace" letter-spacing="1">HIT RATE</text>' +
    '</svg>';
}

/**
 * Horizontal stacked bar showing decision distribution.
 * Input: { deny: number, allow: number, passthrough: number }
 */
function renderDecisionBars(byDecision) {
  const d = Number(byDecision.deny) || 0;
  const a = Number(byDecision.allow) || 0;
  const p = Number(byDecision.passthrough) || 0;
  const total = d + a + p;

  if (total === 0) {
    return '<div style="color: ' + COLOR_DIM + '; font-family: SF Mono, Monaco, monospace; font-size: 12px; text-align: center; padding: 24px;">No events yet</div>';
  }

  const dPct = (d / total) * 100;
  const aPct = (a / total) * 100;
  const pPct = (p / total) * 100;

  return '<div style="margin-bottom: 16px;">' +
    '<div style="display: flex; height: 32px; border-radius: 4px; overflow: hidden; background: ' + COLOR_BG_HOVER + ';">' +
    '<div style="background: ' + COLOR_ACCENT + '; width: ' + dPct + '%;" title="deny"></div>' +
    '<div style="background: ' + COLOR_BLUE + '; width: ' + aPct + '%;" title="allow"></div>' +
    '<div style="background: ' + COLOR_DIM + '; width: ' + pPct + '%;" title="passthrough"></div>' +
    '</div></div>' +
    '<div style="display: flex; justify-content: space-between; font-family: SF Mono, Monaco, monospace; font-size: 11px;">' +
    '<div><span style="display:inline-block; width:10px; height:10px; background:' + COLOR_ACCENT + '; border-radius:2px; vertical-align: middle; margin-right: 6px;"></span>deny <span style="color: ' + COLOR_DIM + '">' + d + '</span></div>' +
    '<div><span style="display:inline-block; width:10px; height:10px; background:' + COLOR_BLUE + '; border-radius:2px; vertical-align: middle; margin-right: 6px;"></span>allow <span style="color: ' + COLOR_DIM + '">' + a + '</span></div>' +
    '<div><span style="display:inline-block; width:10px; height:10px; background:' + COLOR_DIM + '; border-radius:2px; vertical-align: middle; margin-right: 6px;"></span>passthrough <span style="color: ' + COLOR_DIM + '">' + p + '</span></div>' +
    '</div>';
}

/**
 * Sparkline SVG path from numeric array. Handles single-point gracefully.
 */
function renderSparkline(values) {
  const nums = (values || []).map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) {
    return '<div style="color: ' + COLOR_DIM + '; font-family: SF Mono, Monaco, monospace; font-size: 12px; text-align: center; padding: 24px;">No data yet</div>';
  }

  const width = 800;
  const height = 120;
  const padding = 10;
  const max = Math.max(...nums, 1);
  const min = 0;
  const range = max - min;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = nums.length === 1
    ? [[width / 2, height / 2]]
    : nums.map((n, i) => {
        const x = padding + (i / (nums.length - 1)) * innerW;
        const y = padding + innerH - ((n - min) / range) * innerH;
        return [x, y];
      });

  const pathD = nums.length === 1
    ? 'M' + points[0][0] + ' ' + points[0][1] + ' l 0 0'
    : 'M' + points.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ');

  // Fill area under curve
  const fillD = nums.length === 1
    ? ''
    : pathD + ' L ' + points[points.length - 1][0].toFixed(1) + ' ' + (height - padding) +
      ' L ' + points[0][0].toFixed(1) + ' ' + (height - padding) + ' Z';

  return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" style="height: 120px;">' +
    (fillD ? '<path d="' + fillD + '" fill="' + COLOR_ACCENT + '" fill-opacity="0.1" />' : '') +
    '<path d="' + pathD + '" stroke="' + COLOR_ACCENT + '" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />' +
    points.map((p) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="' + COLOR_ACCENT + '" />').join('') +
    '</svg>';
}

/**
 * Cache performance block. Input shape from /api/cache/stats.
 * All values are numbers from our own DB — no escape needed.
 */
function renderCacheStats(stats) {
  const hitRate = Number(stats.hitRate) || 0;
  const total = (Number(stats.totalHits) || 0) + (Number(stats.totalMisses) || 0);
  const queryEntries = Number(stats.queryEntries) || 0;
  const patternEntries = Number(stats.patternEntries) || 0;
  const hotFiles = Number(stats.hotFileCount) || 0;

  return '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-family: SF Mono, Monaco, monospace; font-size: 12px;">' +
    '<div><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Hit Rate</div>' +
    '<div style="font-size: 20px; font-weight: 600; color: ' + COLOR_ACCENT + ';">' + (hitRate * 100).toFixed(1) + '%</div></div>' +
    '<div><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Total Ops</div>' +
    '<div style="font-size: 20px; font-weight: 600;">' + total + '</div></div>' +
    '<div><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Query Entries</div>' +
    '<div style="font-size: 20px; font-weight: 600;">' + queryEntries + '</div></div>' +
    '<div><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Pattern Entries</div>' +
    '<div style="font-size: 20px; font-weight: 600;">' + patternEntries + '</div></div>' +
    '<div style="grid-column: span 2;"><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Hot Files Warmed</div>' +
    '<div style="font-size: 20px; font-weight: 600;">' + hotFiles + '</div></div>' +
    '</div>';
}

/**
 * Graph stats block. Input from /stats endpoint.
 * All values numeric from our DB.
 */
function renderGraphStats(stats) {
  // The /stats API returns { nodes, edges, extractedPct, inferredPct, ambiguousPct, ... }
  const nodes = Number(stats.nodes ?? stats.nodeCount) || 0;
  const edges = Number(stats.edges ?? stats.edgeCount) || 0;
  const extracted = Number(stats.extractedPct) || 0;
  const inferred = Number(stats.inferredPct) || 0;
  const ambiguous = Number(stats.ambiguousPct) || 0;

  return '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-family: SF Mono, Monaco, monospace; font-size: 12px;">' +
    '<div><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Nodes</div>' +
    '<div style="font-size: 20px; font-weight: 600; color: ' + COLOR_BLUE + ';">' + nodes + '</div></div>' +
    '<div><div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Edges</div>' +
    '<div style="font-size: 20px; font-weight: 600; color: ' + COLOR_PURPLE + ';">' + edges + '</div></div>' +
    '<div style="grid-column: span 2; margin-top: 8px;">' +
    '<div style="color: ' + COLOR_DIM + '; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">Confidence Distribution</div>' +
    '<div style="display: flex; gap: 8px; font-size: 11px;">' +
    '<span>extracted: <b style="color: ' + COLOR_ACCENT + '">' + extracted + '%</b></span>' +
    '<span>inferred: <b style="color: ' + COLOR_BLUE + '">' + inferred + '%</b></span>' +
    '<span>ambiguous: <b style="color: ' + COLOR_PURPLE + '">' + ambiguous + '%</b></span>' +
    '</div></div>' +
    '</div>';
}
`;
}
