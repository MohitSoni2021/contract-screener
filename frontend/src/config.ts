const rawBase = (import.meta.env.VITE_API_BASE_URL || '').trim()

function resolveApiBaseUrl(): string {
  // Guard against literal placeholder values entered in environment configs or missing prod values
  if (!rawBase || rawBase === 'VITE_API_BASE_URL' || rawBase.includes('VITE_API_BASE_URL')) {
    if (import.meta.env.PROD) {
      return 'https://contract-screener-v2.onrender.com'
    }
    return ''
  }
  return rawBase.replace(/\/$/, '')
}

export const API_BASE_URL = resolveApiBaseUrl()

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${cleanPath}`
}

