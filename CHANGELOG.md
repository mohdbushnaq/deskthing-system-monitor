# Changelog

## 1.5.1
- Claude session reset countdown fixed: it now counts against the PC's clock, because the Car Thing's own clock isn't set (it showed thousands of days).
- Bigger reset time in the Claude tile, and a bigger "% used" under the RAM, disk and VRAM values.

## 1.5.0
- Text, number and graph sizes now default to the maximum (150 / 150 / 160 %). Applied once on update.
- "Memory" is now "RAM". RAM, disk and GPU memory tiles use one large ring that fills the tile, with the value (and a smaller GB) and % inside it.
- Claude tile redesigned: a large outer ring for the current session and a smaller inner ring for the week. Session %, week % and time until the session resets sit inside. Per-model limits such as Fable show in the tile header.
- The date under the clock no longer runs off the tile at large text sizes.

## 1.4.1
- Claude usage tile no longer flickers to "Waiting for usage"; it keeps the last reading between checks.
- New setting: check Claude usage every 30 s, 1, 2, 5 or 10 minutes (default 1 minute).

## 1.4.0
- New **Claude usage** tile: rings for the current session (5-hour), weekly, and per-model weekly limits such as Fable, each with time to reset. Signs in through a Claude Code login on the PC or a claude.ai session key.
- Network tile shows total downloaded and uploaded since Windows started (MB/GB/TB).
- Clock now defaults to 12-hour time with AM/PM.
- Shorter grey labels that never get cut off: CPU model only (e.g. i9-13900K), "GB used", "GB free", "VRAM 5.7 GB".

## 1.3.1
- Values on the Memory, Disk and GPU memory tiles no longer collide with the ring gauges ("GB" moved to the line below).
- After an update, the Car Thing reloads a cached older copy of the app by itself.

## 1.3.0
- Six tiles: the left side splits into two tiles (CPU with temperature on top, clock below by default), plus the 2×2 grid on the right.
- New clock tile with seconds and full date.
- Dark, light and auto (day/night) themes.
- Text, number and graph size settings; accent colour.
- Refresh from 0.25 s to 5 s.
- Live 3D preview at http://localhost:8893/.
- Settings grouped: left side first, then right side, look, data.
- Published on GitHub with automatic releases for DeskThing's Update button.

## 1.2.0
- Left side can hold two tiles; sub-second refresh.

## 1.1.0
- Configurable tiles, any disk, CPU temperature (LibreHardwareMonitor or Windows), fans, CPU power.

## 1.0.0
- First version: CPU, per-core load, RAM, GPU, disk C:, network.
