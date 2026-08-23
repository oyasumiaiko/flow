import { findBook } from '../../../server/books'
import {
  apiError,
  HttpError,
  methodNotAllowed,
  requireApiUser,
} from '../../../server/http'
import { ensureSchema, getSitesEnv } from '../../../server/storage'

export const runtime = 'edge'

export default async function handler(request: Request) {
  try {
    const user = requireApiUser(request)
    await ensureSchema()
    const id = getBookId(request)

    if (request.method === 'PATCH') return patchBook(request, user.userId, id)
    if (request.method === 'DELETE') return deleteBook(user.userId, id)
    return methodNotAllowed()
  } catch (error) {
    return apiError(error)
  }
}

async function patchBook(request: Request, userId: string, id: string) {
  const body = (await request.json()) as Record<string, unknown>
  const version = Number(body.version)
  if (!Number.isInteger(version) || version < 1) {
    throw new HttpError(400, 'A valid book version is required')
  }

  const columns: string[] = []
  const values: unknown[] = []
  add(columns, values, body, 'cfi', 'cfi', (value) =>
    value === null ? null : String(value),
  )
  add(columns, values, body, 'percentage', 'percentage_ppm', (value) =>
    value === null
      ? null
      : Math.round(Math.min(1, Math.max(0, Number(value))) * 1_000_000),
  )
  add(columns, values, body, 'definitions', 'definitions_json', JSON.stringify)
  add(columns, values, body, 'annotations', 'annotations_json', JSON.stringify)
  add(columns, values, body, 'configuration', 'configuration_json', (value) =>
    value === null ? null : JSON.stringify(value),
  )
  if (columns.length === 0)
    throw new HttpError(400, 'No supported state fields supplied')

  const { DB } = getSitesEnv()
  columns.push('updated_at = ?', 'version = version + 1')
  values.push(Date.now(), userId, id, version)
  const result = await DB.prepare(
    `UPDATE books SET ${columns.join(
      ', ',
    )} WHERE user_id = ? AND id = ? AND version = ?`,
  )
    .bind(...values)
    .run()

  if (result.meta.changes === 0) {
    const current = await findBook(userId, id)
    if (!current) throw new HttpError(404, 'Book not found')
    return Response.json(
      { error: 'Book state changed on another device', book: current },
      { status: 409 },
    )
  }

  return Response.json({ book: await findBook(userId, id) })
}

async function deleteBook(userId: string, id: string) {
  const { DB, BOOKS } = getSitesEnv()
  const row = await DB.prepare(
    'SELECT object_key, cover_object_key FROM books WHERE user_id = ? AND id = ?',
  )
    .bind(userId, id)
    .first<{ object_key: string; cover_object_key: string | null }>()
  if (!row) throw new HttpError(404, 'Book not found')

  await Promise.all([
    BOOKS.delete(row.object_key),
    row.cover_object_key
      ? BOOKS.delete(row.cover_object_key)
      : Promise.resolve(),
  ])
  await DB.prepare('DELETE FROM books WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .run()
  return new Response(null, { status: 204 })
}

function getBookId(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const id = parts[2]
  if (!id) throw new HttpError(400, 'Book ID is required')
  return decodeURIComponent(id)
}

function add(
  columns: string[],
  values: unknown[],
  body: Record<string, unknown>,
  field: string,
  column: string,
  convert: (value: unknown) => unknown,
) {
  if (!(field in body)) return
  columns.push(`${column} = ?`)
  values.push(convert(body[field]))
}
