import { EVENTS } from '../../utils/constants'
import {
  isNumber,
  requestAnimationFrame as requestFrame,
} from '../../utils/core'
import ContinuousViewManager from '../continuous'

const LOAD_BUFFER_SCREENS = 8
const KEEP_BUFFER_SCREENS = 12
const MAX_LOAD_VIEWS = 24
const MAX_KEEP_VIEWS = 48
const ESTIMATED_BYTES_PER_SCREEN = 2400
const MIN_SLOT_SCREENS = 0.5
const LAYOUT_ASSET_TIMEOUT = 3000

/**
 * A native-scrolling manager with a permanent slot for every linear spine
 * section. The slots never move or disappear, while their iframe contents are
 * rendered only near the viewport and released again outside a larger buffer.
 *
 * This gives the browser one stable scroll axis without keeping a very long
 * book's complete DOM and iframe set in memory.
 */
class StableViewManager extends ContinuousViewManager {
  constructor(options) {
    super(options)
    this.name = 'stable'
    this.slotsReady = false
    this.renderedViews = new Set()
    this.positioning = false
    this.viewportSlotHeight = 640
    this.pixelsPerByte = this.viewportSlotHeight / ESTIMATED_BYTES_PER_SCREEN
    this.calibrated = false
    this.windowUpdatePromise = undefined
    this.windowUpdatePending = false
    this.scrollFrame = undefined
  }

  display(section, target) {
    if (target === section.href || isNumber(target)) {
      target = undefined
    }

    if (!this.slotsReady) {
      this.buildSlots(section)
    }

    const view = this.viewForSection(section)
    if (!view) return Promise.reject(new Error('Section slot not found'))

    this.positioning = true
    this.scrollToViewStart(view)

    return this.displayView(view)
      .then(() => {
        this.moveToView(view, target)
        this.positioning = false
        return this.updateWindow()
      })
      .catch((error) => {
        this.positioning = false
        throw error
      })
  }

  buildSlots(section) {
    this.clear()
    this.renderedViews.clear()

    const placeholderHeight = Math.max(
      this.container?.clientHeight || this._stageSize?.height || 0,
      640,
    )
    this.viewportSlotHeight = placeholderHeight
    this.pixelsPerByte = placeholderHeight / ESTIMATED_BYTES_PER_SCREEN
    this.calibrated = false

    this.collectSections(section).forEach((item) => {
      const view = this.append(item)
      const estimateWeight = this.sectionWeight(item)
      const estimatedHeight = this.estimatedHeight(estimateWeight)
      view.stableSlotIndex = this.views.length - 1
      view.stableEstimateWeight = estimateWeight
      view.stableHeight = estimatedHeight
      view.stableMeasured = false
      view.element.style.height = `${estimatedHeight}px`
      view.element.style.width = '100%'
      view.on(EVENTS.VIEWS.RESIZED, (size) => this.handleViewResize(view, size))
    })

    this.slotsReady = true
  }

  sectionWeight(section) {
    const weight = Number(section?.estimatedLength)
    return Number.isFinite(weight) && weight > 0 ? weight : undefined
  }

  estimatedHeight(weight) {
    if (!weight) return this.viewportSlotHeight
    return Math.max(
      this.viewportSlotHeight * MIN_SLOT_SCREENS,
      weight * this.pixelsPerByte,
    )
  }

  collectSections(section) {
    let first = section
    let previous = first.prev()

    while (previous) {
      first = previous
      previous = first.prev()
    }

    const sections = []
    let current = first

    while (current) {
      sections.push(current)
      current = current.next()
    }

    return sections
  }

  viewForSection(section) {
    return this.views.all().find((view) => view.section.index === section.index)
  }

  scrollToViewStart(view) {
    const offset = view.offset()
    this.scrollTo(offset.left, offset.top, true)
    this.scrollLeft = offset.left
    this.scrollTop = offset.top
  }

  moveToView(view, target) {
    const viewOffset = view.offset()
    let left = viewOffset.left
    let top = viewOffset.top

    if (target) {
      const targetOffset = view.locationOf(target)
      left += targetOffset.left
      top += targetOffset.top
    }

    this.scrollTo(left, top, true)
    this.scrollLeft = left
    this.scrollTop = top
  }

