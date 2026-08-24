import { useEventListener } from '@literal-ui/hooks'
import clsx from 'clsx'
import { useSetAtom } from 'jotai'
import React, {
  CSSProperties,
  ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { MdWebAsset } from 'react-icons/md'
import { RiBookLine } from 'react-icons/ri'
import { PhotoSlider } from 'react-photo-view'
import { useSnapshot } from 'valtio'

import { RenditionSpread } from '@flow/epubjs/types/rendition'
import {
  defaultReaderMetaSettings,
  navbarState,
  ReaderMetaSlot,
  useSettings,
} from '@flow/reader/state'

import { db } from '../db'
import { handleFiles } from '../file'
import {
  hasSelection,
  useBackground,
  useColorScheme,
  useDisablePinchZooming,
  useMobile,
  useSync,
  useTranslation,
  useTypography,
} from '../hooks'
import { BookTab, reader, useReaderSnapshot } from '../models'
import { isTouchScreen } from '../platform'
import { updateCustomStyle } from '../styles'

import {
  getClickedAnnotation,
  setClickedAnnotation,
  Annotations,
} from './Annotation'
import { Tab } from './Tab'
import { TextSelectionMenu } from './TextSelectionMenu'
import { DropZone, SplitView, useDndContext, useSplitViewItem } from './base'
import * as pages from './pages'

function handleKeyDown(tab?: BookTab) {
  return (e: KeyboardEvent) => {
    if (tab?.readingMode === 'scrolled') return
    try {
      switch (e.code) {
        case 'ArrowLeft':
        case 'ArrowUp':
          tab?.prev()
          break
        case 'ArrowRight':
        case 'ArrowDown':
          tab?.next()
          break
        case 'Space':
          e.shiftKey ? tab?.prev() : tab?.next()
      }
    } catch (error) {
      // ignore `rendition is undefined` error
    }
  }
}

function useRenditionEvent(
  rendition:
    | {
        on: (event: string, listener: (...args: any[]) => void) => unknown
        off: (event: string, listener: (...args: any[]) => void) => unknown
      }
    | undefined,
  event: string,
  listener: (...args: any[]) => void,
) {
  const listenerRef = useRef(listener)
  listenerRef.current = listener

  useEffect(() => {
    if (!rendition) return

    const handleEvent = (...args: any[]) => listenerRef.current(...args)
    rendition.on(event, handleEvent)
    return () => {
      rendition.off(event, handleEvent)
    }
  }, [event, rendition])
}

function parseViewportAspectRatio(viewport?: string) {
  if (!viewport) return

  const width = Number.parseFloat(
    /width\s*=\s*([0-9.]+)/i.exec(viewport)?.[1] ?? '',
  )
  const height = Number.parseFloat(
    /height\s*=\s*([0-9.]+)/i.exec(viewport)?.[1] ?? '',
  )

  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return
  }

  return width / height
}

export function ReaderGridView() {
  const { groups } = useReaderSnapshot()

  useEventListener('keydown', handleKeyDown(reader.focusedBookTab))

  if (!groups.length) return null
  return (
    <SplitView className={clsx('ReaderGridView')}>
      {groups.map(({ id }, i) => (
        <ReaderGroup key={id} index={i} />
      ))}
    </SplitView>
  )
}

