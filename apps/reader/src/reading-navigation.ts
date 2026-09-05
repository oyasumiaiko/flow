export type ChapterTurn = -1 | 0 | 1

export interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export interface ScrollBoundary {
  atStart: boolean
  atEnd: boolean
}

export function getScrollBoundary(
  { scrollTop, clientHeight, scrollHeight }: ScrollMetrics,
  epsilon = 2,
): ScrollBoundary {
  return {
    atStart: scrollTop <= epsilon,
    atEnd: scrollTop + clientHeight >= scrollHeight - epsilon,
  }
}

export function chapterTurnFromTap(
  viewportY: number,
  viewportHeight: number,
  zoneRatio = 0.22,
): ChapterTurn {
  if (viewportHeight <= 0) return 0

  const zoneHeight = viewportHeight * zoneRatio
  if (viewportY <= zoneHeight) return -1
  if (viewportY >= viewportHeight - zoneHeight) return 1
  return 0
}

export function chapterTurnFromBoundarySwipe({
  deltaX,
  deltaY,
  boundary,
  minDistance = 48,
}: {
  deltaX: number
  deltaY: number
  boundary: ScrollBoundary
  minDistance?: number
}): ChapterTurn {
  if (Math.abs(deltaY) < minDistance) return 0
  if (Math.abs(deltaY) <= Math.abs(deltaX) * 1.25) return 0

  if (boundary.atStart && deltaY > 0) return -1
  if (boundary.atEnd && deltaY < 0) return 1
  return 0
}

export function chapterTurnFromBoundaryWheel(
  deltaY: number,
  boundary: ScrollBoundary,
): ChapterTurn {
  if (deltaY < 0 && boundary.atStart) return -1
  if (deltaY > 0 && boundary.atEnd) return 1
  return 0
}
