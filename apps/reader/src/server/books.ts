import { getSitesEnv } from './storage'

export function toBookResponse(row: Record<string, unknown>) {
  const id = String(row.id)
  return {
    id,
    name: String(row.name),
    size: Number(row.size),
    contentType: String(row.content_type),
    contentSha256: String(row.content_sha256),
    metadata: JSON.parse(String(row.metadata_json)),
    cfi: row.cfi ? String(row.cfi) : undefined,
    percentage: ppmToNumber(row.percentage_ppm),
    definitions: JSON.parse(String(row.definitions_json)),
    annotations: JSON.parse(String(row.annotations_json)),
    configuration: row.configuration_json
      ? JSON.parse(String(row.configuration_json))
      : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    version: Number(row.version),
    coverUrl: row.cover_object_key
      ? `/api/books/${encodeURIComponent(id)}/cover`
      : null,
    contentUrl: `/api/books/${encodeURIComponent(id)}/content`,
  }
}

export function numberToPpm(value: number | undefined): number | null {
  return Number.isFinite(value)
    ? Math.round(Math.min(1, Math.max(0, value!)) * 1_000_000)
    : null
}

export async function findBook(userId: string, id: string) {
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

function ppmToNumber(value: unknown): number | undefined {
  return value === null || value === undefined
    ? undefined
    : Number(value) / 1_000_000
}
