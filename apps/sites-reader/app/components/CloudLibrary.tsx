'use client'

import ePub, { type Book, type Rendition } from 'epubjs'
import JSZip from 'jszip'
import { useCallback, useEffect, useRef, useState } from 'react'

type CloudBook = {
  id: string
  name: string
  size: number
  metadata: Record<string, unknown>
  cfi?: string
  percentage?: number
  definitions: unknown[]
  annotations: unknown[]
  configuration?: { typography?: ReaderSettings }
  createdAt: number
  updatedAt: number
  version: number
  coverUrl: string | null
  contentUrl: string
}

type ReaderSettings = {
  fontFamily?: string
  fontSizeOffset?: number
  fontWeightOffset?: number
  lineHeight?: number
  spreadMaxWidth?: number
  spreadPageInnerMargin?: number
  spreadPageOuterMargin?: number
  spreadRespectAspectRatio?: boolean
}

type BackupBook = Omit<CloudBook, 'version' | 'coverUrl' | 'contentUrl'>

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSizeOffset: 0,
  fontWeightOffset: 0,
  lineHeight: 1.5,
  spreadMaxWidth: 1500,
  spreadPageInnerMargin: 24,
  spreadPageOuterMargin: 32,
  spreadRespectAspectRatio: true,
}

export function CloudLibrary({ displayName }: { displayName: string }) {
  const [books, setBooks] = useState<CloudBook[]>([])
  const [activeBook, setActiveBook] = useState<CloudBook>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS)
  const [settingsVersion, setSettingsVersion] = useState(0)

  const refresh = useCallback(async () => {
    const response = await fetch('/api/library', { cache: 'no-store' })
    if (!response.ok) throw new Error(await readError(response))
    const payload = (await response.json()) as { books: CloudBook[] }
    setBooks(payload.books)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadInitialData() {
      try {
        const [libraryResponse, settingsResponse] = await Promise.all([
          assertResponse(await fetch('/api/library', { cache: 'no-store' })),
          assertResponse(await fetch('/api/settings', { cache: 'no-store' })),
        ])
        const libraryPayload = (await libraryResponse.json()) as {
          books: CloudBook[]
        }
        const settingsPayload = (await settingsResponse.json()) as {
          settings: ReaderSettings
          version: number
        }
        if (cancelled) return
        setBooks(libraryPayload.books)
        setSettings({ ...DEFAULT_SETTINGS, ...settingsPayload.settings })
        setSettingsVersion(settingsPayload.version)
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadInitialData()
    return () => {
      cancelled = true
    }
  }, [])

  const importFiles = async (files: FileList) => {
    setError(undefined)
    const startedAt = performance.now()
    console.log(`[Flow] 开始导入 ${files.length} 个文件`)
    try {
      for (const file of Array.from(files)) {
        setBusy(`正在导入 ${file.name}`)
        if (file.name.toLowerCase().endsWith('.zip')) {
          await importBackup(file)
        } else {
          await uploadEpub(file)
        }
      }
      await refresh()
      console.log(
        `[Flow] 导入完成，耗时 ${Math.round(performance.now() - startedAt)} ms`,
      )
    } catch (reason) {
      setError(errorMessage(reason))
      console.error('[Flow] 导入失败', reason)
    } finally {
      setBusy(undefined)
    }
  }

  const removeBook = async (book: CloudBook) => {
    if (!window.confirm(`从云端书库删除《${bookTitle(book)}》？`)) return
    setBusy(`正在删除 ${book.name}`)
    try {
      await assertResponse(
        await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
          method: 'DELETE',
        }),
      )
      setBooks((current) => current.filter((item) => item.id !== book.id))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const saveSettings = async (next: ReaderSettings) => {
    setSettings(next)
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next, version: settingsVersion }),
    })
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    const payload = (await response.json()) as { version: number }
    setSettingsVersion(payload.version)
  }

  if (activeBook) {
    return (
      <CloudReader
        book={activeBook}
        settings={{ ...settings, ...activeBook.configuration?.typography }}
        onBack={async () => {
          setActiveBook(undefined)
          await refresh()
        }}
        onBookChange={(next) => {
          setActiveBook(next)
          setBooks((current) =>
            current.map((item) => (item.id === next.id ? next : item)),
          )
        }}
      />
    )
  }

  return (
    <main className="library-shell">
      <header className="library-header compact">
        <div>
          <p className="eyebrow">FLOW CLOUD LIBRARY</p>
          <h1>你的书，停在你上次读到的地方。</h1>
          <p className="lede">
            EPUB、进度与阅读设置会在登录同一 ChatGPT 账号的设备间同步。
          </p>
        </div>
        <div className="account-chip">{displayName}</div>
      </header>

      <section className="library-toolbar" aria-label="书库操作">
        <div>
          <strong>我的书库</strong>
          <span>
            {loading ? '正在读取…' : `${books.length} 本 · 账号独立存储`}
          </span>
        </div>
        <label className="primary-action">
          <input
            type="file"
            accept="application/epub+zip,.epub,application/zip,.zip"
            multiple
            disabled={Boolean(busy)}
            onChange={(event) => {
              if (event.target.files) void importFiles(event.target.files)
              event.target.value = ''
            }}
          />
          {busy ?? '导入 EPUB / Flow 备份'}
        </label>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {books.length === 0 && !loading ? (
        <section className="empty-library">
          <div className="book-mark" aria-hidden="true">
            F
          </div>
          <h2>把第一本书放进云端书库</h2>
          <p>
            可以直接选择 EPUB，也可以选择旧版 Flow 导出的 ZIP 备份批量迁移。
          </p>
        </section>
      ) : (
        <ul className="book-grid">
          {books.map((book) => (
            <li key={book.id} className="book-card">
              <button
                className="book-open"
                type="button"
                onClick={() => setActiveBook(book)}
              >
                <span className="cover-frame">
                  {book.coverUrl ? (
                    // 私有封面端点依赖当前请求的 ChatGPT 身份，不能交给无身份的图片优化代理。
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={book.coverUrl} alt="" />
                  ) : (
                    <span>{bookTitle(book).slice(0, 1)}</span>
                  )}
                  {book.percentage !== undefined && (
                    <i
                      style={{ width: `${Math.round(book.percentage * 100)}%` }}
                    />
                  )}
                </span>
                <strong>{bookTitle(book)}</strong>
                <small>{bookAuthor(book)}</small>
              </button>
              <button
                className="book-delete"
                type="button"
                onClick={() => void removeBook(book)}
                aria-label={`删除 ${bookTitle(book)}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <SettingsPanel
        key={settingsVersion}
        settings={settings}
        onSave={saveSettings}
      />
    </main>
  )
}

function CloudReader({
  book,
  settings,
  onBack,
  onBookChange,
}: {
  book: CloudBook
  settings: ReaderSettings
  onBack: () => void
  onBookChange: (book: CloudBook) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition>()
  const epubRef = useRef<Book>()
  const versionRef = useRef(book.version)
  const initialCfiRef = useRef(book.cfi)
  const initialBookRef = useRef(book)
  const initialSettingsRef = useRef(settings)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const onBookChangeRef = useRef(onBookChange)
  const [status, setStatus] = useState('正在载入电子书…')
  const [error, setError] = useState<string>()

  useEffect(() => {
    onBookChangeRef.current = onBookChange
  }, [onBookChange])

  const scheduleStateSave = useCallback(
    (cfi: string, percentage?: number) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(
            `/api/books/${encodeURIComponent(book.id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                version: versionRef.current,
                cfi,
                percentage,
              }),
            },
          )
          if (response.status === 409) {
            const conflict = (await response.json()) as { book: CloudBook }
            versionRef.current = conflict.book.version
            continue
          }
          if (!response.ok) {
            setError(await readError(response))
            return
          }
          const payload = (await response.json()) as { book: CloudBook }
          versionRef.current = payload.book.version
          onBookChangeRef.current(payload.book)
          return
        }
        setError('阅读位置在另一台设备上持续变化，请稍后重试')
      }, 700)
    },
    [book.id],
  )

  useEffect(() => {
    let disposed = false
    const load = async () => {
      const initialBook = initialBookRef.current
      const startedAt = performance.now()
      console.log(`[Flow] 开始加载《${bookTitle(initialBook)}》`)
      try {
        const response = await assertResponse(
          await fetch(initialBook.contentUrl),
        )
        const bytes = await response.arrayBuffer()
        if (disposed || !containerRef.current) return
        const epub = ePub(bytes)
        epubRef.current = epub
        const rendition = epub.renderTo(containerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'auto',
          flow: 'paginated',
        })
        renditionRef.current = rendition
        applyReaderSettings(rendition, initialSettingsRef.current)
        rendition.on('relocated', (location: { start: { cfi: string } }) => {
          const percentage = epub.locations.length()
            ? epub.locations.percentageFromCfi(location.start.cfi)
            : undefined
          scheduleStateSave(location.start.cfi, percentage)
          setStatus(
            percentage === undefined
              ? '已同步位置'
              : `${Math.round(percentage * 100)}%`,
          )
        })
        await rendition.display(initialCfiRef.current)
        setStatus(
          initialBook.percentage === undefined
            ? '已打开'
            : `${Math.round(initialBook.percentage * 100)}%`,
        )
        console.log(
          `[Flow] 页面已显示，耗时 ${Math.round(
            performance.now() - startedAt,
          )} ms`,
        )
        void epub.locations.generate(1600).then(() => {
          console.log(
            `[Flow] 位置索引生成完成，总耗时 ${Math.round(
              performance.now() - startedAt,
            )} ms`,
          )
        })
      } catch (reason) {
        setError(errorMessage(reason))
      }
    }
    void load()
    return () => {
      disposed = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      renditionRef.current?.destroy()
      epubRef.current?.destroy()
    }
  }, [book.id, scheduleStateSave])

  useEffect(() => {
    if (renditionRef.current)
      applyReaderSettings(renditionRef.current, settings)
  }, [settings])

  return (
    <main className="reader-shell">
      <header className="reader-bar">
        <button type="button" onClick={onBack}>
          返回书库
        </button>
        <strong>{bookTitle(book)}</strong>
        <span>{status}</span>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div
        className="reader-stage"
        style={{
          maxWidth: settings.spreadMaxWidth
            ? `${settings.spreadMaxWidth}px`
            : undefined,
          paddingInline: `${settings.spreadPageOuterMargin ?? 0}px`,
        }}
      >
        <button
          className="page-zone previous"
          type="button"
          aria-label="上一页"
          onClick={() => renditionRef.current?.prev()}
        />
        <div ref={containerRef} className="epub-viewport" />
        <button
          className="page-zone next"
          type="button"
          aria-label="下一页"
          onClick={() => renditionRef.current?.next()}
        />
      </div>
    </main>
  )
}

