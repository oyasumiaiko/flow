import {
  apiError,
  HttpError,
  methodNotAllowed,
  requireApiUser,
} from '../../../../server/http'
import { ensureSchema, getSitesEnv } from '../../../../server/storage'

export const runtime = 'edge'

export default async function handler(request: Request) {
  try {
    if (request.method !== 'GET') return methodNotAllowed()
    const user = requireApiUser(request)
    await ensureSchema()
    const id = getBookId(request)
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

function getBookId(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const id = parts[2]
  if (!id) throw new HttpError(400, 'Book ID is required')
  return decodeURIComponent(id)
}
