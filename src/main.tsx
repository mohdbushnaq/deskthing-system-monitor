import React, { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DeskThing } from '@deskthing/client'
import '@fontsource-variable/outfit'
import '@fontsource-variable/inter'
import './index.css'
import manifest from '../deskthing/manifest.json'

type Cfg = {
  layout: 'split' | 'full'
  left: string[]
  tiles: string[]
  showCores: boolean
  showCpuName: boolean
  cpuChip: 'speed' | 'temp' | 'off'
  theme: 'dark' | 'light' | 'auto'
  dayStart: number
  nightStart: number
  textScale: number
  numberScale: number
  graphScale: number
  accent: string
  clock24: boolean
  claudeWindows: string[]
  tapToChange: boolean
  tileOptions?: { label: string; value: string }[]
  tempUnit: 'C' | 'F'
  refreshMs: number
  warn: number
  hot: number
  tempWarn: number
}
type Stats = {
  cpu: { total: number; cores: number[] }
  cpuName: string
  memUsed: number
  memTotal: number
  gpu: { name: string; use: number; temp: number; memUsed: number; memTotal: number; power: number | null } | null
  net: { down: number; up: number; totalDown: number | null; totalUp: number | null } | null
  cpuGhz: number | null
  netPeriod?: string
  inst?: number
  claude: { windows: { key: string; label: string; pct: number; resetsAt: string | null }[]; error: string | null } | null
  disks: Record<string, { used: number; total: number }>
  hw: {
    cpuTemp: number | null
    cpuTempSource: string | null
    cpuPower: number | null
    cpuClock: number | null
    fans: { name: string; rpm: number }[]
    cpuTempStuck?: boolean
  }
  uptime: number
  host: string
  now: number
  tz: number
}

const DEFAULT_CFG: Cfg = {
  layout: 'split',
  left: ['cpu', 'clock'],
  tiles: ['ram', 'disk:C', 'gpu', 'net'],
  showCores: true,
  showCpuName: true,
  cpuChip: 'speed',
  theme: 'dark',
  dayStart: 7,
  nightStart: 19,
  textScale: 150,
  numberScale: 150,
  graphScale: 160,
  accent: '#4fc3f7',
  clock24: false,
  claudeWindows: ['session', 'weekly', 'model'],
  tapToChange: true,
  tempUnit: 'C',
  refreshMs: 1000,
  warn: 60,
  hot: 85,
  tempWarn: 80
}

// ---------------------------------------------------------------- transport
// On the Car Thing data comes through DeskThing; in the 3D preview page it streams from the app's own server.
const PREVIEW = new URLSearchParams(location.search).has('preview')
type Listener = (m: { request?: string; payload?: unknown }) => void
function subscribe(fn: Listener): () => void {
  if (PREVIEW) {
    const es = new EventSource('/events')
    es.onmessage = (e) => {
      try {
        fn(JSON.parse(e.data))
      } catch {
        /* ignore */
      }
    }
    return () => es.close()
  }
  const off = DeskThing.on('sysmon' as never, fn as never) as unknown
  DeskThing.send({ type: 'sysmon', request: 'hello' } as never)
  return typeof off === 'function' ? (off as () => void) : () => {}
}
function sendToServer(msg: { request: string; payload?: unknown }): void {
  if (PREVIEW) {
    fetch('/action', { method: 'POST', body: JSON.stringify(msg) }).catch(() => {})
    return
  }
  DeskThing.send({ type: 'sysmon', ...msg } as never)
}