interface ReaderGroupProps {
  index: number
}
function ReaderGroup({ index }: ReaderGroupProps) {
  const group = reader.groups[index]!
  const { focusedIndex } = useReaderSnapshot()
  const { tabs, selectedIndex } = useSnapshot(group as any) as {
    tabs: any[]
    selectedIndex: number
  }
  const t = useTranslation()

  const { size } = useSplitViewItem(`${ReaderGroup.name}.${index}`, {
    // to disable sash resize
    visible: false,
  })

  const handleMouseDown = useCallback(() => {
    reader.selectGroup(index)
  }, [index])

  return (
    <div
      className="ReaderGroup group relative flex flex-1 flex-col overflow-hidden focus:outline-none"
      onMouseDown={handleMouseDown}
      style={{ width: size }}
    >
      {/* 仅在顶部热区触发标签栏显示，避免鼠标在正文区域移动时也显示标签栏。 */}
      <div className="peer absolute inset-x-0 top-0 z-20 hidden h-8 sm:block" />
      <Tab.List
        // 标签栏仅在顶部热区悬停、标签栏自身悬停/聚焦、或键盘焦点进入时显示。
        className="pointer-events-none absolute inset-x-0 top-0 z-30 hidden opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 hover:pointer-events-auto hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 peer-hover:pointer-events-auto peer-hover:opacity-100 sm:flex"
        onDelete={() => reader.removeGroup(index)}
      >
        {tabs.map((tab, i) => {
          const selected = i === selectedIndex
          const focused = index === focusedIndex && selected
          return (
            <Tab
              key={tab.id}
              selected={selected}
              focused={focused}
              onClick={() => group.selectTab(i)}
              onDelete={() => reader.removeTab(i, index)}
              Icon={tab instanceof BookTab ? RiBookLine : MdWebAsset}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', `${index},${i}`)
              }}
            >
              {tab.isBook ? tab.title : t(`${tab.title}.title`)}
            </Tab>
          )
        })}
      </Tab.List>

      <DropZone
        className={clsx('flex-1', isTouchScreen || 'h-0')}
        split
        onDrop={async (e, position) => {
          // read `e.dataTransfer` first to avoid get empty value after `await`
          const files = e.dataTransfer.files
          let tabs = []

          if (files.length) {
            tabs = await handleFiles(files)
          } else {
            const text = e.dataTransfer.getData('text/plain')
            const fromTab = text.includes(',')

            if (fromTab) {
              const indexes = text.split(',')
              const groupIdx = Number(indexes[0])

              if (index === groupIdx) {
                if (group.tabs.length === 1) return
                if (position === 'universe') return
              }

              const tabIdx = Number(indexes[1])
              const tab = reader.removeTab(tabIdx, groupIdx)
              if (tab) tabs.push(tab)
            } else {
              const id = text
              const tabParam =
                Object.values(pages).find((p) => p.displayName === id) ??
                (await db?.books.get(id))
              if (tabParam) tabs.push(tabParam)
            }
          }

          if (tabs.length) {
            switch (position) {
              case 'left':
                reader.addGroup(tabs, index)
                break
              case 'right':
                reader.addGroup(tabs, index + 1)
                break
              default:
                tabs.forEach((t) => reader.addTab(t, index))
            }
          }
        }}
      >
        {group.tabs.map((tab, i) => (
          <PaneContainer active={i === selectedIndex} key={tab.id}>
            {tab instanceof BookTab ? (
              <BookPane tab={tab} onMouseDown={handleMouseDown} />
            ) : (
              <tab.Component />
            )}
          </PaneContainer>
        ))}
      </DropZone>
    </div>
  )
}

interface PaneContainerProps {
  active: boolean
  children?: React.ReactNode
}
const PaneContainer: React.FC<PaneContainerProps> = ({ active, children }) => {
  return <div className={clsx('h-full', active || 'hidden')}>{children}</div>
}

interface BookPaneProps {
  tab: BookTab
  onMouseDown: () => void
}

