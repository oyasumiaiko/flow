import { useSyncExternalStore } from 'react'

import { getCloudStatus, subscribeCloudStatus } from '@flow/reader/sync'

export function useCloudStatus() {
  return useSyncExternalStore(
    subscribeCloudStatus,
    getCloudStatus,
    getCloudStatus,
  )
}
