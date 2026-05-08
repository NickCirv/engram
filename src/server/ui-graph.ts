/**
 * Canvas 2D force-directed graph visualization for the dashboard.
 *
 * Lightweight alternative to D3/vis.js — ~180 lines of vanilla JS,
 * handles up to ~500 nodes at 60fps.
 *
 * Physics:
 *   - Pairwise repulsion (Coulomb-like) pushes unconnected nodes apart
 *   - Spring attraction along each edge pulls connected nodes together
 *   - Velocity damping provides settling behavior (no explicit cooling)
 *
 * Interaction:
 *   - Drag canvas to pan
 *   - Scroll to zoom (anchored on cursor)
 *   - Click a node to highlight (god nodes are pre-emphasized)
 */

export function buildGraphScript(): string {
  return `
// ─── Global graph stop handle (ensures re-rendering doesn't leak loops) ───
window.__engram_graph_stop = window.__engram_graph_stop || null;

// ─── Node color by kind (match the graph schema) ───────────────
const NODE_COLORS = {
  file: "#3b82f6",
  function: "#10b981",
  class: "#a855f7",
  concept: "#f59e0b",
  mistake: "#ef4444",
  decision: "#eab308",
  default: "#71717a",
};

// Memory scope mapping: color + shape + label. These represent the three
// memory types we care about: project, global, and personal/entity.
const MEMORY_SCOPE_CONFIG = {
  project: { color: "#3b82f6", shape: "circle", label: "Project" },
  global: { color: "#a855f7", shape: "diamond", label: "Global" },
  entity: { color: "#f59e0b", shape: "square", label: "Personal" },
  default: { color: "#71717a", shape: "circle", label: "Unknown" },
};

// Visual consolidation & distribution knobs
const TOTAL_VISUAL_BUDGET = 200;    // combined visual budget baseline (nodes + edges)
const NODE_PROP = 2 / 3;            // fraction of budget aimed at nodes
const EDGE_PROP = 1 - NODE_PROP;    // fraction for edges
const SCOPE_RATIOS = { project: 0.5, global: 0.25, entity: 0.25 };
const MINORITY_THRESHOLD = 0.05;    // scopes under 5% are treated as "minorities" and preserved

function pathShape(ctx, x, y, r, shape) {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "square") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  } else {
    // fallback to circle
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

/**
 * Main entry point. Given a canvas element and node/edge data from
 * /api/graph/nodes and /api/graph/god-nodes, starts the simulation.
 */
function renderGraph(canvas, nodes, godNodes, edges) {
  // Stop any previous running simulation to avoid animation/handler leaks
  if (typeof window.__engram_graph_stop === 'function') {
    try { window.__engram_graph_stop(); } catch {}
    window.__engram_graph_stop = null;
  }
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const W = rect.width;
  const H = rect.height;

  // God node IDs (for emphasis). godNodes shape: [{node, degree}]
  const godIds = new Set((godNodes || []).map((g) => g.node?.id).filter(Boolean));

  // Build simulation nodes with random starting positions near center.
  // Default memoryScope to 'project' when missing so code files show as
  // project-scope nodes by default.

  // Build a map of nodes (include placeholders for any edge endpoints
  // that the server didn't return). This ensures springs can be wired
  // even when the node list is paginated or truncated.
  const baseNodes = Array.isArray(nodes) ? nodes.slice() : [];
  const nodeMapAll = new Map();
  for (const n of baseNodes) nodeMapAll.set(n.id, n);

  // Compute degree map from provided edges so we can bias placement
  const degreeMap = new Map();
  if (Array.isArray(edges)) {
    for (const ed of edges) {
      degreeMap.set(ed.source, (degreeMap.get(ed.source) || 0) + 1);
      degreeMap.set(ed.target, (degreeMap.get(ed.target) || 0) + 1);
      if (!nodeMapAll.has(ed.source)) {
        nodeMapAll.set(ed.source, { id: ed.source, label: ed.source, kind: 'default', metadata: {} });
      }
      if (!nodeMapAll.has(ed.target)) {
        nodeMapAll.set(ed.target, { id: ed.target, label: ed.target, kind: 'default', metadata: {} });
      }
    }
  }

  // Consolidation helper: choose a subset of nodes/edges to render that
  // respects a global visual budget, scope distribution, and minority
  // preservation.
  function consolidateNodesAndEdges(allNodesArr, allEdgesArr, godIdsSet) {
    const totalAvailable = allNodesArr.length;
    const nodesBudget = Math.max(10, Math.floor(TOTAL_VISUAL_BUDGET * NODE_PROP));
    const edgesBudget = Math.max(5, TOTAL_VISUAL_BUDGET - nodesBudget);

    // If the data is already small, return fast
    if (totalAvailable <= nodesBudget) {
      const keptNodes = allNodesArr.slice();
      const keptNodeIds = new Set(keptNodes.map(n => n.id));
      let keptEdges = (Array.isArray(allEdgesArr) ? allEdgesArr.slice() : []).filter(e => keptNodeIds.has(e.source) && keptNodeIds.has(e.target));
      // score & trim edges if needed
      if (keptEdges.length > edgesBudget) {
        keptEdges.sort((a, b) => edgeScore(b) - edgeScore(a));
        keptEdges = keptEdges.slice(0, edgesBudget);
      }
      return { nodes: keptNodes, edges: keptEdges };
    }

    // Bucket nodes by memory scope
    const buckets = { project: [], global: [], entity: [] };
    for (const n of allNodesArr) {
      try {
        const meta = n.metadata || {};
        const ms = (meta.memoryScope || meta.memory_scope) || 'project';
        if (ms === 'global') buckets.global.push(n);
        else if (ms === 'entity' || ms === 'personal') buckets.entity.push(n);
        else buckets.project.push(n);
      } catch {
        buckets.project.push(n);
      }
    }

    // initial allocation by configured ratios
    const initialAlloc = {
      project: Math.floor(nodesBudget * SCOPE_RATIOS.project),
      global: Math.floor(nodesBudget * SCOPE_RATIOS.global),
      entity: Math.floor(nodesBudget * SCOPE_RATIOS.entity),
    };

    const minMinorityCount = Math.max(1, Math.floor(totalAvailable * MINORITY_THRESHOLD));

    const alloc = { project: 0, global: 0, entity: 0 };
    for (const k of Object.keys(initialAlloc)) {
      const avail = buckets[k].length;
      if (avail <= initialAlloc[k] || avail <= minMinorityCount) {
        alloc[k] = avail; // preserve small groups entirely
      } else {
        alloc[k] = initialAlloc[k];
      }
    }

    // Redistribute any remaining budget to scopes that still need nodes
    let remaining = nodesBudget - (alloc.project + alloc.global + alloc.entity);
    while (remaining > 0) {
      const needs = {
        project: Math.max(0, buckets.project.length - alloc.project),
        global: Math.max(0, buckets.global.length - alloc.global),
        entity: Math.max(0, buckets.entity.length - alloc.entity),
      };
      const totalNeed = needs.project + needs.global + needs.entity;
      if (totalNeed === 0) break;
      let assigned = 0;
      for (const k of ['project', 'global', 'entity']) {
        if (needs[k] <= 0) continue;
        const extra = Math.max(1, Math.floor(remaining * (needs[k] / totalNeed)));
        const give = Math.min(extra, needs[k]);
        alloc[k] += give;
        assigned += give;
      }
      if (assigned === 0) {
        // fallback: assign one-by-one round-robin
        for (const k of ['project', 'global', 'entity']) {
          if (alloc[k] < buckets[k].length && remaining > 0) { alloc[k]++; remaining--; }
        }
        break;
      }
      remaining -= assigned;
    }

    // Score function for nodes: prefer god nodes and higher degree
    function nodeScore(n) {
      const deg = degreeMap.get(n.id) || 0;
      const godBoost = godIdsSet && godIdsSet.has(n.id) ? 2000 : 0;
      return godBoost + deg;
    }

    // Pick top nodes per bucket by nodeScore
    const keptNodes = [];
    for (const k of ['project', 'global', 'entity']) {
      const arr = buckets[k].slice();
      arr.sort((a, b) => nodeScore(b) - nodeScore(a));
      const take = Math.min(arr.length, alloc[k]);
      for (let i = 0; i < take; i++) keptNodes.push(arr[i]);
    }

    // If we still have leftover slots (due to rounding), fill with highest-scoring remaining nodes
    if (keptNodes.length < nodesBudget) {
      const keptIds = new Set(keptNodes.map(n => n.id));
      const rem = allNodesArr.filter(n => !keptIds.has(n.id));
      rem.sort((a, b) => nodeScore(b) - nodeScore(a));
      for (let i = 0; i < Math.min(rem.length, nodesBudget - keptNodes.length); i++) keptNodes.push(rem[i]);
    }

    const keptNodeIds = new Set(keptNodes.map(n => n.id));

    // Edge score: prefer edges between high-degree nodes, god-involving edges, and keep minority-scope edges slightly boosted
    function edgeScore(e) {
      const sDeg = degreeMap.get(e.source) || 0;
      const tDeg = degreeMap.get(e.target) || 0;
      const godBoost = (godIdsSet && (godIdsSet.has(e.source) || godIdsSet.has(e.target))) ? 200 : 0;
      let scopeBoost = 0;
      try {
        const sScope = (nodeMapAll.get(e.source) && ((nodeMapAll.get(e.source).metadata && (nodeMapAll.get(e.source).metadata.memoryScope || nodeMapAll.get(e.source).metadata.memory_scope)))) || 'project';
        const tScope = (nodeMapAll.get(e.target) && ((nodeMapAll.get(e.target).metadata && (nodeMapAll.get(e.target).metadata.memoryScope || nodeMapAll.get(e.target).metadata.memory_scope)))) || 'project';
        const total = allNodesArr.length || 1;
        // If either endpoint belongs to a small/minority scope, slightly boost the edge
        if ((sScope === 'global' && buckets.global.length / total < MINORITY_THRESHOLD) ||
            (tScope === 'global' && buckets.global.length / total < MINORITY_THRESHOLD) ||
            (sScope === 'entity' && buckets.entity.length / total < MINORITY_THRESHOLD) ||
            (tScope === 'entity' && buckets.entity.length / total < MINORITY_THRESHOLD)) {
          scopeBoost = 20;
        }
      } catch (ex) {}
      return sDeg + tDeg + godBoost + scopeBoost;
    }

    // Collect candidate edges that connect kept nodes
    let keptEdges = (Array.isArray(allEdgesArr) ? allEdgesArr.slice() : []).filter(e => keptNodeIds.has(e.source) && keptNodeIds.has(e.target));
    if (keptEdges.length > edgesBudget) {
      keptEdges.sort((a, b) => edgeScore(b) - edgeScore(a));
      keptEdges = keptEdges.slice(0, edgesBudget);
    }

    return { nodes: keptNodes, edges: keptEdges };
  }

  // Use consolidation to produce the simulated subset (this keeps layout responsive)
  const combined = consolidateNodesAndEdges(Array.from(nodeMapAll.values()), Array.isArray(edges) ? edges : [], godIds);
  const candidateNodes = combined.nodes.slice(0, 600); // safety cap for layout

  // Cluster by project when multiple projectRoots are present (useful
  // for the 'global' memory-scope view where nodes come from many projects).
  const projectBuckets = new Map();
  for (const n of candidateNodes) {
    try {
      const root = (n.metadata && (n.metadata.projectRoot || n.metadata.project_root)) || "__no_project__";
      const arr = projectBuckets.get(root) || [];
      arr.push(n);
      projectBuckets.set(root, arr);
    } catch {
      const arr = projectBuckets.get("__no_project__") || [];
      arr.push(n);
      projectBuckets.set("__no_project__", arr);
    }
  }

  let sim = [];
  if (projectBuckets.size > 1) {
    // Place each project's cluster around a ring and distribute nodes
    // in that project's local neighborhood. Use the project's god node
    // as the cluster center when available.
    const roots = Array.from(projectBuckets.keys());
    const clusterRingRadius = Math.min(W, H) * 0.35;

    // Map god node id by projectRoot so we can center clusters on them
    const godByProject = new Map();
    (godNodes || []).forEach((g) => {
      try {
        const pr = (g.node && (g.node.metadata && (g.node.metadata.projectRoot || g.node.metadata.project_root))) || "__no_project__";
        if (g.node && g.node.id) godByProject.set(pr, g.node.id);
      } catch {}
    });

    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const nodesInCluster = projectBuckets.get(root) || [];
      const clusterAngle = (i / roots.length) * Math.PI * 2;
      const cx = W / 2 + Math.cos(clusterAngle) * clusterRingRadius;
      const cy = H / 2 + Math.sin(clusterAngle) * clusterRingRadius;
      // Sort by degree so hubs are placed closer to center
      nodesInCluster.sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0));
      const godIdForProject = godByProject.get(root);
      for (let j = 0; j < nodesInCluster.length; j++) {
        const n = nodesInCluster[j];
        const deg = degreeMap.get(n.id) || 0;
        const weight = Math.min(1, deg / Math.max(1, (Array.from(degreeMap.values()).reduce((s, v) => s + v, 0) / Math.max(1, degreeMap.size))));
        let x, y;
        if (godIdForProject && n.id === godIdForProject) {
          // Place god node at cluster center
          x = cx;
          y = cy;
        } else {
          const localR = Math.max(10, (1 - weight) * 120 * (0.4 + Math.random() * 0.8));
          const ang = Math.random() * Math.PI * 2;
          x = cx + Math.cos(ang) * localR + (Math.random() - 0.5) * 8;
          y = cy + Math.sin(ang) * localR + (Math.random() - 0.5) * 8;
        }
        sim.push({
          id: n.id,
          label: n.label || n.id,
          kind: n.kind || "default",
          memoryScope: (n.metadata && (n.metadata.memoryScope || n.metadata.memory_scope)) || "project",
          isGod: godIds.has(n.id),
          x: Math.max(20, Math.min(W - 20, x)),
          y: Math.max(20, Math.min(H - 20, y)),
          vx: 0, vy: 0,
        });
      }
    }
  } else {
    sim = candidateNodes.map((n, idx) => {
      const deg = degreeMap.get(n.id) || 0;
      // pick an angle and radius biased by degree
      const angle = (idx / Math.max(1, candidateNodes.length)) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const avgDeg = degreeMap.size > 0 ? (Array.from(degreeMap.values()).reduce((s, v) => s + v, 0) / degreeMap.size) : 1;
      const weight = Math.min(1, deg / Math.max(1, avgDeg));
      // nodes with higher degree sit closer to center
      const radiusOuter = Math.min(W, H) * 0.45;
      const radiusInner = Math.min(W, H) * 0.08;
      const r = radiusInner + (1 - weight) * (radiusOuter - radiusInner) * (0.25 + Math.random() * 0.75);
      const x = W / 2 + Math.cos(angle) * r + (Math.random() - 0.5) * 20;
      const y = H / 2 + Math.sin(angle) * r + (Math.random() - 0.5) * 20;
      return {
        id: n.id,
        label: n.label || n.id,
        kind: n.kind || "default",
        memoryScope: (n.metadata && (n.metadata.memoryScope || n.metadata.memory_scope)) || "project",
        isGod: godIds.has(n.id),
        x: Math.max(20, Math.min(W - 20, x)),
        y: Math.max(20, Math.min(H - 20, y)),
        vx: 0, vy: 0,
      };
    });
  }

  if (sim.length === 0) {
    ctx.fillStyle = "#71717a";
    ctx.font = "13px SF Mono, Monaco, monospace";
    ctx.textAlign = "center";
    ctx.fillText("No graph data yet", W / 2, H / 2);
    return;
  }

  // Build a quick id->node map for edge wiring
  const nodeById = new Map(sim.map((n) => [n.id, n]));
  const springs = [];
  if (Array.isArray(edges)) {
    for (const e of edges) {
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (a && b) springs.push({ a, b, relation: e.relation });
    }
  }

  // Expose visible nodes/edges so other UI pieces (legend) can summarize
  try {
    window.__engram_graph_visibleNodes = sim.map(n => n.id);
    window.__engram_graph_visibleEdges = springs.map(s => ({ source: s.a.id, target: s.b.id, relation: s.relation }));
  } catch (e) {}

  // Viewport transform (pan + zoom)
  let viewX = 0, viewY = 0, zoom = 1;
  let draggingView = false, dragStartX = 0, dragStartY = 0;
  let selectedId = null;
  let selectedEdge = null;
  let lastMouseX = null, lastMouseY = null;

  // ─── Physics step (tuned to settle faster and avoid long oscillations) ───
  // REPULSION scales down for large graphs (so springs can pull clusters together)
  const REPULSION = Math.max(75, Math.floor(900 * Math.min(1, 300 / Math.max(1, sim.length))));
  // Stronger spring constant to favor edge clustering over global repulsion
  const SPRING_K = 0.22;
  // Spring length tuned by viewport size (keeps connected nodes reasonably close)
  const SPRING_LENGTH = Math.max(40, Math.min(100, Math.floor(Math.sqrt(W * H) / 8)));
  const DAMPING = 0.90;
  const CENTER_GRAVITY = 0.003;
  const MAX_SPEED = 12;

  function step() {
    // Large graphs: approximate pairwise repulsion using spatial hashing
    // (grid buckets). This reduces O(n^2) to near-linear by only checking
    // nearby cells. For small graphs we keep exact pairwise repulsion.
    let maxSpeed = 0;
    const N = sim.length;
    if (N > 400) {
      const cellSize = SPRING_LENGTH * 1.5;
      const buckets = new Map();
      const nodeIndex = new Map();
      for (let i = 0; i < N; i++) {
        const n = sim[i];
        nodeIndex.set(n.id, i);
        const cx = Math.floor(n.x / cellSize);
        const cy = Math.floor(n.y / cellSize);
        const key = cx + ',' + cy;
        const arr = buckets.get(key) || [];
        arr.push(n);
        buckets.set(key, arr);
      }

      for (let i = 0; i < N; i++) {
        const a = sim[i];
        const acx = Math.floor(a.x / cellSize);
        const acy = Math.floor(a.y / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = (acx + dx) + ',' + (acy + dy);
            const arr = buckets.get(key);
            if (!arr) continue;
            for (const b of arr) {
              const j = nodeIndex.get(b.id);
              if (j <= i) continue; // symmetric update only once
              const dx_ = b.x - a.x;
              const dy_ = b.y - a.y;
              const dist2 = dx_ * dx_ + dy_ * dy_ + 0.01;
              const force = REPULSION / dist2;
              const dist = Math.sqrt(dist2);
              const fx = (dx_ / dist) * force;
              const fy = (dy_ / dist) * force;
              a.vx -= fx; a.vy -= fy;
              b.vx += fx; b.vy += fy;
            }
          }
        }
      }
    } else {
      // Exact pairwise repulsion
      for (let i = 0; i < sim.length; i++) {
        const a = sim[i];
        for (let j = i + 1; j < sim.length; j++) {
          const b = sim[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist2 = dx * dx + dy * dy + 0.01;
          const force = REPULSION / dist2;
          const dist = Math.sqrt(dist2);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
    }

    // Spring attraction along edges
    for (const s of springs) {
      const a = s.a;
      const b = s.b;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = SPRING_LENGTH;
      const f = SPRING_K * (dist - target);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Gravity toward viewport center — keeps components visible
    for (const n of sim) {
      n.vx += (W / 2 - n.x) * CENTER_GRAVITY;
      n.vy += (H / 2 - n.y) * CENTER_GRAVITY;
    }

    // Apply damping, clamp velocities, and update positions
    for (const n of sim) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;

      // Clamp speeds to avoid large oscillations
      if (n.vx > MAX_SPEED) n.vx = MAX_SPEED;
      if (n.vx < -MAX_SPEED) n.vx = -MAX_SPEED;
      if (n.vy > MAX_SPEED) n.vy = MAX_SPEED;
      if (n.vy < -MAX_SPEED) n.vy = -MAX_SPEED;

      n.x += n.vx;
      n.y += n.vy;

      // Keep nodes roughly within viewport bounds to avoid runaway
      const pad = 50;
      n.x = Math.max(-pad, Math.min(W + pad, n.x));
      n.y = Math.max(-pad, Math.min(H + pad, n.y));

      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > maxSpeed) maxSpeed = speed;
    }

    return maxSpeed;
  }

  // Pre-relaxation: run a short synchronous settle pass to reduce visible bouncing.
  // Stop early when velocities have settled to a low threshold. Cap iterations
  // to avoid excessive blocking on huge graphs. For very dense graphs we use
  // more iterations to let springs pull clusters together.
  try {
    const base = Math.floor(80000 / Math.max(1, sim.length));
    const maxIters = Math.min(2000, Math.max(120, base));
    for (let i = 0; i < maxIters; i++) {
      const maxSpeed = step();
      if (maxSpeed < 0.02 && i > 20) break;
    }
  } catch (e) {
    // If the browser is very constrained, skip pre-relax and continue
  }

  // ─── Render ─────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(viewX, viewY);
    ctx.scale(zoom, zoom);

    // Draw edges (lines) first
    const RELATION_STYLES = {
      contains: { color: '#9CA3AF', width: 1, dash: [] },
      imports: { color: '#60A5FA', width: 1, dash: [6,4] },
      similar_to: { color: '#FBBF24', width: 1, dash: [2,4] },
      depends_on: { color: '#10B981', width: 1.25, dash: [] },
      triggered_by: { color: '#A78BFA', width: 1, dash: [4,3] },
      rationale_for: { color: '#EF4444', width: 1, dash: [2,2] },
      default: { color: '#6B7280', width: 0.9, dash: [] },
    };

    for (const s of springs) {
      const a = s.a;
      const b = s.b;
      const style = RELATION_STYLES[s.relation] || RELATION_STYLES.default;
      ctx.beginPath();
      if (style.dash && ctx.setLineDash) ctx.setLineDash(style.dash);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = style.color;
      // Ensure edge stroke is visible even when zoomed out
      ctx.lineWidth = Math.max(0.8, style.width) / Math.max(zoom, 0.5);
      ctx.globalAlpha = 0.95;
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
    }

    // Draw nodes
    for (const n of sim) {
      const radius = n.isGod ? 7 : 4;
      const scopeCfg = MEMORY_SCOPE_CONFIG[n.memoryScope] || MEMORY_SCOPE_CONFIG.default;
      const color = scopeCfg.color || NODE_COLORS[n.kind] || NODE_COLORS.default;
      const shape = scopeCfg.shape || "circle";

      // Draw shape path
      pathShape(ctx, n.x, n.y, radius, shape);
      ctx.fillStyle = color;
      ctx.globalAlpha = n.id === selectedId ? 1.0 : (n.isGod ? 0.95 : 0.85);
      ctx.fill();

      if (n.id === selectedId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
    }

    // Labels for god nodes and selected
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = "#e4e4e7";
    ctx.font = (11 / zoom) + "px SF Mono, Monaco, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (const n of sim) {
      if (n.isGod || n.id === selectedId) {
        const label = n.label.length > 30 ? n.label.slice(0, 27) + "..." : n.label;
        ctx.fillText(label, n.x, n.y + 10);
      }
    }

    ctx.restore();
  }

  // ─── Animation loop ─────────────────────────────────────────
  let frames = 0;
  let running = true;

  // Expose a stop handle so subsequent renders can cleanly terminate
  const stop = () => { running = false; };
  window.__engram_graph_stop = stop;

  function tick() {
    if (!running) return;
    if (frames < 300) step();  // run physics until settled
    draw();
    frames++;
    requestAnimationFrame(tick);
  }
  tick();

  // ─── Interaction: pan + selection ───────────────────────────────────────
  canvas.addEventListener("mousedown", (e) => {
    const x = e.offsetX;
    const y = e.offsetY;

    // Hit test for node click (world coords)
    const worldX = (x - viewX) / zoom;
    const worldY = (y - viewY) / zoom;
    let clickedNode = null;
    for (const n of sim) {
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      const radius = n.isGod ? 7 : 4;
      if (dx * dx + dy * dy < (radius + 3) * (radius + 3)) {
        clickedNode = n;
        break;
      }
    }

    if (clickedNode) {
      selectedId = clickedNode.id;
      selectedEdge = null;
      const info = document.getElementById("graph-info");
      if (info) {
        info.textContent = clickedNode.kind + " · " + clickedNode.label + (clickedNode.isGod ? " (god node)" : "");
      }
    } else {
      // If no node clicked, attempt an edge hit-test (pick the nearest segment)
      let clickedEdge = null;
      let bestDist = Infinity;
      for (const s of springs) {
        // distance from point to segment AB
        const ax = s.a.x, ay = s.a.y, bx = s.b.x, by = s.b.y;
        const px = worldX, py = worldY;
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = 0;
        if (l2 > 0) t = ((px - ax) * dx + (py - ay) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const projx = ax + t * dx, projy = ay + t * dy;
        const dist2 = (projx - px) * (projx - px) + (projy - py) * (projy - py);
        if (dist2 < bestDist) {
          bestDist = dist2;
          clickedEdge = s;
        }
      }
      // threshold in world coords (approx)
      if (clickedEdge && bestDist < (12 * 12)) {
        selectedEdge = clickedEdge;
        selectedId = null;
        const info = document.getElementById("graph-info");
        if (info) {
          info.textContent = (selectedEdge.relation || 'edge') + ' · ' + selectedEdge.a.label + ' ↔ ' + selectedEdge.b.label;
        }
      } else {
        // Start panning
        draggingView = true;
        dragStartX = x - viewX;
        dragStartY = y - viewY;
        selectedId = null;
        selectedEdge = null;
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    lastMouseX = e.offsetX;
    lastMouseY = e.offsetY;
    if (draggingView) {
      viewX = e.offsetX - dragStartX;
      viewY = e.offsetY - dragStartY;
    }
  });

  canvas.addEventListener("mouseup", () => { draggingView = false; });
  canvas.addEventListener("mouseleave", () => { draggingView = false; });

  // ─── Interaction: zoom (wheel + keyboard) ──────────────────────────────────────
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(3, zoom * zoomDelta));

    // Anchor zoom on cursor
    const mx = e.offsetX;
    const my = e.offsetY;
    viewX = mx - ((mx - viewX) * newZoom) / zoom;
    viewY = my - ((my - viewY) * newZoom) / zoom;
    zoom = newZoom;
  }, { passive: false });

  // Keyboard zoom: - / = keys. Center on selected node/edge if any, else on
  // the last mouse cursor position.
  function keyboardZoom(zoomDelta) {
    const newZoom = Math.max(0.2, Math.min(3, zoom * zoomDelta));
    if (selectedId) {
      const n = nodeById.get(selectedId);
      if (n) {
        // center selected node in viewport at newZoom
        viewX = (W / 2) - (n.x * newZoom);
        viewY = (H / 2) - (n.y * newZoom);
        zoom = newZoom;
        return;
      }
    }
    if (selectedEdge) {
      const a = selectedEdge.a, b = selectedEdge.b;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      viewX = (W / 2) - (cx * newZoom);
      viewY = (H / 2) - (cy * newZoom);
      zoom = newZoom;
      return;
    }
    // Anchor on mouse cursor screen coords if available
    if (lastMouseX != null && lastMouseY != null) {
      const mx = lastMouseX;
      const my = lastMouseY;
      viewX = mx - ((mx - viewX) * newZoom) / zoom;
      viewY = my - ((my - viewY) * newZoom) / zoom;
      zoom = newZoom;
      return;
    }
    // fallback: center viewport
    viewX = (W / 2) - ((W / 2 - viewX) * newZoom) / zoom;
    viewY = (H / 2) - ((H / 2 - viewY) * newZoom) / zoom;
    zoom = newZoom;
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === '-' || ev.key === '_') {
      keyboardZoom(0.9);
    } else if (ev.key === '=' || ev.key === '+' ) {
      keyboardZoom(1.1);
    }
  });
}
`;
}
