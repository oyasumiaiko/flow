import { debounce } from '@github/mini-throttle/decorators'
import { IS_SERVER } from '@literal-ui/hooks'
import React from 'react'
import { v4 as uuidv4 } from 'uuid'
import { proxy, ref, snapshot, subscribe, useSnapshot } from 'valtio'

import type { Rendition, Location, Book } from '@flow/epubjs'
import Navigation, { NavItem } from '@flow/epubjs/types/navigation'
import { RenditionSpread } from '@flow/epubjs/types/rendition'
import Section from '@flow/epubjs/types/section'

import { AnnotationColor, AnnotationType } from '../annotation'
import { BookRecord, db } from '../db'
import { fileToEpub } from '../file'
import { ReadingMode } from '../state'
import { defaultStyle } from '../styles'
import { ensureCloudBookFile } from '../sync'

import { dfs, find, INode } from './tree'

function updateIndex(array: any[], deletedItemIndex: number) {
  const last = array.length - 1
  return deletedItemIndex > last ? last : deletedItemIndex
}

export function compareHref(
  sectionHref: string | undefined,
  navitemHref: string | undefined,
) {
  if (sectionHref && navitemHref) {
    const [target] = navitemHref.split('#')

    return (
      sectionHref.endsWith(target!) ||
      // fix for relative nav path `../Text/example.html`
      target?.endsWith(sectionHref)
    )
  }
}

function compareDefinition(d1: string, d2: string) {
  return d1.toLowerCase() === d2.toLowerCase()
}

export interface INavItem extends NavItem, INode {
  subitems?: INavItem[]
}

export interface IMatch extends INode {
  excerpt: string
  description?: string
  cfi?: string
  subitems?: IMatch[]
}

export interface ISection extends Section {
  length: number
  images: string[]
  estimatedLength?: number
  navitem?: INavItem
}

interface TimelineItem {
  location: Location
  timestamp: number
}

class BaseTab {
  constructor(public readonly id: string, public readonly title = id) {}

  get isBook(): boolean {
    return this instanceof BookTab
  }

  get isPage(): boolean {
    return this instanceof PageTab
  }
}

// https://github.com/pmndrs/valtio/blob/92f3311f7f1a9fe2a22096cd30f9174b860488ed/src/vanilla.ts#L6
type AsRef = { $$valtioRef: true }
const globalLocationJobs = new WeakMap<object, Promise<void>>()

export class BookTab extends BaseTab {
  epub?: Book
  iframe?: Window & AsRef
  rendition?: Rendition & { manager?: any }
  nav?: Navigation
  locationToReturn?: Location
  section?: ISection
  sections?: ISection[]
  results?: IMatch[]
  activeResultID?: string
  rendered = false
  readingMode: ReadingMode = 'paginated'
  globalLocationTotal = 0
  globalLocations?: string[]
  private renderGeneration = 0

  get container() {
    return this?.rendition?.manager?.container as HTMLDivElement | undefined
  }

  timeline: TimelineItem[] = []
  get location() {
    return this.timeline[0]?.location
  }

  display(target?: string, returnable = true) {
    this.rendition?.display(target)
    if (returnable) this.showPrevLocation()
  }
  displayFromSelector(selector: string, section: ISection, returnable = true) {
    try {
      const el = section.document.querySelector(selector)
      if (el) this.display(section.cfiFromElement(el), returnable)
    } catch (err) {
      this.display(section.href, returnable)
    }
  }
  prev() {
    this.rendition?.prev()
    // avoid content flash
    if (this.container?.scrollLeft === 0 && !this.location?.atStart) {
      this.rendered = false
    }
  }
  next() {
    this.rendition?.next()
  }

  updateBook(changes: Partial<BookRecord>) {
    changes = {
      ...changes,
      updatedAt: Date.now(),
    }
    // don't wait promise resolve to make valtio batch updates
    this.book = { ...this.book, ...changes }
    db?.books.update(this.book.id, changes)
  }

  annotationRange?: Range
  setAnnotationRange(cfi: string) {
    const range = this.view?.contents.range(cfi)
    if (range) this.annotationRange = ref(range)
  }

  define(def: string[]) {
    this.updateBook({ definitions: [...this.book.definitions, ...def] })
  }
  undefine(def: string) {
    this.updateBook({
      definitions: this.book.definitions.filter(
        (d) => !compareDefinition(d, def),
      ),
    })
  }
  isDefined(def: string) {
    return this.book.definitions.some((d) => compareDefinition(d, def))
  }

