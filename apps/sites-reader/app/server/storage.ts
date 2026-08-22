import { env } from 'cloudflare:workers'

export type SitesEnv = {
  DB: D1Database
  BOOKS: R2Bucket
}

/**
 * 所有服务端持久化都从同一个入口取得绑定。绑定缺失属于部署错误，必须显式失败，
 * 禁止退化到内存或浏览器存储，否则会让用户误以为数据已经同步。
 */
export function getSitesEnv(): SitesEnv {
  const bindings = env as unknown as Partial<SitesEnv>
  if (!bindings.DB) throw new Error('Sites D1 binding `DB` is unavailable')
  if (!bindings.BOOKS)
    throw new Error('Sites R2 binding `BOOKS` is unavailable')
  return bindings as SitesEnv
}

let schemaPromise: Promise<void> | undefined

/** 本地预览和新环境首次请求会执行幂等初始化；正式部署仍以 Drizzle migration 为准。 */
export function ensureSchema(): Promise<void> {
  schemaPromise ??= initializeSchema().catch((error) => {
    schemaPromise = undefined
    throw error
  })
  return schemaPromise
}

async function initializeSchema(): Promise<void> {
  const { DB } = getSitesEnv()
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS books (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      object_key TEXT NOT NULL,
      cover_object_key TEXT,
      metadata_json TEXT NOT NULL,
      cfi TEXT,
      percentage_ppm INTEGER,
      definitions_json TEXT NOT NULL DEFAULT '[]',
      annotations_json TEXT NOT NULL DEFAULT '[]',
      configuration_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, id)
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_books_user_hash
      ON books(user_id, content_sha256)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_books_user_updated
      ON books(user_id, updated_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )`),
  ])
  await DB.prepare('PRAGMA optimize').run()
}

export function bookObjectKey(userId: string, bookId: string): string {
  return `users/${encodeKeyPart(userId)}/books/${encodeKeyPart(
    bookId,
  )}/book.epub`
}

export function coverObjectKey(userId: string, bookId: string): string {
  return `users/${encodeKeyPart(userId)}/books/${encodeKeyPart(bookId)}/cover`
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%', '_')
}
