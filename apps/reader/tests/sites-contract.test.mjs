import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { bookObjectKey, coverObjectKey } from '../src/server/keys.js'

const root = new URL('../', import.meta.url)

test('R2 object keys are deterministically isolated by Sites user ID', async () => {
  const first = bookObjectKey('account/a', 'book 1')
  const second = bookObjectKey('account/b', 'book 1')
  assert.notEqual(first, second)
  assert.match(first, /^users\/account_2Fa\/books\/book_201\/book\.epub$/)
  assert.match(
    coverObjectKey('account/a', 'book 1'),
    /^users\/account_2Fa\/books\/book_201\/cover$/,
  )
})

test('every book API obtains server identity and scopes structured queries', async () => {
  const files = [
    'src/pages/api/library.ts',
    'src/pages/api/books/[id].ts',
    'src/pages/api/books/[id]/content.ts',
    'src/pages/api/books/[id]/cover.ts',
  ]

  for (const file of files) {
    const source = await readFile(new URL(file, root), 'utf8')
    assert.match(source, /requireApiUser\(request\)/, file)
    assert.match(source, /user_id\s*=\s*\?/, file)
  }
})

test('legacy Dropbox, ZIP backup, and local preference stores are absent', async () => {
  const files = [
    'package.json',
    'src/file.ts',
    'src/sync.ts',
    'src/state.ts',
    'src/components/pages/settings.tsx',
  ]
  const combined = (
    await Promise.all(
      files.map((file) => readFile(new URL(file, root), 'utf8')),
    )
  ).join('\n')

  assert.doesNotMatch(combined, /from ['"]dropbox['"]|nookies|file-saver/)
  assert.doesNotMatch(
    combined,
    /flow_backup_|localStorageEffect|useLocalStorageState/,
  )
  assert.doesNotMatch(combined, /application\/zip|\.zip['"]/)
})
