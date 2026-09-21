# hmson0105.github.io

Personal research portfolio for Hyemi Son. Plain static HTML — **no build step,
no framework, no package manager.** GitHub Pages serves the files as they are.

## Running locally

Any static file server works. From the repository root:

```bash
python3 -m http.server 8139
```

Then open <http://localhost:8139>. There is nothing to compile or install.

## Routes

Each route is a real directory with its own `index.html`, so a direct URL and a
browser refresh both resolve to a real file. No hash routing, no client-side
router, and no `404.html` redirect trick is needed — this is the one approach
that is stable on GitHub Pages without a build step.

| URL | File |
|---|---|
| `/` | `index.html` — curtain landing, full screen, no scroll |
| `/about/` | `about/index.html` |
| `/research/` | `research/index.html` |
| `/projects/` | `projects/index.html` |
| `/contact/` | `contact/index.html` |

Project detail pages keep their existing locations:

```
papers/japan-ev-battery/          dashboards/sme-crisis-index/
patents/ai-power-health-index/    dashboards/patent-atlas/
                                  dashboards/tactile-sensor-ip/
```

## Curtain video — where to put the files

Drop the footage here, using these exact names:

```
assets/video/curtain-hero.mp4     ← required. H.264 / AAC (or no audio track)
assets/video/curtain-hero.webm    ← optional. VP9; Chrome and Firefox prefer it
assets/video/curtain-hero.jpg     ← required. Poster still, ~1920×1080
```

No code change is needed — `index.html` already points at these paths.

**The poster is not decorative.** It is what a visitor sees when the video is
still loading, when autoplay is refused (mobile Low Power Mode does this), when
the file is missing, and when the visitor has asked for reduced motion. Export
it from a frame of the same footage so the swap is invisible.

A placeholder poster is committed so the landing page is never broken. Replace
it with the real still.

### Encoding guidance

- Keep the mp4 **under about 6 MB**. GitHub Pages serves it as a plain file with
  no adaptive streaming, so the whole thing downloads.
- 8–12 seconds, looping seamlessly; the first and last frames should match.
- Silent. The `muted` attribute is required for autoplay, so an audio track is
  dead weight.
- The video is `object-fit: cover`, so it fills any aspect ratio and crops the
  overflow. Keep the subject near the centre.

```bash
# example: 10s, silent, ~1080p, web-optimised
ffmpeg -i source.mov -t 10 -an -vf "scale=1920:-2" \
       -c:v libx264 -crf 25 -preset slow -movflags +faststart \
       assets/video/curtain-hero.mp4

# poster from a frame
ffmpeg -i assets/video/curtain-hero.mp4 -ss 2 -frames:v 1 -q:v 3 \
       assets/video/curtain-hero.jpg
```

## Shared assets

- `assets/site.css` — the whole design system; every page loads it
- `assets/site.js` — mobile menu, footer year, video fallback logic
- `assets/images/profile.png` — portrait used on `/about/`
- `assets/og-cover.png` — link-preview image (1200×630)
- `assets/kitty.png` — favicon ([Icons8](https://icons8.com), credited in the footer)