  rangeToCfi(range: Range) {
    return this.view.contents.cfiFromRange(range)
  }
  putAnnotation(
    type: AnnotationType,
    cfi: string,
    color: AnnotationColor,
    text: string,
    notes?: string,
  ) {
    const spine = this.section
    if (!spine?.navitem) return

    const i = this.book.annotations.findIndex((a) => a.cfi === cfi)
    let annotation = this.book.annotations[i]

    const now = Date.now()
    if (!annotation) {
      annotation = {
        id: uuidv4(),
        bookId: this.book.id,
        cfi,
        spine: {
          index: spine.index,
          title: spine.navitem.label,
        },
        createAt: now,
        updatedAt: now,
        type,
        color,
        notes,
        text,
      }

      this.updateBook({
        // DataCloneError: Failed to execute 'put' on 'IDBObjectStore': #<Object> could not be cloned.
        annotations: [...snapshot(this.book.annotations), annotation],
      })
    } else {
      annotation = {
        ...this.book.annotations[i]!,
        type,
        updatedAt: now,
        color,
        notes,
        text,
      }
      this.book.annotations.splice(i, 1, annotation)
      this.updateBook({
        annotations: [...snapshot(this.book.annotations)],
      })
    }
  }
  removeAnnotation(cfi: string) {
    return this.updateBook({
      annotations: snapshot(this.book.annotations).filter((a) => a.cfi !== cfi),
    })
  }

  keyword = ''
  setKeyword(keyword: string) {
    if (this.keyword === keyword) return
    this.keyword = keyword
    this.onKeywordChange()
  }

  // only use throttle/debounce for side effects
  @debounce(1000)
  async onKeywordChange() {
    this.results = await this.search()
  }

  get totalLength() {
    return (
      this.sections?.reduce((acc, s) => acc + this.sectionWeight(s), 0) ?? 0
    )
  }

  sectionWeight(section: ISection) {
    return section.estimatedLength || section.length || 1
  }

  ensureGlobalLocations() {
    const epub = this.epub
    if (!epub) return Promise.resolve()

    if (this.globalLocations?.length) {
      if (!epub.locations.length()) epub.locations.load(this.globalLocations)
      this.globalLocationTotal = Math.max(this.globalLocations.length - 1, 0)
      return this.rendition?.reportLocation() ?? Promise.resolve()
    }
    const existingJob = globalLocationJobs.get(this)
    if (existingJob) return existingJob

    const generation = this.renderGeneration
    ;(epub.locations as any).pause = 1
    const job = epub.locations
      .generate(1500)
      .then((locations) => {
        if (generation !== this.renderGeneration || epub !== this.epub) return
        this.globalLocations = ref([...locations])
        this.globalLocationTotal = Math.max(locations.length - 1, 0)
        return this.rendition?.reportLocation()
      })
      .catch((error) => {
        console.error('Failed to build global EPUB locations', error)
      })
      .finally(() => {
        globalLocationJobs.delete(this)
      })
    globalLocationJobs.set(this, job)

    return job
  }

  toggle(id: string) {
    const item = find(this.nav?.toc, id) as INavItem
    if (item) item.expanded = !item.expanded
  }

  toggleResult(id: string) {
    const item = find(this.results, id)
    if (item) item.expanded = !item.expanded
  }

  showPrevLocation() {
    this.locationToReturn = this.location
  }

  hidePrevLocation() {
    this.locationToReturn = undefined
  }

  mapSectionToNavItem(sectionHref: string) {
    let navItem: NavItem | undefined
    this.nav?.toc.forEach((item) =>
      dfs(item as NavItem, (i) => {
        if (compareHref(sectionHref, i.href)) navItem ??= i
      }),
    )
    return navItem
  }

  get currentHref() {
    return this.location?.start.href
  }

  get currentNavItem() {
    return this.section?.navitem
  }

  get view() {
    const manager = this.rendition?.manager
    return (
      manager?.current?.() ??
      manager?.views?.displayed?.().find((view: any) => view.contents)
    )
  }

  getNavPath(navItem = this.currentNavItem) {
    const path: INavItem[] = []

    if (this.nav) {
      while (navItem) {
        path.unshift(navItem)
        const parentId = navItem.parent
        if (!parentId) {
          navItem = undefined
        } else {
          const index = this.nav.tocById[parentId]!
          navItem = this.nav.getByIndex(parentId, index, this.nav.toc)
        }
      }
    }

    return path
  }

  searchInSection(keyword = this.keyword, section = this.section) {
    if (!section) return

    const subitems = section.find(keyword) as unknown as IMatch[]
    if (!subitems.length) return

    const navItem = section.navitem
    if (navItem) {
      const path = this.getNavPath(navItem)
      path.pop()
      return {
        id: navItem.href,
        excerpt: navItem.label,
        description: path.map((i) => i.label).join(' / '),
        subitems: subitems.map((i) => ({ ...i, id: i.cfi! })),
        expanded: true,
      }
    }
  }

