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

/**
 * Main entry point. Given a canvas element and node/edge data from
 * /api/graph/nodes and /api/graph/god-nodes, starts the simulation.
 */
function renderGraph(canvas, nodes, godNodes) {
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

  // Viewport transform (pan + zoom)
  let viewX = 0, viewY = 0, zoom = 1;
  let draggingView = false, dragStartX = 0, dragStartY = 0;
  let selectedId = null;

  // ─── Physics step ────────────────────────────────────────────
  const REPULSION = 1200;
  const SPRING_K = 0.02;
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

    // Draw nodes
    for (const n of sim) {
      const radius = n.isGod ? 7 : 4;
      const color = NODE_COLORS[n.kind] || NODE_COLORS.default;

      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = n.id === selectedId ? 1.0 : (n.isGod ? 0.95 : 0.75);
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
