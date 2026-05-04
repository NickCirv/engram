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
  // Limit the number of simulated nodes to keep the layout responsive
  // on typical browsers. We'll seed initial positions based on edge
  // degrees so connected nodes start clustered (avoids grid artifacts).
  const MAX_SIM_NODES = 600;

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

  // Compute average degree (fallback to 1)
  let totalDeg = 0;
  for (const v of degreeMap.values()) totalDeg += v;
  const avgDeg = degreeMap.size > 0 ? totalDeg / degreeMap.size : 1;
  const radiusOuter = Math.min(W, H) * 0.45;
  const radiusInner = Math.min(W, H) * 0.08;

  // Prioritize nodes with higher degree so we include connected endpoints
  // in the simulated subset when the graph is large.
  const combined = Array.from(nodeMapAll.values());
  combined.sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0));
  const candidateNodes = combined.slice(0, MAX_SIM_NODES);

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
        const weight = Math.min(1, deg / Math.max(1, avgDeg));
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
      const weight = Math.min(1, deg / Math.max(1, avgDeg));
      // nodes with higher degree sit closer to center
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

  // Viewport transform (pan + zoom)
  let viewX = 0, viewY = 0, zoom = 1;
  let draggingView = false, dragStartX = 0, dragStartY = 0;
  let selectedId = null;

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

  // ─── Interaction: pan ───────────────────────────────────────
  canvas.addEventListener("mousedown", (e) => {
    const x = e.offsetX;
    const y = e.offsetY;

    // Hit test for node click (world coords)
    const worldX = (x - viewX) / zoom;
    const worldY = (y - viewY) / zoom;
    let clicked = null;
    for (const n of sim) {
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      const radius = n.isGod ? 7 : 4;
      if (dx * dx + dy * dy < (radius + 3) * (radius + 3)) {
        clicked = n;
        break;
      }
    }

    if (clicked) {
      selectedId = clicked.id;
      const info = document.getElementById("graph-info");
      if (info) {
        info.textContent = clicked.kind + " · " + clicked.label + (clicked.isGod ? " (god node)" : "");
      }
    } else {
      draggingView = true;
      dragStartX = x - viewX;
      dragStartY = y - viewY;
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (draggingView) {
      viewX = e.offsetX - dragStartX;
      viewY = e.offsetY - dragStartY;
    }
  });

  canvas.addEventListener("mouseup", () => { draggingView = false; });
  canvas.addEventListener("mouseleave", () => { draggingView = false; });

  // ─── Interaction: zoom ──────────────────────────────────────
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
}
`;
}
