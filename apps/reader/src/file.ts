import pLimit from 'p-limit'
import { v4 as uuidv4 } from 'uuid'

import ePub, { Book } from '@flow/epubjs'

import { BookRecord, db } from './db'
import { mapExtToMimes } from './mime'
import { uploadCloudBook } from './sync'

const importLimit = pLimit(3)

export async function fileToEpub(file: File) {
  const data = await file.arrayBuffer()
  return ePub(data)
}

/**
 * 导入只接受 EPUB。旧 ZIP 备份、Dropbox 和其他并行恢复通道已经移除；每本书
 * 在写入本地缓存前必须先成功进入 Sites R2/D1。最多并发处理三本，兼顾批量导入
 * 吞吐和浏览器内存占用。
 */
export async function handleFiles(files: Iterable<File>) {
  const candidates = [...files]
  const unsupported = candidates.filter((file) => !isEpub(file))
  if (unsupported.length > 0) {
    throw new Error(
      `仅支持 EPUB 文件：${unsupported.map((file) => file.name).join('、')}`,
    )
  }

  const books = await db?.books.toArray()
  return Promise.all(
    candidates.map((file) =>
      importLimit(async () => {
        const existing = books?.find((book) => book.name === file.name)
        return existing ?? addBook(file)
      }),
    ),
  )
}

export async function addBook(file: File) {
  const startedAt = performance.now()
  console.log(`[Flow Sites] 开始解析并上传《${file.name}》`)
  const epub = await fileToEpub(file)
  const metadata = await epub.loaded.metadata
  const coverDataUrl = await readCover(epub)

  const draft: BookRecord = {
    id: uuidv4(),
    name: file.name || `${metadata.title}.epub`,
    size: file.size,
    metadata,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    definitions: [],
    annotations: [],
  }
  const book = await uploadCloudBook(draft, file, coverDataUrl)

  const database = db
  if (!database) throw new Error('Flow local EPUB cache is unavailable')
  await database.transaction(
    'rw',
    database.books,
    database.files,
    database.covers,
    async () => {
      await database.books.put(book)
      await database.files.put({ id: book.id, file })
      await database.covers.put({ id: book.id, cover: book.coverUrl ?? null })
    },
  )
  console.log(
    `[Flow Sites] 《${book.name}》已进入云端书库，耗时 ${(
      (performance.now() - startedAt) /
      1000
    ).toFixed(2)} 秒`,
  )
  return book
}

/** 仅用于把已取得的 EPUB 放进本地读取缓存，不承担任何云端写入。 */
export async function addFile(id: string, file: File, epub?: Book) {
  await db?.files.put({ id, file })

  if (!epub) epub = await fileToEpub(file)
  const cover = await readCover(epub)
  await db?.covers.put({ id, cover })
}

export function readBlob(fn: (reader: FileReader) => void) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as string))
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Failed to read blob')),
    )
    fn(reader)
  })
}

async function readCover(epub: Book): Promise<string | null> {
  const url = await epub.coverUrl()
  if (!url) return null
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`封面读取失败：HTTP ${response.status}`)
  }
  const blob = await response.blob()
  return readBlob((reader) => reader.readAsDataURL(blob))
}

export async function fetchBook(url: string) {
  const filename = decodeURIComponent(/\/([^/]*\.epub)$/i.exec(url)?.[1] ?? '')
  const books = await db?.books.toArray()
  const book = books?.find((candidate) => candidate.name === filename)
  if (book) return book

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`EPUB 下载失败：HTTP ${response.status}`)
  }
  const blob = await response.blob()
  return addBook(
    new File([blob], filename || 'download.epub', {
      type: blob.type || 'application/epub+zip',
    }),
  )
}

function isEpub(file: File) {
  return (
    mapExtToMimes['.epub'].includes(file.type) ||
    file.name.toLowerCase().endsWith('.epub')
  )
}
