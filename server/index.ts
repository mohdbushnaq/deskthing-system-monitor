import { DeskThing } from '@deskthing/server'
import { DESKTHING_EVENTS, SETTING_TYPES } from '@deskthing/types'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { PREVIEW_HTML } from './preview'
import manifest from '../deskthing/manifest.json'

// DeskThing starts app servers with a nearly empty environment (no PATH, SystemRoot, ProgramFiles).
// Windows tools such as nvidia-smi, netstat and PowerShell fail without them, so fill in the usual defaults.
const WIN = process.platform === 'win32'
const WIN_ROOT = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
const SYS32 = path.join(WIN_ROOT, 'System32')
const TOOL_ENV: NodeJS.ProcessEnv = WIN
  ? {
      ...process.env,
      SystemRoot: WIN_ROOT,
      windir: WIN_ROOT,
      SystemDrive: process.env.SystemDrive || WIN_ROOT.slice(0, 2),
      ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
      ProgramW6432: process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files',
      ProgramData: process.env.ProgramData || 'C:\\ProgramData',
      PSModulePath: process.env.PSModulePath || path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'Modules'),
      PATH: [process.env.PATH, SYS32, WIN_ROOT, path.join(SYS32, 'WindowsPowerShell', 'v1.0')].filter(Boolean).join(';')
    }
  : process.env

function run(tools: string[], args: string[], timeout = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const attempt = (i: number): void => {
      if (i >= tools.length) return resolve(null)
      execFile(tools[i], args, { timeout, windowsHide: true, env: TOOL_ENV }, (err, stdout) => {
        if (err) return attempt(i + 1)
        resolve(String(stdout))
      })
    }
    attempt(0)
  })
}

const num = (s: unknown): number | null => {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  if (typeof s !== 'string') return null
  let t = s.replace(/[^\d.,-]/g, '')
  // "1,234" is a thousands separator, "61,3" is a decimal comma (European locales)
  if (t.includes(',') && !t.includes('.') && !/,\d{3}(?!\d)/.test(t)) t = t.replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

// ================================================================ Settings
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
  claudeSource: 'auto' | 'code' | 'web' | 'off'
  claudeCredPath: string
  claudeSessionKey: string
  claudeWindows: string[]
  claudeEvery: number
  tempSource: 'auto' | 'lhm' | 'windows' | 'off'
  lhmUrl: string
  tempUnit: 'C' | 'F'
  refreshMs: number
  warn: number
  hot: number
  tempWarn: number
}
const DEFAULT: Cfg = {
  layout: 'split',
  left: ['cpu', 'clock'],
  // right grid: top-left, top-right, bottom-left, bottom-right
  tiles: ['ram', 'disk:C', 'gpu', 'net'],
  showCores: true,
  showCpuName: true,
  cpuTempInPanel: true,
  theme: 'dark',
  dayStart: 7,
  nightStart: 19,
  textScale: 150,
  numberScale: 150,
  graphScale: 160,
  accent: '#4fc3f7',
  clock24: false,
  claudeSource: 'auto',
  claudeCredPath: '~/.claude/.credentials.json',
  claudeSessionKey: '',
  claudeWindows: ['session', 'weekly', 'model'],
  claudeEvery: 60,
  tempSource: 'auto',
  lhmUrl: 'http://localhost:8085/data.json',
  tempUnit: 'C',
  refreshMs: 1000,
  warn: 60,
  hot: 85,
  tempWarn: 80
}
let cfg: Cfg = { ...DEFAULT, left: [...DEFAULT.left], tiles: [...DEFAULT.tiles] }

// Settings whose meaning changed in 1.3.0 are versioned so DeskThing replaces old saved values once
const LAYOUT_VERSION = '1.3.0'
const PREVIEW_PORT = 8893

function drives(): string[] {
  if (!WIN) return ['/']
  const found: string[] = []
  for (let c = 67; c <= 90; c++) {
    const L = String.fromCharCode(c)
    try {
      fs.statfsSync(`${L}:\\`)
      found.push(L)
    } catch {
      /* not present */
    }
  }
  return found.length ? found : ['C']
}

function tileOptions(): { label: string; value: string }[] {
  return [
    { label: 'CPU (load, temperature, graph, cores)', value: 'cpu' },
    { label: 'Clock & date', value: 'clock' },
    { label: 'RAM', value: 'ram' },
    { label: 'GPU (load, temperature, VRAM)', value: 'gpu' },
    { label: 'GPU video memory', value: 'vram' },
    { label: 'CPU temperature', value: 'cpuTemp' },
    ...drives().map((d) => ({ label: WIN ? `Disk ${d}:` : 'Disk /', value: `disk:${d}` })),
    { label: 'Network up/down', value: 'net' },
    { label: 'Fans (needs LibreHardwareMonitor)', value: 'fans' },
    { label: 'CPU power & clock (needs LibreHardwareMonitor)', value: 'cpuPower' },
    { label: 'Claude usage (session, weekly, Fable)', value: 'claude' },
    { label: 'Uptime & PC name', value: 'uptime' },
    { label: 'Empty', value: 'none' }
  ]
}

