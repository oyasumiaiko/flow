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

test('mobile reading uses a stable windowed full-spine document flow', async () => {
  const [
    styles,
    page,
    home,
    touchGuard,
    reader,
    readerView,
    layout,
    stable,
    typography,
  ] = await Promise.all([
    readFile(new URL('src/pages/styles.css', root), 'utf8'),
    readFile(new URL('src/components/Page.tsx', root), 'utf8'),
    readFile(new URL('src/pages/index.tsx', root), 'utf8'),
    readFile(new URL('src/hooks/useDisablePinchZooming.ts', root), 'utf8'),
    readFile(new URL('src/models/reader.ts', root), 'utf8'),
    readFile(new URL('src/components/Reader.tsx', root), 'utf8'),
    readFile(new URL('src/components/Layout.tsx', root), 'utf8'),
    readFile(
      new URL('../../packages/epubjs/src/managers/stable/index.js', root),
      'utf8',
    ),
    readFile(
      new URL('src/components/viewlets/TypographyView.tsx', root),
      'utf8',
    ),
  ])

  assert.match(styles, /overflow-y:\s*auto/)
  assert.match(styles, /touch-action:\s*pan-y/)
  assert.match(home, /scroll-parent bg-background h-full/)
  assert.doesNotMatch(home, /library-scroll/)
  assert.match(page, /scroll bg-background h-full/)
  assert.match(touchGuard, /event\.touches\.length < 2/)
  assert.match(reader, /manager:[\s\S]*StableViewManager/)
  assert.match(reader, /flow:[\s\S]*'scrolled'/)
  assert.doesNotMatch(reader, /'scrolled-continuous'/)
  assert.match(reader, /manager\?\.current\?\.\(\)/)
  assert.match(reader, /this\.section = ref\(currentSection\)/)
  assert.match(stable, /collectSections/)
  assert.match(stable, /buildSlots/)
  assert.match(stable, /view\.element\.style\.height/)
  assert.match(stable, /LOAD_BUFFER_SCREENS/)
  assert.match(stable, /ESTIMATED_BYTES_PER_SCREEN/)
  assert.match(stable, /stableEstimateWeight/)
  assert.match(stable, /waitForViewLayout/)
  assert.match(stable, /image\.addEventListener\('load'/)
  assert.match(stable, /addScrollListeners\(\)/)
  assert.match(stable, /requestFrame/)
  assert.match(stable, /requestWindowUpdate/)
  assert.match(stable, /KEEP_BUFFER_SCREENS/)
  assert.match(stable, /MAX_LOAD_VIEWS/)
  assert.match(stable, /MAX_KEEP_VIEWS/)
  assert.match(stable, /releaseView/)
  assert.match(stable, /view\.destroy\(\)/)
  assert.match(stable, /view\.section\.unload\(\)/)
  assert.match(stable, /this\.scrollTop \+= delta/)
  assert.doesNotMatch(stable, /this\.views\.(prepend|remove)/)
  assert.doesNotMatch(stable, /this\.(next|prev)\(/)
  assert.doesNotMatch(reader, /Promise\.all\(promises\)/)
  assert.match(reader, /archive\?\.getSize/)
  assert.match(reader, /ensureGlobalLocations/)
  assert.match(readerView, /useRenditionEvent\(rendition, 'touchend'/)
  assert.match(readerView, /if \(!start \|\| isScrolled\) return/)
  assert.match(layout, /reader_menu/)
  assert.match(layout, /<PageActionBar env={Env\.Mobile}/)
  assert.match(layout, /<ViewActionBar env={Env\.Mobile}/)
  assert.match(typography, /reading_mode\.scrolled/)
})

test('mobile library chrome and Android back use explicit app navigation', async () => {
  const [home, navigation, layout, settings] = await Promise.all([
    readFile(new URL('src/pages/index.tsx', root), 'utf8'),
    readFile(new URL('src/navigation.ts', root), 'utf8'),
    readFile(new URL('src/components/Layout.tsx', root), 'utf8'),
    readFile(new URL('src/components/pages/settings.tsx', root), 'utf8'),
  ])

  assert.match(home, /LibraryHeader/)
  assert.match(home, /<MdAdd size=\{28\}/)
  assert.match(home, /import_device/)
  assert.match(home, /import_link/)
  assert.match(home, /setTimeout\(\(\) => {[\s\S]*enterSelect\(book\.id\)/)
  assert.doesNotMatch(home, /<TextField/)
  assert.doesNotMatch(home, /router\.push\('\/_'\)/)
  assert.doesNotMatch(home, /beforePopState/)

  assert.match(navigation, /window\.addEventListener\('popstate'/)
  assert.match(navigation, /restoreReader\(target\.snapshot\)/)
  assert.match(navigation, /current\.layer\.close\(\)/)
  assert.match(navigation, /saveReaderEntry\('replace'\)/)
  assert.match(layout, /navigateReader\(\(\) =>/)
  assert.match(layout, /if \(!readMode\) return null/)
  assert.doesNotMatch(layout, /mb-12 sm:mb-0/)
  assert.match(settings, /goBack\(\(\) => reader\.clear\(\)\)/)
})

test('the reader remains installable as a standalone mobile app', async () => {
  const [manifestText, app, document, pwa, serviceWorker] = await Promise.all([
    readFile(new URL('public/manifest.json', root), 'utf8'),
    readFile(new URL('src/pages/_app.tsx', root), 'utf8'),
    readFile(new URL('src/pages/_document.tsx', root), 'utf8'),
    readFile(new URL('src/pwa.ts', root), 'utf8'),
    readFile(new URL('public/sw.js', root), 'utf8'),
  ])
  const manifest = JSON.parse(manifestText)

  assert.equal(manifest.display, 'standalone')
  assert.deepEqual(manifest.display_override, ['standalone'])
  assert.equal(manifest.theme_color, '#fff')
  assert.equal(manifest.scope, '/')
  assert.match(app, /initializePwa\(\)/)
  assert.match(pwa, /register\('\/sw\.js'/)
  assert.match(document, /href="\/manifest\.json"/)
  assert.match(document, /name="mobile-web-app-capable" content="yes"/)
  assert.match(document, /apple-mobile-web-app-capable/)
  assert.match(serviceWorker, /flow-static-standalone/)
  assert.match(serviceWorker, /'\/manifest\.json'/)
  assert.match(serviceWorker, /addEventListener\('fetch'/)
})

test('immersive mode fills the viewport without drawing a duplicate status bar', async () => {
  const [fullscreen, index, layout, reader, settings, state, background] =
    await Promise.all([
      readFile(new URL('src/fullscreen.ts', root), 'utf8'),
      readFile(new URL('src/pages/index.tsx', root), 'utf8'),
      readFile(new URL('src/components/Layout.tsx', root), 'utf8'),
      readFile(new URL('src/components/Reader.tsx', root), 'utf8'),
      readFile(new URL('src/components/pages/settings.tsx', root), 'utf8'),
      readFile(new URL('src/state.ts', root), 'utf8'),
      readFile(new URL('src/hooks/theme/useBackground.ts', root), 'utf8'),
    ])

  assert.match(fullscreen, /requestFullscreen/)
  assert.match(fullscreen, /exitFullscreen/)
  assert.match(fullscreen, /display-mode: fullscreen/)
  assert.match(index, /viewport-fit=cover/)
  assert.doesNotMatch(layout, /WebStatusBar/)
  assert.match(reader, /case 'time'/)
  assert.match(reader, /case 'battery'/)
  assert.match(reader, /getBattery/)
  assert.match(state, /\| 'time'/)
  assert.match(state, /\| 'battery'/)
  assert.match(state, /\| 'globalPage'/)
  assert.match(settings, /enterImmersiveMode/)
  assert.match(settings, /exitImmersiveMode/)
  assert.match(settings, /'time'/)
  assert.match(settings, /'battery'/)
  assert.match(settings, /'globalPage'/)
  assert.match(background, /rawTheme\.schemes\.dark\.background/)
  assert.match(background, /#theme-color/)
})
