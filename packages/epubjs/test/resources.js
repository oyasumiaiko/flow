import assert from 'assert'

import Resources from '../src/resources'

describe('Resources', function () {
  it('replaces package-root and zip-root asset paths', function () {
    const resources = new Resources(
      {
        qr: {
          href: 'Images/qr.jpg',
          type: 'image/jpeg',
        },
      },
      {
        replacements: 'none',
        resolver: (href) => `/OEBPS/${href}`,
      },
    )
    resources.replacementUrls = ['blob:qr-image']

    const content = [
      '<img src="../Images/qr.jpg">',
      '<img src="/OEBPS/Images/qr.jpg">',
      '<img src="/Images/qr.jpg">',
    ].join('')

    assert.equal(
      resources.substitute(content, '/OEBPS/Text/chapter.xhtml'),
      [
        '<img src="blob:qr-image">',
        '<img src="blob:qr-image">',
        '<img src="blob:qr-image">',
      ].join(''),
    )
  })
})
