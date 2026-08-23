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

function getBookId(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const id = parts[2]
  if (!id) throw new HttpError(400, 'Book ID is required')
  return decodeURIComponent(id)
}