function BookPane({ tab, onMouseDown }: BookPaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const renderRef = useRef<HTMLDivElement>(null)
  const cursorHideTimerRef = useRef<number | undefined>(undefined)
  const prevSize = useRef({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [cursorHidden, setCursorHidden] = useState(false)
  const typography = useTypography(tab)
  const [settings] = useSettings()
  const { dark } = useColorScheme()
  const [background] = useBackground()
  const mobile = useMobile()
  const deviceMeta = useReaderDeviceMeta()
  const readingMode =
    typography.readingMode ?? (mobile ? 'scrolled' : 'paginated')
  const isScrolled = readingMode === 'scrolled'

  const { iframe, rendition, rendered, container } = useSnapshot(tab)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const observer = new ResizeObserver(([e]) => {
      const width = e?.contentRect.width ?? 0
      const height = e?.contentRect.height ?? 0
      setViewportSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      )
      if (
        width !== 0 &&
        height !== 0 &&
        prevSize.current.width !== 0 &&
        prevSize.current.height !== 0
      ) {
        reader.resize()
      }
      prevSize.current = { width, height }
    })

    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [])

  useSync(tab)

  const setNavbar = useSetAtom(navbarState)
  const autoHideCursorInReading = !!settings.autoHideCursorInReading
  const shouldAutoHideCursor = autoHideCursorInReading && mobile === false

  const clearCursorHideTimer = useCallback(() => {
    if (cursorHideTimerRef.current === undefined) return
    window.clearTimeout(cursorHideTimerRef.current)
    cursorHideTimerRef.current = undefined
  }, [])

  const scheduleCursorHide = useCallback(() => {
    if (!shouldAutoHideCursor) return
    clearCursorHideTimer()
    cursorHideTimerRef.current = window.setTimeout(() => {
      setCursorHidden(true)
    }, 5000)
  }, [clearCursorHideTimer, shouldAutoHideCursor])

  const handleReadingAreaMouseMove = useCallback(() => {
    if (!shouldAutoHideCursor) return
    // 仅鼠标移动会重置隐藏状态；点击和滚轮不会触发该逻辑。
    setCursorHidden(false)
    scheduleCursorHide()
  }, [scheduleCursorHide, shouldAutoHideCursor])

  useEffect(() => {
    if (shouldAutoHideCursor) {
      return () => {
        clearCursorHideTimer()
      }
    }
    clearCursorHideTimer()
    setCursorHidden(false)
  }, [clearCursorHideTimer, shouldAutoHideCursor])

  useEffect(() => {
    if (!iframe) return
    const targets = [
      iframe.document.documentElement,
      iframe.document.body,
    ].filter(Boolean) as HTMLElement[]

    targets.forEach((el) => {
      el.style.cursor = cursorHidden ? 'none' : ''
    })

    return () => {
      targets.forEach((el) => {
        el.style.cursor = ''
      })
    }
  }, [cursorHidden, iframe])

  const applyCustomStyle = useCallback(() => {
    const contents = rendition?.getContents()[0]
    const isDoublePage = rendition?.manager?.layout?.divisor === 2
    updateCustomStyle(contents, typography, isDoublePage)
  }, [rendition, typography])

  useEffect(() => {
    tab.onRender = applyCustomStyle
  }, [applyCustomStyle, tab])

  useEffect(() => {
    if (renderRef.current) tab.render(renderRef.current, readingMode)
  }, [readingMode, tab])

  useEffect(() => {
    /**
     * when `spread` changes, we should call `spread()` to re-layout,
     * then call {@link updateCustomStyle} to update custom style
     * according to the latest layout
     */
    rendition?.spread(
      isScrolled
        ? RenditionSpread.None
        : typography.spread ?? RenditionSpread.Auto,
    )
  }, [isScrolled, typography.spread, rendition])

  useEffect(() => applyCustomStyle(), [applyCustomStyle])

  useEffect(() => {
    if (dark === undefined) return
    // set `!important` when in dark mode
    rendition?.themes.override('color', dark ? '#bfc8ca' : '#3f484a', dark)
  }, [rendition, dark])

  const [src, setSrc] = useState<string>()

  useEffect(() => {
    if (src) {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement?.blur()
    }
  }, [src])

  const { setDragEvent } = useDndContext()

  // `dragenter` not fired in iframe when the count of times is even, so use `dragover`
  useEventListener(iframe, 'dragover', (e: any) => {
    console.log('drag enter in iframe')
    setDragEvent(e)
  })

  useRenditionEvent(rendition, 'mousedown', onMouseDown)
  useRenditionEvent(rendition, 'mousemove', handleReadingAreaMouseMove)

  useRenditionEvent(rendition, 'click', (e) => {
    // https://developer.chrome.com/blog/tap-to-search
    e.preventDefault()

    for (const el of e.composedPath() as any) {
      // `instanceof` may not work in iframe
      if (el.tagName === 'A' && el.href) {
        tab.showPrevLocation()
        return
      }
      if (
        mobile === false &&
        el.tagName === 'IMG' &&
        el.src.startsWith('blob:')
      ) {
        setSrc(el.src)
        return
      }
    }

    if (isTouchScreen && container) {
      if (getClickedAnnotation()) {
        setClickedAnnotation(false)
        return
      }

      if (isScrolled) {
        if (mobile) setNavbar((visible) => !visible)
        return
      }

      const w = container.clientWidth
      const x = e.clientX % w
      const threshold = 0.3
      const side = w * threshold

      if (x < side) {
        tab.prev()
      } else if (w - x < side) {
        tab.next()
      } else if (mobile) {
        setNavbar((a) => !a)
      }
    }
  })

  const handleWheelTurnPage = useCallback(
    (deltaY: number) => {
      if (deltaY < 0) {
        tab.prev()
      } else if (deltaY > 0) {
        tab.next()
      }
    },
    [tab],
  )

  useRenditionEvent(rendition, 'wheel', (e) => {
    if (isScrolled) return
    handleWheelTurnPage(e.deltaY)
  })

  useRenditionEvent(rendition, 'keydown', handleKeyDown(tab))

  const touchStartRef = useRef<
    | {
        x: number
        y: number
        time: number
        activeWindow?: Window
      }
    | undefined
  >(undefined)

  useRenditionEvent(rendition, 'touchstart', (e, contents) => {
    touchStartRef.current = {
      x: e.targetTouches[0]?.clientX ?? 0,
      y: e.targetTouches[0]?.clientY ?? 0,
      time: Date.now(),
      activeWindow: contents?.window,
    }
  })

  useRenditionEvent(rendition, 'touchend', (e) => {
    const start = touchStartRef.current
    touchStartRef.current = undefined
    if (!start || isScrolled) return

    const selection = start.activeWindow?.getSelection()
    if (hasSelection(selection)) return

    const x1 = e.changedTouches[0]?.clientX ?? 0
    const y1 = e.changedTouches[0]?.clientY ?? 0
    const deltaX = x1 - start.x
    const deltaY = y1 - start.y
    const deltaT = Date.now() - start.time
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX < 10) return

    if (absY / absX > 2 && (deltaT > 100 || absX < 30)) {
      return
    }

    if (deltaX > 0) tab.prev()
    if (deltaX < 0) tab.next()
  })

  useRenditionEvent(rendition, 'touchmove', (e) => {
    if (e.touches.length > 1 && e.cancelable) e.preventDefault()
  })

  useDisablePinchZooming(iframe as unknown as Window | undefined)

  const spreadContainerStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {
      colorScheme: 'auto',
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      touchAction: isScrolled ? 'pan-y' : undefined,
    }

    if (isScrolled) return style

    if ((typography.spread ?? RenditionSpread.Auto) === RenditionSpread.None) {
      return style
    }

    const outerMargin = Math.max(0, typography.spreadPageOuterMargin ?? 0)

    // 双页整体始终居中，outer margin 直接作用在阅读容器两侧。
    style.marginInline = 'auto'
    style.paddingInline = `${outerMargin}px`

    let maxWidth = typography.spreadMaxWidth
    if (typography.spreadRespectAspectRatio) {
      const aspectRatio = parseViewportAspectRatio(tab.book.metadata.viewport)
      const usableHeight = Math.max(viewportSize.height, 0)
      if (aspectRatio && usableHeight > 0) {
        // 内侧边距通过列宽/列间距内部消化，这里只把外侧留白计入总宽约束。
        const aspectMaxWidth = usableHeight * aspectRatio * 2 + outerMargin * 2
        maxWidth = maxWidth
          ? Math.min(maxWidth, aspectMaxWidth)
          : aspectMaxWidth
      }
    }

    if (maxWidth && maxWidth > 0) {
      style.maxWidth = `${maxWidth}px`
    }

    return style
  }, [
    tab.book.metadata.viewport,
    isScrolled,
    typography.spread,
    typography.spreadMaxWidth,
    typography.spreadPageOuterMargin,
    typography.spreadRespectAspectRatio,
    viewportSize.height,
  ])

  useEffect(() => {
    reader.resize()
  }, [
    typography.spread,
    typography.spreadMaxWidth,
    typography.spreadPageOuterMargin,
    typography.spreadRespectAspectRatio,
    readingMode,
    viewportSize.height,
  ])

  return (
    <div className={clsx('flex h-full flex-col', mobile && 'py-[3vw]')}>
      <PhotoSlider
        images={[{ src, key: 0 }]}
        visible={!!src}
        onClose={() => setSrc(undefined)}
        maskOpacity={0.6}
        bannerVisible={false}
      />
      <ReaderPaneHeader tab={tab} deviceMeta={deviceMeta} />
      <div
        ref={viewportRef}
        className={clsx(
          'relative flex-1',
          isTouchScreen || 'h-0',
          cursorHidden && 'cursor-none',
        )}
        onMouseMove={handleReadingAreaMouseMove}
        onMouseLeave={() => {
          clearCursorHideTimer()
          setCursorHidden(false)
        }}
        onWheel={(e) => {
          if (isScrolled) return
          // 双页设置最大宽度后，两侧会出现留白；在留白区域滚轮也应保持翻页行为。
          e.preventDefault()
          handleWheelTurnPage(e.deltaY)
        }}
      >
        <div
          className={clsx(
            'absolute inset-0',
            // do not cover `sash`
            'z-20',
            rendered && 'hidden',
            background,
          )}
        />
        <div className="absolute inset-0">
          <div
            ref={renderRef}
            className="relative"
            style={spreadContainerStyle}
          >
            <TextSelectionMenu tab={tab} />
            <Annotations tab={tab} />
          </div>
        </div>
      </div>
      <ReaderPaneFooter tab={tab} deviceMeta={deviceMeta} />
    </div>
  )
}