  search(keyword = this.keyword) {
    // avoid blocking input
    return new Promise<IMatch[] | undefined>((resolve) => {
      requestIdleCallback(async () => {
        if (!keyword) {
          resolve(undefined)
          return
        }

        const results: IMatch[] = []

        for (const section of this.sections ?? []) {
          const wasLoaded = !!section.document
          try {
            if (!wasLoaded) await section.load(this.epub?.load.bind(this.epub))
            this.indexSection(section)
            const result = this.searchInSection(keyword, section)
            if (result) results.push(result)
          } catch (error) {
            console.error('Failed to search EPUB section', error)
          } finally {
            if (!wasLoaded) section.unload()
          }
        }

        resolve(results)
      })
    })
  }

  private _el?: HTMLDivElement
  onRender?: () => void
  async render(el: HTMLDivElement, readingMode: ReadingMode) {
    if (el === this._el && readingMode === this.readingMode) return
    const generation = ++this.renderGeneration
    const target = this.location?.start.cfi ?? this.book.cfi ?? undefined

    if (this.epub) {
      this.epub.destroy()
      this.epub = undefined
      this.rendition = undefined
      this.iframe = undefined
      this.rendered = false
      el.replaceChildren()
    }

    this._el = ref(el)
    this.readingMode = readingMode

    const file = await ensureCloudBookFile(this.book)
    const epub = await fileToEpub(file)
    if (generation !== this.renderGeneration) {
      epub.destroy()
      return
    }
    this.epub = ref(epub)

    this.epub.loaded.navigation.then((nav) => {
      this.nav = nav
    })
    console.log(this.epub)
    this.epub.loaded.spine.then((spine: any) => {
      const sections = spine.spineItems as ISection[]
      sections.forEach((section) => {
        section.length = 0
        section.images = []
        section.estimatedLength = this.epub?.archive?.getSize(section.url) ?? 0
        this.epub!.loaded.navigation.then(() => {
          section.navitem = this.mapSectionToNavItem(section.href)
        })
      })
      this.sections = ref(sections)
    })
    if (this.globalLocations?.length) {
      this.epub.locations.load(this.globalLocations)
      this.globalLocationTotal = Math.max(this.globalLocations.length - 1, 0)
    }
    this.rendition = ref(
      this.epub.renderTo(el, {
        width: '100%',
        height: '100%',
        // Scrolled reading deliberately renders one spine section at a time.
        // EPUB storage boundaries therefore never become placeholders inside a
        // single document, and very long books keep constant rendering cost.
        manager: 'default',
        flow: readingMode === 'scrolled' ? 'scrolled' : 'paginated',
        spread: readingMode === 'scrolled' ? RenditionSpread.None : undefined,
        allowScriptedContent: true,
      }),
    )
    console.log(this.rendition)
    this.rendition.display(target)
    this.rendition.themes.default(defaultStyle)
    this.rendition.hooks.render.register((view: any) => {
      console.log('hooks.render', view)
      this.onRender?.()
    })

    this.rendition.on('relocated', (loc: Location) => {
      console.log('relocated', loc)
      this.rendered = true
      this.timeline.unshift({
        location: loc,
        timestamp: Date.now(),
      })

      const start = loc.start
      const currentSection =
        this.sections?.find((section) =>
          compareHref(section.href, start.href),
        ) ?? (this.epub as any)?.spine?.get(start.href)
      if (currentSection) this.section = ref(currentSection)

      // calculate percentage
      if (this.sections) {
        const i = this.sections.findIndex((s) => s.href === start.href)
        if (i < 0) return
        const previousSectionsLength = this.sections
          .slice(0, i)
          .reduce((acc, s) => acc + this.sectionWeight(s), 0)
        const previousSectionsPercentage =
          previousSectionsLength / this.totalLength
        const currentSectionPercentage =
          this.sectionWeight(this.sections[i]!) / this.totalLength
        const displayedPercentage = start.displayed.page / start.displayed.total

        const percentage =
          previousSectionsPercentage +
          currentSectionPercentage * displayedPercentage

        this.updateBook({ cfi: start.cfi, percentage })
      }
    })

    this.rendition.on('attached', (...args: any[]) => {
      console.log('attached', args)
    })
    this.rendition.on('started', (...args: any[]) => {
      console.log('started', args)
    })
    this.rendition.on('displayed', (...args: any[]) => {
      console.log('displayed', args)
    })
    this.rendition.on('rendered', (section: ISection, view: any) => {
      console.log('rendered', [section, view])
      this.indexSection(section)
      if (!this.currentHref || compareHref(section.href, this.currentHref)) {
        this.section = ref(section)
      }
      this.iframe = ref(view.window as Window) as unknown as Window & AsRef
    })
    this.rendition.on('selected', (...args: any[]) => {
      console.log('selected', args)
    })
    this.rendition.on('removed', (...args: any[]) => {
      console.log('removed', args)
    })
  }

