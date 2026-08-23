export function requireApiUser(request: Request): { userId: string } {
  const userId = request.headers.get('oai-authenticated-user-id')?.trim()
  if (!userId) throw new HttpError(401, 'ChatGPT authentication is required')
  return { userId }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export function apiError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error(error)
  return Response.json(
    {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    },
    { status: 500 },
  )
}

export function methodNotAllowed(): Response {
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}

export function parseJson<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  return JSON.parse(value) as T
}
