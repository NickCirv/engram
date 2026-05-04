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

  // Build simulation nodes with random starting positions near center
  const sim = (nodes || []).slice(0, 300).map((n) => ({
    id: n.id,
    label: n.label || n.id,
    kind: n.kind || "default",
    memoryScope: (n.metadata && n.metadata.memoryScope) || null,
    isGod: godIds.has(n.id),
    x: W / 2 + (Math.random() - 0.5) * 400,
    y: H / 2 + (Math.random() - 0.5) * 400,
    vx: 0, vy: 0,
  }));

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

  // ─── Physics step ────────────────────────────────────────────
  const REPULSION = 1200;
  const SPRING_K = 0.06;
  const SPRING_LENGTH = 80;
  const DAMPING = 0.85;
  const CENTER_GRAVITY = 0.003;

  function step() {
    // Pairwise repulsion (O(n^2) but fine up to ~500 nodes)
    for (let i = 0; i < sim.length; i++) {
      const a = sim[i];
      for (let j = i + 1; j < sim.length; j++) {
        const b = sim[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 1;
        const force = REPULSION / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
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

    // Gravity toward viewport center — keeps disconnected components visible
    for (const n of sim) {
      n.vx += (W / 2 - n.x) * CENTER_GRAVITY;
      n.vy += (H / 2 - n.y) * CENTER_GRAVITY;
    }

    // Apply velocity with damping
    for (const n of sim) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }
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
      ctx.lineWidth = style.width / zoom;
      ctx.globalAlpha = 0.9;
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
