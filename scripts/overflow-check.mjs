#!/usr/bin/env node
/**
 * Does any page scroll sideways on a phone? Names the elements that cause it.
 *
 * Drives headless Chrome over the DevTools Protocol (no dependencies: CDP's
 * /json endpoints plus a minimal WebSocket client). Prints one line per route,
 * and for a failing route the widest offending elements.
 *
 *   node scripts/overflow-check.mjs                       # localhost:3000
 *   WEB=https://mandate-console-five.vercel.app node scripts/overflow-check.mjs
 *   WIDTH=390 node scripts/overflow-check.mjs
 */

import { existsSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'

const WEB = (process.env.WEB ?? 'http://localhost:3000').replace(/\/+$/, '')
const WIDTH = Number(process.env.WIDTH ?? 390)
const HEIGHT = Number(process.env.HEIGHT ?? 844)
const PORT = Number(process.env.CDP_PORT ?? 9222)
const CHROME =
  process.env.CHROME ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p))

/** The routes that matter, with a receipt id filled in from the API when there is one. */
const routes = process.env.ROUTES ? process.env.ROUTES.split(',') : ['/', '/chain', '/mandate', '/vaults']

// ----------------------------------------------------------- tiny WS client

/** Just enough RFC 6455 to talk to Chrome: text frames, client-masked, no extensions. */
class Ws {
  constructor(url) {
    const u = new URL(url)
    this.port = Number(u.port)
    this.host = u.hostname
    this.path = u.pathname + u.search
    this.buf = Buffer.alloc(0)
    this.waiters = []
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = connect(this.port, this.host, () => {
        const key = randomBytes(16).toString('base64')
        this.accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
        this.sock.write(
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        )
      })
      this.sock.on('error', reject)
      const onHandshake = (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk])
        const end = this.buf.indexOf('\r\n\r\n')
        if (end < 0) return
        const head = this.buf.subarray(0, end).toString()
        if (!/101/.test(head)) return reject(new Error(`websocket handshake failed: ${head.split('\r\n')[0]}`))
        this.buf = this.buf.subarray(end + 4)
        this.sock.off('data', onHandshake)
        this.sock.on('data', (c) => this.onData(c))
        this.onData(Buffer.alloc(0))
        resolve()
      }
      this.sock.on('data', onHandshake)
    })
  }
  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      if (this.buf.length < 2) return
      const len0 = this.buf[1] & 0x7f
      let offset = 2
      let len = len0
      if (len0 === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        offset = 4
      } else if (len0 === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        offset = 10
      }
      if (this.buf.length < offset + len) return
      const payload = this.buf.subarray(offset, offset + len).toString('utf8')
      this.buf = this.buf.subarray(offset + len)
      const w = this.waiters.shift()
      if (w) w(payload)
    }
  }
  send(obj) {
    const data = Buffer.from(JSON.stringify(obj), 'utf8')
    const mask = randomBytes(4)
    const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]))
    let header
    if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length])
    else if (data.length < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(data.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x81
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(data.length), 2)
    }
    this.sock.write(Buffer.concat([header, mask, masked]))
  }
  /** Sends and waits for the matching id, ignoring CDP events in between. */
  call(id, method, params = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 45_000)
      const want = (payload) => {
        let msg
        try {
          msg = JSON.parse(payload)
        } catch {
          this.waiters.unshift(want)
          return
        }
        if (msg.id !== id) {
          this.waiters.push(want)
          return
        }
        clearTimeout(timer)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
      this.waiters.push(want)
      this.send({ id, method, params })
    })
  }
  close() {
    try {
      this.sock.destroy()
    } catch {
      // already gone
    }
  }
}

// ------------------------------------------------------------- the measure

/** Runs in the page: is it wider than the viewport, and what is sticking out? */
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const out = [];
  if (sw > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const cs = getComputedStyle(el);
        // The culprit is the outermost element that overflows; children inherit the blame.
        if (el.parentElement && out.some((o) => o.el === el.parentElement)) continue;
        out.push({
          el,
          tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
          right: Math.round(r.right),
          width: Math.round(r.width),
          overflow: cs.overflowX,
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    }
  }
  return JSON.stringify({ vw, sw, offenders: out.slice(0, 8).map(({ el, ...rest }) => rest) });
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return res.json()
}

const main = async () => {
  if (!CHROME) {
    console.error('No Chrome found. Set CHROME=/path/to/chrome.')
    process.exit(1)
  }
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=' + (process.env.TMP ?? '/tmp') + '/overflow-check-profile',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  process.on('exit', () => chrome.kill())

  // Wait for the debugging endpoint.
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(500)
    targets = await cdpTargets().catch(() => null)
  }
  if (!targets?.length) {
    console.error('Chrome did not expose a debugging target.')
    process.exit(1)
  }

  let failed = 0
  let id = 0
  console.log(`\n${WEB} at ${WIDTH}px\n`)

  for (const route of routes) {
    const page = targets.find((t) => t.type === 'page')
    const ws = new Ws(page.webSocketDebuggerUrl)
    await ws.connect()
    try {
      await ws.call(++id, 'Page.enable')
      await ws.call(++id, 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true })
      await ws.call(++id, 'Page.navigate', { url: `${WEB}${route}` })
      await sleep(Number(process.env.SETTLE ?? 3500))
      if (process.env.SHOT) {
        const shot = await ws.call(++id, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        const name = route === '/' ? 'home' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
        writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(shot.data, 'base64'))
      }
      const { result } = await ws.call(++id, 'Runtime.evaluate', { expression: PROBE, returnByValue: true })
      const { vw, sw, offenders } = JSON.parse(result.value)
      if (sw > vw + 1) {
        failed++
        console.log(`  ✗ ${route.padEnd(28)} scrollWidth ${sw} > viewport ${vw}  (+${sw - vw}px)`)
        for (const o of offenders) console.log(`      ${String(o.right).padStart(5)}px  ${o.tag.slice(0, 64)}${o.overflow !== 'visible' ? ` [overflow-x:${o.overflow}]` : ''}  "${o.text}"`)
      } else {
        console.log(`  ✓ ${route.padEnd(28)} ${sw}px, fits`)
      }
    } catch (err) {
      failed++
      console.log(`  ✗ ${route.padEnd(28)} ${err.message}`)
    } finally {
      ws.close()
    }
  }

  chrome.kill()
  console.log(failed ? `\n${failed} route(s) overflow\n` : '\nno horizontal overflow\n')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