interface ReaderPaneHeaderProps {
  tab: BookTab
  deviceMeta: ReaderDeviceMeta
}

interface ReaderDeviceMeta {
  time: string
  battery?: string
}

interface ReaderMetaContext {
  tab: BookTab
  navPath: { label: string }[]
  location?: {
    start?: {
      href?: string
      displayed?: {
        page?: number
        total?: number
      }
    }
  }
  percentage?: number
}

function getReaderMetaText(
  slot: ReaderMetaSlot,
  context: ReaderMetaContext,
  deviceMeta: ReaderDeviceMeta,
) {
  switch (slot) {
    case 'none':
      return
    case 'bookTitle':
      return context.tab.title
    case 'chapterPath': {
      const labels = context.navPath
        .map((item) => item.label?.trim())
        .filter(Boolean)
      return labels.length ? labels.join(' / ') : undefined
    }
    case 'pageNumber': {
      const displayed = context.location?.start?.displayed
      const page = displayed?.page
      const total = displayed?.total
      if (page === undefined || total === undefined) return
      return `${page} / ${total}`
    }
    case 'href':
      return context.location?.start?.href
    case 'progress':
      return `${((context.percentage ?? 0) * 100).toFixed()}%`
    case 'time':
      return deviceMeta.time
    case 'battery':
      return deviceMeta.battery
  }
}

