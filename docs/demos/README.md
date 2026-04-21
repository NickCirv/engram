# engram demos

> **One source → three deliveries.** `showcase.html` is a Hyperframes scene composition, a live HTML player, and the source of truth for the rendered MP4. Edit it once; every channel updates.

---

## What lives here

| File | Role | Edit when… |
|---|---|---|
| [`showcase.html`](./showcase.html) | Hyperframes scene composition + live HTML player | Scene visuals change |
| [`scene-table.md`](./scene-table.md) | Source-of-truth scene table (drives everything) | Scene narrative changes |
| [`captions.vtt`](./captions.vtt) | WebVTT cues, baked-in lower-thirds + accessibility | Caption text changes |
| [`chapters.vtt`](./chapters.vtt) | Chapter scrubber timestamps | Scene boundaries change |
| [`poster.svg`](./poster.svg) | First-frame poster · README hero · social card | Brand identity changes |
| `showcase.mp4` *(generated)* | H.264 1280×720 · social + GitHub README embed | Run `npx hyperframes render` |
| `showcase.webm` *(generated)* | VP9 fallback · smaller, served first | Run `npx hyperframes render` |
| `storyboard/*.svg` *(inline)* | Reduced-motion fallback frames | Already inline in `showcase.html` |

---

## Why Hyperframes

