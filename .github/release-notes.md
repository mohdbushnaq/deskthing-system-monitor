## System Monitor 2.0.1

**Fix:** the network **Total** option showed 0. It now reports everything Windows still keeps.

---

## What's in 2.0

A live PC dashboard for the Spotify Car Thing running DeskThing, by CutSmokey.

### New in 2.0
- **Tap to change tiles.** Tap any tile on the Car Thing and pick what it shows from a full-screen menu. Your choice is saved to the app's settings on the PC. (Can be turned off under *1 · Layout*.)
- **Network totals straight from Windows.** The totals under the network speeds now come from Windows' own Data usage records (Settings → Network & internet → Data usage), all networks added together. Choose **Last 24 hours, Last 7 days, Last 30 days, Total** or **Since Windows started**.
- **Settings reorganised** into numbered groups: 1 Layout · 2 Look · 3 CPU & clock · 4 Temperature · 5 Network · 6 Claude · 7 Refresh & preview.

### Highlights from 1.x
- Six tiles in three equal columns: CPU with live GHz, clock with seconds, RAM, any disk, GPU, GPU memory, CPU temperature, network, fans, CPU power, Claude usage, uptime.
- Claude usage tile: current session and weekly limits as rings, with time to reset.
- Dark, light and auto (day/night) themes; text, number and graph sizes; refresh down to 0.25 s.
- Live 3D preview at http://localhost:8893/.

### Install
In DeskThing, open **Downloads**, click the **+** tile and paste `https://github.com/mohdbushnaq/deskthing-system-monitor`, or download the zip below and load it with **Add App**. Installed from the repo, updates appear behind DeskThing's Update button.

Previous stable version: [v1.8.0](https://github.com/mohdbushnaq/deskthing-system-monitor/releases/tag/v1.8.0) (branch `stable-1.8.0`).
