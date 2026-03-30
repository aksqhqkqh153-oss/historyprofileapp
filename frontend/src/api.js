const RAW_ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim()
const RAW_ENV_API_BASE_FALLBACKS = (import.meta.env.VITE_API_BASE_FALLBACKS || '').trim()
const KNOWN_PRODUCTION_FALLBACKS = [
  'https://api.historyprofile.com',
  'https://historyprofile-app-backend-production-c222.up.railway.app',
]
const KNOWN_DEPRECATED_API_BASES = new Set([
  'https://historyprofile-app-backend-production-3f81.up.railway.app',
])
const KNOWN_FRONTEND_ORIGINS = new Set([
  'https://historyprofile.com',
  'https://www.historyprofile.com',
  'https://ecc8d748.historyprofileapp.pages.dev',
])
const RETRYABLE_NON_API_STATUSES = new Set([404, 405, 501, 502, 503, 504])
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/phone/request-code',
  '/api/auth/phone/verify-code',
  '/api/auth/find-account',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/confirm',
])
const REMEMBER_KEY = 'icj_auto_login'
const AUTH_EXPIRED_EVENT = 'icj-auth-expired'
const SUCCESSFUL_API_BASE_KEY = 'historyprofile_successful_api_base'

class RetryNextBaseError extends Error {
  constructor(message, finalMessage = '') {
    super(message)
    this.name = 'RetryNextBaseError'
    this.finalMessage = finalMessage || message
  }
}

function getWindowOrigin() {
  if (typeof window === 'undefined') return ''
  return (window.location?.origin || '').trim()
}

function normalizeBase(base) {
  const raw = String(base || '').trim()
  if (!raw) return ''
  if (raw === '/') return ''
  return raw.replace(/\/+$/, '')
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => normalizeBase(item))
    .filter(Boolean)
}

function uniqueBases(values) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    const normalized = normalizeBase(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function isLocalhost() {
  if (typeof window === 'undefined') return false
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname)
}

function isInvalidProductionApiBase(base) {
  const normalized = normalizeBase(base)
  const origin = normalizeBase(getWindowOrigin())
  if (!normalized) return false
  if (KNOWN_DEPRECATED_API_BASES.has(normalized)) return true
  if (KNOWN_FRONTEND_ORIGINS.has(normalized)) return true
  if (!isLocalhost() && origin && normalized === origin) return true
  return false
}

function getSuccessfulApiBase() {
  try {
    const stored = normalizeBase(localStorage.getItem(SUCCESSFUL_API_BASE_KEY) || '')
    if (!stored || isInvalidProductionApiBase(stored)) {
      localStorage.removeItem(SUCCESSFUL_API_BASE_KEY)
      return ''
    }
    const allowed = new Set([
      normalizeBase(RAW_ENV_API_BASE),
      ...splitCsv(RAW_ENV_API_BASE_FALLBACKS),
      ...KNOWN_PRODUCTION_FALLBACKS.map(item => normalizeBase(item)),
    ].filter(Boolean))
    if (!isLocalhost() && allowed.size && !allowed.has(stored)) {
      localStorage.removeItem(SUCCESSFUL_API_BASE_KEY)
      return ''
    }
    return stored
  } catch {
    return ''
  }
}

function setSuccessfulApiBase(base) {
  try {
    const normalized = normalizeBase(base)
    if (normalized && !isInvalidProductionApiBase(normalized)) {
      localStorage.setItem(SUCCESSFUL_API_BASE_KEY, normalized)
    } else {
      localStorage.removeItem(SUCCESSFUL_API_BASE_KEY)
    }
  } catch {
    // ignore
  }
}

function getApiBaseCandidates() {
  const origin = normalizeBase(getWindowOrigin())
  const envBase = normalizeBase(RAW_ENV_API_BASE)
  const fallbacks = splitCsv(RAW_ENV_API_BASE_FALLBACKS)
  const stored = getSuccessfulApiBase()
  const productionCandidates = uniqueBases([
    stored,
    envBase,
    ...fallbacks,
    ...KNOWN_PRODUCTION_FALLBACKS,
  ]).filter(base => !isInvalidProductionApiBase(base))

  if (isLocalhost()) {
    return uniqueBases(['', origin, ...productionCandidates])
  }

  return productionCandidates
}

export function getApiBase() {
  const candidates = getApiBaseCandidates()
  return candidates[0] || ''
}

export function getRememberedLogin() {
  return localStorage.getItem(REMEMBER_KEY) === '1'
}

export function getToken() {
  return sessionStorage.getItem('icj_token') || localStorage.getItem('icj_token') || ''
}

