export type User = {
  name?: string
  email?: string
  picture?: string
}

export type ShortLink = {
  code: string
  url: string
  created: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Pagelove's own error pages (e.g. 401 from the edge) are HTML.
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      (res.status === 401
        ? "Please sign in first."
        : `Request failed (${res.status})`)
    throw new ApiError(res.status, message)
  }
  return data as T
}

export const loginUrl = "/auth/login"
export const logoutUrl = "/auth/logout"

export function shortUrl(code: string) {
  return `${window.location.origin}/s/${code}`
}

export async function getMe(): Promise<User | null> {
  const data = await request<{ signedIn: boolean; user?: User }>("/api/me")
  return data.signedIn ? (data.user ?? {}) : null
}

export async function listLinks(): Promise<ShortLink[]> {
  const data = await request<{ links: ShortLink[] }>("/api/links")
  return data.links
}

export async function createLink(url: string, code?: string) {
  const data = await request<{ link: ShortLink }>("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(code ? { url, code } : { url }),
  })
  return data.link
}

export async function deleteLink(code: string) {
  await request<{ ok: true }>(`/api/links?code=${encodeURIComponent(code)}`, {
    method: "DELETE",
  })
}
