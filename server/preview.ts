// A live 3D preview: a generic 800×480 display frame showing the real app UI, fed by this app's server.
export const PREVIEW_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>System Monitor · 3D preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: radial-gradient(1200px 700px at 50% 35%, #1d2430, #07090c 70%); color: #e8eaed;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; overflow: hidden; user-select: none; }
  header { position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; padding: 18px 26px; z-index: 2; }
  h1 { font-size: 17px; font-weight: 650; margin: 0; letter-spacing: .02em; }
  h1 small { color: #8a919c; font-weight: 500; margin-left: 8px; }
  .btns button { background: #1a2029; color: #e8eaed; border: 1px solid #2a313c; border-radius: 999px; padding: 8px 14px; margin-left: 8px; font: inherit; font-size: 13px; cursor: pointer; }
  .btns button:hover { background: #232b37; }
  #stage { position: absolute; inset: 0; perspective: 1700px; display: grid; place-items: center; cursor: grab; }
  #stage.drag { cursor: grabbing; }
  #rig { position: relative; transform-style: preserve-3d; transition: transform .6s cubic-bezier(.2,.8,.2,1); }
  #rig.live { transition: none; }
  .dev { position: relative; width: 880px; height: 560px; transform-style: preserve-3d; }
  .face { position: absolute; border-radius: 34px; backface-visibility: hidden; }
  .front { inset: 0; transform: translateZ(22px); background: linear-gradient(160deg, #2b313b, #14181e 55%, #0d1014);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.12), inset 0 -2px 6px rgba(0,0,0,.6); }
  .back { inset: 0; transform: rotateY(180deg) translateZ(22px); background: linear-gradient(200deg, #20252d, #0b0d10); }
  .edge { position: absolute; background: linear-gradient(90deg, #0d1014, #252b34 50%, #0d1014); }
  .edge.t { left: 30px; right: 30px; top: -22px; height: 44px; transform: rotateX(90deg); }
  .edge.b { left: 30px; right: 30px; top: 538px; height: 44px; transform: rotateX(90deg); }
  .edge.l { top: 30px; bottom: 30px; left: -22px; width: 44px; transform: rotateY(90deg); background: linear-gradient(180deg, #0d1014, #252b34 50%, #0d1014); }
  .edge.r { top: 30px; bottom: 30px; left: 858px; width: 44px; transform: rotateY(90deg); background: linear-gradient(180deg, #0d1014, #252b34 50%, #0d1014); }
  .screen { position: absolute; left: 40px; top: 40px; width: 800px; height: 480px; border-radius: 10px; overflow: hidden;
    transform: translateZ(23px); background: #000; box-shadow: 0 0 0 2px #05070a, 0 0 40px rgba(79,195,247,.08); }
  .screen iframe { width: 800px; height: 480px; border: 0; display: block; background: #000; }
  .glare { position: absolute; left: 40px; top: 40px; width: 800px; height: 480px; border-radius: 10px; pointer-events: none; transform: translateZ(24px);
    background: linear-gradient(115deg, rgba(255,255,255,.10), rgba(255,255,255,0) 38%, rgba(255,255,255,0) 70%, rgba(255,255,255,.04)); }
  .shadow { position: absolute; left: 50%; top: 50%; width: 900px; height: 160px; margin-left: -450px; margin-top: 260px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(0,0,0,.55), rgba(0,0,0,0)); transform: rotateX(90deg) translateZ(-60px); filter: blur(6px); }
  footer { position: fixed; bottom: 16px; left: 0; right: 0; text-align: center; color: #8a919c; font-size: 13px; }
  #status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f87171; margin-right: 6px; vertical-align: middle; }
  #status.on { background: #4ade80; }
</style>
</head>
<body>
<header>
  <h1>System Monitor <small>live 3D preview · 800×480</small></h1>
  <div class="btns">
    <button data-view="front">Front</button>
    <button data-view="angle">Angled</button>
    <button data-view="side">Side</button>
    <button id="spin">Auto-rotate</button>
  </div>
</header>
<div id="stage">
  <div id="rig">
    <div class="dev">
      <div class="face back"></div>
      <div class="edge t"></div><div class="edge b"></div><div class="edge l"></div><div class="edge r"></div>
      <div class="face front"></div>
      <div class="screen"><iframe src="/client/index.html?preview=1" title="System Monitor"></iframe></div>
      <div class="glare"></div>
    </div>
  </div>
</div>
<footer><span id="status"></span><span id="msg">Connecting to DeskThing…</span> · drag to rotate · scroll to zoom · changes you save in DeskThing show up here live</footer>
<script>
  const rig = document.getElementById('rig'), stage = document.getElementById('stage')
  const views = { front: [0, 0], angle: [-8, -24], side: [-4, -62] }
  let rx = -8, ry = -24, zoom = 1, spin = false, last = null
  function fit() { return Math.min(innerWidth / 1050, (innerHeight - 140) / 680) }
  function apply() { rig.style.transform = 'scale(' + (fit() * zoom).toFixed(3) + ') rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)' }
  apply(); addEventListener('resize', apply)
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { spin = false; [rx, ry] = views[b.dataset.view]; rig.classList.remove('live'); apply() })
  document.getElementById('spin').onclick = () => { spin = !spin }
  stage.addEventListener('pointerdown', e => { last = [e.clientX, e.clientY]; spin = false; stage.classList.add('drag'); rig.classList.add('live'); stage.setPointerCapture(e.pointerId) })
  stage.addEventListener('pointermove', e => { if (!last) return; ry += (e.clientX - last[0]) * .35; rx = Math.max(-60, Math.min(60, rx - (e.clientY - last[1]) * .35)); last = [e.clientX, e.clientY]; apply() })
  stage.addEventListener('pointerup', () => { last = null; stage.classList.remove('drag') })
  stage.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(.5, Math.min(1.8, zoom * (e.deltaY < 0 ? 1.08 : .92))); apply() }, { passive: false })
  ;(function tick() { if (spin) { rig.classList.add('live'); ry += .25; apply() } requestAnimationFrame(tick) })()
  // connection indicator (the iframe has its own stream)
  const es = new EventSource('/events'), dot = document.getElementById('status'), msg = document.getElementById('msg')
  es.onmessage = () => { dot.className = 'on'; msg.textContent = 'Live data from your PC' }
  es.onerror = () => { dot.className = ''; msg.textContent = 'Not connected: is DeskThing running?' }
</script>
</body>
</html>`