function settingsDef(): Record<string, unknown> {
  const opts = tileOptions()
  const select = (id: string, label: string, value: string, options: { label: string; value: string }[], extra = {}) => ({
    id,
    type: SETTING_TYPES.SELECT,
    label,
    value,
    options,
    ...extra
  })
  const range = (id: string, label: string, value: number, min: number, max: number, step: number, extra = {}) => ({
    id,
    type: SETTING_TYPES.RANGE,
    label,
    value,
    min,
    max,
    step,
    ...extra
  })
  const bool = (id: string, label: string, value: boolean, extra = {}) => ({ id, type: SETTING_TYPES.BOOLEAN, label, value, ...extra })
  const splitOnly = { dependsOn: [{ settingId: 'layout', isValue: 'split' }] }
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, value: String(h) }))

  // DeskThing lists settings in this order
  return {
    // ---------- Left side
    layout: select(
      'layout',
      '◧ Left side · layout',
      cfg.layout,
      [
        { label: 'Two tiles (top and bottom)', value: 'split' },
        { label: 'One large CPU panel', value: 'full' }
      ],
      { version: LAYOUT_VERSION, description: 'Two tiles gives 6 tiles in total. One large CPU panel gives 4 tiles on the right.' }
    ),
    leftTop: select('leftTop', '◧ Left side · top tile', cfg.left[0], opts, { ...splitOnly, version: LAYOUT_VERSION }),
    leftBottom: select('leftBottom', '◧ Left side · bottom tile', cfg.left[1], opts, { ...splitOnly, version: LAYOUT_VERSION }),
    cpuTempInPanel: bool('cpuTempInPanel', '◧ CPU · show temperature next to CPU %', cfg.cpuTempInPanel),
    showCores: bool('showCores', '◧ CPU · show per-core bars', cfg.showCores),
    showCpuName: bool('showCpuName', '◧ CPU · show model name', cfg.showCpuName),
    clock24: bool('clock24', '◧ Clock · 24-hour time (off = AM/PM)', cfg.clock24, { version: '1.4.0' }),

    // ---------- Right side
    tile1: select('tile1', '◨ Right side · top left', cfg.tiles[0], opts, { version: LAYOUT_VERSION }),
    tile2: select('tile2', '◨ Right side · top right', cfg.tiles[1], opts, { version: LAYOUT_VERSION }),
    tile3: select('tile3', '◨ Right side · bottom left', cfg.tiles[2], opts, { version: LAYOUT_VERSION }),
    tile4: select('tile4', '◨ Right side · bottom right', cfg.tiles[3], opts, { version: LAYOUT_VERSION }),

    // ---------- Claude usage
    claudeWindows: {
      id: 'claudeWindows',
      type: SETTING_TYPES.MULTISELECT,
      label: '✳ Claude usage · rings to show',
      value: cfg.claudeWindows,
      options: [
        { label: 'Current session (5-hour)', value: 'session' },
        { label: 'Weekly (all models)', value: 'weekly' },
        { label: 'Weekly per model (e.g. Fable)', value: 'model' }
      ]
    },
    claudeEvery: select(
      'claudeEvery',
      '✳ Claude usage · check every',
      String(cfg.claudeEvery),
      [
        { label: '30 seconds', value: '30' },
        { label: '1 minute', value: '60' },
        { label: '2 minutes', value: '120' },
        { label: '5 minutes', value: '300' },
        { label: '10 minutes', value: '600' }
      ],
      { description: 'The tile keeps showing the last reading in between.' }
    ),
    claudeSource: select(
      'claudeSource',
      '✳ Claude usage · sign-in',
      cfg.claudeSource,
      [
        { label: 'Auto (Claude Code login, else session key)', value: 'auto' },
        { label: 'Claude Code login on this PC', value: 'code' },
        { label: 'claude.ai session key', value: 'web' },
        { label: 'Off', value: 'off' }
      ],
      {
        description:
          'Claude Code login: install Claude Code and sign in with your Claude account once; its saved login is read from the file below. Session key: paste the "sessionKey" cookie from claude.ai. It works like a password and is only stored in DeskThing on this PC.'
      }
    ),
    claudeCredPath: { id: 'claudeCredPath', type: SETTING_TYPES.STRING, label: '✳ Claude Code login file', value: cfg.claudeCredPath },
    claudeSessionKey: {
      id: 'claudeSessionKey',
      type: SETTING_TYPES.STRING,
      label: '✳ claude.ai session key',
      description:
        'How to get it: 1) Open claude.ai in Chrome or Edge and make sure you are signed in. 2) Press F12 to open DevTools. 3) Go to Application → Storage → Cookies → https://claude.ai. 4) Find the row named "sessionKey" and copy its Value (it starts with sk-ant-). 5) Paste it here and press Save. Treat it like a password: it stays only in DeskThing on this PC. If you sign out of claude.ai you will need a new one.',
      value: cfg.claudeSessionKey
    },

    // ---------- Look
    theme: select('theme', '🎨 Theme', cfg.theme, [
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' },
      { label: 'Auto: light by day, dark by night', value: 'auto' }
    ]),
    dayStart: select('dayStart', '🎨 Auto theme · day starts at', String(cfg.dayStart), hours, {
      dependsOn: [{ settingId: 'theme', isValue: 'auto' }]
    }),
    nightStart: select('nightStart', '🎨 Auto theme · night starts at', String(cfg.nightStart), hours, {
      dependsOn: [{ settingId: 'theme', isValue: 'auto' }]
    }),
    textScale: range('textScale', '🎨 Text size (%)', cfg.textScale, 70, 150, 5, { description: 'Labels and small text.', version: '1.5.0' }),
    numberScale: range('numberScale', '🎨 Number size (%)', cfg.numberScale, 70, 150, 5, { description: 'The big values and the clock.', version: '1.5.0' }),
    graphScale: range('graphScale', '🎨 Graph size (%)', cfg.graphScale, 50, 160, 10, { description: 'Height of graphs and core bars.', version: '1.5.0' }),
    accent: { id: 'accent', type: SETTING_TYPES.COLOR, label: '🎨 Accent colour', value: cfg.accent },

    // ---------- Data
    refreshMs: select('refreshMs', '⏱ Refresh every', String(cfg.refreshMs), [
      { label: '0.25 s', value: '250' },
      { label: '0.5 s', value: '500' },
      { label: '0.75 s', value: '750' },
      { label: '1 s', value: '1000' },
      { label: '2 s', value: '2000' },
      { label: '3 s', value: '3000' },
      { label: '5 s', value: '5000' }
    ], { description: 'CPU, RAM and disks follow this. GPU and network update at most once a second.' }),
    tempSource: select(
      'tempSource',
      '🌡 CPU temperature source',
      cfg.tempSource,
      [
        { label: 'Auto (LibreHardwareMonitor, else Windows)', value: 'auto' },
        { label: 'LibreHardwareMonitor only', value: 'lhm' },
        { label: 'Windows thermal zone only', value: 'windows' },
        { label: 'Off', value: 'off' }
      ],
      {
        description:
          'LibreHardwareMonitor gives the real CPU package temperature (run it as admin and turn on Options → Remote Web Server). The Windows thermal zone is only an approximation on most PCs.'
      }
    ),
    lhmUrl: { id: 'lhmUrl', type: SETTING_TYPES.STRING, label: '🌡 LibreHardwareMonitor URL', value: cfg.lhmUrl },
    tempUnit: select('tempUnit', '🌡 Temperature unit', cfg.tempUnit, [
      { label: 'Celsius', value: 'C' },
      { label: 'Fahrenheit', value: 'F' }
    ]),
    warn: range('warn', '🚦 Amber above (load %)', cfg.warn, 30, 95, 5),
    hot: range('hot', '🚦 Red above (load %)', cfg.hot, 40, 100, 5),
    tempWarn: range('tempWarn', '🚦 Red above (temperature °C)', cfg.tempWarn, 50, 100, 5),

    // ---------- Preview
    openPreview: bool('openPreview', '🖥 Open the 3D Car Thing preview after saving', false, {
      description: `Turn on and press Save to open a live 3D preview in your browser (http://localhost:${PREVIEW_PORT}/). It switches itself off again.`
    })
  }
}

