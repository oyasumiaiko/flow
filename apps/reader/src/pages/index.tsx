import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { FormEvent, useEffect, useRef, useState } from 'react'
import {
  MdAdd,
  MdCheck,
  MdClose,
  MdDeleteOutline,
  MdLink,
  MdOutlineFileUpload,
  MdSelectAll,
} from 'react-icons/md'
import { RiSettings5Line } from 'react-icons/ri'
import { useSet } from 'react-use'

import { Button, DropZone, ReaderGridView, Settings } from '../components'
import { BookRecord, CoverRecord, db } from '../db'
import { fetchBook, handleFiles } from '../file'
import {
  useDisablePinchZooming,
  useLibrary,
  useRemoteBooks,
  useTranslation,
} from '../hooks'
import { reader, useReaderSnapshot } from '../models'
import {
  goBack,
  navigateReader,
  openTransientLayer,
  startNavigationHistory,
} from '../navigation'
import { lock } from '../styles'
import { deleteCloudBooks } from '../sync'

const placeholder = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="gray" fill-opacity="0" width="1" height="1"/></svg>`
const SOURCE = 'src'

export default function Index() {
  const { focusedTab } = useReaderSnapshot()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  useDisablePinchZooming()

  useEffect(() => startNavigationHistory(), [])

  useEffect(() => {
    let source = router.query[SOURCE]
    if (!source) return
    if (!Array.isArray(source)) source = [source]
    setLoading(true)

    Promise.all(source.map((url) => fetchBook(url)))
      .then((books) =>
        navigateReader(() => books.forEach((book) => reader.addTab(book))),
      )
      .catch(showError)
      .finally(() => setLoading(false))
  }, [router.query])

  useEffect(() => {
    if ('launchQueue' in window && 'LaunchParams' in window) {
      window.launchQueue.setConsumer((params) => {
        if (!params.files.length) return
        Promise.all(params.files.map((file) => file.getFile()))
          .then((files) => handleFiles(files))
          .then((books) =>
            navigateReader(() => books.forEach((book) => reader.addTab(book))),
          )
          .catch(showError)
      })
    }
  }, [])

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <title>{focusedTab?.title ?? 'Flow'}</title>
      </Head>
      <ReaderGridView />
      {loading || <Library />}
    </>
  )
}

const Library: React.FC = () => {
  const books = useLibrary()
  const covers = useLiveQuery(() => db?.covers.toArray() ?? [])
  const t = useTranslation('home')
  const remote = useRemoteBooks()
  const [ready, setReady] = useState(false)
  const [select, setSelect] = useState(false)
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [selectedBookIds, { add, has, toggle, reset }] = useSet<string>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { groups } = useReaderSnapshot()

  useEffect(() => {
    if (!remote.data || !db) return
    const database = db
    const remoteBooks = remote.data

    database
      .transaction(
        'rw',
        database.books,
        database.covers,
        database.files,
        async () => {
          const localBooks = await database.books.toArray()
          const remoteIds = new Set(remoteBooks.map((book) => book.id))
          const removedIds = localBooks
            .filter((book) => !remoteIds.has(book.id))
            .map((book) => book.id)
          if (removedIds.length > 0) {
            await Promise.all([
              database.books.bulkDelete(removedIds),
              database.covers.bulkDelete(removedIds),
              database.files.bulkDelete(removedIds),
            ])
          }

          const mergedBooks = remoteBooks.map((cloudBook) => {
            const localBook = localBooks.find(
              (book) => book.id === cloudBook.id,
            )
            if (
              localBook &&
              (localBook.updatedAt ?? 0) > (cloudBook.updatedAt ?? 0)
            ) {
              return {
                ...cloudBook,
                ...localBook,
                version: cloudBook.version,
                contentUrl: cloudBook.contentUrl,
                coverUrl: cloudBook.coverUrl,
              }
            }
            return cloudBook
          })
          await database.books.bulkPut(mergedBooks)
          await database.covers.bulkPut(
            remoteBooks.map((book) => ({
              id: book.id,
              cover: book.coverUrl ?? null,
            })),
          )
        },
      )
      .then(() => setReady(true))
      .catch(showError)
  }, [remote.data])

  useEffect(() => {
    if (!select) reset()
  }, [reset, select])

  if (groups.length) return null
  if (remote.error) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg space-y-4 text-center">
          <h1 className="typescale-title-large">{t('cloud_load_failed')}</h1>
          <p className="text-on-surface-variant break-words">
            {remote.error.message}
          </p>
          <Button onClick={() => void remote.mutate()}>{t('retry')}</Button>
        </div>
      </main>
    )
  }
  if (!ready || !books) return null

  const selectedBooks = [...selectedBookIds]
    .map((id) => books.find((book) => book.id === id))
    .filter((book): book is BookRecord => !!book)
  const allSelected = selectedBookIds.size === books.length

  const closeLibraryMenu = () => goBack(() => setLibraryMenuOpen(false))
  const closeImportMenu = () => goBack(() => setImportMenuOpen(false))
  const openLibraryMenu = () =>
    openTransientLayer(
      () => setLibraryMenuOpen(true),
      () => setLibraryMenuOpen(false),
    )
  const openImportMenu = () =>
    openTransientLayer(
      () => setImportMenuOpen(true),
      () => setImportMenuOpen(false),
    )
  const enterSelectMode = (bookId?: string) => {
    if (select) {
      if (bookId) toggle(bookId)
      return
    }
    openTransientLayer(
      () => setSelect(true),
      () => setSelect(false),
    )
    if (bookId) add(bookId)
  }
  const leaveSelectMode = () => goBack(() => setSelect(false))

  const importFiles = async (files: FileList | File[]) => {
    try {
      await handleFiles(files)
      await remote.mutate()
      closeImportMenu()
    } catch (error) {
      showError(error)
    }
  }

  const importRemoteBook = async (event: FormEvent) => {
    event.preventDefault()
    const url = remoteUrl.trim()
    if (!url) return
    try {
      await fetchBook(url)
      await remote.mutate()
      setRemoteUrl('')
      closeImportMenu()
    } catch (error) {
      showError(error)
    }
  }

  const deleteSelectedBooks = async () => {
    if (!selectedBooks.length) return
    try {
      const ids = selectedBooks.map((book) => book.id)
      await deleteCloudBooks(ids)
      const database = db
      if (!database) throw new Error('Flow local EPUB cache is unavailable')
      await database.transaction(
        'rw',
        database.books,
        database.covers,
        database.files,
        async () => {
          await Promise.all([
            database.books.bulkDelete(ids),
            database.covers.bulkDelete(ids),
            database.files.bulkDelete(ids),
          ])
        },
      )
      leaveSelectMode()
      await remote.mutate()
    } catch (error) {
      showError(error)
    }
  }

  return (
    <DropZone
      className="scroll-parent bg-background h-full"
      onDrop={async (event) => {
        const bookId = event.dataTransfer.getData('text/plain')
        const book = books.find((candidate) => candidate.id === bookId)
        if (book) {
          navigateReader(() => reader.addTab(book))
          return
        }
        await importFiles(event.dataTransfer.files)
      }}
    >
      <header className="LibraryHeader border-surface-variant/60 bg-background/90 relative z-30 shrink-0 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4">
          {select ? (
            <>
              <ToolbarButton
                label={t('cancel')}
                Icon={MdClose}
                onClick={leaveSelectMode}
              />
              <div className="min-w-0 flex-1">
                <h1 className="typescale-title-medium truncate">
                  {selectedBookIds.size} {t('selected')}
                </h1>
              </div>
              <ToolbarButton
                label={allSelected ? t('deselect_all') : t('select_all')}
                Icon={MdSelectAll}
                onClick={() => {
                  if (allSelected) reset()
                  else books.forEach((book) => add(book.id))
                }}
              />
              <ToolbarButton
                label={t('delete')}
                Icon={MdDeleteOutline}
                disabled={!selectedBookIds.size}
                danger
                onClick={() => void deleteSelectedBooks()}
              />
            </>
          ) : (
            <>
              <div className="relative">
                <ToolbarButton
                  label={t('menu')}
                  Icon={RiSettings5Line}
                  onClick={openLibraryMenu}
                />
                {libraryMenuOpen && (
                  <Popover align="left" onDismiss={closeLibraryMenu}>
                    <MenuButton
                      Icon={RiSettings5Line}
                      onClick={() =>
                        navigateReader(() => reader.addTab(Settings))
                      }
                    >
                      {t('settings')}
                    </MenuButton>
                    {!!books.length && (
                      <MenuButton
                        Icon={MdCheck}
                        onClick={() => enterSelectMode()}
                      >
                        {t('select')}
                      </MenuButton>
                    )}
                  </Popover>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h1 className="typescale-title-large truncate font-semibold">
                  {t('library')}
                </h1>
                <div className="typescale-label-small text-on-surface-variant">
                  {books.length} {t('books')}
                </div>
              </div>

              <div className="relative">
                <button
                  type="button"
                  className="bg-primary-container text-on-primary-container relative flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-transform active:scale-95"
                  aria-label={t('import')}
                  title={t('import')}
                  onClick={openImportMenu}
                >
                  <MdAdd size={28} />
                </button>
                {importMenuOpen && (
                  <Popover align="right" onDismiss={closeImportMenu} wide>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/epub+zip,application/epub,.epub"
                      className="hidden"
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void importFiles(event.target.files)
                        }
                        event.target.value = ''
                      }}
                      multiple
                    />
                    <MenuButton
                      Icon={MdOutlineFileUpload}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t('import_device')}
                    </MenuButton>
                    <div className="bg-surface-variant/70 my-2 h-px" />
                    <form
                      className="space-y-2 px-2 pb-1"
                      onSubmit={importRemoteBook}
                    >
                      <label className="typescale-label-medium text-on-surface-variant flex items-center gap-2">
                        <MdLink size={18} />
                        {t('import_link')}
                      </label>
                      <input
                        type="url"
                        value={remoteUrl}
                        onChange={(event) => setRemoteUrl(event.target.value)}
                        placeholder="https://…/book.epub"
                        className="bg-surface1 text-on-surface ring-outline-variant h-10 w-full rounded-lg px-3 ring-1 ring-inset"
                        required
                      />
                      <Button className="w-full rounded-lg" type="submit">
                        {t('import')}
                      </Button>
                    </form>
                  </Popover>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="scroll min-h-0 flex-1">
        {books.length ? (
          <ul
            className="mx-auto grid w-full max-w-7xl px-4 py-5 sm:px-6"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(calc(92px + 3vw), 1fr))`,
              columnGap: lock(16, 32),
              rowGap: lock(24, 40),
            }}
          >
            {books.map((book) => (
              <Book
                key={book.id}
                book={book}
                covers={covers}
                select={select}
                selected={has(book.id)}
                toggle={toggle}
                enterSelect={enterSelectMode}
              />
            ))}
          </ul>
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-8 text-center">
            <div className="bg-primary-container text-on-primary-container mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
              <MdOutlineFileUpload size={32} />
            </div>
            <h2 className="typescale-title-large">{t('empty_title')}</h2>
            <p className="text-on-surface-variant">{t('empty_description')}</p>
            <Button className="mt-3 rounded-lg" onClick={openImportMenu}>
              {t('import_first_book')}
            </Button>
          </div>
        )}
      </div>
    </DropZone>
  )
}