const ReaderPaneHeader: React.FC<ReaderPaneHeaderProps> = ({
  tab,
  deviceMeta,
}) => {
  const [settings] = useSettings()
  const { location, book } = useSnapshot(tab)
  const navPath = tab.getNavPath()
  const context: ReaderMetaContext = {
    tab,
    navPath,
    location,
    percentage: book.percentage,
  }
  const leftSlot =
    settings.readerHeaderLeft ?? defaultReaderMetaSettings.readerHeaderLeft
  const rightSlot =
    settings.readerHeaderRight ?? defaultReaderMetaSettings.readerHeaderRight

  useEffect(() => {
    navPath.forEach((i) => (i.expanded = true))
  }, [navPath])

  return (
    <Bar>
      <BarSlot
        align="left"
        value={getReaderMetaText(leftSlot, context, deviceMeta)}
      />
      <BarSlot
        align="right"
        value={getReaderMetaText(rightSlot, context, deviceMeta)}
      />
    </Bar>
  )
}

interface FooterProps {
  tab: BookTab
  deviceMeta: ReaderDeviceMeta
}
const ReaderPaneFooter: React.FC<FooterProps> = ({ tab, deviceMeta }) => {
  const [settings] = useSettings()
  const { locationToReturn, location, book } = useSnapshot(tab)
  const navPath = tab.getNavPath()
  const context: ReaderMetaContext = {
    tab,
    navPath,
    location,
    percentage: book.percentage,
  }
  const leftSlot =
    settings.readerFooterLeft ?? defaultReaderMetaSettings.readerFooterLeft
  const rightSlot =
    settings.readerFooterRight ?? defaultReaderMetaSettings.readerFooterRight

  return (
    <Bar>
      {locationToReturn ? (
        <>
          <button
            className={clsx(locationToReturn || 'invisible')}
            onClick={() => {
              tab.hidePrevLocation()
              tab.display(locationToReturn.end.cfi, false)
            }}
          >
            Return to {locationToReturn.end.cfi}
          </button>
          <button
            onClick={() => {
              tab.hidePrevLocation()
            }}
          >
            Stay
          </button>
        </>
      ) : (
        <>
          <BarSlot
            align="left"
            value={getReaderMetaText(leftSlot, context, deviceMeta)}
          />
          <BarSlot
            align="right"
            value={getReaderMetaText(rightSlot, context, deviceMeta)}
          />
        </>
      )}
    </Bar>
  )
}