function applySettings(s: Record<string, { value?: unknown }> | null | undefined): void {
  if (!s) return
  const v = (k: string) => s[k]?.value
  const pick = (k: string, d: string) => {
    const t = v(k)
    return typeof t === 'string' && t ? t : d
  }
  const bool = (k: keyof Cfg) => (typeof v(k) === 'boolean' ? (v(k) as boolean) : (DEFAULT[k] as boolean))
  const n = (k: keyof Cfg) => num(v(k)) ?? (DEFAULT[k] as number)
  const str = (k: keyof Cfg) => (typeof v(k) === 'string' && (v(k) as string).trim() ? (v(k) as string).trim() : (DEFAULT[k] as string))
  const oneOf = <T extends string>(k: keyof Cfg, allowed: T[]): T => (allowed.includes(v(k) as T) ? (v(k) as T) : (DEFAULT[k] as T))
  cfg = {
    layout: oneOf('layout', ['split', 'full']),
    left: [pick('leftTop', DEFAULT.left[0]), pick('leftBottom', DEFAULT.left[1])],
    tiles: [0, 1, 2, 3].map((i) => pick(`tile${i + 1}`, DEFAULT.tiles[i])),
    showCores: bool('showCores'),
    showCpuName: bool('showCpuName'),
    cpuTempInPanel: bool('cpuTempInPanel'),
    theme: oneOf('theme', ['dark', 'light', 'auto']),
    dayStart: Math.min(23, Math.max(0, n('dayStart'))),
    nightStart: Math.min(23, Math.max(0, n('nightStart'))),
    textScale: n('textScale'),
    numberScale: n('numberScale'),
    graphScale: n('graphScale'),
    accent: str('accent'),
    clock24: bool('clock24'),
    claudeSource: oneOf('claudeSource', ['auto', 'code', 'web', 'off']),
    claudeCredPath: str('claudeCredPath'),
    claudeSessionKey: typeof v('claudeSessionKey') === 'string' ? (v('claudeSessionKey') as string).trim() : '',
    claudeWindows: Array.isArray(v('claudeWindows')) ? (v('claudeWindows') as string[]) : DEFAULT.claudeWindows,
    claudeEvery: Math.min(600, Math.max(30, n('claudeEvery'))),
    tempSource: oneOf('tempSource', ['auto', 'lhm', 'windows', 'off']),
    lhmUrl: str('lhmUrl'),
    tempUnit: oneOf('tempUnit', ['C', 'F']),
    refreshMs: Math.min(5000, Math.max(250, n('refreshMs'))),
    warn: n('warn'),
    hot: n('hot'),
    tempWarn: n('tempWarn')
  }
}

