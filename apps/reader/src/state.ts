import { atom, useAtom } from 'jotai'

import { RenditionSpread } from '@flow/epubjs/types/rendition'

export const navbarState = atom<boolean>(false)

export type ReaderMetaSlot =
  | 'none'
  | 'bookTitle'
  | 'chapterPath'
  | 'pageNumber'
  | 'globalPage'
  | 'href'
  | 'progress'
  | 'time'
  | 'battery'

type ReaderMetaSettings = {
  readerHeaderLeft?: ReaderMetaSlot
  readerHeaderRight?: ReaderMetaSlot
  readerFooterLeft?: ReaderMetaSlot
  readerFooterRight?: ReaderMetaSlot
}

export const defaultReaderMetaSettings: Required<ReaderMetaSettings> = {
  readerHeaderLeft: 'chapterPath',
  readerHeaderRight: 'pageNumber',
  readerFooterLeft: 'href',
  readerFooterRight: 'progress',
}

export type ColorScheme = 'light' | 'dark' | 'system'
export type ReadingMode = 'paginated' | 'scrolled'

export interface Settings extends TypographyConfiguration, ReaderMetaSettings {
  theme?: ThemeConfiguration
  colorScheme?: ColorScheme
  locale?: 'en-US' | 'zh-CN' | 'ja-JP'
  autoHideCursorInReading?: boolean
  enableTextSelectionMenu?: boolean
}

export interface TypographyConfiguration {
  readingMode?: ReadingMode
  fontSizeOffset?: number
  fontWeightOffset?: number
  fontFamily?: string
  lineHeight?: number
  spread?: RenditionSpread
  spreadMaxWidth?: number
  spreadPageInnerMargin?: number
  spreadPageOuterMargin?: number
  spreadRespectAspectRatio?: boolean
  zoom?: number
}

interface ThemeConfiguration {
  source?: string
  background?: number
}

export const defaultSettings: Settings = {
  ...defaultReaderMetaSettings,
  colorScheme: 'system',
  locale: 'en-US',
}

const settingsState = atom<Settings>(defaultSettings)

/** 全局偏好只在内存中供 UI 使用，权威值由 CloudSettingsGate 与 Sites D1 同步。 */
export function useSettings() {
  return useAtom(settingsState)
}
