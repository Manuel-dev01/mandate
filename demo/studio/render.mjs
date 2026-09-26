/**
 * Deterministic frame renderer. Every frame is a function of t only, so the render
 * is reproducible and the duration is exact. Frames are piped straight into ffmpeg
 * (no 3 GB of PNGs on disk).
 *
 *   node render.mjs out.mp4 [--from S] [--to S] [--fps 60] [--scale 1]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const FFMPEG = process.env.FFMPEG ?? 'C:/Users/DELL 5420/Desktop/hackathons/Leash/node_modules/ffmpeg-static/ffmpeg.exe'
const out = process.argv[2] ?? 'out.mp4'
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? Number(process.argv[i + 1]) : d }
const FPS = arg('fps', 60)
const FROM = arg('from', 0)
let TO = arg('to', NaN)

const browser = await chromium.launch({ channel: 'chrome', args: ['--force-device-scale-factor=1', '--hide-scrollbars'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1 })
await page.goto(pathToFileURL(resolve('studio.html')).href, { waitUntil: 'load' })
await page.waitForFunction(() => typeof window.drawAt === 'function' && window.__TOTAL__ > 0)

const total = await page.evaluate(() => window.__TOTAL__)
if (!Number.isFinite(TO)) TO = total
console.log(`timeline ${total.toFixed(3)}s · rendering ${FROM}s..${TO.toFixed(3)}s @ ${FPS}fps`)

// Let every plate decode before frame 0, or the first seconds render blank.
await page.evaluate(async () => {
  const urls = [...new Set(window.__TIMELINE__.scenes.filter((s) => s.plate).map((s) => 'assets/' + s.plate))]
  await Promise.all(urls.map((u) => new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = u })))
})

const frames = Math.round((TO - FROM) * FPS)
const ff = spawn(FFMPEG, [
  '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-r', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-movflags', '+faststart', '-r', String(FPS), out,
], { stdio: ['pipe', 'ignore', 'pipe'] })
let ffErr = ''
ff.stderr.on('data', (d) => { ffErr += d.toString().slice(-4000) })

const t0 = Date.now()
for (let f = 0; f < frames; f++) {
  const t = FROM + f / FPS
  await page.evaluate((tt) => window.drawAt(tt), t)
  // PNG encoding of a detailed frame was the bottleneck (~1.6 fps). JPEG is an
  // order of magnitude cheaper and the frames go into lossy H.264 regardless.
  const buf = await page.screenshot({ type: 'jpeg', quality: Number(process.env.JPEG_Q ?? 94) })
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
  if (f % 300 === 0 || f === frames - 1) {
    const el = (Date.now() - t0) / 1000
    const pct = ((f + 1) / frames) * 100
    process.stdout.write(`\r  ${String(f + 1).padStart(6)}/${frames}  ${pct.toFixed(1)}%  ${(f / Math.max(el, 0.001)).toFixed(1)} fps  eta ${Math.round((el / Math.max(f, 1)) * (frames - f) / 60)}m   `)
  }
}
ff.stdin.end()
await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + '\n' + ffErr)))))
await browser.close()
console.log(`\ndone -> ${out}  (${frames} frames)`)