// ================================================================ CPU load
let lastCpu = os.cpus().map((c) => c.times)
function cpuLoad(): { total: number; cores: number[] } {
  const now = os.cpus().map((c) => c.times)
  let idleAll = 0
  let totalAll = 0
  const cores = now.map((t, i) => {
    const p = lastCpu[i] ?? t
    const idle = t.idle - p.idle
    const total = t.user - p.user + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle
    idleAll += idle
    totalAll += total
    return total ? Math.round(100 * (1 - idle / total)) : 0
  })
  lastCpu = now
  return { total: totalAll ? Math.round(100 * (1 - idleAll / totalAll)) : 0, cores }
}

// ================================================================ GPU (NVIDIA)
type Gpu = { name: string; use: number; temp: number; memUsed: number; memTotal: number; power: number | null }
let gpu: Gpu | null = null
const SMI = [...(WIN ? [path.join(SYS32, 'nvidia-smi.exe')] : []), 'nvidia-smi']
let gpuBusy = false
async function readGpu(): Promise<void> {
  if (gpuBusy) return
  gpuBusy = true
  try {
    await readGpuOnce()
  } finally {
    gpuBusy = false
  }
}
async function readGpuOnce(): Promise<void> {
  const out = await run(SMI, [
    '--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw',
    '--format=csv,noheader,nounits'
  ])
  if (!out) {
    gpu = null
    return
  }
  const [name, use, temp, memUsed, memTotal, power] = out.split('\n')[0].split(',').map((x) => x.trim())
  const n = [use, temp, memUsed, memTotal].map(Number)
  gpu = n.every(Number.isFinite)
    ? {
        name: name.replace(/^NVIDIA\s+(GeForce\s+)?/i, ''),
        use: n[0],
        temp: n[1],
        memUsed: n[2] * 1048576,
        memTotal: n[3] * 1048576,
        power: num(power)
      }
    : null
}