// ---------------------------------------------------------------- helpers
const historyLen = (ms: number): number => Math.min(240, Math.max(20, Math.round(60000 / ms)))
const gb = (b: number): string => (b / 1073741824).toFixed(b >= 107374182400 ? 0 : 1)
const pct = (a: number, b: number): number => (b ? Math.round((100 * a) / b) : 0)
function rate(bps: number): [string, string] {
  if (bps >= 1048576) return [(bps / 1048576).toFixed(1), 'MB/s']
  if (bps >= 1024) return [(bps / 1024).toFixed(0), 'KB/s']
  return [String(Math.round(bps)), 'B/s']
}
// "13th Gen Intel(R) Core(TM) i9-13900K" → "i9-13900K", "AMD Ryzen 7 5800X 8-Core Processor" → "Ryzen 7 5800X"
function shortCpu(name: string): string {
  const n = name.replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim()
  const m =
    n.match(/\b(i[3579]-\d{4,5}[A-Z]{0,3})\b/i) ||
    n.match(/\b(Core Ultra \d \d{3}[A-Z]{0,2})\b/i) ||
    n.match(/\b(Ryzen (?:Threadripper )?(?:PRO )?\d+ \d{4}[A-Z0-9]{0,3})\b/i) ||
    n.match(/\b(Xeon\b.*?\b[A-Z]?\d{4,5}[A-Z]?(?: v\d)?)\b/i) ||
    n.match(/\b(Apple M\d(?: Pro| Max| Ultra)?)\b/i)
  if (m) return m[1].replace(/^Core /i, '')
  return n.replace(/\b(\d+(st|nd|rd|th) Gen|Intel|AMD|CPU|Processor|\d+-Core)\b/gi, '').replace(/@.*$/, '').replace(/\s+/g, ' ').trim()
}
function size(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  return `${Math.round(b / 1e6)} MB`
}
function resetIn(iso: string | null, now: number): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return 'resetting'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
function upFor(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}
const PERIOD: Record<string, string> = { '24h': '24 h', '7d': '7 days', '30d': '30 days', total: 'Total', boot: 'Boot' }
const ICONS: Record<string, string> = {
  cpu: '◆', clock: '◷', ram: '▤', gpu: '▣', vram: '▣', cpuTemp: '✦', disk: '◍', net: '⇅', fans: '✲', cpuPower: 'ϟ', claude: '✳', uptime: '⌂', none: '▢'
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Text that scales to fill its box (uses SVG so it works on the Car Thing's older browser)
function FitText({ text, className, deps }: { text: string; className?: string; deps?: unknown }) {
  const ref = useRef<SVGTextElement>(null)
  const [box, setBox] = useState('0 0 100 30')
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      const b = el.getBBox()
      if (b.width > 0) setBox(`${b.x} ${b.y} ${b.width} ${b.height}`)
    }
    measure()
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
    fonts?.ready.then(measure)
  }, [text.length, deps])
  return (
    <svg className={`fit ${className ?? ''}`} viewBox={box} preserveAspectRatio="xMidYMid meet">
      <text ref={ref} x="0" y="0">
        {text}
      </text>
    </svg>
  )
}

// Shrinks a single line of HTML so it never spills out of its box (works on the Car Thing's browser)
function Fit({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    // offsetWidth ignores the transform, and width:max-content makes it the natural, unwrapped width
    const need = i.offsetWidth
    const have = o.clientWidth
    const next = need > have && need > 0 ? Math.max(0.4, have / need) : 1
    if (Math.abs(next - k) > 0.01) setK(next)
  })
  return (
    <div ref={outer} className={`fitrow ${className ?? ''}`} style={style}>
      <span ref={inner} className="fitrow-in" style={{ transform: `scale(${k})` }}>
        {children}
      </span>
    </div>
  )
}

