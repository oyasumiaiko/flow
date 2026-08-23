import {
  apiError,
  HttpError,
  methodNotAllowed,
  requireApiUser,
} from '../../server/http'
import { ensureSchema, getSitesEnv } from '../../server/storage'

export const runtime = 'edge'

export default async function handler(request: Request) {
  try {
    const user = requireApiUser(request)
    await ensureSchema()
    if (request.method === 'GET') return getSettings(user.userId)
    if (request.method === 'PUT') return putSettings(request, user.userId)
    return methodNotAllowed()
  } catch (error) {
    return apiError(error)
  }
}

async function getSettings(userId: string) {
  const { DB } = getSitesEnv()
  const row = await DB.prepare(
    'SELECT settings_json, updated_at, version FROM user_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ settings_json: string; updated_at: number; version: number }>()

  return Response.json(
    row
      ? {
          settings: JSON.parse(row.settings_json),
          updatedAt: row.updated_at,
          version: row.version,
        }
      : { settings: {}, updatedAt: 0, version: 0 },
  )
}

async function putSettings(request: Request, userId: string) {
  const body = (await request.json()) as {
    settings?: unknown
    version?: number
  }
  if (!body.settings || typeof body.settings !== 'object') {
    throw new HttpError(400, 'Settings object is required')
  }

  const version = Number(body.version ?? 0)
  const now = Date.now()
  const { DB } = getSitesEnv()
  if (version === 0) {
    const result = await DB.prepare(
      'INSERT OR IGNORE INTO user_settings (user_id, settings_json, updated_at, version) VALUES (?, ?, ?, 1)',
    )
      .bind(userId, JSON.stringify(body.settings), now)
      .run()
    if (result.meta.changes > 0)
      return Response.json({ version: 1, updatedAt: now })
  } else {
    const result = await DB.prepare(
      'UPDATE user_settings SET settings_json = ?, updated_at = ?, version = version + 1 WHERE user_id = ? AND version = ?',
    )
      .bind(JSON.stringify(body.settings), now, userId, version)
      .run()
    if (result.meta.changes > 0)
      return Response.json({ version: version + 1, updatedAt: now })
  }

  const current = await DB.prepare(
    'SELECT settings_json, updated_at, version FROM user_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ settings_json: string; updated_at: number; version: number }>()
  throw new SettingsConflictError(current)
}

class SettingsConflictError extends HttpError {
  constructor(
    public readonly current: {
      settings_json: string
      updated_at: number
      version: number
    } | null,
  ) {
    super(409, 'Settings changed on another device')
  }
}
