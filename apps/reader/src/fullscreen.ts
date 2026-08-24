type Listener = () => void

function displayModeQuery() {
  return window.matchMedia('(display-mode: fullscreen)')
}

export function subscribeImmersiveMode(listener: Listener) {
  if (typeof document === 'undefined') return () => undefined

  const query = displayModeQuery()
  document.addEventListener('fullscreenchange', listener)
  query.addEventListener('change', listener)

  return () => {
    document.removeEventListener('fullscreenchange', listener)
    query.removeEventListener('change', listener)
  }
}

export function getImmersiveModeSnapshot() {
  if (typeof document === 'undefined') return false
  return !!document.fullscreenElement || displayModeQuery().matches
}

export function getImmersiveModeServerSnapshot() {
  return false
}

export function isRuntimeFullscreenSupported() {
  return typeof document !== 'undefined' && document.fullscreenEnabled
}

export async function enterImmersiveMode() {
  if (!isRuntimeFullscreenSupported()) return false
  if (document.fullscreenElement) return true

  await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  return true
}

export async function exitImmersiveMode() {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return true
  }

  // Manifest-level fullscreen cannot be changed at runtime. Once the refreshed
  // standalone manifest is installed, this branch is no longer used.
  return !displayModeQuery().matches
}