  private indexSection(section: ISection) {
    const doc = section.document
    if (!doc) return
    section.length = doc.body?.textContent?.length ?? 0
    section.images = [...doc.querySelectorAll('img')].map(
      (element) => element.src,
    )
    section.estimatedLength ||= doc.documentElement?.outerHTML.length ?? 0
    section.navitem ||= this.mapSectionToNavItem(section.href)
  }

  constructor(public book: BookRecord) {
    super(book.id, book.name)

    // don't subscribe `db.books` in `constructor`, it will
    // 1. update the unproxied instance, which is not reactive
    // 2. update unnecessary state (e.g. percentage) of all tabs with the same book
  }
}

class PageTab extends BaseTab {
  constructor(public readonly Component: React.FC<any>) {
    super(Component.displayName ?? 'untitled')
  }
}

type Tab = BookTab | PageTab
type TabParam = ConstructorParameters<typeof BookTab | typeof PageTab>[0]

export class Group {
  id = uuidv4()
  tabs: Tab[] = []

  constructor(
    tabs: Array<Tab | TabParam> = [],
    public selectedIndex = tabs.length - 1,
  ) {
    this.tabs = tabs.map((t) => {
      if (t instanceof BookTab || t instanceof PageTab) return t
      const isPage = typeof t === 'function'
      return isPage ? new PageTab(t) : new BookTab(t)
    })
  }

  get selectedTab() {
    return this.tabs[this.selectedIndex]
  }

  get bookTabs() {
    return this.tabs.filter((t) => t instanceof BookTab) as BookTab[]
  }

  removeTab(index: number) {
    const tab = this.tabs.splice(index, 1)
    this.selectedIndex = updateIndex(this.tabs, index)
    return tab[0]
  }

  addTab(param: TabParam | Tab) {
    const isTab = param instanceof BookTab || param instanceof PageTab
    const isPage = typeof param === 'function'

    const id = isTab ? param.id : isPage ? param.displayName : param.id

    const index = this.tabs.findIndex((t) => t.id === id)
    if (index > -1) {
      this.selectTab(index)
      return this.tabs[index]
    }

    const tab = isTab ? param : isPage ? new PageTab(param) : new BookTab(param)

    this.tabs.splice(++this.selectedIndex, 0, tab)
    return tab
  }

  replaceTab(param: TabParam, index = this.selectedIndex) {
    this.addTab(param)
    this.removeTab(index)
  }

  selectTab(index: number) {
    this.selectedIndex = index
  }
}

export class Reader {
  groups: Group[] = []
  focusedIndex = -1

  get focusedGroup() {
    return this.groups[this.focusedIndex]
  }

  get focusedTab() {
    return this.focusedGroup?.selectedTab
  }

  get focusedBookTab() {
    return this.focusedTab instanceof BookTab ? this.focusedTab : undefined
  }

  addTab(param: TabParam | Tab, groupIdx = this.focusedIndex) {
    let group = this.groups[groupIdx]
    if (group) {
      this.focusedIndex = groupIdx
    } else {
      group = this.addGroup([])
    }
    return group.addTab(param)
  }

  removeTab(index: number, groupIdx = this.focusedIndex) {
    const group = this.groups[groupIdx]
    if (group?.tabs.length === 1) {
      this.removeGroup(groupIdx)
      return group.tabs[0]
    }
    return group?.removeTab(index)
  }

  replaceTab(
    param: TabParam,
    index = this.focusedIndex,
    groupIdx = this.focusedIndex,
  ) {
    const group = this.groups[groupIdx]
    group?.replaceTab(param, index)
  }

  removeGroup(index: number) {
    this.groups.splice(index, 1)
    this.focusedIndex = updateIndex(this.groups, index)
  }

  addGroup(tabs: Array<Tab | TabParam>, index = this.focusedIndex + 1) {
    const group = proxy(new Group(tabs))
    this.groups.splice(index, 0, group)
    this.focusedIndex = index
    return group
  }

  selectGroup(index: number) {
    this.focusedIndex = index
  }

  clear() {
    this.groups = []
    this.focusedIndex = -1
  }

  resize() {
    this.groups.forEach(({ bookTabs }) => {
      bookTabs.forEach(({ rendition }) => {
        try {
          rendition?.resize()
        } catch (error) {
          console.error(error)
        }
      })
    })
  }
}

export const reader = proxy(new Reader())

subscribe(reader, () => {
  console.log(snapshot(reader))
})

export function useReaderSnapshot(): Reader {
  // 对外只暴露只读使用约定，但避免把含 Window/Range 的完整 Valtio 深层快照类型
  // 扩散到每个组件并触发 TypeScript 的无限递归实例化。
  return useSnapshot(reader) as unknown as Reader
}

declare global {
  interface Window {
    reader: Reader
  }
}

if (!IS_SERVER) {
  window.reader = reader
}
