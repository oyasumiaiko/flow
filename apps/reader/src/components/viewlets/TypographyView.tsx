import clsx from 'clsx'
import { useCallback, useMemo, useRef, useState } from 'react'
import { MdAdd, MdRemove } from 'react-icons/md'

import { RenditionSpread } from '@flow/epubjs/types/rendition'
import { useTranslation } from '@flow/reader/hooks'
import { reader, useReaderSnapshot } from '@flow/reader/models'
import {
  defaultSettings,
  TypographyConfiguration,
  useSettings,
} from '@flow/reader/state'
import { keys } from '@flow/reader/utils'

import { Checkbox, Label, Select, TextField, TextFieldProps } from '../Form'
import { PaneViewProps, PaneView, Pane } from '../base'

// Define an interface for the Font object

enum TypographyScope {
  Book,
  Global,
}

export const TypographyView: React.FC<PaneViewProps> = (props) => {
  const { focusedBookTab } = useReaderSnapshot()
  const [settings, setSettings] = useSettings()
  const [scope, setScope] = useState(TypographyScope.Book)
  const t = useTranslation('typography')

  const [localFonts, setLocalFonts] = useState<string[]>()

  const {
    fontFamily,
    fontSizeOffset,
    fontWeightOffset,
    lineHeight,
    zoom,
    spread,
    spreadMaxWidth,
    spreadPageInnerMargin,
    spreadPageOuterMargin,
    spreadRespectAspectRatio,
  } =
    scope === TypographyScope.Book
      ? focusedBookTab?.book.configuration?.typography ?? defaultSettings
      : settings

  const setTypography = useCallback(
    <K extends keyof TypographyConfiguration>(
      k: K,
      v: TypographyConfiguration[K],
    ) => {
      if (scope === TypographyScope.Book) {
        reader.focusedBookTab?.updateBook({
          configuration: {
            ...reader.focusedBookTab.book.configuration,
            typography: {
              ...reader.focusedBookTab.book.configuration?.typography,
              [k]: v,
            },
          },
        })
      } else {
        setSettings((prev) => ({
          ...prev,
          [k]: v,
        }))
      }
    },
    [scope, setSettings],
  )

  const queryLocalFonts = useCallback(async () => {
    if (localFonts) return
    if (!('queryLocalFonts' in window)) {
      console.error('queryLocalFonts is not available')
      return
    }

    try {
      const fonts = await window.queryLocalFonts()
      const uniqueFonts = Array.from(new Set(fonts.map((f) => f.family)))
      setLocalFonts(uniqueFonts)
    } catch (error) {
      console.error('Error querying local fonts:', error)
    }
  }, [localFonts])

  const fontOptions = useMemo(() => {
    const options = localFonts ? [...localFonts] : []
    // 某些字体可能来自历史配置而不是本机字体列表，这里补回当前值，避免切换时丢失当前选项。
    if (fontFamily && !options.includes(fontFamily)) {
      options.unshift(fontFamily)
    }
    return options
  }, [fontFamily, localFonts])

  const cycleFontByWheel = useCallback(
    (deltaY: number) => {
      if (!fontOptions.length) return
      const values = ['', ...fontOptions]
      const currentValue = fontFamily ?? ''
      const currentIndex = Math.max(values.indexOf(currentValue), 0)
      const nextIndex = Math.min(
        Math.max(currentIndex + (deltaY > 0 ? 1 : -1), 0),
        values.length - 1,
      )
      const nextValue = values[nextIndex]
      if (nextValue === currentValue) return
      setTypography('fontFamily', nextValue || undefined)
    },
    [fontFamily, fontOptions, setTypography],
  )

  return (
    <PaneView {...props}>
      <div className="typescale-body-medium flex gap-2 px-5 pb-2 !text-[13px]">
        {keys(TypographyScope)
          .filter((k) => isNaN(Number(k)))
          .map((scopeName) => (
            <button
              key={scopeName}
              className={clsx(
                TypographyScope[scopeName] === scope
                  ? 'text-on-surface-variant'
                  : 'text-outline/60',
              )}
              onClick={() => setScope(TypographyScope[scopeName])}
            >
              {t(`scope.${scopeName.toLowerCase()}`)}
            </button>
          ))}
      </div>
      <Pane
        headline={t('title')}
        className="space-y-3 px-5 pt-2 pb-4"
        key={`${scope}${focusedBookTab?.id}`}
      >
        <Select
          name={t('page_view')}
          value={spread ?? RenditionSpread.Auto}
          onChange={(e) => {
            setTypography('spread', e.target.value as RenditionSpread)
          }}
        >
          <option value={RenditionSpread.None}>
            {t('page_view.single_page')}
          </option>
          <option value={RenditionSpread.Auto}>
            {t('page_view.double_page')}
          </option>
        </Select>
        <NumberField
          name={t('double_page.max_width')}
          min={600}
          step={20}
          defaultValue={spreadMaxWidth}
          onChange={(v) => {
            setTypography('spreadMaxWidth', v || undefined)
          }}
        />
        <Checkbox
          name={t('double_page.respect_aspect_ratio')}
          checked={!!spreadRespectAspectRatio}
          onChange={(e) => {
            setTypography('spreadRespectAspectRatio', e.target.checked)
          }}
        />
        <NumberField
          name={t('double_page.page_inner_margin')}
          min={0}
          step={1}
          defaultValue={spreadPageInnerMargin}
          onChange={(v) => {
            setTypography('spreadPageInnerMargin', v || undefined)
          }}
        />
        <NumberField
          name={t('double_page.page_outer_margin')}
          min={0}
          step={1}
          defaultValue={spreadPageOuterMargin}
          onChange={(v) => {
            setTypography('spreadPageOuterMargin', v || undefined)
          }}
        />
        <Checkbox
          name={t('auto_hide_cursor')}
          checked={!!settings.autoHideCursorInReading}
          onChange={(e) => {
            setSettings((prev) => ({
              ...prev,
              autoHideCursorInReading: e.target.checked,
            }))
          }}
        />
        <Select
          name={t('font_family')}
          value={fontFamily ?? ''}
          onFocus={queryLocalFonts}
          onMouseEnter={queryLocalFonts}
          // 在下拉框聚焦时支持滚轮逐项切换，减少“点开-选择-关闭”的重复操作。
          onWheel={(e) => {
            e.preventDefault()
            cycleFontByWheel(e.deltaY)
          }}
          onChange={(e) => {
            const nextValue = e.target.value || undefined
            setTypography('fontFamily', nextValue)
          }}
        >
          <option value="">default</option>
          {fontOptions.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </Select>
        <OffsetSliderField
          name={t('font_size')}
          value={fontSizeOffset}
          min={-12}
          max={12}
          step={0.25}
          unit="px"
          onChange={(v) => {
            setTypography('fontSizeOffset', v)
          }}
        />
        <OffsetSliderField
          name={t('font_weight')}
          value={fontWeightOffset}
          min={-500}
          max={500}
          step={100}
          unit=""
          onChange={(v) => {
            setTypography('fontWeightOffset', v)
          }}
        />
        <NumberField
          name={t('line_height')}
          min={1}
          step={0.1}
          defaultValue={lineHeight}
          onChange={(v) => {
            setTypography('lineHeight', v || undefined)
          }}
        />
        <NumberField
          name={t('zoom')}
          min={1}
          step={0.1}
          defaultValue={zoom}
          onChange={(v) => {
            setTypography('zoom', v || undefined)
          }}
        />
      </Pane>
    </PaneView>
  )
}

interface OffsetSliderFieldProps {
  name: string
  value?: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v?: number) => void
}

