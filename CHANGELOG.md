# Changelog

## 2.0.0
- Tap any tile on the Car Thing to change what it shows; the choice is saved to the PC settings. Setting: *1 · Layout · tap a tile on the Car Thing to change it*.
- Network totals now come from Windows' own Data usage records instead of the app's own counting: last 24 hours, 7 days, 30 days, total, or since Windows started.
- Settings reorganised into numbered groups: Layout, Look, CPU & clock, Temperature, Network, Claude, Refresh & preview.
- Stable fallback: v1.8.0 (branch `stable-1.8.0`).

## 1.8.0
- Network totals for a period you choose: today, this week, this month, this year, all time, or since Windows started. Totals are tracked per day and saved in DeskThing, including traffic while DeskThing was closed (as long as the PC wasn't restarted in between). History starts when you install 1.8.0.
- Fixes values blinking (GHz, Claude usage) when an older copy of the app keeps running next to the new one after an update: the Car Thing now only listens to the newest copy.
- Bigger GPU temperature chip that still fits the tile at 100% load.

## 1.7.2
- The GHz chip (and the GPU temperature chip) always shows: it keeps a fixed size and only the % number shrinks when space runs out. The CPU % is a little smaller to leave room.

## 1.7.1
- Equal space above and below the tiles: rows can no longer grow past the screen.
- CPU % and the date are no longer clipped at the bottom.
- The GHz chip shows with two- and three-digit CPU % (the row now shrinks to fit instead of hiding it).
- Graphs take only the space left in a tile, so labels under them are never cut off.

## 1.7.0
- CPU tile shows the live clock speed in GHz next to the CPU % instead of the temperature (setting: Clock speed / Temperature / Nothing). Read from Windows without admin rights, or from LibreHardwareMonitor when it's running.
- Value rows (CPU %, GPU % with temperature) and the date under the clock shrink to fit their tile, so nothing spills out at 100% or with long dates.

## 1.6.0
- All three columns are now the same width; tiles and their text, numbers and graphs fit the equal columns.
- When the CPU temperature comes from the Windows thermal zone and never changes (a fixed motherboard value on many PCs), it's shown dimmed as "~28°C" and the CPU temp tile says "not live". Use LibreHardwareMonitor for the real CPU temperature.

## 1.5.3
- The claude.ai session key setting now explains step by step where to find the key.

## 1.5.2
- Ring tiles show just the % under the value (no "used"). Disk now shows used GB like RAM, with the drive size in the header.
- Claude: reset time shown without the arrow, slightly larger.

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