function SettingsPanel({
  settings,
  onSave,
}: {
  settings: ReaderSettings
  onSave: (settings: ReaderSettings) => Promise<void>
}) {
  const [draft, setDraft] = useState(settings)
  const numberField = (
    key: keyof ReaderSettings,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label>
      <span>
        {label}
        <output>{String(draft[key] ?? 0)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(draft[key] ?? 0)}
        onChange={(event) =>
          setDraft({ ...draft, [key]: Number(event.target.value) })
        }
      />
    </label>
  )
  return (
    <details className="settings-panel">
      <summary>跨设备阅读设置</summary>
      <div className="settings-grid">
        {numberField('spreadMaxWidth', '双页最大宽度', 700, 2200, 20)}
        {numberField('spreadPageInnerMargin', '双页内侧边距', 0, 120, 2)}
        {numberField('spreadPageOuterMargin', '页面外侧边距', 0, 160, 2)}
        {numberField('fontSizeOffset', '字号偏移', -6, 16, 0.5)}
        {numberField('fontWeightOffset', '字重偏移', -200, 300, 10)}
        {numberField('lineHeight', '行高', 1, 2.6, 0.1)}
        <label className="check-setting">
          <input
            type="checkbox"
            checked={draft.spreadRespectAspectRatio ?? true}
            onChange={(event) =>
              setDraft({
                ...draft,
                spreadRespectAspectRatio: event.target.checked,
              })
            }
          />
          尊重原书宽高比
        </label>
        <button type="button" onClick={() => void onSave(draft)}>
          保存并同步
        </button>
      </div>
    </details>
  )
}