export function setSession(token, user, remember = false) {
  const serializedUser = JSON.stringify(user)
  sessionStorage.setItem('icj_token', token)
  sessionStorage.setItem('icj_user', serializedUser)
  if (remember) {
    localStorage.setItem('icj_token', token)
    localStorage.setItem('icj_user', serializedUser)
    localStorage.setItem(REMEMBER_KEY, '1')
  } else {
    localStorage.removeItem('icj_token')
    localStorage.removeItem('icj_user')
    localStorage.removeItem(REMEMBER_KEY)
  }
}

export function clearSession({ preserveRemember = false } = {}) {
  sessionStorage.removeItem('icj_token')
  sessionStorage.removeItem('icj_user')
  localStorage.removeItem('icj_token')
  localStorage.removeItem('icj_user')
  localStorage.removeItem(SUCCESSFUL_API_BASE_KEY)
  if (!preserveRemember) {
    localStorage.removeItem(REMEMBER_KEY)
  }
}

export function getStoredUser() {
  const raw = sessionStorage.getItem('icj_user') || localStorage.getItem('icj_user')
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function shouldAttachAuthHeader(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  if (PUBLIC_AUTH_PATHS.has(path)) {
    return false
  }
  return method !== 'OPTIONS'
}

function buildHeaders(options = {}) {
  const headers = { ...(options.headers || {}) }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

function notifyAuthExpired(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail }))
}

function isNetworkLevelFailure(error) {
  return error instanceof TypeError
}

function shouldRetryWithAnotherBase(path, res, data, base) {
  const status = Number(res?.status || 0)
  const contentType = String(res?.headers?.get?.('content-type') || '').toLowerCase()
  const detail = String(data?.detail || '').toLowerCase()
  const normalizedBase = normalizeBase(base)
  const windowOrigin = normalizeBase(getWindowOrigin())
  const isPublicAuthPath = PUBLIC_AUTH_PATHS.has(path)
  const isLikelyHtmlPage = contentType.includes('text/html')
  const isWrongMethodOnFrontendHost = isPublicAuthPath && status === 405 && ((!normalizedBase && windowOrigin) || normalizedBase === windowOrigin)
  const isMissingApiRoute = RETRYABLE_NON_API_STATUSES.has(status)
  const isFrontendNotBackend = detail.includes('method not allowed') || detail.includes('not found')

  if (isWrongMethodOnFrontendHost) return true
  if (isLikelyHtmlPage && isPublicAuthPath) return true
  if (isMissingApiRoute && isPublicAuthPath) return true
  if (isFrontendNotBackend && isPublicAuthPath && normalizedBase === windowOrigin) return true
  return false
}

async function requestWithBase(base, path, options, headers) {
  const token = getToken()
  const requestHeaders = { ...headers }
  if (token && shouldAttachAuthHeader(path, options)) {
    requestHeaders.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: requestHeaders,
    credentials: 'include',
  })

  const data = await res.json().catch(() => ({}))
  if (shouldRetryWithAnotherBase(path, res, data, base)) {
    throw new RetryNextBaseError(`Retry another API base after ${res.status} from ${base || 'same-origin'}`, data.detail || `요청 처리 중 오류가 발생했습니다. (${res.status})`)
  }
  if (res.status === 401 && !PUBLIC_AUTH_PATHS.has(path)) {
    clearSession({ preserveRemember: true })
    notifyAuthExpired({ path, status: res.status, detail: data.detail || '' })
  }
  if (!res.ok) {
    throw new Error(data.detail || `요청 처리 중 오류가 발생했습니다. (${res.status})`)
  }

  setSuccessfulApiBase(base)
  return data
}

export async function api(path, options = {}) {
  const headers = buildHeaders(options)
  const candidates = getApiBaseCandidates()
  let lastError = null

  if (!candidates.length && !isLocalhost()) {
    throw new Error('VITE_API_BASE_URL 또는 VITE_API_BASE_FALLBACKS 값이 비어 있거나 잘못되었습니다. Cloudflare Pages 변수를 확인해주세요.')
  }

  for (const base of candidates) {
    try {
      return await requestWithBase(base, path, options, headers)
    } catch (error) {
      lastError = error
      if (error instanceof RetryNextBaseError) {
        continue
      }
      if (!isNetworkLevelFailure(error)) {
        throw error
      }
    }
  }

  throw new Error(
    lastError?.finalMessage || lastError?.message || 'API 서버에 연결하지 못했습니다. 도메인 설정 또는 백엔드 배포 상태를 확인해주세요.'
  )
}

export { AUTH_EXPIRED_EVENT }


export async function uploadFile(file, category = 'general', profileId = null) {
  const formData = new FormData()
  formData.append('file', file)
  const params = new URLSearchParams()
  params.set('category', category || 'general')
  if (profileId !== null && profileId !== undefined && profileId !== '') {
    params.set('profile_id', String(profileId))
  }
  return api(`/api/uploads/file?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })
}
