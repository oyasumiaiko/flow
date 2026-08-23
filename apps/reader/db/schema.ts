import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * EPUB 与封面二进制存放在 R2；这里只保存可查询的书目、所有权和阅读状态。
 * user_id 参与主键及所有查询，确保每个 ChatGPT 账号拥有完全独立的数据分区。
 */
export const books = sqliteTable(
  'books',
  {
    userId: text('user_id').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    contentType: text('content_type').notNull(),
    contentSha256: text('content_sha256').notNull(),
    objectKey: text('object_key').notNull(),
    coverObjectKey: text('cover_object_key'),
    metadataJson: text('metadata_json').notNull(),
    cfi: text('cfi'),
    percentage: integer('percentage_ppm'),
    definitionsJson: text('definitions_json').notNull().default('[]'),
    annotationsJson: text('annotations_json').notNull().default('[]'),
    configurationJson: text('configuration_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex('idx_books_user_hash').on(table.userId, table.contentSha256),
    index('idx_books_user_updated').on(table.userId, table.updatedAt),
  ],
)

/** 所有全局阅读偏好以一个 JSON 文档按用户保存，并使用版本号处理多设备并发。 */
export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  settingsJson: text('settings_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
  version: integer('version').notNull().default(1),
})