interface ToolbarButtonProps
  extends Omit<React.ComponentProps<'button'>, 'children'> {
  label: string
  Icon: React.ComponentType<{ size?: number }>
  danger?: boolean
}

function ToolbarButton({
  label,
  Icon,
  danger,
  className,
  ...props
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 disabled:opacity-40',
        danger
          ? 'text-error hover:bg-error-container'
          : 'text-on-surface hover:bg-surface-variant/60',
        className,
      )}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={24} />
    </button>
  )
}

interface PopoverProps {
  align: 'left' | 'right'
  onDismiss: () => void
  wide?: boolean
  children: React.ReactNode
}

function Popover({ align, onDismiss, wide, children }: PopoverProps) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 cursor-default"
        aria-label="Close"
        onClick={onDismiss}
      />
      <div
        className={clsx(
          'bg-surface2 text-on-surface absolute top-[calc(100%+8px)] z-40 overflow-hidden rounded-2xl p-2 shadow-2xl ring-1 ring-black/10',
          align === 'left' ? 'left-0' : 'right-0',
          wide ? 'w-[min(21rem,calc(100vw-2rem))]' : 'w-52',
        )}
      >
        {children}
      </div>
    </>
  )
}

interface MenuButtonProps extends React.ComponentProps<'button'> {
  Icon: React.ComponentType<{ size?: number }>
}

