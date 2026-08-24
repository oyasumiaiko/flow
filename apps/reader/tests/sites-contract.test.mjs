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

test('mobile library scrolling and continuous reading remain enabled', async () => {
  const [styles, page, home, touchGuard, reader, typography] =
    await Promise.all([
      readFile(new URL('src/pages/styles.css', root), 'utf8'),
      readFile(new URL('src/components/Page.tsx', root), 'utf8'),
      readFile(new URL('src/pages/index.tsx', root), 'utf8'),
      readFile(new URL('src/hooks/useDisablePinchZooming.ts', root), 'utf8'),
      readFile(new URL('src/models/reader.ts', root), 'utf8'),
      readFile(
        new URL('src/components/viewlets/TypographyView.tsx', root),
        'utf8',
      ),
    ])

  assert.match(styles, /overflow-y:\s*auto/)
  assert.match(styles, /touch-action:\s*pan-y/)
  assert.match(home, /scroll-parent h-full px-4/)
  assert.doesNotMatch(home, /library-scroll/)
  assert.match(page, /scroll h-full/)
  assert.match(touchGuard, /event\.touches\.length < 2/)
  assert.match(reader, /manager:\s*readingMode === 'scrolled'/)
  assert.match(reader, /flow:[\s\S]*'scrolled-continuous'/)
  assert.match(typography, /reading_mode\.scrolled/)
})

test('the reader remains installable as a standalone mobile app', async () => {
  const [manifestText, legacyManifestText, app, document, pwa, serviceWorker] =
    await Promise.all([
      readFile(new URL('public/manifest.webmanifest', root), 'utf8'),
      readFile(new URL('public/manifest.json', root), 'utf8'),
      readFile(new URL('src/pages/_app.tsx', root), 'utf8'),
      readFile(new URL('src/pages/_document.tsx', root), 'utf8'),
      readFile(new URL('src/pwa.ts', root), 'utf8'),
      readFile(new URL('public/sw.js', root), 'utf8'),
    ])
  const manifest = JSON.parse(manifestText)

  assert.deepEqual(manifest, JSON.parse(legacyManifestText))
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.display_override, undefined)
  assert.equal(manifest.theme_color, '#24292e')
  assert.equal(manifest.scope, '/')
  assert.deepEqual(manifest.file_handlers[0].accept['application/epub+zip'], [
    '.epub',
  ])
  assert.match(app, /initializePwa\(\)/)
  assert.match(pwa, /register\('\/sw\.js'/)
  assert.doesNotMatch(pwa, /sw\.js\?/)
  assert.match(document, /manifest\.webmanifest/)
  assert.doesNotMatch(document, /manifest\.webmanifest\?/)
  assert.match(document, /name="mobile-web-app-capable" content="yes"/)
  assert.match(document, /apple-mobile-web-app-capable/)
  assert.doesNotMatch(serviceWorker, /manifest\.(json|webmanifest)/)
  assert.match(serviceWorker, /addEventListener\('fetch'/)
})
