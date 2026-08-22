import { apiError, HttpError, requireApiUser } from '../../server/http'
import { ensureSchema, getSitesEnv } from '../../server/storage'

export async function GET() {
  try {
    const user = await requireApiUser()
    await ensureSchema()
    const { DB } = getSitesEnv()
    const row = await DB.prepare(
      'SELECT settings_json, updated_at, version FROM user_settings WHERE user_id = ?',
    )
      .bind(user.userId)
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
  } catch (error) {
    return apiError(error)
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser()
    await ensureSchema()
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
        .bind(user.userId, JSON.stringify(body.settings), now)
        .run()
      if (result.meta.changes > 0)
        return Response.json({ version: 1, updatedAt: now })
    } else {
      const result = await DB.prepare(
        'UPDATE user_settings SET settings_json = ?, updated_at = ?, version = version + 1 WHERE user_id = ? AND version = ?',
      )
        .bind(JSON.stringify(body.settings), now, user.userId, version)
        .run()
      if (result.meta.changes > 0)
        return Response.json({ version: version + 1, updatedAt: now })
    }
    throw new HttpError(
      409,
      'Settings changed on another device; reload before saving',
    )
  } catch (error) {
    return apiError(error)
  }
}