// ================================================================ Network
let lastNet: { rx: number; tx: number; at: number } | null = null
let net: { down: number; up: number; totalDown: number | null; totalUp: number | null } | null = null
// Totals since Windows started, from 64-bit adapter counters (netstat's counters wrap at 4 GB)
let netTotals: { down: number; up: number } | null = null
let totalsBusy = false
async function readNetTotals(): Promise<void> {
  if (!WIN || totalsBusy) return
  totalsBusy = true
  try {
    const out = await run(
      PS,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$s = Get-NetAdapterStatistics -ErrorAction SilentlyContinue; if ($s) { "{0} {1}" -f ($s | Measure-Object ReceivedBytes -Sum).Sum, ($s | Measure-Object SentBytes -Sum).Sum }'
      ],
      8000
    )
    const [d, u] = (out ?? '').trim().split(/\s+/).map(Number)
    if (Number.isFinite(d) && Number.isFinite(u)) netTotals = { down: d, up: u }
  } finally {
    totalsBusy = false
  }
}
const NETSTAT = [...(WIN ? [path.join(SYS32, 'netstat.exe')] : []), 'netstat']
let netBusy = false
async function readNet(): Promise<void> {
  if (!WIN || netBusy) return
  netBusy = true
  try {
    await readNetOnce()
  } finally {
    netBusy = false
  }
}
async function readNetOnce(): Promise<void> {
  const out = await run(NETSTAT, ['-e'])
  if (!out) return
  const row = out
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .find((p) => p.length >= 3 && /^\d+$/.test(p[p.length - 1]) && /^\d+$/.test(p[p.length - 2]))
  if (!row) return
  const rx = Number(row[row.length - 2])
  const tx = Number(row[row.length - 1])
  const at = Date.now()
  if (lastNet && at > lastNet.at && rx >= lastNet.rx && tx >= lastNet.tx) {
    const s = (at - lastNet.at) / 1000
    net = { down: (rx - lastNet.rx) / s, up: (tx - lastNet.tx) / s, totalDown: netTotals?.down ?? null, totalUp: netTotals?.up ?? null }
  }
  lastNet = { rx, tx, at }
}

// ================================================================ Disks
function readDisks(): Record<string, { used: number; total: number }> {
  const out: Record<string, { used: number; total: number }> = {}
  for (const t of shown()) {
    if (!t.startsWith('disk:')) continue
    const d = t.slice(5)
    try {
      const s = fs.statfsSync(WIN ? `${d}:\\` : d === '/' ? '/' : d)
      const total = s.blocks * s.bsize
      out[d] = { used: total - s.bavail * s.bsize, total }
    } catch {
      /* drive gone */
    }
  }
  return out
}

// ================================================================ Temperatures / fans
type Hw = {
  cpuTemp: number | null
  cpuTempSource: string | null
  cpuPower: number | null
  cpuClock: number | null
  fans: { name: string; rpm: number }[]
  // true when the reading hasn't moved for a long time (typical of the Windows ACPI thermal zone)
  cpuTempStuck?: boolean
}
let hw: Hw = { cpuTemp: null, cpuTempSource: null, cpuPower: null, cpuClock: null, fans: [] }
// recent CPU temperature readings, to spot a sensor that never changes
const tempHistory: number[] = []

type LhmNode = { Text?: string; Value?: string; Type?: string; SensorId?: string; ImageURL?: string; Children?: LhmNode[] }