[Hyperframes](https://github.com/heygen-com/hyperframes) (by HeyGen) is HTML-native video composition built for AI agents. The trade-off it solves:

| Pattern | Problem |
|---|---|
| Static screenshot hero | Feels dead, doesn't show the product |
| Auto-looping background MP4 | Spammy, no narrative, mobile-hostile |
| 30MB animated GIF | Blocks mobile, breaks Core Web Vitals, can't pause |
| YouTube embed | Third-party dependency, analytics leak, CLS hit |
| Hyperframes-rendered MP4 + live HTML player + storyboard | One source, deterministic, scrubbable, reduced-motion-safe |

Engram's showcase is 24 seconds, 4 scenes, ≤3MB rendered. Built for the GitHub README, the install page hero, social posts, and email — every channel uses the same `showcase.html`.

---

## Render to MP4 (and WebM)

### One-time setup

```bash
git clone https://github.com/heygen-com/hyperframes ~/tools/hyperframes
cd ~/tools/hyperframes
npm install
npm run build
npm link    # exposes `hyperframes` CLI globally
```

### Each render

From the engram repo root:

```bash
hyperframes render \
  --input  docs/demos/showcase.html \
  --output docs/demos/showcase.mp4 \
  --width  1280 \
  --height 720 \
  --fps    30 \
  --duration 24 \
  --captions docs/demos/captions.vtt \
  --bake-captions
```

Then the WebM fallback (smaller, served first):

```bash
hyperframes render \
  --input  docs/demos/showcase.html \
  --output docs/demos/showcase.webm \
  --width  1280 \
  --height 720 \
  --fps    30 \
  --duration 24 \
  --codec  vp9 \
  --captions docs/demos/captions.vtt \
  --bake-captions
```

### Verify before commit

```bash
ls -lh docs/demos/showcase.{mp4,webm}
# both files should be present, total <6MB

ffprobe -v error -show_entries format=duration docs/demos/showcase.mp4
# duration should be 24.000000

open docs/demos/showcase.html
# poster click should now play the rendered video
```

---

## Embedding in the GitHub README

GitHub's markdown renderer supports `<video>` directly. Use this snippet at the top of the root `README.md`:

```html
<p align="center">
  <a href="https://github.com/NickCirv/engram/blob/main/docs/demos/showcase.html">
    <img src="docs/demos/poster.svg" alt="engram — 24s showcase" width="100%">
  </a>
</p>

<p align="center">
  <video src="docs/demos/showcase.mp4" controls muted playsinline poster="docs/demos/poster.svg" width="100%">
    Your browser doesn't support HTML video.
    <a href="docs/demos/showcase.html">Open the live HTML player</a>.
  </video>
</p>
```

Notes:
- The `<img>` is what Twitter, LinkedIn, Slack, and HN render in unfurls — link it to the live player.
- The `<video>` is what GitHub renders inline (no JS, just plays muted).
- Always `preload="none"` (the `<video>` tag above doesn't include it because GitHub's HTML sanitizer strips it; the live player at `showcase.html` includes it).

---

## Embedding on social

| Platform | Asset | Notes |
|---|---|---|
| Twitter / X | `showcase.mp4` (re-encoded to ≤2:20, ≤512MB) | Captions baked in (autoplay-muted) |
| LinkedIn | `showcase.mp4` | Native video upload, captions baked in |
| Reddit | `showcase.mp4` | Native upload only — never link a CDN URL |
| Email | `poster.svg` linked to `showcase.html` | No email client renders video reliably |
| Hacker News | Link to `showcase.html` | HN strips media; the live player is the destination |

---

## Editing the showcase

To change anything about the demo:

1. **Edit `scene-table.md`** — that's the source of truth. Update timing, visuals, captions.
2. **Sync `captions.vtt` and `chapters.vtt`** — they're generated from the table.
3. **Update `showcase.html`** — change the `.scene` blocks to match. Keep `data-scene-start`/`data-scene-end` aligned with chapter timings.
4. **Update `poster.svg`** if the brand identity or first-frame composition changed.
5. **Re-render the MP4** with the commands above.
6. **Open `showcase.html`** in a browser and click through all 4 chapters to verify.
7. **Test reduced-motion**: macOS → System Settings → Accessibility → Display → Reduce Motion. Reload — the storyboard should appear.

---

## Production checklist

Before committing a re-rendered MP4:

- [ ] Total runtime exactly 24.000s (`ffprobe`)
- [ ] File size ≤3MB combined (mp4 + webm)
- [ ] Captions visible and legible without sound
- [ ] Tested in Chrome, Safari, Firefox (autoplay-muted)
- [ ] Tested at mobile 375px width — no horizontal scroll
- [ ] `prefers-reduced-motion` swaps to storyboard
- [ ] `poster.svg` works as a standalone hero (the slop test)
- [ ] No third-party CDN calls in the live player
- [ ] Captions VTT cues align to chapter boundaries (0, 5, 11, 18)
- [ ] All numbers shown match the live `engram` v2.0.2 dashboard (not placeholders)

---

## Anti-patterns (auto-reject)

Pulled from `~/.claude/skills/aaa-design/references/product-tutorial-showcase.md`:

| Forbidden | Reason |
|---|---|
| Autoplay with sound | Browser autoplay policy violation |
| Background loop with no narrative | Decoration ≠ information |
| 30MB+ GIF | Breaks mobile, can't pause |
| YouTube embed as primary | Third-party dependency |
| Motion when `prefers-reduced-motion: reduce` | WCAG violation |
| Captions over the cursor interaction | Reader can't see the thing they're watching |
| Fake UI / "marketing mock" of features that don't ship | Trust collapse |
| Scene runtime > 8s | Viewer drops off — split into two scenes |

---

## Troubleshooting

**"Hyperframes can't find scenes"**
Check the `.scene` elements have both `data-scene-start` AND `data-scene-end` attributes in seconds (no units). The sum of all scene durations must equal the meta `hyperframes:duration`.

**"MP4 is twice the expected duration"**
The auto-advance loop in the live-player `<script>` is firing during render. Hyperframes should ignore JS by default (uses headless rendering of static frames), but if it doesn't, add `data-hyperframes-skip-js="true"` to the script tag.

**"Captions are double-stamped (baked + WebVTT both showing)"**
The renderer baked them in (correct). Disable the WebVTT track in the live player by removing `default` from `<track kind="captions" default>`.

**"poster.svg doesn't render in the GitHub README"**
GitHub serves SVGs with `Content-Type: image/svg+xml` only when accessed through `raw.githubusercontent.com`. The README link should be `docs/demos/poster.svg` (relative), not the raw URL.

**"npm hyperframes — module not found"**
The package isn't on the npm registry yet. Use `git clone + npm link` per the one-time setup above. If `hyperframes` is still missing, fall back to `npx playwright codegen` for the recording route — but you lose deterministic re-renders.

---

## Why a separate folder

We could embed the demo inside `docs/install.html`, but separating it keeps:

- The install page lean (no large MP4/SVG inline)
- The showcase reusable across surfaces (README, social, email, install page)
- The render artifacts in one place for `.gitattributes` LFS rules later
- The scene table as a single editable source

---

## Credits

- **Pattern**: [Hyperframes](https://github.com/heygen-com/hyperframes) by HeyGen — HTML-native video composition for agents.
- **Aesthetic**: Terminal Mono + amber accent, brand-matched to `~/engram/assets/banner.png`.
- **Quality reference**: `~/.claude/skills/aaa-design/references/product-tutorial-showcase.md`.
