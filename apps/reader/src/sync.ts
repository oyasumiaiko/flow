import { BookRecord, db } from './db'

export interface SettingsEnvelope<T> {
  settings: T
  updatedAt: number
  version: number
}

export type CloudSyncStatus = {
  state: 'idle' | 'syncing' | 'error'
  message?: string
}

type BookEnvelope = { book: BookRecord }
type LibraryEnvelope = { books: BookRecord[] }
type PendingBookUpdate = {
  changes: Partial<BookRecord>
  timer?: number
  flushing: boolean
}

const pendingBookUpdates = new Map<string, PendingBookUpdate>()
const listeners = new Set<() => void>()
let cloudStatus: CloudSyncStatus = { state: 'idle' }

export function getCloudStatus() {
  return cloudStatus
}

export function subscribeCloudStatus(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function markCloudSyncing() {
  setCloudStatus({ state: 'syncing' })
}

export function markCloudIdle() {
  setCloudStatus({ state: 'idle' })
}

export function reportCloudError(error: unknown) {
  setCloudError(error)
}

export async function fetchCloudBooks(): Promise<BookRecord[]> {
  const result = await requestJson<LibraryEnvelope>('/api/library')
  return result.books
}

export async function uploadCloudBook(
  book: BookRecord,
  file: File,
  coverDataUrl: string | null,
): Promise<BookRecord> {
  setCloudStatus({ state: 'syncing' })
  const form = new FormData()
  form.set('book', file)
  form.set('record', JSON.stringify(book))
  if (coverDataUrl) {
    const cover = await fetch(coverDataUrl).then((response) => response.blob())
    form.set(
      'cover',
      new File([cover], 'cover', { type: cover.type || 'image/jpeg' }),
    )
  }

  try {
    const response = await fetch('/api/library', { method: 'POST', body: form })
    const payload = (await response.json()) as BookEnvelope & { error?: string }
    if (response.status === 409 && payload.book) {
      setCloudStatus({ state: 'idle' })
      return payload.book
    }
    if (!response.ok || !payload.book) {
      throw new Error(
        payload.error || `Upload failed with HTTP ${response.status}`,
      )
    }
    setCloudStatus({ state: 'idle' })
    return payload.book
  } catch (error) {
    setCloudError(error)
    throw error
  }
}

/**
 * EPUB 仅在打开时从 R2 下载并放入 Dexie 缓存，避免书架加载时批量下载整个书库。
 * 缓存缺失不会改变权威数据来源；没有 contentUrl 时直接报错。
 */
export async function ensureCloudBookFile(book: BookRecord): Promise<File> {
  const cached = await db?.files.get(book.id)
  if (cached) return cached.file
  if (!book.contentUrl) {
    throw new Error(`Book ${book.id} has no Sites content URL`)
  }

  const startedAt = performance.now()
  console.log(`[Flow Sites] 开始下载《${book.name}》`)
  setCloudStatus({ state: 'syncing' })
  try {
    const response = await fetch(book.contentUrl)
    if (!response.ok) {
      throw new Error(
        `Download failed with HTTP ${response.status}: ${await readError(
          response,
        )}`,
      )
    }
    const blob = await response.blob()
    const file = new File([blob], book.name, {
      type: blob.type || book.contentType || 'application/epub+zip',
    })
    await db?.files.put({ id: book.id, file })
    console.log(
      `[Flow Sites] 《${book.name}》下载完成，耗时 ${(
        (performance.now() - startedAt) /
        1000
      ).toFixed(2)} 秒`,
    )
    setCloudStatus({ state: 'idle' })
    return file
  } catch (error) {
    setCloudError(error)
    throw error
  }
}

export async function deleteCloudBooks(bookIds: string[]): Promise<void> {
  setCloudStatus({ state: 'syncing' })
  try {
    await Promise.all(
      bookIds.map(async (id) => {
        const response = await fetch(`/api/books/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          throw new Error(
            `Delete failed with HTTP ${response.status}: ${await readError(
              response,
            )}`,
          )
        }
      }),
    )
    setCloudStatus({ state: 'idle' })
  } catch (error) {
    setCloudError(error)
    throw error
  }
}

/**
 * 阅读位置、标注和单书排版在短窗口内合并，随后按书串行写入 D1。
 * 版本冲突会读取服务端版本并明确重试当前本地变更；网络错误会保留待写数据，
 * 同时把同步状态置为 error，等待用户点击重试，绝不静默丢弃。
 */
export function queueCloudBookUpdate(
  bookId: string,
  changes: Partial<BookRecord>,
) {
  const pending = pendingBookUpdates.get(bookId) ?? {
    changes: {},
    flushing: false,
  }
  pending.changes = { ...pending.changes, ...changes }
  if (pending.timer !== undefined) window.clearTimeout(pending.timer)
  pending.timer = window.setTimeout(() => void flushBookUpdate(bookId), 350)
  pendingBookUpdates.set(bookId, pending)
}

export function retryPendingCloudUpdates() {
  for (const [bookId, pending] of pendingBookUpdates) {
    if (!pending.flushing) void flushBookUpdate(bookId)
  }
  window.dispatchEvent(new Event('flow:retry-settings'))
}

export async function fetchCloudSettings<T>(): Promise<SettingsEnvelope<T>> {
  return requestJson<SettingsEnvelope<T>>('/api/settings')
}

export async function saveCloudSettings<T>(
  settings: T,
  version: number,
): Promise<{ version: number; updatedAt: number }> {
  return requestJson('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings, version }),
  })
}

async function flushBookUpdate(bookId: string) {
  const pending = pendingBookUpdates.get(bookId)
  if (!pending || pending.flushing) return
  if (Object.keys(pending.changes).length === 0) {
    pendingBookUpdates.delete(bookId)
    return
  }

  const changes = pending.changes
  pending.changes = {}
  pending.timer = undefined
  pending.flushing = true
  setCloudStatus({ state: 'syncing' })

  try {
    const local = await db?.books.get(bookId)
    if (!local?.version) {
      throw new Error(`Book ${bookId} has no Sites synchronization version`)
    }
    let version = local.version
    let response = await patchCloudBook(bookId, version, changes)
    if (response.status === 409) {
      const conflict = (await response.json()) as BookEnvelope
      if (!conflict.book?.version) {
        throw new Error('Sites returned an invalid book conflict response')
      }
      version = conflict.book.version
      await db?.books.update(bookId, { version })
      response = await patchCloudBook(bookId, version, changes)
    }

    const result = await parseResponse<BookEnvelope>(response)
    if (!result.book?.version) {
      throw new Error('Sites returned an invalid book update response')
    }
    await db?.books.update(bookId, {
      version: result.book.version,
      updatedAt: result.book.updatedAt,
    })
    setCloudStatus({ state: 'idle' })
  } catch (error) {
    pending.changes = { ...changes, ...pending.changes }
    setCloudError(error)
  } finally {
    pending.flushing = false
    if (Object.keys(pending.changes).length === 0) {
      pendingBookUpdates.delete(bookId)
    } else {
      // 更新可能在上一次请求进行时到达；重新安排一次串行写入，避免计时器已经
      // 触发但因 flushing=true 返回后，最新阅读进度永久滞留在内存里。
      if (pending.timer !== undefined) window.clearTimeout(pending.timer)
      pending.timer = window.setTimeout(() => void flushBookUpdate(bookId), 350)
    }
  }
}

function patchCloudBook(
  bookId: string,
  version: number,
  changes: Partial<BookRecord>,
) {
  return fetch(`/api/books/${encodeURIComponent(bookId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...changes, version }),
  })
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  return parseResponse<T>(response)
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new CloudRequestError(
      response.status,
      `Sites request failed with HTTP ${response.status}: ${await readError(
        response,
      )}`,
    )
  }
  return (await response.json()) as T
}

export class CloudRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string
  } | null
  return payload?.error ?? response.statusText
}

function setCloudError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[Flow Sites] 云同步失败', error)
  setCloudStatus({ state: 'error', message })
}

function setCloudStatus(next: CloudSyncStatus) {
  cloudStatus = next
  listeners.forEach((listener) => listener())
}
