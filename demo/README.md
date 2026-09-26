# The product demo video

A 5-minute desktop demo of Mandate, rendered deterministically from real product footage.

| File | What it is |
|---|---|
| `mandate-demo-5min.mp4` | **The deliverable.** 05:00.00 · 1920×1080 · 60 fps · H.264 High · yuv420p · 18,000 frames · 94 MB |
| `mandate-preview-18s.mp4` | The 18-second motion preview (opening title + landing push-in) |
| `qc/` | Frames pulled back out of the finished file, for readability checks |
| `studio/` | The reusable source: compositor, timeline, capture and render scripts |

## How it was made

Nothing is a mockup. Every screen is the deployed console at
`mandate-console-five.vercel.app`, captured live through Playwright at 1920×1080 with
`deviceScaleFactor: 2` so the edit can push in and stay sharp.

The two interactions shown — **VERIFY** and **REPLAY** — are real clicks against the real
API; the `VERIFIED — every hash re-derives` and `REPRODUCED — identical verdict, identical
hash` results in frame are the product's own output, not captions.

The camera never guesses. `measure.mjs` records `getBoundingClientRect()` for each thing
the camera should look at and writes it to `plates.json`; `timeline.js` frames those boxes.
An earlier pass used estimated coordinates and cropped text off both edges.

## Honesty rules, enforced as data

These are properties on each scene in `timeline.js`, not prose in a script:

- **`still`** — the frame is a screenshot rather than live capture, and says so on screen.
  Every Telegram beat carries *"Screenshot · Telegram desktop · this session."* Telegram is
  a desktop app: it cannot be driven by Playwright, and logging into Telegram Web as the
  account owner was not on the table.
- **`disclose`** — a reconstructed presentation cursor is on screen. It appears only on the
  VERIFY and REPLAY scenes and is labelled *"Presentation cursor reconstructed · the result
  is live product output."* The cursor is synthetic; the result it points at is not.
- **`evidence`** — a panel of external facts, labelled `EVIDENCE · VERIFIED LIVE`, with its
  method and source named on screen.

**No transaction, confirmation or result was staged for this video.** The three settlements
shown were read back from the chain with `eth_getTransactionReceipt` against
`sepolia.base.org` — blocks 47216250, 47211697, 47156826, each `status SUCCESS` — not
quoted from our own ledger.

Two claims in `docs/DEMO.md` were corrected rather than filmed as written:

- *"all seven rules"* — seven is the cap on rule **types**; a mandate compiles to one to
  seven. The caption says "all seven" only where the receipt on screen genuinely shows seven.
- *"identical hash"* for the two refusals — the checks and numbers are identical, but the
  decision hash legitimately differs, because the override message is a recorded input.
  The caption says **"identical checks, identical numbers."**

## Re-rendering

```bash
cd demo/studio
npm i playwright                       # and a local Chrome
FFMPEG=/path/to/ffmpeg node render.mjs out.mp4          # full 5:00
FFMPEG=/path/to/ffmpeg node render.mjs out.mp4 --from 0 --to 18   # an excerpt
node still.mjs 70 178 250              # single frames, for checking a shot
```

Every frame is a pure function of `t`, so a re-render is byte-comparable and the duration
is exact by construction — `timeline.js` normalises the scene list to the target runtime,
so changing any duration cannot drift the total.

### Performance note

The render pipes frames straight into ffmpeg rather than writing 18,000 PNGs. The pipe is
**MJPEG on purpose**: PNG-encoding each frame held the render to ~1.6 fps, and the frames
are going into lossy H.264 regardless. JPEG q94 took it to ~8 fps — about 37 minutes for
the full export. `studio-v1-innerHTML.html` is the first compositor, kept for comparison;
it rebuilt the DOM every frame.

## Known limits

- **Telegram is stills, not motion.** The four bot beats are screenshots from the session,
  labelled as such. To replace them with real motion, screen-record Telegram and cut the
  clips in — the timeline takes a plate per scene, so it is a one-line change each.
- The plates in `studio/assets/` are downscaled to 2640px wide, the widest the edit ever
  displays. The 3840×2160 originals stay in the scratchpad, not in the repo.
