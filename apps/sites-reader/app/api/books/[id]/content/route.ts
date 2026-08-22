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
      'SELECT object_key, content_type, name FROM books WHERE user_id = ? AND id = ?',
    )
      .bind(user.userId, id)
      .first<{ object_key: string; content_type: string; name: string }>()
    if (!row) throw new HttpError(404, 'Book not found')
    const object = await BOOKS.get(row.object_key)
    if (!object) throw new HttpError(500, 'Book object is missing from storage')
    return new Response(object.body, {
      headers: {
        'Content-Type': row.content_type,
        'Content-Length': String(object.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(
          row.name,
        )}`,
        'Cache-Control': 'private, max-age=300',
        ETag: object.httpEtag,
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
