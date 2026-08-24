import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  getImmersiveModeServerSnapshot,
  getImmersiveModeSnapshot,
  subscribeImmersiveMode,
} from '../fullscreen'
import { useMobile } from '../hooks'

interface BatteryManager extends EventTarget {
  charging: boolean
  level: number
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>
}

export function WebStatusBar() {
  const mobile = useMobile()
  const immersive = useSyncExternalStore(
    subscribeImmersiveMode,
    getImmersiveModeSnapshot,
    getImmersiveModeServerSnapshot,
  )
  const time = useClock()
  const battery = useBattery()

  if (!mobile || !immersive) return null

  const percentage =
    battery.level === undefined ? undefined : Math.round(battery.level * 100)

  return (
    <div
      className="WebStatusBar bg-surface text-on-surface flex h-7 shrink-0 items-center justify-between px-3 text-xs"
      role="status"
      aria-label="Device status"
    >
      <span className="tabular-nums">{time}</span>
      <span className="flex items-center gap-1.5 tabular-nums">
        {battery.charging && <span aria-label="Charging">⚡</span>}
        <span className="relative h-2.5 w-5 rounded-sm border border-current p-px">
          <span
            className="bg-on-surface block h-full rounded-[1px]"
            style={{ width: `${percentage ?? 0}%` }}
          />
        </span>
        <span>{percentage === undefined ? '--' : percentage}%</span>
      </span>
    </div>
  )
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  return formatter.format(now)
}

function useBattery() {
  const [battery, setBattery] = useState<{
    charging: boolean
    level?: number
  }>({ charging: false })

  useEffect(() => {
    const getBattery = (navigator as NavigatorWithBattery).getBattery
    if (!getBattery) return

    let manager: BatteryManager | undefined
    let cancelled = false
    const update = () => {
      if (!manager || cancelled) return
      setBattery({ charging: manager.charging, level: manager.level })
    }

    void getBattery
      .call(navigator)
      .then((value) => {
        if (cancelled) return
        manager = value
        update()
        manager.addEventListener('chargingchange', update)
        manager.addEventListener('levelchange', update)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      manager?.removeEventListener('chargingchange', update)
      manager?.removeEventListener('levelchange', update)
    }
  }, [])

  return battery
}
