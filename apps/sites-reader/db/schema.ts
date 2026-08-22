import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * 书籍元数据与阅读状态按 Sites 提供的稳定 ChatGPT 用户 ID 分区。
 * EPUB 和封面二进制不进入 SQLite，而是通过 object_key / cover_object_key 指向 R2。
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

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').primaryKey(),
  settingsJson: text('settings_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
  version: integer('version').notNull().default(1),
})
