import { useMediaQuery } from '@literal-ui/hooks'
import { useCallback, useEffect } from 'react'

import { ColorScheme, useSettings } from '@flow/reader/state'

export type { ColorScheme }

export function useColorScheme() {
  const [settings, setSettings] = useSettings()
  const scheme = settings.colorScheme ?? 'system'
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const dark = scheme === 'dark' || (scheme === 'system' && prefersDark)

  useEffect(() => {
    if (dark !== undefined) {
      document.documentElement.classList.toggle('dark', dark)
    }
  }, [dark])

  const setScheme = useCallback(
    (next: ColorScheme) => {
      setSettings((previous) => ({ ...previous, colorScheme: next }))
    },
    [setSettings],
  )

  return { scheme, dark, setScheme }
}