  displayView(view) {
    if (view.displayed) {
      this.renderedViews.add(view)
      view.show()
      return Promise.resolve(view)
    }

    if (view.stableLoading) return view.stableLoading

    view.stableLoading = view
      .display(this.request)
      .then(() => this.waitForViewLayout(view))
      .then(() => {
        view.show()
        this.renderedViews.add(view)
        return view
      })
      .finally(() => {
        view.stableLoading = undefined
      })

    return view.stableLoading
  }

  waitForViewLayout(view) {
    const doc = view.document
    if (!doc) return Promise.resolve()

    const imagePromises = Array.from(doc.images || [])
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
          }),
      )
    const fontsReady = doc.fonts?.ready || Promise.resolve()
    const assetsReady = Promise.all([...imagePromises, fontsReady])
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, LAYOUT_ASSET_TIMEOUT),
    )

    return Promise.race([assetsReady, timeout]).then(
      () =>
        new Promise((resolve) => {
          requestFrame(() => {
            view.expand(true)
            requestFrame(resolve)
          })
        }),
    )
  }

  handleViewResize(view, size) {
    const previousHeight = view.stableHeight || 0
    const nextHeight = size.height
    const delta = nextHeight - previousHeight
    const viewTop = view.offset().top

    view.stableHeight = nextHeight
    view.stableMeasured = true
    view.expanded = true

    // Reflow above the viewport must not move the visible reading anchor.
    // The slot remains in place; only the native scroll offset is corrected by
    // the exact measured delta.
    if (
      !this.positioning &&
      delta &&
      viewTop + previousHeight <= this.scrollTop
    ) {
      this.scrollBy(0, delta, true)
      this.scrollTop += delta
    } else if (
      !this.positioning &&
      delta &&
      previousHeight > 0 &&
      viewTop < this.scrollTop &&
      this.scrollTop < viewTop + previousHeight
    ) {
      const relativeAnchor = Math.min(
        Math.max((this.scrollTop - viewTop) / previousHeight, 0),
        1,
      )
      const correction = delta * relativeAnchor
      this.scrollBy(0, correction, true)
      this.scrollTop += correction
    }

    this.calibrateEstimates(view, nextHeight)
  }

  calibrateEstimates(view, measuredHeight) {
    const weight = view.stableEstimateWeight
    if (
      this.calibrated ||
      !weight ||
      weight < 1200 ||
      measuredHeight < this.viewportSlotHeight * 0.75
    ) {
      return
    }

    const baseline = this.viewportSlotHeight / ESTIMATED_BYTES_PER_SCREEN
    const measuredRatio = measuredHeight / weight
    this.pixelsPerByte = Math.min(
      Math.max(measuredRatio, baseline / 4),
      baseline * 4,
    )
    this.calibrated = true
    this.applyEstimatedHeights()
  }

  applyEstimatedHeights() {
    const views = this.views.all()
    if (!views.length) return

    const anchorIndex = this.indexAtOffset(this.scrollTop + 1)
    const anchor = views[anchorIndex]
    const oldAnchorTop = anchor?.element.offsetTop || 0
    const oldAnchorHeight = anchor?.stableHeight || 1
    const anchorRatio = Math.min(
      Math.max((this.scrollTop - oldAnchorTop) / oldAnchorHeight, 0),
      1,
    )

    for (const view of views) {
      if (view.stableMeasured || !view.stableEstimateWeight) continue
      const height = this.estimatedHeight(view.stableEstimateWeight)
      view.stableHeight = height
      view.element.style.height = `${height}px`
    }

    if (!anchor || this.positioning) return
    const newAnchorTop = anchor.element.offsetTop
    const newAnchorHeight = anchor.stableHeight || oldAnchorHeight
    const nextScrollTop =
      newAnchorTop +
      (anchor.stableMeasured
        ? this.scrollTop - oldAnchorTop
        : newAnchorHeight * anchorRatio)
    const correction = nextScrollTop - this.scrollTop
    if (correction) {
      this.scrollBy(0, correction, true)
      this.scrollTop = nextScrollTop
    }
  }

  viewportHeight() {
    return this.settings.fullsize
      ? window.innerHeight
      : this.container.clientHeight
  }

  indexAtOffset(offset) {
    const views = this.views.all()
    let low = 0
    let high = views.length - 1
    let result = Math.max(high, 0)

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const view = views[middle]
      const bottom = view.element.offsetTop + (view.stableHeight || 0)

      if (bottom >= offset) {
        result = middle
        high = middle - 1
      } else {
        low = middle + 1
      }
    }

    return result
  }

  boundedRange(first, last, center, limit) {
    if (last - first + 1 <= limit) return [first, last]

    const half = Math.floor(limit / 2)
    let start = Math.max(first, center - half)
    let end = Math.min(last, start + limit - 1)
    start = Math.max(first, end - limit + 1)

    return [start, end]
  }

  updateWindow() {
    if (!this.slotsReady || !this.views.length) return Promise.resolve()

    const height = Math.max(this.viewportHeight(), 1)
    const top = this.scrollTop
    const bottom = top + height
    const loadStart = Math.max(0, top - height * LOAD_BUFFER_SCREENS)
    const loadEnd = bottom + height * LOAD_BUFFER_SCREENS
    const keepStart = Math.max(0, top - height * KEEP_BUFFER_SCREENS)
    const keepEnd = bottom + height * KEEP_BUFFER_SCREENS
    const center = this.indexAtOffset(top + height / 2)
    const [loadFirst, loadLast] = this.boundedRange(
      this.indexAtOffset(loadStart),
      this.indexAtOffset(loadEnd),
      center,
      MAX_LOAD_VIEWS,
    )
    const [keepFirst, keepLast] = this.boundedRange(
      this.indexAtOffset(keepStart),
      this.indexAtOffset(keepEnd),
      center,
      MAX_KEEP_VIEWS,
    )
    const views = this.views.all()
    const displays = []

    for (let index = loadFirst; index <= loadLast; index += 1) {
      const view = views[index]
      if (view) displays.push(this.displayView(view))
    }

    for (const view of Array.from(this.renderedViews)) {
      if (view.stableSlotIndex < keepFirst || view.stableSlotIndex > keepLast) {
        this.releaseView(view)
      }
    }

    return Promise.all(displays).then(() => undefined)
  }

  requestWindowUpdate() {
    if (this.windowUpdatePromise) {
      this.windowUpdatePending = true
      return this.windowUpdatePromise
    }

    this.windowUpdatePromise = this.updateWindow().finally(() => {
      this.windowUpdatePromise = undefined
      if (this.windowUpdatePending) {
        this.windowUpdatePending = false
        this.requestWindowUpdate()
      }
    })
    return this.windowUpdatePromise
  }

  releaseView(view) {
    if (!view || !view.displayed || view.stableLoading) return

    const height = view.stableHeight || view.height()
    view.destroy()
    view.sectionRender = undefined
    view.section.unload()
    view.element.style.height = `${height}px`
    view.element.style.width = '100%'
    view.element.style.visibility = 'visible'
    this.renderedViews.delete(view)
  }

  // The structure is fixed. check/update may render nearby iframe contents,
  // but never prepend, remove, reorder, or navigate between spine sections.
  fill() {
    return Promise.resolve()
  }

  check() {
    return this.updateWindow().then(() => false)
  }

  update() {
    return this.updateWindow()
  }

  trim() {}

  erase() {}

  addScrollListeners() {
    super.addScrollListeners()
    this._scrolled.cancel?.()
    this._scrolled = () => {
      if (this.scrollFrame) return
      this.scrollFrame = requestFrame(() => {
        this.scrollFrame = undefined
        this.scrolled()
      })
    }
  }

  scrolled() {
    this.requestWindowUpdate()

    this.emit(EVENTS.MANAGERS.SCROLL, {
      top: this.scrollTop,
      left: this.scrollLeft,
    })

    clearTimeout(this.afterScrolled)
    this.afterScrolled = setTimeout(() => {
      this.emit(EVENTS.MANAGERS.SCROLLED, {
        top: this.scrollTop,
        left: this.scrollLeft,
      })
    }, this.settings.afterScrolledTimeout)
  }

  clear() {
    this.slotsReady = false
    this.renderedViews?.clear()
    this.windowUpdatePromise = undefined
    this.windowUpdatePending = false
    super.clear()
  }

  destroy() {
    this.slotsReady = false
    this.renderedViews.clear()
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame)
    this.scrollFrame = undefined
    this.windowUpdatePromise = undefined
    this.windowUpdatePending = false
    super.destroy()
  }
}

export default StableViewManager
