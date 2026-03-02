import { useEventListener } from '@literal-ui/hooks'
import Dexie from 'dexie'
import { useRouter } from 'next/router'
import { parseCookies, destroyCookie } from 'nookies'

import {
  ColorScheme,
  useColorScheme,
  useForceRender,
  useTranslation,
} from '@flow/reader/hooks'
import {
  defaultReaderMetaSettings,
  ReaderMetaSlot,
  Settings as ReaderSettings,
  useSettings,
} from '@flow/reader/state'
import { dbx, mapToToken, OAUTH_SUCCESS_MESSAGE } from '@flow/reader/sync'

import { Button } from '../Button'
import { Select } from '../Form'
import { Page } from '../Page'

export const Settings: React.FC = () => {
  const { scheme, setScheme } = useColorScheme()
  const [settings, setSettings] = useSettings()
  const { asPath, push, locale } = useRouter()
  const t = useTranslation('settings')

  return (
    <Page headline={t('title')}>
      <div className="space-y-6">
        <Item title={t('language')}>
          <Select
            value={locale}
            onChange={(e) => {
              push(asPath, undefined, { locale: e.target.value })
            }}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">简体中文</option>
            <option value="ja-JP">日本語</option>
          </Select>
        </Item>
        <Item title={t('color_scheme')}>
          <Select
            value={scheme}
            onChange={(e) => {
              setScheme(e.target.value as ColorScheme)
            }}
          >
            <option value="system">{t('color_scheme.system')}</option>
            <option value="light">{t('color_scheme.light')}</option>
            <option value="dark">{t('color_scheme.dark')}</option>
          </Select>
        </Item>
        <ReaderMetaConfig settings={settings} setSettings={setSettings} />
        <Synchronization />
        <Item title={t('cache')}>
          <Button
            variant="secondary"
            onClick={() => {
              window.localStorage.clear()
              Dexie.getDatabaseNames().then((names) => {
                names.forEach((n) => Dexie.delete(n))
              })
            }}
          >
            {t('cache.clear')}
          </Button>
        </Item>
      </div>
    </Page>
  )
}

const readerMetaOptions: ReaderMetaSlot[] = [
  'none',
  'bookTitle',
  'chapterPath',
  'pageNumber',
  'href',
  'progress',
]

interface ReaderMetaConfigProps {
  settings: ReaderSettings
  setSettings: (updater: (prev: ReaderSettings) => ReaderSettings) => void
}

const ReaderMetaConfig: React.FC<ReaderMetaConfigProps> = ({
  settings,
  setSettings,
}) => {
  const t = useTranslation('settings.reader_meta')

  const updateSlot = (
    key:
      | 'readerHeaderLeft'
      | 'readerHeaderRight'
      | 'readerFooterLeft'
      | 'readerFooterRight',
    value: ReaderMetaSlot,
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  return (
    <Item title={t('title')}>
      <div className="space-y-3">
        <Select
          name={t('header_left')}
          value={
            settings.readerHeaderLeft ??
            defaultReaderMetaSettings.readerHeaderLeft
          }
          onChange={(e) => {
            updateSlot('readerHeaderLeft', e.target.value as ReaderMetaSlot)
          }}
        >
          {readerMetaOptions.map((value) => (
            <option key={value} value={value}>
              {t(`option.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          name={t('header_right')}
          value={
            settings.readerHeaderRight ??
            defaultReaderMetaSettings.readerHeaderRight
          }
          onChange={(e) => {
            updateSlot('readerHeaderRight', e.target.value as ReaderMetaSlot)
          }}
        >
          {readerMetaOptions.map((value) => (
            <option key={value} value={value}>
              {t(`option.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          name={t('footer_left')}
          value={
            settings.readerFooterLeft ??
            defaultReaderMetaSettings.readerFooterLeft
          }
          onChange={(e) => {
            updateSlot('readerFooterLeft', e.target.value as ReaderMetaSlot)
          }}
        >
          {readerMetaOptions.map((value) => (
            <option key={value} value={value}>
              {t(`option.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          name={t('footer_right')}
          value={
            settings.readerFooterRight ??
            defaultReaderMetaSettings.readerFooterRight
          }
          onChange={(e) => {
            updateSlot('readerFooterRight', e.target.value as ReaderMetaSlot)
          }}
        >
          {readerMetaOptions.map((value) => (
            <option key={value} value={value}>
              {t(`option.${value}`)}
            </option>
          ))}
        </Select>
      </div>
    </Item>
  )
}

const Synchronization: React.FC = () => {
  const cookies = parseCookies()
  const refreshToken = cookies[mapToToken['dropbox']]
  const render = useForceRender()
  const t = useTranslation('settings.synchronization')

  useEventListener('message', (e) => {
    if (e.data === OAUTH_SUCCESS_MESSAGE) {
      // init app (generate access token, fetch remote data, etc.)
      window.location.reload()
    }
  })

  return (
    <Item title={t('title')}>
      <Select>
        <option value="dropbox">Dropbox</option>
      </Select>
      <div className="mt-2">
        {refreshToken ? (
          <Button
            variant="secondary"
            onClick={() => {
              destroyCookie(null, mapToToken['dropbox'])
              render()
            }}
          >
            {t('unauthorize')}
          </Button>
        ) : (
          <Button
            onClick={() => {
              const redirectUri =
                window.location.origin + '/api/callback/dropbox'

              dbx.auth
                .getAuthenticationUrl(
                  redirectUri,
                  JSON.stringify({ redirectUri }),
                  'code',
                  'offline',
                )
                .then((url) => {
                  window.open(url as string, '_blank')
                })
            }}
          >
            {t('authorize')}
          </Button>
        )}
      </div>
    </Item>
  )
}

interface PartProps {
  title: string
}
const Item: React.FC<PartProps> = ({ title, children }) => {
  return (
    <div>
      <h3 className="typescale-title-small text-on-surface-variant">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  )
}

Settings.displayName = 'settings'
