import { useBoolean } from '@literal-ui/hooks'
import clsx from 'clsx'
import { useLiveQuery } from 'dexie-react-hooks'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import {
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdCheckCircle,
  MdOutlineFileDownload,
  MdOutlineShare,
} from 'react-icons/md'
import { useSet } from 'react-use'

import { Button, DropZone, ReaderGridView, TextField } from '../components'
import { BookRecord, CoverRecord, db } from '../db'
import { fetchBook, handleFiles } from '../file'
import {
  useDisablePinchZooming,
  useLibrary,
  useMobile,
  useRemoteBooks,
  useTranslation,
} from '../hooks'
import { reader, useReaderSnapshot } from '../models'
import { lock } from '../styles'
import { deleteCloudBooks } from '../sync'
import { copy } from '../utils'

const placeholder = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="gray" fill-opacity="0" width="1" height="1"/></svg>`
const SOURCE = 'src'

export default function Index() {
  const { focusedTab } = useReaderSnapshot()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  useDisablePinchZooming()

  useEffect(() => {
    let source = router.query[SOURCE]
    if (!source) return
    if (!Array.isArray(source)) source = [source]
    setLoading(true)

    Promise.all(source.map((url) => fetchBook(url)))
      .then((books) => books.forEach((book) => reader.addTab(book)))
      .catch(showError)
      .finally(() => setLoading(false))
  }, [router.query])

  useEffect(() => {
    if ('launchQueue' in window && 'LaunchParams' in window) {
      window.launchQueue.setConsumer((params) => {
        if (!params.files.length) return
        Promise.all(params.files.map((file) => file.getFile()))
          .then((files) => handleFiles(files))
          .then((books) => books.forEach((book) => reader.addTab(book)))
          .catch(showError)
      })
    }
  }, [])

  useEffect(() => {
    router.beforePopState(({ url }) => {
      if (url === '/') reader.clear()
      return true
    })
  }, [router])

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

  const [select, toggleSelect] = useBoolean(false)
  const [selectedBookIds, { add, has, toggle, reset }] = useSet<string>()
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

  const selectedBooks = [...selectedBookIds].map(
    (id) => books.find((book) => book.id === id)!,
  )
  const allSelected = selectedBookIds.size === books.length

  return (
    <DropZone
      className="scroll-parent h-full px-4"
      onDrop={async (event) => {
        const bookId = event.dataTransfer.getData('text/plain')
        const book = books.find((candidate) => candidate.id === bookId)
        if (book) {
          reader.addTab(book)
          return
        }
        try {
          await handleFiles(event.dataTransfer.files)
          await remote.mutate()
        } catch (error) {
          showError(error)
        }
      }}
    >
      <div className="mb-4 space-y-2.5">
        <TextField
          name={SOURCE}
          placeholder="https://link.to/remote.epub"
          type="url"
          hideLabel
          actions={[
            {
              title: t('share'),
              Icon: MdOutlineShare,
              onClick(element) {
                if (element?.reportValidity()) {
                  copy(`${window.location.origin}/?${SOURCE}=${element.value}`)
                }
              },
            },
            {
              title: t('download'),
              Icon: MdOutlineFileDownload,
              onClick(element) {
                if (element?.reportValidity()) {
                  fetchBook(element.value)
                    .then(() => remote.mutate())
                    .catch(showError)
                }
              },
            },
          ]}
        />
        <div className="flex items-center justify-between gap-4">
          <div className="space-x-2">
            {books.length ? (
              <Button variant="secondary" onClick={toggleSelect}>
                {t(select ? 'cancel' : 'select')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  fetchBook(
                    'https://epubtest.org/books/Fundamental-Accessibility-Tests-Basic-Functionality-v1.0.0.epub',
                  )
                    .then(() => remote.mutate())
                    .catch(showError)
                }}
              >
                {t('download_sample_book')}
              </Button>
            )}
            {select &&
              (allSelected ? (
                <Button variant="secondary" onClick={reset}>
                  {t('deselect_all')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => books.forEach((book) => add(book.id))}
                >
                  {t('select_all')}
                </Button>
              ))}
          </div>

          <div className="space-x-2">
            {select ? (
              <Button
                onClick={async () => {
                  try {
                    const ids = selectedBooks.map((book) => book.id)
                    await deleteCloudBooks(ids)
                    const database = db
                    if (!database) {
                      throw new Error('Flow local EPUB cache is unavailable')
                    }
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
                    toggleSelect()
                    await remote.mutate()
                  } catch (error) {
                    showError(error)
                  }
                }}
              >
                {t('delete')}
              </Button>
            ) : (
              <Button className="relative">
                <input
                  type="file"
                  accept="application/epub+zip,application/epub,.epub"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={async (event) => {
                    try {
                      if (event.target.files) {
                        await handleFiles(event.target.files)
                        await remote.mutate()
                      }
                    } catch (error) {
                      showError(error)
                    } finally {
                      event.target.value = ''
                    }
                  }}
                  multiple
                />
                {t('import')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="scroll min-h-0 flex-1">
        <ul
          className="grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(calc(80px + 3vw), 1fr))`,
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
            />
          ))}
        </ul>
      </div>
    </DropZone>
  )
}

interface BookProps {
  book: BookRecord
  covers?: CoverRecord[]
  select?: boolean
  selected?: boolean
  toggle: (id: string) => void
}

const Book: React.FC<BookProps> = ({
  book,
  covers,
  select,
  selected,
  toggle,
}) => {
  const router = useRouter()
  const mobile = useMobile()
  const cover = covers?.find((candidate) => candidate.id === book.id)?.cover
  const Icon = selected ? MdCheckBox : MdCheckBoxOutlineBlank

  return (
    <div className="relative flex flex-col">
      <div
        role="button"
        className="border-inverse-on-surface relative border"
        onClick={async () => {
          if (select) {
            toggle(book.id)
            return
          }
          if (mobile) await router.push('/_')
          reader.addTab(book)
        }}
      >
        {book.percentage !== undefined && (
          <div className="typescale-body-large absolute right-0 bg-gray-500/60 px-2 text-gray-100">
            {(book.percentage * 100).toFixed()}%
          </div>
        )}
        <img
          src={cover ?? placeholder}
          alt="Cover"
          className="mx-auto aspect-[9/12] object-cover"
          draggable={false}
        />
        {select && (
          <div className="absolute bottom-1 right-1">
            <Icon
              size={24}
              className={clsx(
                '-m-1',
                selected ? 'text-tertiary' : 'text-outline',
              )}
            />
          </div>
        )}
      </div>

      <div
        className="line-clamp-2 text-on-surface-variant typescale-body-small lg:typescale-body-medium mt-2 w-full"
        title={book.name}
      >
        <MdCheckCircle className="text-tertiary mr-1 mb-0.5 inline" size={16} />
        {book.name}
      </div>
    </div>
  )
}

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  window.alert(message)
}
