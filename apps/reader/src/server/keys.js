/** @param {string} userId @param {string} bookId */
export function bookObjectKey(userId, bookId) {
  return `users/${encodeKeyPart(userId)}/books/${encodeKeyPart(
    bookId,
  )}/book.epub`
}

/** @param {string} userId @param {string} bookId */
export function coverObjectKey(userId, bookId) {
  return `users/${encodeKeyPart(userId)}/books/${encodeKeyPart(bookId)}/cover`
}

/** @param {string} value */
function encodeKeyPart(value) {
  return encodeURIComponent(value).replaceAll('%', '_')
}