function Spark({ data, color, len, min = 0, max = 100 }: { data: number[]; color: string; len: number; min?: number; max?: number }) {
  const w = 300
  const h = 100
  const offset = len - data.length
  const y = (v: number) => h - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (h - 4) - 2
  const pts = data.map((v, i) => `${(((i + offset) / (len - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const id = `g${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {data.length > 1 && (
        <>
          <polygon points={`${((offset / (len - 1)) * w).toFixed(1)},${h} ${pts} ${w},${h}`} fill={`url(#${id})`} />
          <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- app
function App() {
  const [s, setS] = useState<Stats | null>(null)
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG)
  const [hist, setHist] = useState<{ cpu: number[]; gpu: number[]; temp: number[] }>({ cpu: [], gpu: [], temp: [] })
  const [stale, setStale] = useState(false)
  const [clockNow, setClockNow] = useState(Date.now())
  const last = useRef(0)
  const lenRef = useRef(historyLen(DEFAULT_CFG.refreshMs))
  // PC local time = Car Thing time + skew; keeps the seconds ticking smoothly between updates
  const skew = useRef<{ ms: number; tz: number } | null>(null)
  // Last Claude reading that had data; a gap in updates never blanks the tile
  const lastClaude = useRef<Stats['claude']>(null)
  const newestInst = useRef(0)
  // the slot whose tile picker is open (tap a tile to change it)
  const [picking, setPicking] = useState<string | null>(null)

  useEffect(() => {
    const off = subscribe((data) => {
      if (data.request === 'config' && data.payload) {
        // After an update the Car Thing can keep showing a cached copy of the old app. If the PC side runs a
        // newer version than this page, reload this page once with a cache-busting query.
        const serverVersion = (data.payload as { version?: string }).version
        if (!PREVIEW && serverVersion && serverVersion !== manifest.version) {
          const tried = sessionStorage.getItem('sysmon-reload')
          if (tried !== serverVersion) {
            sessionStorage.setItem('sysmon-reload', serverVersion)
            location.replace(`${location.pathname}?v=${encodeURIComponent(serverVersion)}&t=${Date.now()}`)
            return
          }
        }
        const next = { ...DEFAULT_CFG, ...(data.payload as Partial<Cfg>) }
        lenRef.current = historyLen(next.refreshMs)
        setCfg(next)
        return
      }
      if (data.request !== 'stats' || !data.payload) return
      const p = data.payload as Stats
      // If an older copy of the app is still running next to the new one, both send updates and values
      // flicker. Only accept updates from the newest server process.
      if (p.inst) {
        if (p.inst < newestInst.current) return
        newestInst.current = p.inst
      } else if (newestInst.current) return
      last.current = Date.now()
      skew.current = { ms: p.now - Date.now(), tz: p.tz }
      if (p.claude?.windows?.length) lastClaude.current = p.claude
      else if (p.claude && lastClaude.current) lastClaude.current = { ...lastClaude.current, error: p.claude.error }
      setS(p)
      const n = lenRef.current
      setHist((h) => ({
        cpu: [...h.cpu, p.cpu.total].slice(-n),
        gpu: p.gpu ? [...h.gpu, p.gpu.use].slice(-n) : h.gpu,
        temp: p.hw?.cpuTemp != null ? [...h.temp, p.hw.cpuTemp].slice(-n) : h.temp
      }))
    })
    const t = window.setInterval(() => {
      setStale(Date.now() - last.current > 6000)
      setClockNow(Date.now())
    }, 250)
    return () => {
      window.clearInterval(t)
      off()
    }
  }, [])

  if (!s) return <div className="waiting">Waiting for your PC…</div>

  // PC local wall-clock time as a UTC-based Date
  const pc = new Date(clockNow + (skew.current?.ms ?? 0) + (skew.current?.tz ?? 0) * 60000)
  const hour = pc.getUTCHours()
  const isDay =
    cfg.dayStart <= cfg.nightStart ? hour >= cfg.dayStart && hour < cfg.nightStart : hour >= cfg.dayStart || hour < cfg.nightStart
  const theme = cfg.theme === 'auto' ? (isDay ? 'light' : 'dark') : cfg.theme

  const tone = (v: number): string => (v >= cfg.hot ? 'var(--hot)' : v >= cfg.warn ? 'var(--warm)' : 'var(--ok)')
  const tempTone = (c: number): string => (c >= cfg.tempWarn ? 'var(--hot)' : c >= cfg.tempWarn - 15 ? 'var(--warm)' : 'var(--ok)')
  const temp = (c: number): string => (cfg.tempUnit === 'F' ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`)
  const len = lenRef.current
  const coreCols = (n: number) => (n > 16 ? Math.ceil(n / 2) : n)

  const Head = ({ label, icon, right }: { label: string; icon: string; right?: string }) => (
    <div className="head">
      <span className="icon">{icon}</span>
      <span className="label">{label}</span>
      {right && <span className="right">{right}</span>}
    </div>
  )

  const Missing = ({ label, icon, why }: { label: string; icon: string; why: string }) => (
    <div className="tile">
      <Head label={label} icon={icon} />
      <div className="big dim">—</div>
      <div className="sub wrap">{why}</div>
    </div>
  )

  const Cores = ({ cores }: { cores: number[] }) => (
    <div className="cores" style={{ gridTemplateColumns: `repeat(${coreCols(cores.length)}, 1fr)` }}>
      {cores.map((v, i) => (
        <div key={i} className="core">
          <div className="corefill" style={{ height: `${v}%`, background: tone(v) }} />
        </div>
      ))}
    </div>
  )

  function CpuBody({ large }: { large?: boolean }) {
    const c = s!.hw?.cpuTemp
    return (
      <>
        <Head label="CPU" icon="◆" right={cfg.showCpuName ? shortCpu(s!.cpuName) : undefined} />
        {/* the chip keeps its size; only the number shrinks if the tile is too narrow */}
        <div className={`valrow big${large ? ' xl' : ''}`}>
          <Fit className="valnum">
            <span style={{ color: tone(s!.cpu.total) }}>{s!.cpu.total}</span>
            <span className="unit">%</span>
          </Fit>
          {cfg.cpuChip === 'speed' && s!.cpuGhz != null && <span className="chip">{s!.cpuGhz.toFixed(2)} GHz</span>}
          {cfg.cpuChip === 'temp' && c != null && (
            <span className={`chip${s!.hw.cpuTempStuck ? ' stuck' : ''}`} style={{ color: s!.hw.cpuTempStuck ? undefined : tempTone(c) }}>
              {s!.hw.cpuTempStuck ? '~' : ''}
              {temp(c)}
            </span>
          )}
        </div>
        <div className="graph">
          <Spark data={hist.cpu} color="var(--accent)" len={len} />
        </div>
        {cfg.showCores && <Cores cores={s!.cpu.cores} />}
      </>
    )
  }

  // One ring that fills the tile, value and % inside it (RAM, disks, GPU memory)
  function RingTile({ label, icon, right, value, unit, sub, load }: { label: string; icon: string; right?: string; value: string; unit: string; sub: string; load: number }) {
    const r = 84
    const circ = 2 * Math.PI * r
    return (
      <div className="tile">
        <Head label={label} icon={icon} right={right} />
        <div className="bigring-wrap">
          <svg className="bigring" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r={r} className="ring-bg" style={{ strokeWidth: 16 }} />
            <circle
              cx="100"
              cy="100"
              r={r}
              className="ring-fg"
              style={{ strokeWidth: 16 }}
              stroke={tone(load)}
              strokeDasharray={`${(circ * Math.min(100, load)) / 100} ${circ}`}
              transform="rotate(-90 100 100)"
            />
            <text x="100" y="86" className="br-main" style={{ fill: tone(load) }}>
              {value}
              <tspan className="br-unit" dx="4">
                {unit}
              </tspan>
            </text>
            <text x="100" y="128" className="br-sub">
              {sub}
            </text>
          </svg>
        </div>
      </div>
    )
  }

  function renderTile(kind: string, st: Stats, key: string) {
    if (kind === 'cpu')
      return (
        <div className="tile" key={key}>
          <CpuBody />
        </div>
      )

    if (kind === 'clock') {
      let h = pc.getUTCHours()
      let suffix = ''
      if (!cfg.clock24) {
        suffix = h >= 12 ? 'PM' : 'AM'
        h = h % 12 || 12
      }
      const hh = cfg.clock24 ? String(h).padStart(2, '0') : String(h)
      const mm = String(pc.getUTCMinutes()).padStart(2, '0')
      const ss = String(pc.getUTCSeconds()).padStart(2, '0')
      return (
        <div className="tile clock" key={key}>
          <div className="clock-time">
            <FitText className="clock-main" text={`${hh}:${mm}`} deps={cfg.clock24} />
            <div className="clock-side">
              <span className="clock-sec">{ss}</span>
              {suffix && <span className="clock-ampm">{suffix}</span>}
            </div>
          </div>
          <div className="clock-date">
            <span className="day">{DAYS[pc.getUTCDay()]}</span>
            <Fit className="date">
              {pc.getUTCDate()} {MONTHS[pc.getUTCMonth()]} {pc.getUTCFullYear()}
            </Fit>
          </div>
        </div>
      )
    }

    if (kind === 'ram') {
      const mem = pct(st.memUsed, st.memTotal)
      return <RingTile key={key} label="RAM" icon="▤" right={`${gb(st.memTotal)} GB`} value={gb(st.memUsed)} unit="GB" sub={`${mem}%`} load={mem} />
    }

    if (kind === 'gpu') {
      if (!st.gpu) return <Missing key={key} label="GPU" icon="▣" why="No NVIDIA GPU found" />
      return (
        <div className="tile" key={key}>
          <Head label="GPU" icon="▣" right={st.gpu.name} />
          <div className="valrow big">
            <Fit className="valnum">
              <span style={{ color: tone(st.gpu.use) }}>{st.gpu.use}</span>
              <span className="unit">%</span>
            </Fit>
            <span className="chip gputemp" style={{ color: tempTone(st.gpu.temp) }}>
              {temp(st.gpu.temp)}
            </span>
          </div>
          <div className="graph">
            <Spark data={hist.gpu} color="var(--accent2)" len={len} />
          </div>
          <div className="sub">VRAM {gb(st.gpu.memUsed)} GB</div>
        </div>
      )
    }

    if (kind === 'vram') {
      if (!st.gpu) return <Missing key={key} label="VRAM" icon="▣" why="No NVIDIA GPU found" />
      const v = pct(st.gpu.memUsed, st.gpu.memTotal)
      return <RingTile key={key} label="VRAM" icon="▣" right={`${gb(st.gpu.memTotal)} GB`} value={gb(st.gpu.memUsed)} unit="GB" sub={`${v}%`} load={v} />
    }

    if (kind === 'cpuTemp') {
      const c = st.hw?.cpuTemp
      if (c == null)
        return (
          <Missing key={key} label="CPU temp" icon="✦" why="Not available. Run LibreHardwareMonitor with its web server on, or pick another source in settings." />
        )
      return (
        <div className="tile" key={key}>
          <Head
            label="CPU temp"
            icon="✦"
            right={st.hw.cpuTempStuck ? 'not live' : st.hw.cpuTempSource === 'LibreHardwareMonitor' ? 'LHM' : st.hw.cpuTempSource ? 'Windows' : undefined}
          />
          <div className="big">
            <span style={{ color: tempTone(c) }}>{temp(c)}</span>
          </div>
          <div className="graph">
            <Spark data={hist.temp} color="var(--warm)" len={len} min={20} max={100} />
          </div>
        </div>
      )
    }

    if (kind.startsWith('disk:')) {
      const d = kind.slice(5)
      const disk = st.disks?.[d]
      const name = d === '/' ? 'Disk /' : `Disk ${d}:`
      if (!disk) return <Missing key={key} label={name} icon="◍" why="Drive not found" />
      const u = pct(disk.used, disk.total)
      return <RingTile key={key} label={name} icon="◍" right={`${gb(disk.total)} GB`} value={gb(disk.used)} unit="GB" sub={`${u}%`} load={u} />
    }

    if (kind === 'net') {
      const [dv, du] = st.net ? rate(st.net.down) : ['…', '']
      const [uv, uu] = st.net ? rate(st.net.up) : ['…', '']
      return (
        <div className="tile" key={key}>
          <Head label="Network" icon="⇅" />
          <div className="net">
            <div className="net-row">
              <span className="arrow down">↓</span>
              <span className="net-val">{dv}</span>
              <span className="unit">{du}</span>
            </div>
            <div className="net-row">
              <span className="arrow up">↑</span>
              <span className="net-val">{uv}</span>
              <span className="unit">{uu}</span>
            </div>
          </div>
          {st.net?.totalDown != null && st.net.totalUp != null && (
            <Fit className="sub totals">
              <span className="period">{PERIOD[st.netPeriod ?? 'boot'] ?? ''}</span>
              <span className="arrow down">↓</span> {size(st.net.totalDown)}
              <span className="gap" />
              <span className="arrow up">↑</span> {size(st.net.totalUp)}
            </Fit>
          )}
        </div>
      )
    }

    if (kind === 'fans') {
      const fans = st.hw?.fans ?? []
      if (!fans.length) return <Missing key={key} label="Fans" icon="✲" why="Needs LibreHardwareMonitor running with its web server on" />
      return (
        <div className="tile" key={key}>
          <Head label="Fans" icon="✲" />
          <div className="list">
            {fans.slice(0, 4).map((f, i) => (
              <div key={i} className="row">
                <span className="dim">{f.name}</span>
                <span className="num">{Math.round(f.rpm)}</span>
              </div>
            ))}
          </div>
          <div className="sub">RPM</div>
        </div>
      )
    }

    if (kind === 'cpuPower') {
      const { cpuPower, cpuClock } = st.hw ?? {}
      if (cpuPower == null && cpuClock == null)
        return <Missing key={key} label="CPU power" icon="ϟ" why="Needs LibreHardwareMonitor running with its web server on" />
      return (
        <div className="tile" key={key}>
          <Head label="CPU power" icon="ϟ" />
          <div className="big">
            <span>{cpuPower != null ? Math.round(cpuPower) : '—'}</span>
            <span className="unit">W</span>
          </div>
          <div className="sub">{cpuClock != null ? `${(cpuClock / 1000).toFixed(2)} GHz` : ''}</div>
        </div>
      )
    }

    if (kind === 'claude') {
      const c = lastClaude.current ?? st.claude
      const want = (k: string) => cfg.claudeWindows.includes(k.startsWith('model:') ? 'model' : k)
      const wins = (c?.windows ?? []).filter((w) => want(w.key))
      const session = wins.find((w) => w.key === 'session')
      const weekly = wins.find((w) => w.key === 'weekly')
      const models = wins.filter((w) => w.key.startsWith('model:'))
      if (!session && !weekly) return <Missing key={key} label="Claude" icon="✳" why={c?.error ?? 'Waiting for usage…'} />
      const arc = (r: number, w: number, value: number, color: string) => {
        const circ = 2 * Math.PI * r
        return (
          <>
            <circle cx="100" cy="100" r={r} className="ring-bg" style={{ strokeWidth: w }} />
            <circle
              cx="100"
              cy="100"
              r={r}
              className="ring-fg"
              style={{ strokeWidth: w }}
              stroke={color}
              strokeDasharray={`${(circ * Math.min(100, value)) / 100} ${circ}`}
              transform="rotate(-90 100 100)"
            />
          </>
        )
      }
      // the Car Thing's own clock isn't set, so count down against the PC's time
      const reset = session ? resetIn(session.resetsAt, clockNow + (skew.current?.ms ?? 0)) : ''
      return (
        <div className="tile" key={key}>
          <Head
            label="Claude"
            icon="✳"
            right={[...models.map((m) => `${m.label} ${m.pct}%`), c?.error ? '!' : ''].filter(Boolean).join(' · ') || undefined}
          />
          <div className="bigring-wrap">
            <svg className="bigring" viewBox="0 0 200 200">
              {session && arc(88, 14, session.pct, 'var(--accent)')}
              {weekly && arc(session ? 64 : 88, session ? 10 : 14, weekly.pct, 'var(--accent2)')}
              {session && (
                <>
                  <text x="100" y="72" className="cl-label" style={{ fill: 'var(--accent)' }}>
                    SESSION
                  </text>
                  <text x="100" y="95" className="cl-main" style={{ fill: tone(session.pct) }}>
                    {session.pct}%
                  </text>
                </>
              )}
              {weekly && (
                <text x="100" y={session ? 118 : 100} className={session ? 'cl-week' : 'cl-main'} style={{ fill: 'var(--accent2)' }}>
                  {session ? `WEEK ${weekly.pct}%` : `${weekly.pct}%`}
                </text>
              )}
              {reset && (
                <text x="100" y={session ? 138 : 124} className="cl-reset">
                  {reset}
                </text>
              )}
            </svg>
          </div>
        </div>
      )
    }

    if (kind === 'uptime') {
      return (
        <div className="tile" key={key}>
          <Head label="This PC" icon="⌂" />
          <div className="big mid">{st.host}</div>
          <div className="sub">up {upFor(st.uptime)}</div>
        </div>
      )
    }

    return <div className="tile empty" key={key} />
  }

  const style = {
    // the default sky-blue is too pale on white, so the light theme uses a deeper blue unless you picked your own
    ['--accent' as string]: theme === 'light' && cfg.accent.toLowerCase() === DEFAULT_CFG.accent ? '#0284c7' : cfg.accent,
    ['--ts' as string]: String(cfg.textScale / 100),
    ['--ns' as string]: String(cfg.numberScale / 100),
    ['--gs' as string]: String(cfg.graphScale / 100),
    ['--anim' as string]: `${Math.min(0.6, (cfg.refreshMs / 1000) * 0.8).toFixed(2)}s`
  }

  const current = (slot: string): string =>
    slot === 'leftTop' ? cfg.left[0] : slot === 'leftBottom' ? cfg.left[1] : cfg.tiles[Number(slot.slice(4)) - 1]
  function tap(slot: string) {
    if (cfg.tapToChange && (cfg.tileOptions?.length ?? 0) > 0) setPicking(slot)
  }
  function choose(slot: string, value: string) {
    setPicking(null)
    // show the change right away; the PC saves it to the settings
    setCfg((c) => {
      const left = [...c.left]
      const tiles = [...c.tiles]
      if (slot === 'leftTop') left[0] = value
      else if (slot === 'leftBottom') left[1] = value
      else tiles[Number(slot.slice(4)) - 1] = value
      return { ...c, left, tiles }
    })
    sendToServer({ request: 'setTile', payload: { slot, value } })
  }

  return (
    <div className={`app theme-${theme} layout-${cfg.layout}${stale ? ' stale' : ''}`} style={style}>
      {cfg.layout === 'split' ? (
        <>
          <div className="slot l1" onClick={() => tap('leftTop')}>
            {renderTile(cfg.left[0], s, 'l0')}
          </div>
          <div className="slot l2" onClick={() => tap('leftBottom')}>
            {renderTile(cfg.left[1], s, 'l1')}
          </div>
        </>
      ) : (
        <div className="slot lfull">
          <div className="tile">
            <CpuBody large />
            <div className="foot">
              <span>{s.host}</span>
              <span className="dim">up {upFor(s.uptime)}</span>
            </div>
          </div>
        </div>
      )}
      {cfg.tiles.slice(0, 4).map((t, i) => (
        <div key={i} className={`slot r${i + 1}`} onClick={() => tap(`tile${i + 1}`)}>
          {renderTile(t, s, `r${i}`)}
        </div>
      ))}
      {picking && (
        <div className="picker-backdrop" onClick={() => setPicking(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>Choose a tile</span>
              <button className="picker-close" onClick={() => setPicking(null)}>
                ✕
              </button>
            </div>
            <div className="picker-grid">
              {(cfg.tileOptions ?? []).map((o) => (
                <button
                  key={o.value}
                  className={`picker-opt${o.value === current(picking) ? ' on' : ''}`}
                  onClick={() => choose(picking, o.value)}
                >
                  <span className="picker-icon">{ICONS[o.value.split(':')[0]] ?? '▢'}</span>
                  <span className="picker-label">{o.label.replace(/\s*\(.*\)\s*$/, '')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
