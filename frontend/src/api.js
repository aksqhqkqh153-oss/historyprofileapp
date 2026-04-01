const ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim()
const isLocalHost = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const API_BASE = isLocalHost ? '' : ENV_API_BASE
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/find-account',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/confirm',
])

const REMEMBER_KEY = 'icj_auto_login'
const AUTH_EXPIRED_EVENT = 'icj-auth-expired'
const API_CACHE_PREFIX = 'icj_api_cache:'

const memoryCache = new Map()
const pendingRequests = new Map()

const CACHE_RULES = [
  { match: path => path === '/api/profile', ttlMs: 60 * 1000 },
  { match: path => path === '/api/users', ttlMs: 3 * 60 * 1000 },
  { match: path => path === '/api/friends', ttlMs: 60 * 1000 },
  { match: path => path === '/api/follows', ttlMs: 60 * 1000 },
  { match: path => path === '/api/map-users', ttlMs: 60 * 1000 },
  { match: path => path === '/api/location-sharing/status', ttlMs: 15 * 1000 },
  { match: path => path === '/api/notifications', ttlMs: 20 * 1000 },
  { match: path => path === '/api/badges-summary', ttlMs: 30 * 1000 },
  { match: path => path === '/api/home/upcoming-schedules', ttlMs: 30 * 1000 },
  { match: path => path === '/api/admin-mode', ttlMs: 45 * 1000 },
  { match: path => path === '/api/admin/quote-forms', ttlMs: 30 * 1000 },
  { match: path => path === '/api/materials/overview', ttlMs: 30 * 1000 },
  { match: path => path === '/api/settlement/records', ttlMs: 30 * 1000 },
  { match: path => path === '/api/settlement/platform-sync-status', ttlMs: 15 * 1000 },
  { match: path => path.startsWith('/api/calendar/events'), ttlMs: 45 * 1000 },
  { match: path => path.startsWith('/api/work-schedule'), ttlMs: 30 * 1000 },
  { match: path => path.startsWith('/api/chat-list'), ttlMs: 15 * 1000 },
  { match: path => path.startsWith('/api/chat/rooms'), ttlMs: 10 * 1000 },
  { match: path => path.startsWith('/api/quote-forms/options'), ttlMs: 5 * 60 * 1000 },
]

const INVALIDATION_RULES = [
  { match: path => path.startsWith('/api/profile'), invalidate: ['/api/profile', '/api/map-users', '/api/users', '/api/location-sharing/status'] },
  { match: path => path.startsWith('/api/friends') || path.startsWith('/api/follows'), invalidate: ['/api/friends', '/api/follows', '/api/users', '/api/badges-summary'] },
  { match: path => path.startsWith('/api/calendar/events'), invalidate: ['/api/calendar/events', '/api/home/upcoming-schedules', '/api/work-schedule', '/api/badges-summary'] },
  { match: path => path.startsWith('/api/work-schedule'), invalidate: ['/api/work-schedule', '/api/home/upcoming-schedules', '/api/badges-summary'] },
  { match: path => path.startsWith('/api/group-rooms') || path.startsWith('/api/chat'), invalidate: ['/api/chat-list', '/api/chat/rooms', '/api/users'] },
  { match: path => path.startsWith('/api/admin-mode') || path.startsWith('/api/admin/'), invalidate: ['/api/admin-mode', '/api/users', '/api/profile', '/api/admin/quote-forms'] },
  { match: path => path.startsWith('/api/materials/'), invalidate: ['/api/materials/overview'] },
  { match: path => path.startsWith('/api/settlement/'), invalidate: ['/api/settlement/records', '/api/settlement/platform-sync-status'] },
  { match: path => path.startsWith('/api/quote-forms/submit'), invalidate: ['/api/admin/quote-forms'] },
  { match: path => path.startsWith('/api/notifications'), invalidate: ['/api/notifications', '/api/badges-summary'] },
]

export function getApiBase() {
  return API_BASE
}

export function getRememberedLogin() {
  const saved = localStorage.getItem(REMEMBER_KEY)
  return saved === null ? true : saved === '1'
}

export function getToken() {
  return sessionStorage.getItem('icj_token') || localStorage.getItem('icj_token') || ''
}

export function setSession(token, user, remember = true) {
  const serializedUser = JSON.stringify(user)
  sessionStorage.setItem('icj_token', token)
  sessionStorage.setItem('icj_user', serializedUser)
  localStorage.setItem('icj_token', token)
  localStorage.setItem('icj_user', serializedUser)
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  invalidateApiCache()
}

export function clearSession({ preserveRemember = false } = {}) {
  sessionStorage.removeItem('icj_token')
  sessionStorage.removeItem('icj_user')
  localStorage.removeItem('icj_token')
  localStorage.removeItem('icj_user')
  if (!preserveRemember) {
    localStorage.removeItem(REMEMBER_KEY)
  }
  invalidateApiCache()
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

function stripHashAndNormalize(path = '') {
  const noHash = String(path).split('#')[0]
  return noHash || ''
}

function getBasePath(path = '') {
  return stripHashAndNormalize(path).split('?')[0]
}

function getCacheRule(path) {
  const basePath = getBasePath(path)
  return CACHE_RULES.find(rule => rule.match(basePath)) || null
}

function getTokenScope() {
  const token = getToken()
  return token ? token.slice(-16) : 'guest'
}

function getCacheKey(path) {
  return `${API_CACHE_PREFIX}${getTokenScope()}:${stripHashAndNormalize(path)}`
}

function readStorageCache(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    sessionStorage.removeItem(key)
    return null
  }
}

