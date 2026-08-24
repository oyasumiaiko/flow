export interface LatestValueWriterCallbacks {
  onStart?: () => void
  onIdle?: () => void
  onError?: (error: unknown) => void
}

export interface LatestValueWriter<T> {
  enqueue(value: T): void
  retry(): void
  hasPending(): boolean
}

/**
 * 串行写入最新值：同一时刻最多只有一个请求在途；写入期间产生的多次更新只保留
 * 最后一份。失败的值会留在队列中，等待显式重试或下一次用户更新。
 */
export function createLatestValueWriter<T>(
  write: (value: T) => Promise<void>,
  callbacks: LatestValueWriterCallbacks = {},
): LatestValueWriter<T> {
  const empty = Symbol('empty')
  let pending: T | typeof empty = empty
  let flushing = false
  let paused = false

  async function flush() {
    if (flushing || paused || pending === empty) return
    flushing = true
    callbacks.onStart?.()

    try {
      while (!paused && pending !== empty) {
        const value = pending as T
        pending = empty
        try {
          await write(value)
        } catch (error) {
          // 若写入期间没有更新，保留失败值；否则保留用户后来产生的最新值。
          if (pending === empty) pending = value
          paused = true
          callbacks.onError?.(error)
        }
      }

      if (!paused && pending === empty) callbacks.onIdle?.()
    } finally {
      flushing = false
      // write() 完成的微任务边界可能恰好收到新值；确保它不会滞留。
      if (!paused && pending !== empty) void flush()
    }
  }

  return {
    enqueue(value) {
      pending = value
      paused = false
      void flush()
    },
    retry() {
      paused = false
      void flush()
    },
    hasPending() {
      return pending !== empty
    },
  }
}
