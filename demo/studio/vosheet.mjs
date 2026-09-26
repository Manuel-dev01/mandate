/** Emit a voice-over sheet with timecodes taken from the real timeline. */
import { readFileSync, writeFileSync } from 'node:fs'
global.window = {}
eval(readFileSync('timeline.js', 'utf8'))
const T = window.__TIMELINE__
// Round to tenths BEFORE splitting, or 299.95s formats as 04:60.0.
const tc = (s) => { const x = Math.round(s * 10) / 10; const m = Math.floor(x / 60); const r = x - m * 60
  return `${String(m).padStart(2,'0')}:${r.toFixed(1).padStart(4,'0')}` }
// Roughly 2.6 words/second is a comfortable, unhurried delivery.
const WPS = 2.6
let acc = 0, out = []
T.scenes.forEach((s, i) => {
  const start = acc, end = acc + s.dur; acc = end
  const what = s.type === 'card' ? `SLIDE — ${(s.h1 || s.h2 || '').replace(/<br\/>/g, ' ')}`
    : s.type === 'evidence' ? `EVIDENCE PANEL — ${s.title}`
    : `${s.still ? 'STILL' : 'LIVE'} — ${s.plate}${s.cursor ? ' (cursor)' : ''}`
  out.push({ n: i + 1, start, end, dur: s.dur, what,
    kicker: s.kicker || '', cap: (s.cap || '').replace(/<[^>]+>/g, ''),
    words: Math.floor(s.dur * WPS) })
})
const md = [
  '# Voice-over sheet',
  '',
  `Timecodes are exact: generated from \`timeline.js\`, total **${tc(acc)}**.`,
  `The word budget is at ~${WPS} words/second — an unhurried pace with breathing room.`,
  '',
  '| # | In | Out | Len | On screen | Word budget |',
  '|---|---|---|---|---|---|',
  ...out.map(o => `| ${o.n} | \`${tc(o.start)}\` | \`${tc(o.end)}\` | ${o.dur.toFixed(1)}s | ${o.what} | ~${o.words} |`),
  '',
  '---',
  '',
  '## Per shot',
  '',
  ...out.flatMap(o => [
    `### ${o.n} · \`${tc(o.start)} – ${tc(o.end)}\`  (${o.dur.toFixed(1)}s, ~${o.words} words)`,
    '',
    `**On screen:** ${o.what}`,
    o.kicker ? `**Caption kicker:** ${o.kicker}` : '',
    o.cap ? `**Caption:** ${o.cap}` : '',
    '',
    '> _Narration:_',
    '',
  ].filter(Boolean)),
].join('\n')
writeFileSync('../VOICEOVER.md', md)
console.log('total', tc(acc), '| scenes', out.length, '| total word budget ~' + out.reduce((a,o)=>a+o.words,0))