async function readLhm(): Promise<Hw | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2000)
    const res = await fetch(cfg.lhmUrl, { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const root = (await res.json()) as LhmNode
    const leaves: { hw: string; hwImg: string; group: string; text: string; value: string; id: string }[] = []
    const walk = (n: LhmNode, hwName: string, hwImg: string, group: string, depth: number): void => {
      const kids = n.Children ?? []
      // depth 2 = hardware (CPU, GPU, motherboard…), sub-hardware keeps the parent's identity
      const isHw = depth === 2
      const nh = isHw ? n.Text ?? '' : hwName
      const ni = isHw ? n.ImageURL ?? '' : hwImg
      if (!kids.length && n.Value !== undefined && n.Value !== '') {
        leaves.push({ hw: nh, hwImg: ni, group, text: n.Text ?? '', value: n.Value, id: n.SensorId ?? '' })
        return
      }
      kids.forEach((k) => walk(k, nh, ni, n.Text ?? group, depth + 1))
    }
    walk(root, '', '', '', 0)
    const isCpu = (l: (typeof leaves)[number]) => /cpu/i.test(l.hwImg) || /\/(intel|amd)cpu\//i.test(l.id)
    const temps = leaves.filter((l) => isCpu(l) && (/temperature/i.test(l.id) || /temperature/i.test(l.group) || /°C|°F/.test(l.value)))
    const pick =
      temps.find((l) => /package/i.test(l.text)) ??
      temps.find((l) => /tctl|tdie/i.test(l.text)) ??
      temps.find((l) => /core max/i.test(l.text)) ??
      temps.find((l) => /core average/i.test(l.text)) ??
      temps[0]
    const powers = leaves.filter((l) => isCpu(l) && (/\/power\//i.test(l.id) || /power/i.test(l.group) || /\bW$/.test(l.value.trim())))
    const power = powers.find((l) => /package/i.test(l.text)) ?? powers[0]
    const clocks = leaves.filter((l) => isCpu(l) && (/\/clock\//i.test(l.id) || /clock/i.test(l.group) || /MHz/.test(l.value)) && /core/i.test(l.text))
    const clockVals = clocks.map((l) => num(l.value)).filter((x): x is number => x !== null && x > 0)
    const fans = leaves
      .filter((l) => /\/fan\//i.test(l.id) || /^fans?$/i.test(l.group) || /RPM/i.test(l.value))
      .map((l) => ({ name: l.text, rpm: num(l.value) ?? 0 }))
      .filter((f) => f.rpm > 0)
    return {
      cpuTemp: pick ? num(pick.value) : null,
      cpuTempSource: pick ? 'LibreHardwareMonitor' : null,
      cpuPower: power ? num(power.value) : null,
      cpuClock: clockVals.length ? Math.max(...clockVals) : null,
      fans
    }
  } catch {
    return null
  }
}

const PS = [path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe']
async function readWindowsTemp(): Promise<number | null> {
  if (!WIN) return null
  // Performance-counter thermal zones need no admin rights; values are tenths of a kelvin
  const out = await run(
    PS,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$z = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue; if ($z) { ($z | Measure-Object -Property HighPrecisionTemperature -Maximum).Maximum }'
    ],
    6000
  )
  const v = num(out?.trim())
  if (v === null || v <= 0) return null
  const c = v / 10 - 273.15
  return c > 5 && c < 125 ? Math.round(c * 10) / 10 : null
}

// ================================================================ Claude usage
type UsageWindow = { key: string; label: string; pct: number; resetsAt: string | null }
type Claude = { windows: UsageWindow[]; error: string | null; at: number } | null
let claude: Claude = null

const expandHome = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)

function prettyModel(key: string): string {
  // seven_day_opus → Opus, seven_day_fable → Fable, seven_day_oauth_apps → Apps
  const name = key.replace(/^seven_day_?/, '').replace(/_/g, ' ').trim()
  if (/oauth/i.test(name)) return 'Apps'
  return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Model'
}

function parseUsage(data: Record<string, unknown>): UsageWindow[] {
  const out: UsageWindow[] = []
  const win = (k: string, label: string, raw: unknown) => {
    const w = raw as { utilization?: unknown; resets_at?: unknown } | null
    const pct = w ? num(w.utilization) : null
    if (pct === null) return
    out.push({ key: k, label, pct: Math.max(0, Math.min(100, Math.round(pct))), resetsAt: typeof w!.resets_at === 'string' ? w!.resets_at : null })
  }
  win('session', 'Session', data.five_hour)
  win('weekly', 'Weekly', data.seven_day)
  // Per-model weekly caps (Fable, Opus, Sonnet…). Skip ones that are switched off (null) or empty.
  for (const [k, raw] of Object.entries(data)) {
    if (!/^seven_day_./.test(k) || /cowork|oauth/i.test(k) || !raw) continue
    const w = raw as { utilization?: unknown }
    if (num(w.utilization) === null) continue
    win(`model:${k}`, prettyModel(k), raw)
  }
  // Newer responses may group the per-model cap under another name
  const scoped = (data.weekly_scoped ?? data.seven_day_scoped) as Record<string, unknown> | undefined
  if (scoped && typeof scoped === 'object') {
    if ('utilization' in scoped) win('model:scoped', typeof scoped.model === 'string' ? prettyModel(scoped.model) : 'Model', scoped)
    else for (const [k, raw] of Object.entries(scoped)) win(`model:${k}`, prettyModel(k), raw)
  }
  return out
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal })
    const text = await res.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 200)
    }
    return { ok: res.ok, status: res.status, body }
  } finally {
    clearTimeout(t)
  }
}

async function usageFromClaudeCode(): Promise<UsageWindow[] | string> {
  let token: string | undefined
  try {
    const raw = JSON.parse(fs.readFileSync(expandHome(cfg.claudeCredPath), 'utf8'))
    token = raw?.claudeAiOauth?.accessToken ?? raw?.access_token
  } catch {
    return 'No Claude Code login found on this PC'
  }
  if (!token) return 'Claude Code login file has no token'
  const r = await getJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'Content-Type': 'application/json',
    'User-Agent': 'claude-code/2 (deskthing-system-monitor)'
  })
  if (r.status === 401) return 'Claude Code login expired: open Claude Code once to refresh it'
  if (!r.ok) return `Claude usage request failed (${r.status})`
  return parseUsage(r.body as Record<string, unknown>)
}

