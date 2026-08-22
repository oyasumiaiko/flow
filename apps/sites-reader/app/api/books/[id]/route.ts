import { toBookResponse } from '../../../server/books'
import { apiError, HttpError, requireApiUser } from '../../../server/http'
import { ensureSchema, getSitesEnv } from '../../../server/storage'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireApiUser()
    await ensureSchema()
    const { id } = await context.params
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
    add(
      columns,
      values,
      body,
      'definitions',
      'definitions_json',
      JSON.stringify,
    )
    add(
      columns,
      values,
      body,
      'annotations',
      'annotations_json',
      JSON.stringify,
    )
    add(columns, values, body, 'configuration', 'configuration_json', (value) =>
      value === null ? null : JSON.stringify(value),
    )
    if (columns.length === 0)
      throw new HttpError(400, 'No supported state fields supplied')

    const { DB } = getSitesEnv()
    columns.push('updated_at = ?', 'version = version + 1')
    values.push(Date.now(), user.userId, id, version)
    const result = await DB.prepare(
      `UPDATE books SET ${columns.join(
        ', ',
      )} WHERE user_id = ? AND id = ? AND version = ?`,
    )
      .bind(...values)
      .run()
    if (result.meta.changes === 0) {
      const current = await findBook(user.userId, id)
      if (!current) throw new HttpError(404, 'Book not found')
      return Response.json(
        { error: 'Book state changed on another device', book: current },
        { status: 409 },
      )
    }

    return Response.json({ book: await findBook(user.userId, id) })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireApiUser()
    await ensureSchema()
    const { id } = await context.params
    const { DB, BOOKS } = getSitesEnv()
    const row = await DB.prepare(
      'SELECT object_key, cover_object_key FROM books WHERE user_id = ? AND id = ?',
    )
      .bind(user.userId, id)
      .first<{ object_key: string; cover_object_key: string | null }>()
    if (!row) throw new HttpError(404, 'Book not found')

    await Promise.all([
      BOOKS.delete(row.object_key),
      row.cover_object_key
        ? BOOKS.delete(row.cover_object_key)
        : Promise.resolve(),
    ])
    await DB.prepare('DELETE FROM books WHERE user_id = ? AND id = ?')
      .bind(user.userId, id)
      .run()
    return new Response(null, { status: 204 })
  } catch (error) {
    return apiError(error)
  }
}

async function findBook(userId: string, id: string) {
  const { DB } = getSitesEnv()
  const row = await DB.prepare(
    `SELECT
      id, name, size, content_type, content_sha256, metadata_json, cfi,
      percentage_ppm, definitions_json, annotations_json, configuration_json,
      created_at, updated_at, version, cover_object_key
    FROM books WHERE user_id = ? AND id = ?`,
  )
    .bind(userId, id)
    .first<Record<string, unknown>>()
  return row ? toBookResponse(row) : null
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
