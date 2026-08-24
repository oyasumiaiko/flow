export type PwaInstallState = 'available' | 'installed' | 'unavailable'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const listeners = new Set<() => void>()
let initialized = false
let installPrompt: BeforeInstallPromptEvent | undefined
let installState: PwaInstallState = 'unavailable'

export function initializePwa() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  installState = isStandalone() ? 'installed' : 'unavailable'

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as BeforeInstallPromptEvent
    installState = 'available'
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined
    installState = 'installed'
    emit()
  })

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register('/sw.js?v=4', { scope: '/' })
      .catch((error) => {
        console.error('[Flow PWA] Service worker registration failed', error)
      })
  }
}

export function subscribePwaInstall(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPwaInstallState(): PwaInstallState {
  return installState
}

export async function promptPwaInstall() {
  if (!installPrompt) return false
  const prompt = installPrompt
  installPrompt = undefined
  await prompt.prompt()
  const choice = await prompt.userChoice
  if (choice.outcome !== 'accepted') {
    installState = 'unavailable'
    emit()
  }
  return choice.outcome === 'accepted'
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone
  )
}

function emit() {
  listeners.forEach((listener) => listener())
}
