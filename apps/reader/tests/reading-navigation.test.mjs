import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chapterTurnFromBoundarySwipe,
  chapterTurnFromBoundaryWheel,
  chapterTurnFromTap,
  getScrollBoundary,
} from '../src/reading-navigation.ts'

test('tap zones turn chapters only at the top and bottom of the viewport', () => {
  assert.equal(chapterTurnFromTap(50, 1000), -1)
  assert.equal(chapterTurnFromTap(500, 1000), 0)
  assert.equal(chapterTurnFromTap(950, 1000), 1)
})

test('a boundary swipe requires a second vertical gesture that starts at the edge', () => {
  assert.equal(
    chapterTurnFromBoundarySwipe({
      deltaX: 0,
      deltaY: -80,
      boundary: { atStart: false, atEnd: true },
    }),
    1,
  )
  assert.equal(
    chapterTurnFromBoundarySwipe({
      deltaX: 0,
      deltaY: 80,
      boundary: { atStart: true, atEnd: false },
    }),
    -1,
  )
  assert.equal(
    chapterTurnFromBoundarySwipe({
      deltaX: 0,
      deltaY: -80,
      boundary: { atStart: false, atEnd: false },
    }),
    0,
  )
  assert.equal(
    chapterTurnFromBoundarySwipe({
      deltaX: 60,
      deltaY: -50,
      boundary: { atStart: false, atEnd: true },
    }),
    0,
  )
})

test('scroll boundaries tolerate fractional mobile scroll offsets', () => {
  assert.deepEqual(
    getScrollBoundary({
      scrollTop: 0.8,
      clientHeight: 800,
      scrollHeight: 1600,
    }),
    { atStart: true, atEnd: false },
  )
  assert.deepEqual(
    getScrollBoundary({
      scrollTop: 799.2,
      clientHeight: 800,
      scrollHeight: 1600,
    }),
    { atStart: false, atEnd: true },
  )
})

test('wheel turns only when already at the matching chapter boundary', () => {
  assert.equal(
    chapterTurnFromBoundaryWheel(40, { atStart: false, atEnd: true }),
    1,
  )
  assert.equal(
    chapterTurnFromBoundaryWheel(-40, { atStart: true, atEnd: false }),
    -1,
  )
  assert.equal(
    chapterTurnFromBoundaryWheel(40, { atStart: false, atEnd: false }),
    0,
  )
})
