import { reader } from './models'

const HISTORY_KEY = '__flowNavigation'

interface ReaderNavigationSnapshot {
  groups: typeof reader.groups
  focusedIndex: number
  selectedIndexes: number[]
}

interface NavigationEntry {
  depth: number
  snapshot: ReaderNavigationSnapshot
  layer?: {
    open: () => void
    close: () => void
  }
}

interface FlowHistoryState {
  id: number
  depth: number
}

const entries = new Map<number, NavigationEntry>()
let currentId = 0
let currentDepth = 0
let nextId = 1
let started = false
let subscribers = 0

function captureReader(): ReaderNavigationSnapshot {
  const groups = [...reader.groups]
  return {
    groups,
    focusedIndex: reader.focusedIndex,
    selectedIndexes: groups.map((group) => group.selectedIndex),
  }
}

function restoreReader(snapshot: ReaderNavigationSnapshot) {
  reader.groups = [...snapshot.groups]
  snapshot.groups.forEach((group, index) => {
    const lastIndex = group.tabs.length - 1
    group.selectedIndex = Math.min(
      Math.max(snapshot.selectedIndexes[index] ?? lastIndex, 0),
      lastIndex,
    )
  })
  reader.focusedIndex = Math.min(
    Math.max(snapshot.focusedIndex, reader.groups.length ? 0 : -1),
    reader.groups.length - 1,
  )
}

function flowState(): FlowHistoryState | undefined {
  return window.history.state?.[HISTORY_KEY]
}

function writeHistory(state: FlowHistoryState, mode: 'push' | 'replace') {
  const value = {
    ...window.history.state,
    [HISTORY_KEY]: state,
  }
  window.history[`${mode}State`](value, '', window.location.href)
}

function saveReaderEntry(mode: 'push' | 'replace') {
  if (mode === 'push') {
    currentId = nextId++
    currentDepth += 1
  }

  entries.set(currentId, {
    depth: currentDepth,
    snapshot: captureReader(),
  })
  writeHistory({ id: currentId, depth: currentDepth }, mode)
}

function handlePopState(event: PopStateEvent) {
  const leaving = entries.get(currentId)
  leaving?.layer?.close()

  const state = event.state?.[HISTORY_KEY] as FlowHistoryState | undefined
  if (!state) return

  const target = entries.get(state.id)
  if (!target) return

  currentId = state.id
  currentDepth = state.depth
  restoreReader(target.snapshot)
  target.layer?.open()
}

export function startNavigationHistory() {
  if (typeof window === 'undefined') return () => undefined

  subscribers += 1
  if (!started) {
    const existing = flowState()
    currentId = existing?.id ?? 0
    currentDepth = existing?.depth ?? 0
    nextId = Math.max(nextId, currentId + 1)
    entries.set(currentId, {
      depth: currentDepth,
      snapshot: captureReader(),
    })
    writeHistory({ id: currentId, depth: currentDepth }, 'replace')
    window.addEventListener('popstate', handlePopState)
    started = true
  }

  return () => {
    subscribers -= 1
    if (subscribers > 0) return
    window.removeEventListener('popstate', handlePopState)
    started = false
  }
}

export function navigateReader(update: () => void) {
  if (typeof window === 'undefined') {
    update()
    return
  }

  const current = entries.get(currentId)
  if (current?.layer) {
    current.layer.close()
    update()
    saveReaderEntry('replace')
    return
  }

  update()
  saveReaderEntry('push')
}

export function openTransientLayer(open: () => void, close: () => void) {
  if (typeof window === 'undefined') {
    open()
    return
  }

  const current = entries.get(currentId)
  if (current?.layer) {
    current.layer.close()
    open()
    entries.set(currentId, {
      depth: currentDepth,
      snapshot: captureReader(),
      layer: { open, close },
    })
    writeHistory({ id: currentId, depth: currentDepth }, 'replace')
    return
  }

  open()
  currentId = nextId++
  currentDepth += 1
  entries.set(currentId, {
    depth: currentDepth,
    snapshot: captureReader(),
    layer: { open, close },
  })
  writeHistory({ id: currentId, depth: currentDepth }, 'push')
}

export function goBack(fallback?: () => void) {
  if (typeof window !== 'undefined' && currentDepth > 0) {
    window.history.back()
    return
  }
  fallback?.()
}

export function syncCurrentHistoryEntry() {
  if (typeof window === 'undefined') return
  writeHistory({ id: currentId, depth: currentDepth }, 'replace')
}