async function uploadEpub(file: File, record?: BackupBook, cover?: Blob) {
  if (!file.name.toLowerCase().endsWith('.epub'))
    throw new Error(`不支持的文件：${file.name}`)
  let metadata: Record<string, unknown> = record?.metadata ?? {}
  let extractedCover = cover
  if (!record) {
    const epub = ePub(await file.arrayBuffer())
    metadata = (await epub.loaded.metadata) as unknown as Record<
      string,
      unknown
    >
    const coverUrl = await epub.coverUrl()
    if (coverUrl)
      extractedCover = await fetch(coverUrl).then((response) => response.blob())
    epub.destroy()
  }
  const payload: BackupBook = record ?? {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    metadata,
    definitions: [],
    annotations: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const form = new FormData()
  form.set('book', file, file.name)
  form.set('record', JSON.stringify(payload))
  if (extractedCover) form.set('cover', extractedCover, 'cover')
  await assertResponse(
    await fetch('/api/library', { method: 'POST', body: form }),
  )
}

async function importBackup(file: File) {
  const zip = await JSZip.loadAsync(file)
  const dataEntry = zip.file('data.json')
  if (!dataEntry) throw new Error('这不是有效的 Flow 备份：缺少 data.json')
  const payload = JSON.parse(await dataEntry.async('text')) as {
    books?: BackupBook[]
  }
  const coversEntry = zip.file('covers.json')
  const covers = coversEntry
    ? (JSON.parse(await coversEntry.async('text')) as Array<{
        id: string
        cover: string | null
      }>)
    : []
  for (const record of payload.books ?? []) {
    const entry = zip.file(`files/${record.name}`)
    if (!entry) throw new Error(`备份缺少电子书文件：${record.name}`)
    const blob = await entry.async('blob')
    const coverData = covers.find((item) => item.id === record.id)?.cover
    const cover = coverData
      ? await fetch(coverData).then((response) => response.blob())
      : undefined
    await uploadEpub(
      new File([blob], record.name, { type: 'application/epub+zip' }),
      record,
      cover,
    )
  }
}

function applyReaderSettings(rendition: Rendition, settings: ReaderSettings) {
  const fontSize = 100 + (settings.fontSizeOffset ?? 0) * 5
  rendition.themes.override('font-size', `${Math.max(60, fontSize)}%`)
  rendition.themes.override(
    'font-weight',
    String(Math.max(100, 400 + (settings.fontWeightOffset ?? 0))),
  )
  rendition.themes.override('line-height', String(settings.lineHeight ?? 1.5))
  if (settings.fontFamily)
    rendition.themes.override('font-family', settings.fontFamily)
  rendition.themes.override(
    'padding-left',
    `${settings.spreadPageInnerMargin ?? 0}px`,
  )
  rendition.themes.override(
    'padding-right',
    `${settings.spreadPageInnerMargin ?? 0}px`,
  )
}

function bookTitle(book: CloudBook | BackupBook): string {
  const value = book.metadata?.title
  return typeof value === 'string' && value.trim()
    ? value
    : book.name.replace(/\.epub$/i, '')
}

function bookAuthor(book: CloudBook): string {
  const value = book.metadata?.creator
  return typeof value === 'string' && value.trim() ? value : '未知作者'
}

async function assertResponse(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(await readError(response))
  return response
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string
  } | null
  return payload?.error ?? `请求失败（${response.status}）`
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