let webOrg: string | null = null
async function usageFromWeb(): Promise<UsageWindow[] | string> {
  const key = cfg.claudeSessionKey.replace(/^sessionKey=/, '')
  if (!key) return 'Add your claude.ai session key in settings'
  const headers = {
    Cookie: `sessionKey=${key}`,
    Accept: 'application/json',
    'anthropic-client-platform': 'web_claude_ai',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
  }
  if (!webOrg) {
    const o = await getJson('https://claude.ai/api/organizations', headers)
    if (o.status === 401 || o.status === 403) return 'claude.ai rejected the session key (expired, or blocked)'
    if (!o.ok || !Array.isArray(o.body)) return `claude.ai request failed (${o.status})`
    const orgs = o.body as { uuid?: string; capabilities?: string[] }[]
    webOrg = (orgs.find((x) => x.capabilities?.includes('chat')) ?? orgs[0])?.uuid ?? null
    if (!webOrg) return 'No Claude organisation found for this account'
  }
  const r = await getJson(`https://claude.ai/api/organizations/${webOrg}/usage`, headers)
  if (r.status === 401 || r.status === 403) {
    webOrg = null
    return 'claude.ai rejected the session key (expired, or blocked)'
  }
  if (!r.ok) return `claude.ai usage request failed (${r.status})`
  return parseUsage(r.body as Record<string, unknown>)
}

let claudeBusy = false
let lastClaudeKey = ''
async function readClaude(force = false): Promise<void> {
  if (cfg.claudeSource === 'off') {
    claude = null
    return
  }
  // Not on screen: don't call the API, but keep the last reading so it shows instantly if the tile comes back
  if (!shown().includes('claude')) return
  const key = `${cfg.claudeSource}|${cfg.claudeCredPath}|${cfg.claudeSessionKey}`
  if (key !== lastClaudeKey) {
    webOrg = null
    lastClaudeKey = key
    force = true
  }
  if (claudeBusy || (!force && claude && Date.now() - claude.at < cfg.claudeEvery * 1000 - 2000)) return
  claudeBusy = true
  try {
    let result: UsageWindow[] | string = 'Not signed in'
    if (cfg.claudeSource === 'code' || cfg.claudeSource === 'auto') result = await usageFromClaudeCode()
    if (cfg.claudeSource === 'web' || (cfg.claudeSource === 'auto' && typeof result === 'string' && cfg.claudeSessionKey)) {
      result = await usageFromWeb()
    }
    // An empty or failed reading never wipes the last good one, so the tile doesn't flicker
    claude =
      typeof result === 'string' || !result.length
        ? { windows: claude?.windows ?? [], error: typeof result === 'string' ? result : 'No usage data returned', at: Date.now() }
        : { windows: result, error: null, at: Date.now() }
  } catch (e) {
    claude = { windows: claude?.windows ?? [], error: `Claude usage unavailable: ${(e as Error).message}`, at: Date.now() }
  } finally {
    claudeBusy = false
  }
}

let hwBusy = false
async function readHw(): Promise<void> {
  if (hwBusy) return
  hwBusy = true
  try {
    const src = cfg.tempSource
    const wantsLhm = src === 'auto' || src === 'lhm' || shown().some((t) => t === 'fans' || t === 'cpuPower')
    const lhm = wantsLhm ? await readLhm() : null
    let next: Hw = lhm ?? { cpuTemp: null, cpuTempSource: null, cpuPower: null, cpuClock: null, fans: [] }
    if (src === 'lhm' && !lhm?.cpuTemp) next = { ...next, cpuTemp: null, cpuTempSource: null }
    if ((src === 'windows' || (src === 'auto' && next.cpuTemp === null)) && needsCpuTemp()) {
      const w = await readWindowsTemp()
      next = { ...next, cpuTemp: w, cpuTempSource: w !== null ? 'Windows thermal zone' : null }
    }
    if (src === 'off') next = { ...next, cpuTemp: null, cpuTempSource: null }
    if (next.cpuTemp !== null) {
      tempHistory.push(next.cpuTemp)
      if (tempHistory.length > 30) tempHistory.shift()
    }
    // A real CPU sensor moves by at least a fraction of a degree within a minute or so; the ACPI zone often never does
    const stuck = tempHistory.length >= 20 && Math.max(...tempHistory) - Math.min(...tempHistory) < 0.05
    hw = { ...next, cpuTempStuck: stuck && next.cpuTempSource === 'Windows thermal zone' }
  } finally {
    hwBusy = false
  }
}
const needsCpuTemp = () => (cfg.cpuTempInPanel && shownCpuPanel()) || shown().includes('cpuTemp')
const shownCpuPanel = () => cfg.layout === 'full' || shown().includes('cpu')
// Every tile currently on screen
const shown = (): string[] => [...(cfg.layout === 'split' ? cfg.left : []), ...cfg.tiles]

// ================================================================ Send (to the Car Thing and to the 3D preview)
type Msg = { request: 'config' | 'stats'; payload: unknown }
const sseClients = new Set<http.ServerResponse>()