function writeStorageCache(key, entry) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // ignore storage quota and serialization errors
  }
}

function deleteStorageCache(key) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function readCacheEntry(path) {
  const key = getCacheKey(path)
  const memoryEntry = memoryCache.get(key)
  if (memoryEntry) return { key, entry: memoryEntry }
  const storageEntry = readStorageCache(key)
  if (storageEntry) {
    memoryCache.set(key, storageEntry)
    return { key, entry: storageEntry }
  }
  return { key, entry: null }
}

function writeCacheEntry(path, data, ttlMs) {
  const { key } = readCacheEntry(path)
  const entry = {
    data,
    savedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  }
  memoryCache.set(key, entry)
  writeStorageCache(key, entry)
  return data
}

function invalidateByPrefixes(prefixes = []) {
  if (!prefixes.length) return
  const normalized = prefixes.map(prefix => getBasePath(prefix)).filter(Boolean)
  for (const key of [...memoryCache.keys()]) {
    const stripped = key.replace(`${API_CACHE_PREFIX}${getTokenScope()}:`, '')
    const basePath = getBasePath(stripped)
    if (normalized.some(prefix => basePath.startsWith(prefix))) {
      memoryCache.delete(key)
      deleteStorageCache(key)
    }
  }
  if (typeof window !== 'undefined') {
    const removeKeys = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (!key || !key.startsWith(API_CACHE_PREFIX)) continue
      const withoutPrefix = key.split(':').slice(2).join(':')
      const basePath = getBasePath(withoutPrefix)
      if (normalized.some(prefix => basePath.startsWith(prefix))) {
        removeKeys.push(key)
      }
    }
    removeKeys.forEach(deleteStorageCache)
  }
}

function maybeInvalidateAfterMutation(path, method) {
  if (method === 'GET') return
  const basePath = getBasePath(path)
  const matched = INVALIDATION_RULES.filter(rule => rule.match(basePath))
  if (!matched.length) return
  const prefixes = matched.flatMap(rule => rule.invalidate)
  invalidateByPrefixes(prefixes)
}

export function invalidateApiCache(prefixes = []) {
  if (!prefixes.length) {
    memoryCache.clear()
    if (typeof window !== 'undefined') {
      const removeKeys = []
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i)
        if (key?.startsWith(API_CACHE_PREFIX)) removeKeys.push(key)
      }
      removeKeys.forEach(deleteStorageCache)
    }
    pendingRequests.clear()
    return
  }
  invalidateByPrefixes(prefixes)
}

async function requestJson(path, options, headers) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && !PUBLIC_AUTH_PATHS.has(path)) {
    clearSession({ preserveRemember: true })
    notifyAuthExpired({ path, status: res.status, detail: data.detail || '' })
  }
  if (!res.ok) {
    throw new Error(data.detail || `요청 처리 중 오류가 발생했습니다. (${res.status})`)
  }
  return data
}

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const token = getToken()
  const headers = buildHeaders(options)
  if (token && shouldAttachAuthHeader(path, options)) {
    headers.Authorization = `Bearer ${token}`
  }

  const rule = method === 'GET' ? getCacheRule(path) : null
  const customCache = options.icjCache || {}
  const skipCache = customCache.skip === true || options.cache === 'no-store'
  const ttlMs = typeof customCache.ttlMs === 'number' ? customCache.ttlMs : rule?.ttlMs || 0
  const useCache = method === 'GET' && !skipCache && ttlMs > 0
  const now = Date.now()

  if (useCache) {
    const { key, entry } = readCacheEntry(path)
    if (entry && entry.expiresAt > now) {
      return entry.data
    }
    if (pendingRequests.has(key)) {
      return pendingRequests.get(key)
    }
    const requestPromise = (async () => {
      try {
        const data = await requestJson(path, options, headers)
        return writeCacheEntry(path, data, ttlMs)
      } catch (err) {
        if (entry?.data) {
          return entry.data
        }
        const message = API_BASE
          ? `서버 연결에 실패했습니다. CORS 또는 네트워크 설정을 확인해주세요. (${API_BASE}${path})`
          : '서버 연결에 실패했습니다. 로컬 백엔드 실행 상태를 확인해주세요.'
        if (err instanceof TypeError) {
          throw new Error(message)
        }
        throw err
      } finally {
        pendingRequests.delete(key)
      }
    })()
    pendingRequests.set(key, requestPromise)
    return requestPromise
  }

  try {
    const data = await requestJson(path, options, headers)
    maybeInvalidateAfterMutation(path, method)
    return data
  } catch (err) {
    if (err instanceof TypeError) {
      const message = API_BASE
        ? `서버 연결에 실패했습니다. CORS 또는 네트워크 설정을 확인해주세요. (${API_BASE}${path})`
        : '서버 연결에 실패했습니다. 로컬 백엔드 실행 상태를 확인해주세요.'
      throw new Error(message)
    }
    throw err
  }
}

export async function uploadFile(file, category = 'general') {
  const token = getToken()
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`${API_BASE}/api/uploads/file?category=${encodeURIComponent(category)}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.detail || `파일 업로드 중 오류가 발생했습니다. (${res.status})`)
  }
  invalidateApiCache(['/api/profile'])
  return data
}

export { AUTH_EXPIRED_EVENT }
