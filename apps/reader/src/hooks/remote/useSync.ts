import { useEffect } from 'react'
import { useSnapshot } from 'valtio'

import { Annotation } from '@flow/reader/annotation'
import { BookTab } from '@flow/reader/models'
import { queueCloudBookUpdate } from '@flow/reader/sync'

export function useSync(tab: BookTab) {
  const { location, book } = useSnapshot(tab)
  const id = tab.book.id

  useEffect(() => {
    queueCloudBookUpdate(id, {
      cfi: location?.start.cfi,
      percentage: book.percentage,
    })
  }, [id, book.percentage, location?.start.cfi])

  useEffect(() => {
    queueCloudBookUpdate(id, {
      definitions: book.definitions as string[],
    })
  }, [book.definitions, id])

  useEffect(() => {
    queueCloudBookUpdate(id, {
      annotations: book.annotations as Annotation[],
    })
  }, [book.annotations, id])

  useEffect(() => {
    queueCloudBookUpdate(id, {
      configuration: book.configuration,
    })
  }, [book.configuration, id])
}
