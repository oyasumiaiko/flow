import { useRouter } from 'next/router'
import { useState, useSyncExternalStore } from 'react'

import { db } from '@flow/reader/db'
import {
  ColorScheme,
  useColorScheme,
  useCloudStatus,
  useTranslation,
} from '@flow/reader/hooks'
import {
  getPwaInstallState,
  promptPwaInstall,
  subscribePwaInstall,
} from '@flow/reader/pwa'
import {
  enterImmersiveMode,
  exitImmersiveMode,
  getImmersiveModeServerSnapshot,
  getImmersiveModeSnapshot,
  isRuntimeFullscreenSupported,
  subscribeImmersiveMode,
} from '@flow/reader/fullscreen'
import {
  defaultReaderMetaSettings,
  ReaderMetaSlot,
  Settings as ReaderSettings,
  useSettings,
} from '@flow/reader/state'
import { retryPendingCloudUpdates } from '@flow/reader/sync'

import { Button } from '../Button'
import { Checkbox, Select } from '../Form'
import { Page } from '../Page'

export const Settings: React.FC = () => {
  const { scheme, setScheme } = useColorScheme()
  const [settings, setSettings] = useSettings()
  const { asPath, push } = useRouter()
  const t = useTranslation('settings')

  return (
    <Page headline={t('title')}>
      <div className="space-y-6">
        <Item title={t('language')}>
          <Select
            value={settings.locale ?? 'en-US'}
            onChange={(e) => {
              const locale = e.target.value as ReaderSettings['locale']
              setSettings((previous) => ({ ...previous, locale }))
              push(asPath, undefined, { locale })
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
        <StatusBarMode />
        <ReaderMetaConfig settings={settings} setSettings={setSettings} />
        <Item title={t('text_selection_menu')}>
          <Checkbox
            name={t('text_selection_menu.enable')}
            checked={settings.enableTextSelectionMenu}
            onChange={(e) => {
              setSettings({
                ...settings,
                enableTextSelectionMenu: e.target.checked,
              })
            }}
          />
        </Item>
        <Synchronization />
        <InstallApp />
        <Item title={t('cache')}>
          <Button
            variant="secondary"
            onClick={async () => {
              await Promise.all([db?.files.clear(), db?.covers.clear()])
              window.location.reload()
            }}
          >
            {t('cache.clear')}
          </Button>
        </Item>
      </div>
    </Page>
  )
}

const StatusBarMode: React.FC = () => {
  const t = useTranslation('settings.status_bar')
  const immersive = useSyncExternalStore(
    subscribeImmersiveMode,
    getImmersiveModeSnapshot,
    getImmersiveModeServerSnapshot,
  )
  const [message, setMessage] = useState<string>()

  const useSystemBar = async () => {
    setMessage(undefined)
    if (!(await exitImmersiveMode())) setMessage(t('manifest_fullscreen'))
  }

  const useWebBar = async () => {
    setMessage(undefined)
    try {
      if (!(await enterImmersiveMode())) setMessage(t('unsupported'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('unsupported'))
    }
  }

  return (
    <Item title={t('title')}>
      <p className="text-on-surface-variant">{t('description')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant={immersive ? 'secondary' : 'primary'}
          onClick={() => void useSystemBar()}
        >
          {t('system')}
        </Button>
        <Button
          variant={immersive ? 'primary' : 'secondary'}
          disabled={!isRuntimeFullscreenSupported() && !immersive}
          onClick={() => void useWebBar()}
        >
          {t('immersive')}
        </Button>
      </div>
      {message && <p className="text-error mt-2">{message}</p>}
    </Item>
  )
}

const InstallApp: React.FC = () => {
  const t = useTranslation('settings.install')
  const state = useSyncExternalStore(
    subscribePwaInstall,
    getPwaInstallState,
    () => 'unavailable',
  )

  return (
    <Item title={t('title')}>
      <p className="text-on-surface-variant">{t('description')}</p>
      {state === 'available' && (
        <Button className="mt-2" onClick={() => void promptPwaInstall()}>
          {t('action')}
        </Button>
      )}
      {state === 'installed' && <p className="mt-2">{t('installed')}</p>}
      {state === 'unavailable' && (
        <p className="text-on-surface-variant mt-2">{t('browser_menu')}</p>
      )}
    </Item>
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
  const t = useTranslation('settings.synchronization')
  const status = useCloudStatus()

  return (
    <Item title={t('title')}>
      <p className="text-on-surface-variant">{t('sites_description')}</p>
      <p className="mt-2 break-words">
        {t(`status.${status.state}`)}
        {status.message ? `：${status.message}` : ''}
      </p>
      {status.state === 'error' && (
        <Button className="mt-2" onClick={retryPendingCloudUpdates}>
          {t('retry')}
        </Button>
      )}
    </Item>
  )
}

interface PartProps {
  title: string
  children?: React.ReactNode
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
