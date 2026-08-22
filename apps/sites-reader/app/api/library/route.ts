import { numberToPpm, toBookResponse } from '../../server/books'
import {
  apiError,
  HttpError,
  parseJson,
  requireApiUser,
} from '../../server/http'
import {
  bookObjectKey,
  coverObjectKey,
  ensureSchema,
  getSitesEnv,
} from '../../server/storage'

const MAX_EPUB_BYTES = 95 * 1024 * 1024

type UploadRecord = {
  id: string
  name: string
  metadata?: unknown
  cfi?: string
  percentage?: number
  definitions?: unknown[]
  annotations?: unknown[]
  configuration?: unknown
  createdAt?: number
  updatedAt?: number
}

export async function GET() {
  try {
    const user = await requireApiUser()
    await ensureSchema()
    const { DB } = getSitesEnv()
    const result = await DB.prepare(
      `SELECT
        id, name, size, content_type, content_sha256, metadata_json, cfi,
        percentage_ppm, definitions_json, annotations_json, configuration_json,
        created_at, updated_at, version, cover_object_key
      FROM books WHERE user_id = ? ORDER BY updated_at DESC`,
    )
      .bind(user.userId)
      .all<Record<string, unknown>>()

    return Response.json({ books: result.results.map(toBookResponse) })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    await ensureSchema()
    const form = await request.formData()
    const file = form.get('book')
    const cover = form.get('cover')
    if (!(file instanceof File)) throw new HttpError(400, 'Missing EPUB file')
    if (file.size === 0) throw new HttpError(400, 'EPUB file is empty')
    if (file.size > MAX_EPUB_BYTES) {
      throw new HttpError(413, 'EPUB exceeds the current 95 MB upload limit')
    }

    const record = parseJson<UploadRecord>(form.get('record'), {
      id: crypto.randomUUID(),
      name: file.name,
    })
    if (!record.id || !record.name)
      throw new HttpError(400, 'Invalid book metadata')

    const bytes = await file.arrayBuffer()
    const sha256 = toHex(await crypto.subtle.digest('SHA-256', bytes))
    const { DB, BOOKS } = getSitesEnv()
    const duplicate = await DB.prepare(
      'SELECT id FROM books WHERE user_id = ? AND content_sha256 = ?',
    )
      .bind(user.userId, sha256)
      .first<{ id: string }>()
    if (duplicate)
      throw new HttpError(409, `Book already exists: ${duplicate.id}`)

    const objectKey = bookObjectKey(user.userId, record.id)
    const coverKey =
      cover instanceof File && cover.size > 0
        ? coverObjectKey(user.userId, record.id)
        : null
    await BOOKS.put(objectKey, bytes, {
      httpMetadata: { contentType: file.type || 'application/epub+zip' },
      customMetadata: { owner: user.userId, bookId: record.id, sha256 },
    })

    try {
      if (coverKey && cover instanceof File) {
        await BOOKS.put(coverKey, await cover.arrayBuffer(), {
          httpMetadata: { contentType: cover.type || 'image/jpeg' },
          customMetadata: { owner: user.userId, bookId: record.id },
        })
      }
      const now = Date.now()
      await DB.prepare(
        `INSERT INTO books (
          user_id, id, name, size, content_type, content_sha256, object_key,
          cover_object_key, metadata_json, cfi, percentage_ppm, definitions_json,
          annotations_json, configuration_json, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
        .bind(
          user.userId,
          record.id,
          record.name,
          file.size,
          file.type || 'application/epub+zip',
          sha256,
          objectKey,
          coverKey,
          JSON.stringify(record.metadata ?? {}),
          record.cfi ?? null,
          numberToPpm(record.percentage),
          JSON.stringify(record.definitions ?? []),
          JSON.stringify(record.annotations ?? []),
          record.configuration === undefined
            ? null
            : JSON.stringify(record.configuration),
          record.createdAt ?? now,
          Math.max(record.updatedAt ?? now, now),
        )
        .run()
    } catch (error) {
      await Promise.all([
        BOOKS.delete(objectKey),
        coverKey ? BOOKS.delete(coverKey) : Promise.resolve(),
      ])
      throw error
    }

    return Response.json({ id: record.id, sha256 }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
