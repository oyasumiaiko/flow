import { getChatGPTUser } from '../chatgpt-auth'

export async function requireApiUser() {
  const user = await getChatGPTUser()
  if (!user) throw new HttpError(401, 'ChatGPT authentication is required')
  return user
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

export function parseJson<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  return JSON.parse(value) as T
}