function MenuButton({ Icon, className, children, ...props }: MenuButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'text-on-surface hover:bg-surface-variant/60 flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors',
        className,
      )}
      {...props}
    >
      <Icon size={21} />
      <span className="typescale-body-medium">{children}</span>
    </button>
  )
}

interface BookProps {
  book: BookRecord
  covers?: CoverRecord[]
  select?: boolean
  selected?: boolean
  toggle: (id: string) => void
  enterSelect: (id: string) => void
}

const Book: React.FC<BookProps> = ({
  book,
  covers,
  select,
  selected,
  toggle,
  enterSelect,
}) => {
  const cover = covers?.find((candidate) => candidate.id === book.id)?.cover
  const longPressTimer = useRef<number | undefined>(undefined)
  const pointerStart = useRef<{ x: number; y: number } | undefined>(undefined)
  const longPressTriggered = useRef(false)

  const cancelLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = undefined
  }

  return (
    <li className="min-w-0">
      <button
        type="button"
        className="group block w-full touch-manipulation text-left"
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          pointerStart.current = { x: event.clientX, y: event.clientY }
          longPressTriggered.current = false
          longPressTimer.current = window.setTimeout(() => {
            longPressTriggered.current = true
            enterSelect(book.id)
            navigator.vibrate?.(12)
          }, 500)
        }}
        onPointerMove={(event) => {
          const start = pointerStart.current
          if (
            start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
          ) {
            cancelLongPress()
          }
        }}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={(event) => {
          event.preventDefault()
          cancelLongPress()
          if (longPressTriggered.current) return
          longPressTriggered.current = true
          enterSelect(book.id)
        }}
        onClick={() => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false
            return
          }
          if (select) {
            toggle(book.id)
            return
          }
          navigateReader(() => reader.addTab(book))
        }}
      >
        <div
          className={clsx(
            'bg-surface1 relative overflow-hidden rounded-xl shadow-sm ring-1 transition duration-200 group-active:scale-[0.98]',
            selected
              ? 'ring-primary ring-[3px]'
              : 'ring-outline-variant/50 group-hover:shadow-md',
          )}
        >
          <img
            src={cover ?? placeholder}
            alt=""
            className="mx-auto aspect-[9/12] w-full object-cover"
            draggable={false}
          />
          {book.percentage !== undefined && (
            <div className="bg-black/15 absolute inset-x-0 bottom-0 h-1">
              <div
                className="bg-tertiary h-full"
                style={{ width: `${Math.min(book.percentage * 100, 100)}%` }}
              />
            </div>
          )}
          {select && (
            <div
              className={clsx(
                'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full shadow',
                selected
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface/90 text-outline ring-outline-variant ring-1',
              )}
            >
              {selected && <MdCheck size={19} />}
            </div>
          )}
          {book.percentage !== undefined && !select && (
            <div className="bg-black/65 absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
              {(book.percentage * 100).toFixed()}%
            </div>
          )}
        </div>
        <h2
          className="typescale-body-medium text-on-surface line-clamp-2 mt-2 w-full font-medium leading-snug"
          title={book.name}
        >
          {book.name}
        </h2>
      </button>
    </li>
  )
}

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  window.alert(message)
}
