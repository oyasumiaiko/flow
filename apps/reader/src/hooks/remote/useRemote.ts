import useSWR from 'swr'

import { fetchCloudBooks } from '@flow/reader/sync'

export function useRemoteBooks() {
  return useSWR('/api/library', fetchCloudBooks, {
    shouldRetryOnError: false,
    revalidateOnFocus: true,
  })
}