function broadcast(msg: Msg): void {
  DeskThing.send({ type: 'sysmon', ...msg } as never)
  if (!sseClients.size) return
  const line = `data: ${JSON.stringify(msg)}\n\n`
  sseClients.forEach((res) => res.write(line))
}

let lastStats: Msg | null = null
const configMsg = (): Msg => ({ request: 'config', payload: { ...cfg, version: manifest.version } })

function sendStats(): void {
  const total = os.totalmem()
  lastStats = {
    request: 'stats',
    payload: {
      cpu: cpuLoad(),
      cpuName: os.cpus()[0]?.model?.replace(/\s+/g, ' ').trim() ?? '',
      memUsed: total - os.freemem(),
      memTotal: total,
      gpu,
      net,
      disks: readDisks(),
      hw,
      claude,
      uptime: os.uptime(),
      host: os.hostname(),
      now: Date.now(),
      tz: -new Date().getTimezoneOffset()
    }
  }
  broadcast(lastStats)
}

// ================================================================ 3D preview web server (localhost only)
let previewServer: http.Server | null = null
const CLIENT_DIR = path.join(__dirname, '..', 'client')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.json': 'application/json'
}

function startPreviewServer(): void {
  if (previewServer) return
  previewServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/' || url.pathname === '/preview') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(PREVIEW_HTML)
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify(configMsg())}\n\n`)
      if (lastStats) res.write(`data: ${JSON.stringify(lastStats)}\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }
    if (url.pathname.startsWith('/client/')) {
      const rel = path.normalize(decodeURIComponent(url.pathname.slice('/client/'.length)) || 'index.html')
      const file = path.join(CLIENT_DIR, rel)
      if (!file.startsWith(CLIENT_DIR)) {
        res.writeHead(403)
        return res.end()
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404)
          return res.end()
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(data)
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  previewServer.on('error', (e) => {
    console.warn(`[sysmon] 3D preview unavailable on port ${PREVIEW_PORT}:`, (e as Error).message)
    previewServer = null
  })
  previewServer.listen(PREVIEW_PORT, '127.0.0.1')
}

// ================================================================ Lifecycle
let timers: Array<() => void> = []
function schedule(): void {
  timers.forEach((t) => t())
  const ms = cfg.refreshMs
  timers = [
    DeskThing.setInterval(async () => sendStats(), ms),
    // these start Windows tools, so they are capped at once a second
    DeskThing.setInterval(async () => readGpu(), Math.max(1000, ms)),
    DeskThing.setInterval(async () => readNet(), Math.max(1000, ms)),
    DeskThing.setInterval(async () => readHw(), Math.max(2000, ms * 2)),
    // readClaude only calls the API once the chosen interval (30 s – 10 min) has passed
    DeskThing.setInterval(async () => readClaude(), 5000),
    DeskThing.setInterval(async () => readNetTotals(), 10000)
  ]
}

async function handlePreviewToggle(s: Record<string, { value?: unknown }> | null | undefined): Promise<void> {
  if (s?.openPreview?.value !== true) return
  startPreviewServer()
  DeskThing.openUrl(`http://localhost:${PREVIEW_PORT}/`)
  try {
    await DeskThing.setSettings({ openPreview: { ...(settingsDef().openPreview as object), value: false } } as never)
  } catch {
    /* ignore */
  }
}

const start = async (): Promise<void> => {
  try {
    await DeskThing.initSettings(settingsDef() as never)
    applySettings((await DeskThing.getSettings()) as never)
    // Refresh the tile choices so newly attached drives show up, keeping the saved values
    await DeskThing.setSettings(settingsDef() as never)
  } catch (e) {
    console.warn('[sysmon] settings unavailable', e)
  }

  DeskThing.on(DESKTHING_EVENTS.SETTINGS, ((data: { payload?: Record<string, { value?: unknown }> }) => {
    const before = cfg.refreshMs
    applySettings(data.payload)
    if (cfg.refreshMs !== before) schedule()
    broadcast(configMsg())
    void readHw()
    void readClaude()
    void handlePreviewToggle(data.payload)
  }) as never)

  DeskThing.on('sysmon' as never, (() => {
    DeskThing.send({ type: 'sysmon', ...configMsg() } as never)
    sendStats()
  }) as never)

  startPreviewServer()
  await Promise.all([readGpu(), readNet(), readHw(), readClaude(true), readNetTotals()])
  schedule()
  broadcast(configMsg())
}

const stop = async (): Promise<void> => {
  timers.forEach((t) => t())
  timers = []
  sseClients.forEach((r) => r.end())
  sseClients.clear()
  previewServer?.close()
  previewServer = null
}

DeskThing.on(DESKTHING_EVENTS.START, start)
DeskThing.on(DESKTHING_EVENTS.STOP, stop)
