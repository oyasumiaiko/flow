import { useRouter } from 'next/router'
import { useCallback, useEffect, useRef, useState } from 'react'

import { defaultSettings, Settings, useSettings } from '../state'
import {
  CloudRequestError,
  fetchCloudSettings,
  markCloudIdle,
  markCloudSyncing,
  reportCloudError,
  saveCloudSettings,
} from '../sync'

import { Button } from './Button'

interface CloudSettingsGateProps {
  children: React.ReactNode
}

/**
 * 在 Flow UI 启动前读取当前 ChatGPT 用户的 D1 偏好。读取失败时显示明确错误并阻止
 * 使用默认值继续运行，避免形成不易察觉的本地偏好分支。
 */
export function CloudSettingsGate({ children }: CloudSettingsGateProps) {
  const [settings, setSettings] = useSettings()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [retryGeneration, setRetryGeneration] = useState(0)
  const versionRef = useRef(0)
  const lastSavedRef = useRef('')

  const load = useCallback(async () => {
    setLoadError(undefined)
    markCloudSyncing()
    try {
      const remote = await fetchCloudSettings<Settings>()
      const routedLocale = isSupportedLocale(router.locale)
        ? router.locale
        : defaultSettings.locale
      const merged: Settings = {
        ...defaultSettings,
        locale: routedLocale,
        ...remote.settings,
      }
      versionRef.current = remote.version
      lastSavedRef.current = JSON.stringify(merged)
      setSettings(merged)
      if (merged.locale && merged.locale !== router.locale) {
        await router.replace(router.asPath, undefined, {
          locale: merged.locale,
        })
      }
      setReady(true)
      markCloudIdle()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      reportCloudError(error)
    }
  }, [router, setSettings])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const retry = () => setRetryGeneration((value) => value + 1)
    window.addEventListener('flow:retry-settings', retry)
    return () => window.removeEventListener('flow:retry-settings', retry)
  }, [])

  useEffect(() => {
    if (!ready) return
    const serialized = JSON.stringify(settings)
    if (serialized === lastSavedRef.current) return

    const timer = window.setTimeout(async () => {
      markCloudSyncing()
      try {
        let saved
        try {
          saved = await saveCloudSettings(settings, versionRef.current)
        } catch (error) {
          if (!(error instanceof CloudRequestError) || error.status !== 409) {
            throw error
          }
          const current = await fetchCloudSettings<Settings>()
          saved = await saveCloudSettings(settings, current.version)
        }
        versionRef.current = saved.version
        lastSavedRef.current = serialized
        markCloudIdle()
      } catch (error) {
        reportCloudError(error)
      }
    }, 450)

    return () => window.clearTimeout(timer)
  }, [ready, retryGeneration, settings])

  if (loadError) {
    return (
      <main className="flex h-screen items-center justify-center p-6">
        <div className="max-w-lg space-y-4 text-center">
          <h1 className="typescale-title-large">Flow 云端设置加载失败</h1>
          <p className="text-on-surface-variant break-words">{loadError}</p>
          <Button onClick={() => void load()}>重试</Button>
        </div>
      </main>
    )
  }

  if (!ready) {
    return (
      <main className="flex h-screen items-center justify-center p-6">
        <p className="text-on-surface-variant">正在加载 Flow 云端设置…</p>
      </main>
    )
  }

  return <>{children}</>
}

function isSupportedLocale(
  value: string | undefined,
): value is NonNullable<Settings['locale']> {
  return value === 'en-US' || value === 'zh-CN' || value === 'ja-JP'
}