interface LineProps extends ComponentProps<'div'> {}
const Bar: React.FC<LineProps> = ({ className, ...props }) => {
  return (
    <div
      className={clsx(
        'typescale-body-small text-outline flex h-6 items-center gap-2 px-[4vw] sm:px-2',
        className,
      )}
      {...props}
    ></div>
  )
}

interface BarSlotProps {
  align: 'left' | 'right'
  value?: string
}

const BarSlot: React.FC<BarSlotProps> = ({ align, value }) => {
  return (
    <div
      className={clsx(
        'min-w-0 flex-1',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {value && <div className="truncate">{value}</div>}
    </div>
  )
}

interface BatteryManager extends EventTarget {
  charging: boolean
  level: number
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>
}

function useReaderDeviceMeta(): ReaderDeviceMeta {
  const [now, setNow] = useState(() => new Date())
  const [battery, setBattery] = useState<{
    charging: boolean
    level?: number
  }>({ charging: false })
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const getBattery = (navigator as NavigatorWithBattery).getBattery
    if (!getBattery) return

    let manager: BatteryManager | undefined
    let cancelled = false
    const update = () => {
      if (!manager || cancelled) return
      setBattery({ charging: manager.charging, level: manager.level })
    }

    void getBattery
      .call(navigator)
      .then((value) => {
        if (cancelled) return
        manager = value
        update()
        manager.addEventListener('chargingchange', update)
        manager.addEventListener('levelchange', update)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      manager?.removeEventListener('chargingchange', update)
      manager?.removeEventListener('levelchange', update)
    }
  }, [])

  const percentage =
    battery.level === undefined ? undefined : Math.round(battery.level * 100)

  return {
    time: timeFormatter.format(now),
    battery:
      percentage === undefined
        ? undefined
        : `${battery.charging ? '⚡ ' : ''}${percentage}%`,
  }
}
