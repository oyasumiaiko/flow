import assert from 'node:assert/strict'
import test from 'node:test'

import { createLatestValueWriter } from '../src/settings-write-queue.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('rapid setting changes are serialized and coalesced to the latest value', async () => {
  let releaseFirst
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const writes = []
  let concurrent = 0
  let maxConcurrent = 0

  const writer = createLatestValueWriter(async (value) => {
    writes.push(value)
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    if (value === 1) await firstBlocked
    concurrent -= 1
  })

  writer.enqueue(1)
  await tick()
  writer.enqueue(2)
  writer.enqueue(3)
  releaseFirst()
  await tick()
  await tick()

  assert.deepEqual(writes, [1, 3])
  assert.equal(maxConcurrent, 1)
  assert.equal(writer.hasPending(), false)
})

test('a failed setting write remains available for an explicit retry', async () => {
  let attempts = 0
  const errors = []
  const writer = createLatestValueWriter(
    async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary failure')
    },
    { onError: (error) => errors.push(error) },
  )

  writer.enqueue('latest')
  await tick()
  assert.equal(writer.hasPending(), true)
  assert.equal(errors.length, 1)

  writer.retry()
  await tick()
  assert.equal(attempts, 2)
  assert.equal(writer.hasPending(), false)
})
