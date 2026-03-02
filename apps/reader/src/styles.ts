import { CSSProperties } from 'react'

import { Contents } from '@flow/epubjs'

import { Settings } from './state'
import { keys } from './utils'

export const activeClass = 'bg-primary70'
export const defaultStyle = {
  html: {
    padding: '0 !important',
  },
  body: {
    background: 'transparent',
  },
  'a:any-link': {
    color: '#3b82f6 !important',
    'text-decoration': 'none !important',
  },
  '::selection': {
    'background-color': 'rgba(3, 102, 214, 0.2)',
  },
}

const camelToSnake = (str: string) =>
  str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

function mapToCss(o: CSSProperties) {
  return keys(o)
    .filter((k) => o[k] !== undefined)
    .map((k) => `${camelToSnake(k)}: ${o[k]} !important;`)
    .join('\n')
}

enum Style {
  Custom = 'custom',
}

export function updateCustomStyle(
  contents: Contents | undefined,
  settings: Settings | undefined,
  isDoublePage = false,
) {
  if (!contents || !settings) return

  const { zoom, spreadPageInnerMargin } = settings
  const other: CSSProperties = {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    fontWeight: settings.fontWeight,
    lineHeight: settings.lineHeight,
  }
  const body = contents.content as HTMLBodyElement
  const parseLength = (value: string | undefined) => {
    const parsed = Number.parseFloat(value ?? '')
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const readBodyLength = (property: keyof CSSStyleDeclaration) =>
    parseLength(body.style[property] as string)
  const requestedInnerMargin = isDoublePage
    ? Math.max(0, spreadPageInnerMargin ?? 0)
    : 0
  const baseColumnWidth = readBodyLength('columnWidth')
  // 保证双页稳定：扩大内侧边距时同步收窄列宽，避免浏览器因列不再可容纳而退化成单列。
  const effectiveInnerMargin =
    requestedInnerMargin > 0 && baseColumnWidth !== undefined
      ? Math.min(requestedInnerMargin, Math.max(baseColumnWidth - 1, 0))
      : requestedInnerMargin
  const baseColumnGap = readBodyLength('columnGap')
  const columnWidth =
    effectiveInnerMargin > 0 && baseColumnWidth !== undefined
      ? baseColumnWidth - effectiveInnerMargin
      : undefined
  const columnGap =
    effectiveInnerMargin > 0 && baseColumnGap !== undefined
      ? baseColumnGap + effectiveInnerMargin * 2
      : undefined
  let css = `a, article, cite, div, li, p, pre, span, table, body {
    ${mapToCss(other)}
  }`

  if (columnGap !== undefined || columnWidth !== undefined) {
    css += `body {
      ${mapToCss({
        columnWidth: columnWidth ? `${columnWidth}px` : undefined,
        columnGap: columnGap ? `${columnGap}px` : undefined,
      })}
    }`
  }

  if (zoom) {
    const scale = (value?: number) =>
      value === undefined ? undefined : `${value / zoom}px`
    css += `body {
      ${mapToCss({
        transformOrigin: 'top left',
        transform: `scale(${zoom})`,
        width: scale(readBodyLength('width')),
        height: scale(readBodyLength('height')),
        columnWidth: scale(columnWidth ?? readBodyLength('columnWidth')),
        columnGap: scale(columnGap ?? readBodyLength('columnGap')),
        paddingTop: scale(readBodyLength('paddingTop')),
        paddingBottom: scale(readBodyLength('paddingBottom')),
        paddingLeft: scale(readBodyLength('paddingLeft')),
        paddingRight: scale(readBodyLength('paddingRight')),
      })}
    }`
  }

  return contents.addStylesheetCss(css, Style.Custom)
}

export function lock(l: number, r: number, unit = 'px') {
  const minw = 400
  const maxw = 2560

  return `calc(${l}${unit} + ${r - l} * (100vw - ${minw}px) / ${maxw - minw})`
}
