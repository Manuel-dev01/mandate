/**
 * Narration -> a single 5:00 audio bed, time-aligned to the edit, muxed onto the video.
 *
 * Source-agnostic: each line becomes one WAV, placed at its shot's exact start time.
 * Swap the engine (or drop in human-recorded per-line WAVs) and the rest is unchanged.
 *
 *   node voice.mjs --engine kokoro        neural TTS, natural but synthetic
 *   node voice.mjs --engine sapi          Windows built-in; a timing scratch, not a master
 *   node voice.mjs --engine files --dir ./vo   pre-recorded 01.wav..23.wav (a human read)
 *
 * Then:
 *   node voice.mjs --mux                  builds narration.wav and muxes to AAC
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const FFMPEG = process.env.FFMPEG ?? 'C:/Users/DELL 5420/Desktop/hackathons/Leash/node_modules/ffmpeg-static/ffmpeg.exe'
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const has = (n) => process.argv.includes('--' + n)

const NAR = JSON.parse(readFileSync(resolve('../narration.json'), 'utf8'))
const OUT = resolve(arg('out', './voice'))
mkdirSync(OUT, { recursive: true })

const secs = (tc) => { const [m, s] = tc.split(':'); return Number(m) * 60 + Number(s) }
const TOTAL = 300

// ---------------------------------------------------------------- engines
async function synthKokoro() {
  const { KokoroTTS } = await import('kokoro-js')
  console.log('loading Kokoro (first run downloads the model)...')
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
  for (const l of NAR.lines) {
    const audio = await tts.generate(l.text, { voice: NAR.voice ?? 'af_heart', speed: NAR.speed ?? 1 })
    await audio.save(`${OUT}/${String(l.n).padStart(2, '0')}.wav`)
    process.stdout.write(`\r  synth ${l.n}/${NAR.lines.length}   `)
  }
  console.log('')
}

function synthSapi() {
  // Windows SAPI. Usable as a timing scratch; it will not pass as a polished read.
  for (const l of NAR.lines) {
    const file = `${OUT}/${String(l.n).padStart(2, '0')}.wav`.replace(/\//g, '\\')
    const text = l.text.replace(/'/g, "''")
    const ps = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like '*Zira*' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.Rate = 1
$s.SetOutputToWaveFile('${file}')
$s.Speak('${text}')
$s.Dispose()`
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error('SAPI failed on line ' + l.n + ': ' + (r.stderr || '').slice(0, 200))
    process.stdout.write(`\r  synth ${l.n}/${NAR.lines.length}   `)
  }
  console.log('')
}

function useFiles(dir) {
  const src = resolve(dir)
  for (const l of NAR.lines) {
    const n = String(l.n).padStart(2, '0')
    const cand = readdirSync(src).find((f) => f.startsWith(n) && /\.(wav|mp3|m4a)$/i.test(f))
    if (!cand) throw new Error(`missing take for line ${l.n} in ${src} (expected ${n}*.wav)`)
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${src}/${cand}`, '-ar', '24000', '-ac', '1', `${OUT}/${n}.wav`])
  }
  console.log(`  imported ${NAR.lines.length} takes from ${src}`)
}

const dur = (f) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', f], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '')
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

/** Place each line at its shot's start on one silent 5:00 bed, and report overruns. */
function build() {
  const files = NAR.lines.map((l) => ({ l, f: `${OUT}/${String(l.n).padStart(2, '0')}.wav` }))
  for (const { f } of files) if (!existsSync(f)) throw new Error('missing ' + f + ' — run a synth step first')

  const over = []
  files.forEach(({ l, f }, i) => {
    const start = secs(l.at)
    const next = i + 1 < files.length ? secs(files[i + 1].l.at) : TOTAL
    const d = dur(f)
    if (start + d > next + 0.35) over.push({ n: l.n, d: d.toFixed(1), room: (next - start).toFixed(1) })
  })
  if (over.length) {
    console.log('\n  lines longer than their shot (they will overlap the next):')
    for (const o of over) console.log(`    line ${o.n}: ${o.d}s of audio in a ${o.room}s shot`)
  }

  const inputs = files.flatMap(({ f }) => ['-i', f])
  const delays = files.map(({ l }, i) => `[${i + 1}:a]adelay=${Math.round(secs(l.at) * 1000)}|${Math.round(secs(l.at) * 1000)}[a${i}]`).join(';')
  const mix = files.map((_, i) => `[a${i}]`).join('')
  const filter = `${delays};${mix}amix=inputs=${files.length}:normalize=0:dropout_transition=0[vo];` +
    `[0:a][vo]amix=inputs=2:normalize=0[out]`
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-t', String(TOTAL), '-i', 'anullsrc=r=24000:cl=mono',
    ...inputs,
    '-filter_complex', filter, '-map', '[out]',
    '-ar', '48000', '-ac', '1', `${OUT}/narration.wav`,
  ])
  console.log(`  bed -> ${OUT}/narration.wav (${dur(`${OUT}/narration.wav`).toFixed(2)}s)`)
}

function mux() {
  const vid = resolve('../mandate-demo-5min.mp4')
  const out = resolve('../mandate-demo-5min-narrated.mp4')
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-i', vid, '-i', `${OUT}/narration.wav`,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-movflags', '+faststart', out,
  ])
  console.log(`  muxed -> ${out}`)
}

const engine = arg('engine', null)
if (engine === 'kokoro') await synthKokoro()
else if (engine === 'sapi') synthSapi()
else if (engine === 'files') useFiles(arg('dir', './vo'))
if (engine) build()
if (has('mux')) { if (!existsSync(`${OUT}/narration.wav`)) build(); mux() }
if (!engine && !has('mux')) console.log('nothing to do — pass --engine kokoro|sapi|files, and/or --mux')