const OffsetSliderField: React.FC<OffsetSliderFieldProps> = ({
  name,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}) => {
  const t = useTranslation('action')
  const rawValue = value ?? 0
  const sliderValue = Math.min(Math.max(rawValue, min), max)
  const stepDecimals = useMemo(() => {
    const stepText = String(step)
    if (stepText.includes('e-')) {
      const exponent = Number(stepText.split('e-')[1])
      return Number.isFinite(exponent) ? exponent : 0
    }
    const decimals = stepText.split('.')[1]
    return decimals ? decimals.length : 0
  }, [step])

  const updateValue = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return
      // 统一按 step 精度归一化，避免 0.1/0.25 连续加减出现浮点尾差。
      const normalized = Number.parseFloat(next.toFixed(stepDecimals))
      onChange(normalized === 0 ? undefined : normalized)
    },
    [onChange, stepDecimals],
  )

  const displayValue = Number.parseFloat(rawValue.toFixed(stepDecimals))
  const offsetText = `${displayValue > 0 ? '+' : ''}${displayValue}${unit}`

  return (
    <div className="flex flex-col">
      <Label name={name} />
      <div className="bg-default flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          className="text-outline hover:text-on-surface-variant flex items-center"
          title={t('step_down')}
          onClick={() => {
            // 滑块只负责快速拖动，真正值不封顶；两侧箭头可继续向外扩展偏移。
            updateValue(rawValue - step)
          }}
        >
          <MdRemove size={16} />
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          className="accent-primary h-2 flex-1 cursor-pointer"
          onChange={(e) => {
            updateValue(Number(e.target.value))
          }}
        />
        <button
          type="button"
          className="text-outline hover:text-on-surface-variant flex items-center"
          title={t('step_up')}
          onClick={() => {
            updateValue(rawValue + step)
          }}
        >
          <MdAdd size={16} />
        </button>
        <button
          type="button"
          className="text-outline/70 hover:text-on-surface-variant border-outline/20 rounded border px-1 leading-5"
          title={t('clear')}
          onClick={() => {
            onChange(undefined)
          }}
        >
          0
        </button>
      </div>
      <div className="typescale-label-small text-outline/70 mt-1 !text-[11px]">
        {offsetText}
      </div>
    </div>
  )
}

interface NumberFieldProps extends Omit<TextFieldProps<'input'>, 'onChange'> {
  onChange: (v?: number) => void
}
const NumberField: React.FC<NumberFieldProps> = ({ onChange, ...props }) => {
  const ref = useRef<HTMLInputElement>(null)
  const t = useTranslation('action')

  return (
    <TextField
      as="input"
      type="number"
      placeholder="default"
      actions={[
        {
          title: t('step_down'),
          Icon: MdRemove,
          onClick: () => {
            if (!ref.current) return
            ref.current.stepDown()
            onChange(Number(ref.current.value))
          },
        },
        {
          title: t('step_up'),
          Icon: MdAdd,
          onClick: () => {
            if (!ref.current) return
            ref.current.stepUp()
            onChange(Number(ref.current.value))
          },
        },
      ]}
      mRef={ref}
      // lazy render
      onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
        onChange(Number(e.target.value))
      }}
      onClear={() => {
        if (ref.current) ref.current.value = ''
        onChange(undefined)
      }}
      {...props}
    />
  )
}
