import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  cpuTempInPanel: boolean
  theme: 'dark' | 'light' | 'auto'
  dayStart: number
  nightStart: number
  textScale: number
  numberScale: number
  graphScale: number
  accent: string
  clock24: boolean
  claudeWindows: string[]
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
  claude: { windows: { key: string; label: string; pct: number; resetsAt: string | null }[]; error: string | null } | null
  disks: Record<string, { used: number; total: number }>
  hw: {
    cpuTemp: number | null
    cpuTempSource: string | null
    cpuPower: number | null
    cpuClock: number | null
    fans: { name: string; rpm: number }[]
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
  cpuTempInPanel: true,
  theme: 'dark',
  dayStart: 7,
  nightStart: 19,
  textScale: 100,
  numberScale: 100,
  graphScale: 100,
  accent: '#4fc3f7',
  clock24: false,
  claudeWindows: ['session', 'weekly', 'model'],
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

function Ring({ value, color }: { value: number; color: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} className="ring-bg" />
      <circle
        cx="50"
        cy="50"
        r={r}
        stroke={color}
        className="ring-fg"
        strokeDasharray={`${(c * Math.min(100, value)) / 100} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" className="ring-txt">
        {value}%
      </text>
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
        <div className={`big${large ? ' xl' : ''}`}>
          <span style={{ color: tone(s!.cpu.total) }}>{s!.cpu.total}</span>
          <span className="unit">%</span>
          {cfg.cpuTempInPanel && c != null && (
            <span className="chip" style={{ color: tempTone(c) }}>
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
            <span className="date">
              {pc.getUTCDate()} {MONTHS[pc.getUTCMonth()]} {pc.getUTCFullYear()}
            </span>
          </div>
        </div>
      )
    }

    if (kind === 'ram') {
      const mem = pct(st.memUsed, st.memTotal)
      return (
        <div className="tile" key={key}>
          <Head label="Memory" icon="▤" />
          <div className="split">
            <div className="split-main">
              <div className="big">
                <span style={{ color: tone(mem) }}>{gb(st.memUsed)}</span>
              </div>
              <div className="sub">GB used</div>
            </div>
            <Ring value={mem} color={tone(mem)} />
          </div>
        </div>
      )
    }

    if (kind === 'gpu') {
      if (!st.gpu) return <Missing key={key} label="GPU" icon="▣" why="No NVIDIA GPU found" />
      return (
        <div className="tile" key={key}>
          <Head label="GPU" icon="▣" right={st.gpu.name} />
          <div className="big">
            <span style={{ color: tone(st.gpu.use) }}>{st.gpu.use}</span>
            <span className="unit">%</span>
            <span className="chip" style={{ color: tempTone(st.gpu.temp) }}>
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
      return (
        <div className="tile" key={key}>
          <Head label="GPU memory" icon="▣" />
          <div className="split">
            <div className="split-main">
              <div className="big">
                <span style={{ color: tone(v) }}>{gb(st.gpu.memUsed)}</span>
              </div>
              <div className="sub">GB used</div>
            </div>
            <Ring value={v} color={tone(v)} />
          </div>
        </div>
      )
    }

    if (kind === 'cpuTemp') {
      const c = st.hw?.cpuTemp
      if (c == null)
        return (
          <Missing key={key} label="CPU temp" icon="✦" why="Not available. Run LibreHardwareMonitor with its web server on, or pick another source in settings." />
        )
      return (
        <div className="tile" key={key}>
          <Head label="CPU temp" icon="✦" right={st.hw.cpuTempSource === 'LibreHardwareMonitor' ? 'LHM' : st.hw.cpuTempSource ? 'Windows' : undefined} />
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
      return (
        <div className="tile" key={key}>
          <Head label={name} icon="◍" />
          <div className="split">
            <div className="split-main">
              <div className="big">
                <span style={{ color: tone(u) }}>{gb(disk.total - disk.used)}</span>
              </div>
              <div className="sub">GB free</div>
            </div>
            <Ring value={u} color={tone(u)} />
          </div>
        </div>
      )
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
            <div className="sub totals">
              <span className="arrow down">↓</span> {size(st.net.totalDown)}
              <span className="gap" />
              <span className="arrow up">↑</span> {size(st.net.totalUp)}
            </div>
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
      const wins = (c?.windows ?? []).filter((w) => want(w.key)).slice(0, 3)
      if (!wins.length) return <Missing key={key} label="Claude" icon="✳" why={c?.error ?? 'Waiting for usage…'} />
      return (
        <div className="tile" key={key}>
          <Head label="Claude" icon="✳" right={c?.error ? '!' : undefined} />
          <div className={`rings n${wins.length}`}>
            {wins.map((w) => (
              <div key={w.key} className="ringcell">
                <Ring value={w.pct} color={tone(w.pct)} />
                <div className="ringlabel">{w.label}</div>
                <div className="ringsub">{resetIn(w.resetsAt, clockNow)}</div>
              </div>
            ))}
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

  return (
    <div className={`app theme-${theme} layout-${cfg.layout}${stale ? ' stale' : ''}`} style={style}>
      {cfg.layout === 'split' ? (
        <>
          <div className="slot l1">{renderTile(cfg.left[0], s, 'l0')}</div>
          <div className="slot l2">{renderTile(cfg.left[1], s, 'l1')}</div>
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
        <div key={i} className={`slot r${i + 1}`}>
          {renderTile(t, s, `r${i}`)}
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
