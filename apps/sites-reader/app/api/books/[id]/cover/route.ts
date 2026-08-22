import { apiError, HttpError, requireApiUser } from '../../../../server/http'
import { ensureSchema, getSitesEnv } from '../../../../server/storage'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireApiUser()
    await ensureSchema()
    const { id } = await context.params
    const { DB, BOOKS } = getSitesEnv()
    const row = await DB.prepare(
      'SELECT cover_object_key FROM books WHERE user_id = ? AND id = ?',
    )
      .bind(user.userId, id)
      .first<{ cover_object_key: string | null }>()
    if (!row?.cover_object_key) throw new HttpError(404, 'Cover not found')
    const object = await BOOKS.get(row.cover_object_key)
    if (!object)
      throw new HttpError(500, 'Cover object is missing from storage')
    const headers = new Headers({
      'Cache-Control': 'private, max-age=3600',
      ETag: object.httpEtag,
    })
    object.writeHttpMetadata(headers)
    return new Response(object.body, { headers })
  } catch (error) {
    return apiError(error)
  }
}
