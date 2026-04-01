import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AUTH_EXPIRED_EVENT, api, clearSession, getRememberedLogin, getStoredUser, setSession, uploadFile } from './api'
import { SETTLEMENT_DATA } from './settlementData'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { createPortal } from 'react-dom'

const PAGE_TITLES = {
  '/': '홈',
  '/map': '지도',
  '/friends': '친구',
  '/chats': '채팅',
  '/schedule': '일정',
  '/schedule/new': '일정등록',
  '/schedule/handless': '손없는날등록',
  '/work-schedule': '스케줄',
  '/profile': '프로필',
  '/meetups': '모임',
  '/boards': '게시판',
  '/notifications': '알림',
  '/settings': '설정',
  '/admin-mode': '관리자모드',
  '/reports': '신고관리',
  '/workday-history': '일시작종료',
  '/settlements': '결산자료',
  '/soomgo-review-finder': '숨고리뷰찾기',
  '/warehouse': '창고현황',
  '/materials': '자재구매/현황',
  '/storage-status': '짐보관현황',
  '/menu-permissions': '메뉴권한',
  '/quotes': '견적',
  '/quote-forms': '견적',
  '/business-card-maker': '명함만들기',
}

function pageTitle(pathname) {
  if (pathname.startsWith('/schedule/new')) return '일정등록'
  if (/^\/schedule\/\d+\/edit$/.test(pathname)) return '일정수정'
  if (/^\/schedule\/\d+$/.test(pathname)) return '일정상세'
  if (pathname.startsWith('/chats/direct/') || pathname.startsWith('/chats/group/')) return '채팅방'
  return PAGE_TITLES[pathname] || '앱'
}

const DEFAULT_ALERT_SETTINGS = {
  mobileEnabled: true,
  appEnabled: true,
  repeatHours: 1,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  mobileTypes: { assignment: true, time: true, address: true },
  appTypes: { assignment: true, time: true, address: true },
}

function deepMerge(base, extra) {
  const output = Array.isArray(base) ? [...base] : { ...base }
  if (!extra || typeof extra !== 'object') return output
  Object.entries(extra).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = deepMerge(output[key], value)
    } else {
      output[key] = value
    }
  })
  return output
}

function normalizeAlertSettings(rawPrefs) {
  return deepMerge(DEFAULT_ALERT_SETTINGS, rawPrefs?.alertSettings || {})
}

function scheduleNotificationCategory(type) {
  const value = String(type || '')
  if (value.includes('assignment')) return 'assignment'
  if (value.includes('time')) return 'time'
  if (value.includes('address')) return 'address'
  return 'assignment'
}

function isScheduleAlertNotification(item) {
  return ['work_schedule_assignment', 'work_schedule_assignment_change', 'work_schedule_time_change', 'work_schedule_address_change', 'calendar_assignment_change', 'calendar_time_change', 'calendar_address_change'].includes(String(item?.type || ''))
}

function parseTimeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function isNowInQuietHours(settings) {
  if (!settings?.quietHoursEnabled) return false
  const start = parseTimeToMinutes(settings.quietStart)
  const end = parseTimeToMinutes(settings.quietEnd)
  if (start == null || end == null) return false
  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  if (start === end) return true
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

function alertStorageKey(userId, channel) {
  return `icj_alert_state_${channel}_${userId || 'guest'}`
}

function loadAlertShownMap(userId, channel) {
  try {
    const raw = localStorage.getItem(alertStorageKey(userId, channel))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function saveAlertShownMap(userId, channel, value) {
  try {
    localStorage.setItem(alertStorageKey(userId, channel), JSON.stringify(value || {}))
  } catch (_) {}
}

const BRANCH_NUMBER_OPTIONS = [0, ...Array.from({ length: 50 }, (_, index) => index + 1)]

const ROLE_OPTIONS = [
  { value: 1, label: '관리자' },
  { value: 2, label: '부관리자' },
  { value: 3, label: '중간관리자' },
  { value: 4, label: '사업자' },
  { value: 5, label: '직원' },
  { value: 6, label: '일반' },
  { value: 7, label: '기타' },
]

const POSITION_OPTIONS = ['대표', '부대표', '호점대표', '팀장', '부팀장', '직원', '본부장', '상담실장', '상담팀장', '상담사원']


const POSITION_PERMISSION_OPTIONS = ['미지정', ...POSITION_OPTIONS]

function normalizeBranchNo(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isAssignedBranchNo(value) {
  return value !== '' && value !== null && value !== undefined && !Number.isNaN(Number(value))
}

function branchOptionLabel(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '본점 또는 미지정'
  return num === 0 ? '0본점' : `${num}호점`
}

function branchDisplayLabel(value, fallback = '본점/미지정') {
  if (!isAssignedBranchNo(value)) return fallback
  return branchOptionLabel(value)
}

const ADMIN_SORT_OPTIONS = [
  { value: 'group_number', label: '구분 기준' },
  { value: 'account_type', label: '사업자 / 직원 분류' },
  { value: 'vehicle_available', label: '차량가용여부기준' },
  { value: 'position_title', label: '직급별 기준' },
  { value: 'role', label: '직책별 기준' },
  { value: 'grade', label: '계정권한 기준' },
  { value: 'email', label: '아이디 기준' },
  { value: 'custom', label: '사용자 지정(필터 2개 이상)' },
]

const ADMIN_CUSTOM_SORT_FIELDS = [
  { value: 'group_number', label: '구분 기준' },
  { value: 'account_type', label: '사업자 / 직원 분류' },
  { value: 'vehicle_available', label: '차량가용여부기준' },
  { value: 'position_title', label: '직급별 기준' },
  { value: 'role', label: '직책별 기준' },
  { value: 'grade', label: '계정권한 기준' },
  { value: 'email', label: '아이디 기준' },
]

const MENU_PERMISSION_SECTIONS = [
  {
    id: 'common',
    label: '공용',
    items: [
      { id: 'warehouse', label: '창고현황', path: '/warehouse' },
      { id: 'materials', label: '자재구매/현황', path: '/materials' },
      { id: 'quotes', label: '견적', path: '/quotes' },
      { id: 'business-card-maker', label: '명함만들기', path: '/business-card-maker' },
      { id: 'workday-history', label: '일시작종료', path: '/workday-history' },
    ],
  },
  {
    id: 'head-office',
    label: '본사용',
    items: [
      { id: 'settlements', label: '결산자료', path: '/settlements' },
      { id: 'storage-status', label: '짐보관현황', path: '/storage-status' },
      { id: 'soomgo-review-finder', label: '숨고리뷰찾기', path: '/soomgo-review-finder' },
    ],
  },
  {
    id: 'business',
    label: '사업자용',
    items: [],
  },
  {
    id: 'staff',
    label: '직원용',
    items: [
      { id: 'points', label: '포인트', path: '/points' },
    ],
  },
  {
    id: 'etc',
    label: '기타',
    items: [
      { id: 'meetups', label: '모임', path: '/meetups' },
      { id: 'boards', label: '게시판', path: '/boards' },
      { id: 'reports', label: '신고관리', path: '/reports', adminOnly: true },
    ],
  },
]

const MENU_PERMISSION_ITEMS = MENU_PERMISSION_SECTIONS.flatMap(section => [
  { key: `section:${section.id}`, type: 'section', sectionId: section.id, label: section.label },
  ...section.items.map(item => ({ ...item, key: `item:${item.id}`, type: 'item', sectionId: section.id })),
])

function effectivePositionTitle(user) {
  const title = String(user?.position_title || '').trim()
  if (title) return title
  if (Number(user?.branch_no || 0) > 0) return '호점대표'
  return '미지정'
}

function isAdministrator(user) {
  return Number(user?.grade || 6) === 1
}

function parseMenuPermissions(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw || {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function buildDefaultMenuPermissions() {
  const defaults = {}
  MENU_PERMISSION_ITEMS.forEach(entry => {
    defaults[entry.key] = POSITION_PERMISSION_OPTIONS.reduce((acc, position) => {
      acc[position] = true
      return acc
    }, {})
  })
  return defaults
}

function normalizeMenuPermissions(raw) {
  const parsed = parseMenuPermissions(raw)
  const defaults = buildDefaultMenuPermissions()
  Object.entries(parsed).forEach(([key, value]) => {
    if (!defaults[key] || typeof value !== 'object' || !value) return
    POSITION_PERMISSION_OPTIONS.forEach(position => {
      if (typeof value[position] === 'boolean') defaults[key][position] = value[position]
    })
  })
  return defaults
}

function canViewMenuEntry(user, permissionMap, entryKey) {
  if (Number(user?.grade || 6) === 1) return true
  const position = effectivePositionTitle(user)
  const row = permissionMap?.[entryKey]
  if (!row) return true
  if (typeof row[position] === 'boolean') return row[position]
  return row['미지정'] ?? true
}

function gradeLabel(grade) {
  return ROLE_OPTIONS.find(item => item.value === Number(grade))?.label || '일반'
}

function canAccessAdminMode(user) {
  return Number(user?.grade || 6) <= 2 || Number(user?.grade || 6) <= Number(user?.permission_config?.admin_mode_access_grade || 2)
}

function isReadOnlyMember(user) {
  return Number(user?.grade || 6) === 6
}

function AccessDeniedRedirect({ message = '권한이 없습니다.' }) {
  const navigate = useNavigate()
  useEffect(() => {
    const timer = window.setTimeout(() => navigate('/', { replace: true, state: { notice: message } }), 1200)
    return () => window.clearTimeout(timer)
  }, [message, navigate])
  return <div className="card error">{message}</div>
}

function parseExcludedBusinessSlots(value) {
  const output = Array(6).fill('')
  if (!value) return output
  let tokens = []
  if (Array.isArray(value)) {
    tokens = value
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) tokens = parsed
    } catch (_) {}
    if (tokens.length === 0) {
      tokens = value.split(/[\n,]/).map(token => token.trim()).filter(Boolean)
    }
  }
  tokens
    .map(item => {
      const match = String(item).match(/(\d{1,2})/)
      return match ? String(Number(match[1])) : ''
    })
    .filter(Boolean)
    .slice(0, 6)
    .forEach((token, index) => { output[index] = token })
  return output
}

function serializeExcludedBusinessSlots(slots) {
  return slots.filter(Boolean).map(value => `${value}호점`).join(', ')
}

const QUICK_ACTION_LIBRARY = [
  { id: 'friendCount', label: '친구 수', kind: 'metric', metricKey: 'friendCount', path: '/friends' },
  { id: 'requestCount', label: '친구요청목록', kind: 'metric', metricKey: 'requestCount', path: '/friends?panel=requests' },
  { id: 'point', label: '포인트', kind: 'placeholder' },
  { id: 'warehouse', label: '창고현황', kind: 'placeholder' },
  { id: 'materialsBuy', label: '자재구매', kind: 'link', path: '/materials' },
  { id: 'storageStatus', label: '짐보관현황', kind: 'placeholder' },
  { id: 'settlements', label: '결산자료', kind: 'link', path: '/settlements' },
]
const DEFAULT_QUICK_ACTION_IDS = ['point', 'warehouse', 'materialsBuy', 'storageStatus', 'settlements']
const HOME_SECTION_ORDER_DEFAULT = ['quick', 'workday', 'upcoming']
const HOME_HOLD_SECONDS_DEFAULT = 1

function homeSettingsStorageKey(userId) {
  return `icj_home_settings_${userId || 'guest'}`
}

function getHomeSettings(userId) {
  const fallback = {
    sectionOrder: [...HOME_SECTION_ORDER_DEFAULT],
    workday: { holdSeconds: HOME_HOLD_SECONDS_DEFAULT, enabled: true, hideOnHome: false },
    activeWorkState: { started: false, updatedAt: '', startTime: '', endTime: '', workDate: '' },
  }
  try {
    const raw = localStorage.getItem(homeSettingsStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const knownIds = new Set(HOME_SECTION_ORDER_DEFAULT)
    const sectionOrder = Array.isArray(parsed?.sectionOrder) ? parsed.sectionOrder.filter(item => knownIds.has(item)) : fallback.sectionOrder
    const workday = parsed?.workday && typeof parsed.workday === 'object' ? parsed.workday : {}
    const activeWorkState = parsed?.activeWorkState && typeof parsed.activeWorkState === 'object' ? parsed.activeWorkState : {}
    const missing = HOME_SECTION_ORDER_DEFAULT.filter(item => !sectionOrder.includes(item))
    return {
      sectionOrder: [...sectionOrder, ...missing],
      workday: {
        holdSeconds: Math.max(1, Math.min(10, Number(workday.holdSeconds || HOME_HOLD_SECONDS_DEFAULT))),
        enabled: workday.enabled !== false,
        hideOnHome: !!workday.hideOnHome,
      },
      activeWorkState: {
        started: !!activeWorkState.started,
        updatedAt: String(activeWorkState.updatedAt || ''),
        startTime: String(activeWorkState.startTime || ''),
        endTime: String(activeWorkState.endTime || ''),
        workDate: String(activeWorkState.workDate || ''),
      },
    }
  } catch (_) {
    return fallback
  }
}

function saveHomeSettings(userId, nextState) {
  localStorage.setItem(homeSettingsStorageKey(userId), JSON.stringify(nextState))
}

function quickActionStorageKey(userId) {
  return `icj_quick_actions_${userId || 'guest'}`
}

function friendGroupStorageKey(userId) {
  return `icj_friend_groups_${userId || 'guest'}`
}

function friendMenuKey(section, itemId) {
  return `${section || 'friend'}-${itemId}`
}

function profileCoverStorageKey(userId) {
  return `icj_profile_cover_${userId || 'guest'}`
}

function loadProfileCover(userId) {
  try { return localStorage.getItem(profileCoverStorageKey(userId)) || '' } catch { return '' }
}

function saveProfileCover(userId, value) {
  try {
    if (!value) localStorage.removeItem(profileCoverStorageKey(userId))
    else localStorage.setItem(profileCoverStorageKey(userId), value)
  } catch {}
}

function getQuickActionState(userId) {
  const fallback = { active: [...DEFAULT_QUICK_ACTION_IDS], archived: [] }
  try {
    const raw = localStorage.getItem(quickActionStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const known = new Set(QUICK_ACTION_LIBRARY.map(item => item.id))
    const active = Array.isArray(parsed?.active) ? parsed.active.filter(id => known.has(id)) : fallback.active
    const archived = Array.isArray(parsed?.archived) ? parsed.archived.filter(id => known.has(id) && !active.includes(id)) : []
    const missing = QUICK_ACTION_LIBRARY.map(item => item.id).filter(id => !active.includes(id) && !archived.includes(id))
    return { active: [...active, ...missing].slice(0, 9), archived }
  } catch (_) {
    return fallback
  }
}

function saveQuickActionState(userId, nextState) {
  localStorage.setItem(quickActionStorageKey(userId), JSON.stringify(nextState))
}

function getFriendGroupState(userId) {
  const fallback = { groups: [], assignments: {} }
  try {
    const raw = localStorage.getItem(friendGroupStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return {
      groups: Array.isArray(parsed?.groups) ? parsed.groups : [],
      assignments: parsed?.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {},
    }
  } catch (_) {
    return fallback
  }
}

function saveFriendGroupState(userId, nextState) {
  localStorage.setItem(friendGroupStorageKey(userId), JSON.stringify(nextState))
}

function chatPinnedOrderStorageKey(userId) {
  return `icj_chat_pinned_order_${userId || 'guest'}`
}

function loadChatPinnedOrder(userId) {
  try {
    const raw = localStorage.getItem(chatPinnedOrderStorageKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveChatPinnedOrder(userId, order) {
  try {
    localStorage.setItem(chatPinnedOrderStorageKey(userId), JSON.stringify(Array.from(new Set(order.filter(Boolean)))))
  } catch {}
}

function Layout({ children, user, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuRef = useRef(null)
  const settingsRef = useRef(null)
  const [badges, setBadges] = useState({ notification_count: 0, chat_count: 0, friend_request_count: 0, menu_count: 0 })
  const isScheduleView = location.pathname === '/schedule'
  const bottomLinks = [
    ['/', '홈'],
    ['/map', '지도'],
    ['/friends', '친구'],
    ['/chats', '채팅'],
    ['/schedule', '일정'],
    ['/work-schedule', '스케줄'],
  ]
  const isBottomActive = (to) => {
    if (to === '/') return location.pathname === '/'
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }
  const menuPermissions = useMemo(() => normalizeMenuPermissions(user?.permission_config?.menu_permissions_json), [user?.permission_config?.menu_permissions_json])
  const topMenuSections = useMemo(() => (
    MENU_PERMISSION_SECTIONS
      .map(section => ({
        ...section,
        visible: canViewMenuEntry(user, menuPermissions, `section:${section.id}`),
        items: section.items.filter(item => {
          if (item.adminOnly && !canAccessAdminMode(user)) return false
          return canViewMenuEntry(user, menuPermissions, `item:${item.id}`)
        }),
      }))
      .filter(section => section.visible)
  ), [menuPermissions, user])

  useEffect(() => {
    setMenuOpen(false)
    setSettingsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function handleOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
      if (settingsRef.current && !settingsRef.current.contains(event.target)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [isMobile])

  useEffect(() => {
    let ignore = false
    async function loadBadges() {
      try {
        const result = await api('/api/badges-summary')
        if (!ignore) setBadges(result || { notification_count: 0, chat_count: 0, friend_request_count: 0, menu_count: 0 })
      } catch (_) {
        if (!ignore) setBadges({ notification_count: 0, chat_count: 0, friend_request_count: 0, menu_count: 0 })
      }
    }
    loadBadges()
    const timer = window.setInterval(loadBadges, 15000)
    return () => {
      ignore = true
      window.clearInterval(timer)
    }
  }, [location.pathname, user?.id])

  function renderBottomLabel(to, label) {
    const count = to === '/chats' ? Number(badges.chat_count || 0) : to === '/friends' ? Number(badges.friend_request_count || 0) : 0
    return (
      <span className="bottom-nav-label-wrap">
        <span>{label}</span>
        {count > 0 && <span className="bottom-nav-badge">{count > 99 ? '99+' : count}</span>}
      </span>
    )
  }

  return (
    <div className={`app-shell${isScheduleView ? ' schedule-wide' : ''}`}>
      <header className="topbar topbar-fixed">
        <div className="topbar-left">
          <div className="dropdown-wrap" ref={menuRef}>
            <button type="button" className="ghost icon-button menu-button-with-badge" onClick={() => setMenuOpen(v => !v)}>
              메뉴
              {Number(badges.menu_count || 0) > 0 && <span className="notification-badge menu-badge">{badges.menu_count > 99 ? '99+' : badges.menu_count}</span>}
            </button>
            {menuOpen && (
              <div className="dropdown-menu left menu-category-dropdown">
                {topMenuSections.map(section => (
                  <div key={section.id} className="menu-category-block">
                    <div className="menu-category-title">{section.label}</div>
                    {section.items.length === 0 ? (
                      <div className="dropdown-item muted menu-category-empty">표시 가능한 메뉴가 없습니다.</div>
                    ) : section.items.map(item => (
                      <button key={item.id} type="button" className="dropdown-item menu-category-item" onClick={() => {
                        navigate(item.path)
                        setMenuOpen(false)
                      }}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))}
                {isAdministrator(user) && (
                  <div className="menu-category-footer">
                    <button type="button" className="dropdown-item menu-permission-button" onClick={() => {
                      navigate('/menu-permissions')
                      setMenuOpen(false)
                    }}>
                      메뉴권한
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="page-heading">{pageTitle(location.pathname)}</div>
        <div className="topbar-right">
          <button type="button" className={location.pathname === '/notifications' ? 'ghost icon-button active-icon notification-icon-button' : 'ghost icon-button notification-icon-button'} onClick={() => navigate('/notifications')} aria-label="알림">
            <span className="notification-bell">🔔</span>
            {Number(badges.notification_count || 0) > 0 && <span className="notification-badge">{badges.notification_count > 99 ? '99+' : badges.notification_count}</span>}
          </button>
          <div className="dropdown-wrap" ref={settingsRef}>
            <button type="button" className={location.pathname === '/settings' ? 'ghost icon-button active-icon' : 'ghost icon-button'} onClick={() => setSettingsOpen(v => !v)}>
              설정
            </button>
            {settingsOpen && (
              <div className="dropdown-menu right">
                {canAccessAdminMode(user) && <button type="button" className="dropdown-item" onClick={() => navigate('/admin-mode')}>관리자모드</button>}
                <button type="button" className="dropdown-item" onClick={() => navigate('/profile')}>프로필</button>
                <button type="button" className="dropdown-item" onClick={() => navigate('/settings')}>설정</button>
                <button type="button" className="dropdown-item danger-text" onClick={onLogout}>로그아웃</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className={`page-container${isScheduleView ? ' schedule-wide' : ''}`}>{children}</main>
      <nav className="bottom-nav">
        {bottomLinks.map(([to, label]) => (
          <Link key={to} className={isBottomActive(to) ? 'bottom-nav-item active' : 'bottom-nav-item'} to={to}>
            {renderBottomLabel(to, label)}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function AuthPage({ onLogin }) {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState({ email: 'admin@example.com', password: 'admin1234' })
  const [autoLogin, setAutoLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/api/demo-accounts').then(setAccounts).catch(() => {})
  }, [])
  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setSession(data.access_token, data.user, true)
      onLogin(data.user)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>로그인</h1>
        <p className="muted">로그인 후 앱 메인 화면으로 이동합니다.</p>
        <form onSubmit={submit} className="stack">
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="아이디" autoComplete="username" />
          <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="비밀번호" autoComplete="current-password" />
          <div className="muted auto-login-check">로그인 상태는 로그아웃 전까지 유지됩니다.</div>
          <button disabled={loading}>{loading ? '로그인 중...' : '로그인'}</button>
          {error && <div className="error">{error}</div>}
        </form>
        <div className="auth-guest-quote-box">
          <div className="auth-guest-quote-title">로그인 없이도 견적 요청이 가능합니다.</div>
          <div className="auth-guest-quote-help">이름과 연락처만 먼저 입력한 뒤, 당일이사 또는 짐보관이사를 선택해서 바로 견적을 접수할 수 있습니다.</div>
          <Link to="/guest-quote" className="auth-guest-quote-button">로그인 없이 견적 받기</Link>
        </div>
        <div className="inline-actions auth-link-row auth-link-row-three">
          <Link to="/signup" className="ghost-link">회원가입</Link>
          <Link to="/find-account" className="ghost-link">계정찾기</Link>
          <Link to="/reset-password" className="ghost-link">비밀번호 재설정</Link>
        </div>
        <div className="demo-box">
          <strong>등록 계정</strong>
          <div className="demo-list demo-list-accounts">
            {accounts.map(acc => (
              <button
                key={acc.email}
                className="demo-item demo-item-account"
                onClick={() => setForm({ email: acc.email, password: Number(acc.grade || 6) === 1 ? 'admin1234' : 'demo1234' })}
              >
                <span className="demo-account-group">{acc.group_number || '0'}</span>
                <span className="demo-account-name">{acc.name || acc.nickname || '-'}</span>
                <span className="demo-account-id">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function SignupPage({ onLogin }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '',
    password: '',
    nickname: '',
    gender: '',
    birth_year: '',
    region: '',
    phone: '',
    recovery_email: '',
    vehicle_number: '',
    branch_no: '',
  })
  const [error, setError] = useState('')
  const branchOptions = BRANCH_NUMBER_OPTIONS

  async function submit(e) {
    e.preventDefault()
    setError('')
    const requiredFields = [
      ['아이디', form.email],
      ['비밀번호', form.password],
      ['닉네임', form.nickname],
      ['성별', form.gender],
      ['생년', form.birth_year],
      ['지역', form.region],
      ['연락처', form.phone],
      ['복구 이메일', form.recovery_email],
    ]
    const missing = requiredFields.filter(([, value]) => !String(value || '').trim()).map(([label]) => label)
    if (missing.length) {
      setError(`다음 필수 항목을 입력해 주세요: ${missing.join(', ')}`)
      return
    }
    try {
      const payload = {
        ...form,
        email: form.email.trim(),
        password: form.password.trim(),
        nickname: form.nickname.trim(),
        gender: form.gender.trim(),
        birth_year: Number(form.birth_year),
        region: form.region.trim(),
        phone: form.phone.trim(),
        recovery_email: form.recovery_email.trim(),
        vehicle_number: form.vehicle_number.trim(),
        branch_no: normalizeBranchNo(form.branch_no),
      }
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSession(data.access_token, data.user, true)
      onLogin(data.user)
      navigate('/')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>회원가입</h1>
        <form onSubmit={submit} className="stack">
          <input type="text" placeholder="아이디 *" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          <input type="password" placeholder="비밀번호 *" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
          <input placeholder="닉네임 *" value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} required />
          <input placeholder="성별 *" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} required />
          <input type="number" placeholder="생년 *" value={form.birth_year} onChange={e => setForm({ ...form, birth_year: e.target.value })} required />
          <input placeholder="지역 *" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} required />
          <input placeholder="연락처 *" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required />
          <input type="email" placeholder="복구 이메일 *" value={form.recovery_email} onChange={e => setForm({ ...form, recovery_email: e.target.value })} required />
          <input placeholder="차량번호 (선택)" value={form.vehicle_number} onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />
          <select value={form.branch_no} onChange={e => setForm({ ...form, branch_no: e.target.value })}>
            <option value="">호점 선택 (선택)</option>
            {branchOptions.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
          </select>
          <button>가입 후 로그인</button>
          {error && <div className="error">{error}</div>}
        </form>
        <Link to="/login" className="ghost-link">로그인으로 돌아가기</Link>
      </section>
    </div>
  )
}

function FindAccountPage() {
  const [form, setForm] = useState({ nickname: '', phone: '', recovery_email: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const data = await api('/api/auth/find-account', {
        method: 'POST',
        body: JSON.stringify({
          nickname: form.nickname.trim(),
          phone: form.phone.trim(),
          recovery_email: form.recovery_email.trim(),
        }),
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h1>계정찾기</h1>
        <p className="muted">닉네임, 연락처, 복구 이메일이 모두 일치하면 등록된 아이디를 확인할 수 있습니다.</p>
        <form onSubmit={submit} className="stack">
          <input placeholder="닉네임" value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} required />
          <input placeholder="연락처" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required />
          <input type="email" placeholder="복구 이메일" value={form.recovery_email} onChange={e => setForm({ ...form, recovery_email: e.target.value })} required />
          <button disabled={loading}>{loading ? '조회 중...' : '계정 찾기'}</button>
        </form>
        {result && <div className="success">확인된 아이디: <strong>{result.account_id}</strong></div>}
        {error && <div className="error">{error}</div>}
        <Link to="/login" className="ghost-link">로그인으로 돌아가기</Link>
      </section>
    </div>
  )
}

function ResetPasswordPage() {
  const [requestForm, setRequestForm] = useState({ recovery_email: '' })
  const [confirmForm, setConfirmForm] = useState({ recovery_email: '', code: '', email: '', new_password: '' })
  const [demoCode, setDemoCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function requestCode(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const data = await api('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify(requestForm),
      })
      setDemoCode(data.demo_code || '')
      setConfirmForm({ ...confirmForm, recovery_email: requestForm.recovery_email })
      setMessage(`복구 코드가 발급되었습니다.${data.demo_code ? ` 데모 코드: ${data.demo_code}` : ''}`)
    } catch (err) {
      setError(err.message)
    }
  }
  async function confirm(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const data = await api('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify(confirmForm),
      })
      setMessage(data.message)
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-card wide">
        <h1>비밀번호 재설정</h1>
        <div className="grid2">
          <form onSubmit={requestCode} className="stack">
            <h3>1. 복구 코드 요청</h3>
            <input placeholder="복구 이메일" value={requestForm.recovery_email} onChange={e => setRequestForm({ recovery_email: e.target.value })} />
            <button>코드 요청</button>
            {demoCode && <div className="info">데모 코드: {demoCode}</div>}
          </form>
          <form onSubmit={confirm} className="stack">
            <h3>2. 코드 확인 후 비밀번호 변경</h3>
            <input placeholder="복구 이메일" value={confirmForm.recovery_email} onChange={e => setConfirmForm({ ...confirmForm, recovery_email: e.target.value })} />
            <input placeholder="인증 코드" value={confirmForm.code} onChange={e => setConfirmForm({ ...confirmForm, code: e.target.value })} />
            <input placeholder="로그인 아이디" value={confirmForm.email} onChange={e => setConfirmForm({ ...confirmForm, email: e.target.value })} />
            <input type="password" placeholder="새 비밀번호" value={confirmForm.new_password} onChange={e => setConfirmForm({ ...confirmForm, new_password: e.target.value })} />
            <button>비밀번호 변경</button>
          </form>
        </div>
        {message && <div className="success">{message}</div>}
      {readOnly && <div className="card muted">일반 등급은 스케줄 화면을 관람만 할 수 있습니다.</div>}
        {error && <div className="error">{error}</div>}
        <Link to="/login" className="ghost-link">로그인으로 이동</Link>
      </section>
    </div>
  )
}

function WorkdayHistoryPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    async function loadLogs() {
      try {
        const response = await api('/api/workday/logs')
        if (!ignore) setItems(Array.isArray(response?.items) ? response.items : [])
      } catch (err) {
        if (!ignore) setError(err.message || '기록을 불러오지 못했습니다.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    loadLogs()
    return () => { ignore = true }
  }, [])

  return (
    <div className="stack-page">
      <section className="card">
        <div className="between align-center">
          <h2>일시작종료</h2>
          <div className="muted small-text">일자별 시작/종료 기록</div>
        </div>
        {loading && <div className="muted">불러오는 중...</div>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && (
          <div className="list">
            {items.map(item => (
              <div key={`${item.work_date}-${item.id}`} className="list-item block">
                <div className="between">
                  <strong>{item.work_date}</strong>
                  <span className="muted">{item.end_time ? '종료완료' : item.start_time ? '진행중' : '대기'}</span>
                </div>
                <div className="admin-summary-line admin-summary-line-primary">
                  <span>[시작 {item.start_time || '-'}]</span>
                  <span>[종료 {item.end_time || '-'}]</span>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="muted">기록이 없습니다.</div>}
          </div>
        )}
      </section>
    </div>
  )
}

function HomePage() {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const [summary, setSummary] = useState(null)
  const [quickState, setQuickState] = useState(() => getQuickActionState(currentUser?.id))
  const [editingQuick, setEditingQuick] = useState(false)
  const [homeSettingsOpen, setHomeSettingsOpen] = useState(false)
  const [homeSettings, setHomeSettings] = useState(() => getHomeSettings(currentUser?.id))
  const [holdProgress, setHoldProgress] = useState(false)
  const [workdayStatus, setWorkdayStatus] = useState(null)
  const holdTimerRef = useRef(null)

  useEffect(() => {
    async function load() {
      const [friends, upcoming] = await Promise.all([
        api('/api/friends'),
        api('/api/home/upcoming-schedules'),
      ])
      let pendingMaterialsSettlementCount = 0
      try {
        if (Number(currentUser?.grade || 6) <= 2) {
          const materials = await api('/api/materials/overview')
          pendingMaterialsSettlementCount = Array.isArray(materials?.pending_requests) ? materials.pending_requests.length : 0
        }
      } catch (_) {}
      setSummary({
        friendCount: friends.friends.length,
        requestCount: friends.received_requests.length,
        pendingMaterialsSettlementCount,
        upcomingCount: (upcoming.days || []).reduce((acc, day) => acc + (day.items?.length || 0), 0),
        upcomingDays: upcoming.days || [],
      })
    }
    load().catch(() => {})
  }, [])

  useEffect(() => {
    setQuickState(getQuickActionState(currentUser?.id))
    setHomeSettings(getHomeSettings(currentUser?.id))
  }, [currentUser?.id])

  useEffect(() => {
    let ignore = false
    async function loadWorkdayStatus() {
      try {
        const response = await api('/api/workday/status')
        if (ignore) return
        const item = response?.today || null
        setWorkdayStatus(response || null)
        if (item) {
          updateHomeSettings({
            ...getHomeSettings(currentUser?.id),
            activeWorkState: {
              started: !!response?.active,
              updatedAt: item.updated_at || item.ended_at || item.started_at || '',
              startTime: item.start_time || '',
              endTime: item.end_time || '',
              workDate: item.work_date || '',
            },
          })
        }
      } catch (_) {}
    }
    loadWorkdayStatus()
    return () => { ignore = true }
  }, [currentUser?.id])

  function updateQuickState(nextState) {
    setQuickState(nextState)
    saveQuickActionState(currentUser?.id, nextState)
  }

  function updateHomeSettings(nextState) {
    setHomeSettings(nextState)
    saveHomeSettings(currentUser?.id, nextState)
  }

  function moveHomeSection(sectionId, direction) {
    const order = [...homeSettings.sectionOrder]
    const index = order.indexOf(sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    updateHomeSettings({ ...homeSettings, sectionOrder: order })
  }

  function startHoldAction() {
    if (!homeSettings.workday.enabled) return
    const holdMs = Math.max(1, Number(homeSettings.workday.holdSeconds || HOME_HOLD_SECONDS_DEFAULT)) * 1000
    setHoldProgress(true)
    holdTimerRef.current = window.setTimeout(async () => {
      const nextAction = homeSettings.activeWorkState?.started ? 'end' : 'start'
      try {
        const response = await api('/api/workday/toggle', { method: 'POST', body: JSON.stringify({ action: nextAction }) })
        const item = response?.item || {}
        const nextState = {
          ...homeSettings,
          activeWorkState: {
            started: nextAction === 'start',
            updatedAt: item.updated_at || item.ended_at || item.started_at || new Date().toISOString(),
            startTime: item.start_time || '',
            endTime: item.end_time || '',
            workDate: item.work_date || '',
          },
        }
        updateHomeSettings(nextState)
        setWorkdayStatus({ active: nextAction === 'start', today: item })
        window.alert(nextAction === 'start' ? '일시작 처리되었습니다.' : '일종료 처리되었습니다.')
      } catch (err) {
        window.alert(err.message || '일시작/일종료 저장 중 오류가 발생했습니다.')
      } finally {
        setHoldProgress(false)
      }
    }, holdMs)
  }

  function stopHoldAction() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHoldProgress(false)
  }

  function moveQuickAction(index, direction) {
    const next = [...quickState.active]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    updateQuickState({ ...quickState, active: next })
  }

  function archiveQuickAction(id) {
    updateQuickState({ active: quickState.active.filter(item => item !== id), archived: [...quickState.archived, id] })
  }

  function restoreQuickAction(id) {
    if (quickState.active.length >= 9) {
      window.alert('빠른 확인은 최대 9개까지 배치할 수 있습니다.')
      return
    }
    updateQuickState({ active: [...quickState.active, id], archived: quickState.archived.filter(item => item !== id) })
  }

  function handleQuickActionClick(item) {
    if (item.id === 'materialsPendingSettlement') {
      navigate('/materials?tab=requesters')
      return
    }
    if (item.path?.includes('?')) {
      navigate(item.path)
      return
    }
    if (item.path) {
      navigate(item.path)
      return
    }
    window.alert(`${item.label} 기능은 다음 업데이트에서 연결할 예정입니다.`)
  }

  const quickLibrary = useMemo(() => {
    const base = [...QUICK_ACTION_LIBRARY]
    if (Number(currentUser?.grade || 6) <= 2 && Number(summary?.pendingMaterialsSettlementCount || 0) > 0) {
      base.push({ id: 'materialsPendingSettlement', label: '자재\n신청목록', kind: 'metric', metricKey: 'pendingMaterialsSettlementCount', path: '/materials' })
    }
    return base
  }, [currentUser?.grade, summary?.pendingMaterialsSettlementCount])

  const activeQuickItems = useMemo(() => {
    const activeIds = [...quickState.active]
    if (Number(currentUser?.grade || 6) <= 2 && Number(summary?.pendingMaterialsSettlementCount || 0) > 0 && !activeIds.includes('materialsPendingSettlement')) {
      activeIds.unshift('materialsPendingSettlement')
    }
    return activeIds.map(id => quickLibrary.find(item => item.id === id)).filter(Boolean)
  }, [quickState.active, quickLibrary, currentUser?.grade, summary?.pendingMaterialsSettlementCount])
  const archivedQuickItems = useMemo(() => quickState.archived.map(id => quickLibrary.find(item => item.id === id)).filter(Boolean), [quickState.archived, quickLibrary])

  const homeSections = useMemo(() => {
    const sections = {
      quick: (
        <section className="card" key="quick">
          <div className="between quick-check-head">
            <h2>빠른 확인</h2>
            <div className="inline-actions wrap">
              <div className="dropdown-wrap">
                <button type="button" className="small ghost" onClick={() => setHomeSettingsOpen(v => !v)}>설정</button>
                {homeSettingsOpen && (
                  <div className="dropdown-menu right home-settings-menu">
                    <div className="menu-category-block">
                      <div className="menu-category-title">홈 구조 변경</div>
                      <div className="stack compact">
                        <strong className="small-text">항목위치변경</strong>
                        {homeSettings.sectionOrder.map(sectionId => (
                          <div key={`section-order-${sectionId}`} className="quick-edit-row">
                            <span>{sectionId === 'quick' ? '빠른 확인' : sectionId === 'workday' ? '일시작~일종료' : '다가오는 일정'}</span>
                            <div className="inline-actions wrap end">
                              <button type="button" className="small ghost" onClick={() => moveHomeSection(sectionId, -1)}>위로</button>
                              <button type="button" className="small ghost" onClick={() => moveHomeSection(sectionId, 1)}>아래로</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="menu-category-block">
                      <div className="menu-category-title">시작종료설정</div>
                      <div className="stack compact">
                        <label>누르는 시간 : <input type="number" min="1" max="10" value={Number(homeSettings.workday.holdSeconds || HOME_HOLD_SECONDS_DEFAULT)} onChange={e => updateHomeSettings({ ...homeSettings, workday: { ...homeSettings.workday, holdSeconds: Math.max(1, Math.min(10, Number(e.target.value || HOME_HOLD_SECONDS_DEFAULT))) } })} /></label>
                        <label>
                          <select value={homeSettings.workday.enabled ? '사용' : '미사용'} onChange={e => updateHomeSettings({ ...homeSettings, workday: { ...homeSettings.workday, enabled: e.target.value === '사용' } })}>
                            <option value="사용">사용</option>
                            <option value="미사용">미사용</option>
                          </select>
                        </label>
                        <label className="check"><input type="checkbox" checked={!!homeSettings.workday.hideOnHome} onChange={e => updateHomeSettings({ ...homeSettings, workday: { ...homeSettings.workday, hideOnHome: e.target.checked } })} /> 홈 화면 제외</label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="small ghost" onClick={() => setEditingQuick(v => !v)}>{editingQuick ? '편집닫기' : '편집'}</button>
            </div>
          </div>
          <div className="quick-check-grid">
            {activeQuickItems.map(item => {
              const isPending = item.kind === 'placeholder'
              const valueText = item.kind === 'metric'
                ? String(summary?.[item.metricKey] ?? '-')
                : item.kind === 'link'
                  ? '바로가기'
                  : '준비중'
              const multiline = item.id === 'materialsPendingSettlement'
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`quick-check-card ${isPending ? 'is-pending' : item.kind === 'link' ? 'is-link' : 'is-metric'}`.trim()}
                  onClick={() => handleQuickActionClick(item)}
                >
                  <strong>{valueText}</strong>
                  <span style={multiline ? { whiteSpace: 'pre-line' } : undefined}>{item.label}</span>
                </button>
              )
            })}
          </div>
          {editingQuick && (
            <div className="quick-check-editor card inset-card">
              <strong>빠른 확인 편집</strong>
              <div className="stack compact">
                {activeQuickItems.map((item, index) => (
                  <div key={`active-${item.id}`} className="quick-edit-row">
                    <span>{String(item.label || '').replace('\n', ' ')}</span>
                    <div className="inline-actions wrap end">
                      <button type="button" className="small ghost" onClick={() => moveQuickAction(index, -1)}>위로</button>
                      <button type="button" className="small ghost" onClick={() => moveQuickAction(index, 1)}>아래로</button>
                      {item.id !== 'materialsPendingSettlement' && <button type="button" className="small ghost" onClick={() => archiveQuickAction(item.id)}>보관</button>}
                    </div>
                  </div>
                ))}
                {activeQuickItems.length === 0 && <div className="muted">배치된 버튼이 없습니다.</div>}
              </div>
              <div className="friends-section-label">보관함</div>
              <div className="stack compact">
                {archivedQuickItems.map(item => (
                  <div key={`archived-${item.id}`} className="quick-edit-row">
                    <span>{String(item.label || '').replace('\n', ' ')}</span>
                    <button type="button" className="small" onClick={() => restoreQuickAction(item.id)}>추가</button>
                  </div>
                ))}
                {archivedQuickItems.length === 0 && <div className="muted">보관된 버튼이 없습니다.</div>}
              </div>
            </div>
          )}
        </section>
      ),
      workday: (!homeSettings.workday.hideOnHome && homeSettings.workday.enabled) ? (
        <section className="card" key="workday">
          <div className="between align-center">
            <h2>일시작 ~ 일종료</h2>
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" onClick={() => navigate('/workday-history')}>기록보기</button>
              <div className="muted small-text">{Number(homeSettings.workday.holdSeconds || HOME_HOLD_SECONDS_DEFAULT)}초 이상 길게 누르기</div>
            </div>
          </div>
          <div className="stack compact">
            <button
              type="button"
              className={`quick-check-card workday-hold-card ${holdProgress ? 'holding' : ''} ${homeSettings.activeWorkState?.started ? 'workday-active' : 'workday-idle'}`.trim()}
              onMouseDown={startHoldAction}
              onMouseUp={stopHoldAction}
              onMouseLeave={stopHoldAction}
              onTouchStart={startHoldAction}
              onTouchEnd={stopHoldAction}
              onTouchCancel={stopHoldAction}
            >
              <strong>{homeSettings.activeWorkState?.started ? '일종료' : '일시작'}</strong>
              <span>{homeSettings.activeWorkState?.started ? '현재 근무 진행중' : '현재 근무 대기중'}</span>
            </button>
            {(homeSettings.activeWorkState?.startTime || homeSettings.activeWorkState?.endTime) && (
              <div className="admin-summary-line admin-summary-line-primary">
                <span>[시작 {homeSettings.activeWorkState.startTime || '-'}]</span>
                <span>[종료 {homeSettings.activeWorkState.endTime || '-'}]</span>
              </div>
            )}
            {homeSettings.activeWorkState?.updatedAt && <div className="muted small-text">최근 변경: {new Date(homeSettings.activeWorkState.updatedAt).toLocaleString('ko-KR')}</div>}
          </div>
        </section>
      ) : null,
      upcoming: (
        <section className="card" key="upcoming">
          <div className="between"><h2>다가오는 일정</h2><Link to="/work-schedule" className="ghost-link">스케줄로 이동</Link></div>
          <div className="list upcoming-schedule-list">
            {(summary?.upcomingDays || []).map(day => (
              <div className="list-item block upcoming-day-group" key={day.date}>
                <strong>{day.label}</strong>
                <div className="stack compact">
                  {day.items.map((item, index) => (
                    <div key={`${day.date}-${index}`} className="upcoming-line">
                      <div> - [{item.time_text}] [{item.customer_name}] [{item.representative_text}] [{item.staff_text}] [{item.start_address}]</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {summary && summary.upcomingDays.length === 0 && <div className="muted">내 계정에 배정된 다가오는 스케줄이 없습니다.</div>}
            {!summary && <div className="muted">불러오는 중...</div>}
          </div>
        </section>
      ),
    }
    return homeSettings.sectionOrder.map(sectionId => sections[sectionId]).filter(Boolean)
  }, [activeQuickItems, archivedQuickItems, currentUser?.grade, editingQuick, holdProgress, homeSettings, homeSettingsOpen, quickState.active, summary])

  return (
    <div className="stack-page">
      {homeSections}
    </div>
  )
}

function ProfilePage({ onUserUpdate }) {
  const [form, setForm] = useState(null)
  const [originalForm, setOriginalForm] = useState(null)
  const [message, setMessage] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const branchOptions = BRANCH_NUMBER_OPTIONS

  useEffect(() => {
    api('/api/profile').then(data => {
      const nextForm = { ...data.user, new_password: '' }
      setForm(nextForm)
      setOriginalForm(nextForm)
    })
  }, [])

  if (!form) return <div className="card">불러오는 중...</div>

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function profileFieldValueLabel(key, value) {
    if (key === 'branch_no') {
      return branchOptions.find(option => Number(option.value) === Number(normalizeBranchNo(value)))?.label || String(value || '-')
    }
    if (key === 'birth_year') return String(value || '')
    if (key === 'interests') {
      if (Array.isArray(value)) return value.join(', ') || '-'
      return String(value || '').trim() || '-'
    }
    return String(value ?? '').trim() || '-'
  }

  function buildProfileChangeSummary(payload) {
    const source = originalForm || {}
    const rows = []
    const fieldLabels = [
      ['email', '아이디'],
      ['nickname', '닉네임'],
      ['phone', '연락처'],
      ['recovery_email', '복구이메일'],
      ['region', '지역'],
      ['gender', '성별'],
      ['birth_year', '출생연도'],
      ['vehicle_number', '차량번호'],
      ['branch_no', '호점'],
      ['marital_status', '결혼여부'],
      ['resident_address', '주민등록주소'],
      ['business_name', '상호'],
      ['business_number', '사업자번호'],
      ['business_type', '업태'],
      ['business_item', '종목'],
      ['business_address', '사업장주소'],
      ['bank_name', '은행명'],
      ['bank_account', '계좌번호'],
      ['mbti', 'MBTI'],
      ['google_email', '구글이메일'],
      ['resident_id', '주민번호'],
      ['one_liner', '한줄소개'],
      ['bio', '프로필소개'],
      ['photo_url', '프로필이미지URL'],
      ['interests', '관심사'],
    ]
    for (const [key, label] of fieldLabels) {
      const beforeValue = key === 'branch_no' ? normalizeBranchNo(source[key]) : source[key]
      const afterValue = key === 'branch_no' ? normalizeBranchNo(payload[key]) : payload[key]
      const beforeLabel = profileFieldValueLabel(key, beforeValue)
      const afterLabel = profileFieldValueLabel(key, afterValue)
      if (beforeLabel !== afterLabel) {
        rows.push(`- ${label}를 [${beforeLabel}]에서 [${afterLabel}]로 변경합니다.`)
      }
    }
    if (String(payload.new_password || '').trim()) {
      rows.push(`- 비밀번호를 [현재 값 확인 불가]에서 [${String(payload.new_password)}]로 변경합니다.`)
    }
    return rows
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      email: form.email || '',
      nickname: form.nickname || '',
      region: form.region || '서울',
      bio: form.bio || '',
      one_liner: form.one_liner || '',
      interests: Array.isArray(form.interests)
        ? form.interests
        : String(form.interests || '').split(',').map(v => v.trim()).filter(Boolean),
      photo_url: form.photo_url || '',
      phone: form.phone || '',
      recovery_email: form.recovery_email || '',
      gender: form.gender || '',
      birth_year: Number(form.birth_year || 1990),
      vehicle_number: form.vehicle_number || '',
      branch_no: normalizeBranchNo(form.branch_no),
      marital_status: form.marital_status || '',
      resident_address: form.resident_address || '',
      business_name: form.business_name || '',
      business_number: form.business_number || '',
      business_type: form.business_type || '',
      business_item: form.business_item || '',
      business_address: form.business_address || '',
      bank_account: form.bank_account || '',
      bank_name: form.bank_name || '',
      mbti: form.mbti || '',
      google_email: form.google_email || '',
      resident_id: form.resident_id || '',
      new_password: form.new_password || '',
    }
    const changeSummary = buildProfileChangeSummary(payload)
    if (!changeSummary.length) {
      setMessage('변경된 항목이 없습니다.')
      return
    }
    const confirmed = window.confirm(`아래 내용으로 프로필을 변경하시겠습니까?\n\n${changeSummary.join('\n')}`)
    if (!confirmed) return
    const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    const nextForm = { ...data.user, new_password: '' }
    setForm(nextForm)
    setOriginalForm(nextForm)
    onUserUpdate(data.user)
    setMessage('프로필이 저장되었습니다.')
  }

  async function saveLocation() {
    const data = await api('/api/profile/location', {
      method: 'POST',
      body: JSON.stringify({ latitude: Number(form.latitude), longitude: Number(form.longitude), region: form.region }),
    })
    setForm(prev => ({ ...data.user, new_password: prev.new_password || '' }))
    onUserUpdate(data.user)
    setMessage('위치가 저장되었습니다.')
  }

  async function handleProfilePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    setMessage('')
    try {
      const uploaded = await uploadFile(file, 'profile')
      setForm(prev => ({ ...prev, photo_url: uploaded.url }))
      setMessage('프로필 이미지가 업로드되었습니다. 저장 버튼을 눌러 반영하세요.')
    } catch (err) {
      setMessage(err.message)
    } finally {
      setUploadingPhoto(false)
      e.target.value = ''
    }
  }

  return (
    <div className="card profile-page-card">
      <div className="profile-header">
        <div>
          <h2>프로필</h2>
          <div className="muted">설정 &gt; 프로필에서 계정 정보를 수정할 수 있습니다.</div>
        </div>
        <div className="profile-badges">
          <span className="profile-badge">{form.grade_label || '일반'}</span>
          <span className="profile-badge ghost">{branchDisplayLabel(form.branch_no, '본점/미지정')}</span>
        </div>
      </div>

      <form onSubmit={save} className="profile-form-layout">
        <section className="profile-section">
          <h3>기본 계정 정보</h3>
          <div className="profile-grid two">
            <label className="field-block">
              <span>아이디</span>
              <input value={form.email || ''} onChange={e => updateField('email', e.target.value)} placeholder="아이디" />
            </label>
            <label className="field-block">
              <span>새 비밀번호</span>
              <input type="password" value={form.new_password || ''} onChange={e => updateField('new_password', e.target.value)} placeholder="변경 시에만 입력" />
            </label>
            <label className="field-block">
              <span>이름</span>
              <input value={form.nickname || ''} onChange={e => updateField('nickname', e.target.value)} placeholder="이름" />
            </label>
            <label className="field-block">
              <span>직급</span>
              <select value={form.position_title || ''} disabled className="readonly-input">
                <option value="">미지정</option>
                {POSITION_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="field-block">
              <span>권한</span>
              <input value={form.grade_label || ''} readOnly className="readonly-input" />
            </label>
            <label className="field-block">
              <span>호점</span>
              <select value={isAssignedBranchNo(form.branch_no) ? String(form.branch_no) : ''} onChange={e => updateField('branch_no', e.target.value)} disabled={Number(form.grade || 6) !== 1} className={Number(form.grade || 6) !== 1 ? 'readonly-input' : ''}>
                <option value="">본점 또는 미지정</option>
                {branchOptions.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
              </select>
            </label>
            <label className="field-block">
              <span>연락처</span>
              <input value={form.phone || ''} onChange={e => updateField('phone', e.target.value)} placeholder="연락처" />
            </label>
            <label className="field-block">
              <span>복구 이메일</span>
              <input value={form.recovery_email || ''} onChange={e => updateField('recovery_email', e.target.value)} placeholder="복구 이메일" />
            </label>
            <label className="field-block">
              <span>구글 아이디</span>
              <input value={form.google_email || ''} onChange={e => updateField('google_email', e.target.value)} placeholder="구글 아이디" />
            </label>
          </div>
        </section>

        <section className="profile-section">
          <h3>개인 정보</h3>
          <div className="profile-grid three">
            <label className="field-block">
              <span>생년월일</span>
              <input value={form.resident_id || ''} onChange={e => updateField('resident_id', e.target.value)} placeholder="예: 950109" />
            </label>
            <label className="field-block">
              <span>출생연도</span>
              <input type="number" value={form.birth_year || 1990} onChange={e => updateField('birth_year', Number(e.target.value))} placeholder="출생연도" />
            </label>
            <label className="field-block">
              <span>결혼</span>
              <input value={form.marital_status || ''} onChange={e => updateField('marital_status', e.target.value)} placeholder="결혼 여부" />
            </label>
            <label className="field-block">
              <span>성별</span>
              <input value={form.gender || ''} onChange={e => updateField('gender', e.target.value)} placeholder="성별" />
            </label>
            <label className="field-block">
              <span>MBTI</span>
              <input value={form.mbti || ''} onChange={e => updateField('mbti', e.target.value)} placeholder="MBTI" />
            </label>
            <label className="field-block">
              <span>지역</span>
              <input value={form.region || ''} onChange={e => updateField('region', e.target.value)} placeholder="지역" />
            </label>
          </div>
          <label className="field-block">
            <span>집주소</span>
            <textarea rows={3} value={form.resident_address || ''} onChange={e => updateField('resident_address', e.target.value)} placeholder="집주소" />
          </label>
        </section>

        <section className="profile-section">
          <h3>사업자 정보</h3>
          <div className="profile-grid two">
            <label className="field-block">
              <span>상호명</span>
              <input value={form.business_name || ''} onChange={e => updateField('business_name', e.target.value)} placeholder="상호명" />
            </label>
            <label className="field-block">
              <span>사업자 등록번호</span>
              <input value={form.business_number || ''} onChange={e => updateField('business_number', e.target.value)} placeholder="사업자 등록번호" />
            </label>
            <label className="field-block">
              <span>업태</span>
              <textarea rows={3} value={form.business_type || ''} onChange={e => updateField('business_type', e.target.value)} placeholder="업태" />
            </label>
            <label className="field-block">
              <span>종목</span>
              <textarea rows={3} value={form.business_item || ''} onChange={e => updateField('business_item', e.target.value)} placeholder="종목" />
            </label>
            <label className="field-block">
              <span>차량 번호</span>
              <input value={form.vehicle_number || ''} onChange={e => updateField('vehicle_number', e.target.value)} placeholder="차량 번호" />
            </label>
            <label className="field-block">
              <span>은행</span>
              <input value={form.bank_name || ''} onChange={e => updateField('bank_name', e.target.value)} placeholder="은행" />
            </label>
            <label className="field-block">
              <span>계좌번호</span>
              <input value={form.bank_account || ''} onChange={e => updateField('bank_account', e.target.value)} placeholder="계좌번호" />
            </label>
            <label className="field-block">
              <span>한줄 소개</span>
              <input value={form.one_liner || ''} onChange={e => updateField('one_liner', e.target.value)} placeholder="한줄 소개" />
            </label>
          </div>
          <label className="field-block">
            <span>사업장 소재지</span>
            <textarea rows={3} value={form.business_address || ''} onChange={e => updateField('business_address', e.target.value)} placeholder="사업장 소재지" />
          </label>
        </section>

        <section className="profile-section">
          <h3>프로필 표시 정보</h3>
          <div className="profile-grid photo">
            <label className="field-block">
              <span>프로필 소개</span>
              <textarea rows={4} value={form.bio || ''} onChange={e => updateField('bio', e.target.value)} placeholder="프로필 소개" />
            </label>
            <label className="field-block">
              <span>관심사</span>
              <input value={Array.isArray(form.interests) ? form.interests.join(', ') : form.interests || ''} onChange={e => updateField('interests', e.target.value)} placeholder="관심사 (쉼표로 구분)" />
            </label>
            <label className="field-block">
              <span>프로필 이미지 URL</span>
              <input value={form.photo_url || ''} onChange={e => updateField('photo_url', e.target.value)} placeholder="프로필 이미지 URL" />
            </label>
            <label className="field-block">
              <span>프로필 이미지 업로드</span>
              <input type="file" accept="image/*" onChange={handleProfilePhotoUpload} disabled={uploadingPhoto} />
            </label>
            <label className="field-block">
              <span>위도</span>
              <input value={form.latitude || ''} onChange={e => updateField('latitude', e.target.value)} placeholder="위도" />
            </label>
            <label className="field-block">
              <span>경도</span>
              <input value={form.longitude || ''} onChange={e => updateField('longitude', e.target.value)} placeholder="경도" />
            </label>
          </div>
        </section>

        <div className="profile-actions">
          <button type="submit">프로필 저장</button>
          <button type="button" className="ghost" onClick={saveLocation}>위치 저장</button>
        </div>
        {message && <div className="success">{message}</div>}
      </form>
    </div>
  )
}

function FriendsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [users, setUsers] = useState([])
  const [data, setData] = useState({ friends: [], received_requests: [], sent_requests: [] })
  const [profile, setProfile] = useState(null)
  const [follows, setFollows] = useState([])
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const currentUser = getStoredUser()
  const [groupState, setGroupState] = useState(() => getFriendGroupState(currentUser?.id))
  const [openFriendMenuId, setOpenFriendMenuId] = useState(null)
  const [groupPicker, setGroupPicker] = useState({ open: false, friend: null })
  const [groupRenamePicker, setGroupRenamePicker] = useState({ open: false, mode: 'rename' })
  const [editingGroupName, setEditingGroupName] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [profilePreview, setProfilePreview] = useState({ mode: '', friend: null, section: '' })
  const [profileEditForm, setProfileEditForm] = useState(null)
  const [myCoverUrl, setMyCoverUrl] = useState(() => loadProfileCover(getStoredUser()?.id))

  async function load() {
    const [u, f, me, followList] = await Promise.all([
      api('/api/users'),
      api('/api/friends'),
      api('/api/profile'),
      api('/api/follows'),
    ])
    setUsers(u)
    setData(f)
    setProfile(me.user)
    setFollows(followList)
  }

  useEffect(() => { load().catch(() => {}) }, [])
  useEffect(() => {
    const panelName = searchParams.get('panel') || ''
    if (panelName) setPanel(panelName)
  }, [searchParams])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 1400)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    setGroupState(getFriendGroupState(currentUser?.id))
  }, [currentUser?.id])

  async function doAction(fn, successText = '처리되었습니다.') {
    setMessage('')
    await fn()
    setMessage(successText)
    await load()
  }

  function saveGroupState(nextState) {
    setGroupState(nextState)
    saveFriendGroupState(currentUser?.id, nextState)
  }

  const followedIds = useMemo(() => new Set((follows || []).map(item => item.id)), [follows])
  const favorites = useMemo(() => data.friends.filter(friend => followedIds.has(friend.id)), [data.friends, followedIds])
  const normalizedQuery = searchText.trim().toLowerCase()
  const filteredFriends = useMemo(() => {
    if (!normalizedQuery) return data.friends
    return data.friends.filter(friend => [friend.nickname, friend.one_liner, friend.region].join(' ').toLowerCase().includes(normalizedQuery))
  }, [data.friends, normalizedQuery])
  const candidateUsers = useMemo(() => {
    const friendIds = new Set(data.friends.map(item => item.id))
    return users.filter(item => !friendIds.has(item.id) && (!normalizedQuery || [item.nickname, item.one_liner, item.region].join(' ').toLowerCase().includes(normalizedQuery)))
  }, [users, data.friends, normalizedQuery])
  const receivedProfiles = useMemo(() => data.received_requests.map(req => ({ ...req, profile: users.find(item => item.id === req.requester_id) || {} })), [data.received_requests, users])
  const sentRequestIds = useMemo(() => new Set((data.sent_requests || []).filter(req => req.status === 'pending').map(req => req.target_user_id)), [data.sent_requests])
  const groupedFriends = useMemo(() => (groupState.groups || []).map(group => ({ ...group, items: data.friends.filter(friend => String(groupState.assignments?.[friend.id] || '') === String(group.id)) })), [groupState, data.friends])

  useEffect(() => {
    function closeMenus(event) {
      if (!event.target.closest('.dropdown-wrap.friend-inline-wrap')) setOpenFriendMenuId(null)
      if (!event.target.closest('.dropdown-wrap.friends-main-menu')) setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenus)
    document.addEventListener('touchstart', closeMenus)
    return () => {
      document.removeEventListener('mousedown', closeMenus)
      document.removeEventListener('touchstart', closeMenus)
    }
  }, [])

  function goDirectChat(targetId) {
    navigate(`/chats/direct/${targetId}`)
  }

  async function toggleFavorite(item) {
    const active = followedIds.has(item.id)
    if (active) {
      const ok = window.confirm('즐겨찾기를 해제하시겠습니까?')
      if (!ok) return
    }
    await api(`/api/follows/${item.id}`, { method: 'POST' })
    await load()
  }

  function openGroupPicker(item) {
    if (!(groupState.groups || []).length) {
      window.alert('먼저 메뉴에서 그룹을 추가해 주세요.')
      return
    }
    setSelectedGroupId(String(groupState.assignments?.[item.id] || ''))
    setGroupPicker({ open: true, friend: item })
    setOpenFriendMenuId(null)
  }

  function applyFriendGroup() {
    if (!groupPicker.friend) return
    const nextAssignments = { ...(groupState.assignments || {}) }
    if (!selectedGroupId) delete nextAssignments[groupPicker.friend.id]
    else nextAssignments[groupPicker.friend.id] = selectedGroupId
    saveGroupState({ ...groupState, assignments: nextAssignments })
    setGroupPicker({ open: false, friend: null })
  }

  async function removeFriend(item) {
    const ok = window.confirm(`${item.nickname || '회원'}님을 친구 목록에서 삭제하시겠습니까?`)
    if (!ok) return
    await api(`/api/friends/${item.id}`, { method: 'DELETE' })
    await load()
  }

  async function blockFriend(item) {
    const ok = window.confirm(`${item.nickname || '회원'}님을 차단하시겠습니까?`)
    if (!ok) return
    await api(`/api/block/${item.id}`, { method: 'POST', body: JSON.stringify({ reason: '친구 화면에서 차단' }) })
    await api(`/api/friends/${item.id}`, { method: 'DELETE' })
    await load()
  }

  function createGroup() {
    const name = window.prompt('새 그룹명을 입력하세요.')
    if (!name || !name.trim()) return
    const nextGroup = { id: `g${Date.now()}`, name: name.trim() }
    saveGroupState({ ...groupState, groups: [...(groupState.groups || []), nextGroup] })
  }

  function openGroupEditor(mode) {
    if (!(groupState.groups || []).length) {
      window.alert(mode === 'rename' ? '수정할 그룹이 없습니다.' : '삭제할 그룹이 없습니다.')
      return
    }
    const first = groupState.groups[0]
    setGroupRenamePicker({ open: true, mode })
    setSelectedGroupId(first?.id || '')
    setEditingGroupName(first?.name || '')
    setMenuOpen(false)
  }

  function submitGroupEditor() {
    const target = groupState.groups.find(group => String(group.id) === String(selectedGroupId))
    if (!target) return
    if (groupRenamePicker.mode === 'rename') {
      const nextName = editingGroupName.trim()
      if (!nextName) {
        window.alert('그룹명을 입력해 주세요.')
        return
      }
      saveGroupState({ ...groupState, groups: groupState.groups.map(group => group.id === target.id ? { ...group, name: nextName } : group) })
    } else {
      const nextAssignments = { ...(groupState.assignments || {}) }
      Object.keys(nextAssignments).forEach(friendId => {
        if (String(nextAssignments[friendId]) === String(target.id)) delete nextAssignments[friendId]
      })
      saveGroupState({ groups: groupState.groups.filter(group => group.id !== target.id), assignments: nextAssignments })
    }
    setGroupRenamePicker({ open: false, mode: 'rename' })
    setSelectedGroupId('')
    setEditingGroupName('')
  }

  async function openMyProfileCard() {
    try {
      const data = await api('/api/profile')
      const me = data?.user || profile
      setProfilePreview({ mode: 'card', friend: { ...me, cover_url: loadProfileCover(me?.id) }, section: 'me' })
    } catch (error) {
      window.alert(error.message)
    }
  }

  function openMyProfileEditor() {
    const me = profilePreview.friend || profile
    if (!me) return
    setProfileEditForm({
      email: me.email || profile?.email || '',
      nickname: me.nickname || '',
      position_title: me.position_title || '',
      region: me.region || '서울',
      bio: me.bio || '',
      one_liner: me.one_liner || '',
      interests: Array.isArray(me.interests) ? me.interests : [],
      photo_url: me.photo_url || '',
      cover_url: loadProfileCover(me.id || profile?.id),
      phone: me.phone || '',
      recovery_email: me.recovery_email || '',
      gender: me.gender || '',
      birth_year: Number(me.birth_year || 1990),
      vehicle_number: me.vehicle_number || '',
      branch_no: me.branch_no ?? null,
      marital_status: me.marital_status || '',
      resident_address: me.resident_address || '',
      business_name: me.business_name || '',
      business_number: me.business_number || '',
      business_type: me.business_type || '',
      business_item: me.business_item || '',
      business_address: me.business_address || '',
      bank_account: me.bank_account || '',
      bank_name: me.bank_name || '',
      mbti: me.mbti || '',
      google_email: me.google_email || '',
      resident_id: me.resident_id || '',
      new_password: '',
    })
    setProfilePreview(prev => ({ ...prev, mode: 'edit' }))
  }

  async function updateMyProfileField(patch = {}) {
    const latest = await api('/api/profile')
    const base = latest?.user || profile
    const payload = {
      email: base?.email || '', nickname: base?.nickname || '', position_title: base?.position_title || '', region: base?.region || '서울',
      bio: base?.bio || '', one_liner: base?.one_liner || '', interests: Array.isArray(base?.interests) ? base.interests : [], photo_url: base?.photo_url || '',
      phone: base?.phone || '', recovery_email: base?.recovery_email || '', gender: base?.gender || '', birth_year: Number(base?.birth_year || 1990),
      vehicle_number: base?.vehicle_number || '', branch_no: base?.branch_no ?? null, marital_status: base?.marital_status || '', resident_address: base?.resident_address || '',
      business_name: base?.business_name || '', business_number: base?.business_number || '', business_type: base?.business_type || '', business_item: base?.business_item || '', business_address: base?.business_address || '',
      bank_account: base?.bank_account || '', bank_name: base?.bank_name || '', mbti: base?.mbti || '', google_email: base?.google_email || '', resident_id: base?.resident_id || '', new_password: '',
      ...patch,
    }
    const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    return result?.user
  }

  async function handleProfileImageUpload(kind, file) {
    if (!file) return
    const uploaded = await uploadFile(file, kind === 'cover' ? 'profile-cover' : 'profile-photo')
    const url = uploaded?.url || ''
    if (kind === 'cover') {
      saveProfileCover(profile?.id, url)
      setMyCoverUrl(url)
      setProfileEditForm(prev => prev ? { ...prev, cover_url: url } : prev)
      setProfilePreview(prev => prev?.friend ? { ...prev, friend: { ...prev.friend, cover_url: url } } : prev)
      return
    }
    const updatedUser = await updateMyProfileField({ photo_url: url, one_liner: profileEditForm?.one_liner ?? profile?.one_liner ?? '' })
    if (updatedUser) {
      setProfile(updatedUser)
      setProfileEditForm(prev => prev ? { ...prev, photo_url: updatedUser.photo_url || '' } : prev)
      setProfilePreview(prev => prev?.friend ? { ...prev, friend: { ...updatedUser, cover_url: loadProfileCover(updatedUser.id) } } : prev)
    }
  }

  async function saveMyProfileEditor() {
    if (!profileEditForm) return
    const { cover_url, ...payload } = profileEditForm
    const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) })
    saveProfileCover(profile?.id, cover_url || '')
    setMyCoverUrl(cover_url || '')
    if (result?.user) {
      setProfile(result.user)
      setProfilePreview({ mode: 'card', friend: { ...result.user, cover_url: cover_url || '' }, section: 'me' })
      setProfileEditForm(null)
    }
  }

  function FriendRow({ item, actions = null, section = 'friends' }) {
    const isFavorite = followedIds.has(item.id)
    return (
      <div className="friend-row-card upgraded">
        <button type="button" className="friend-avatar-button" onClick={() => setProfilePreview({ mode: 'image', friend: item, section })}>
          <AvatarCircle src={item.photo_url} label={item.nickname} className="friend-avatar" />
        </button>
        <button type="button" className="friend-row-body clickable-profile" onClick={() => setProfilePreview({ mode: 'card', friend: item, section })}>
          <div className="friend-row-title">{item.nickname || '회원'}</div>
          <div className="friend-row-subtitle">{item.one_liner || item.bio || item.region || '한줄소개가 없습니다.'}</div>
        </button>
        <div className="friend-row-actions vertical-edge">
          <div className="dropdown-wrap friend-inline-wrap top-menu">
            <button type="button" className="small ghost" onClick={() => setOpenFriendMenuId(prev => prev === friendMenuKey(section, item.id) ? null : friendMenuKey(section, item.id))}>메뉴</button>
            <div className={`dropdown-menu right inline-friend-menu ${openFriendMenuId === friendMenuKey(section, item.id) ? 'open-inline-menu' : ''}`}>
              <button type="button" className="dropdown-item" onClick={() => openGroupPicker(item)}>그룹설정</button>
              <button type="button" className="dropdown-item" onClick={() => removeFriend(item).catch(err => window.alert(err.message))}>친구삭제</button>
              <button type="button" className="dropdown-item danger-text" onClick={() => blockFriend(item).catch(err => window.alert(err.message))}>친구차단</button>
            </div>
          </div>
          <button type="button" className={isFavorite ? 'small ghost active-icon favorite-friend-button bottom-favorite' : 'small ghost favorite-friend-button bottom-favorite'} onClick={() => toggleFavorite(item).catch(err => window.alert(err.message))}>{isFavorite ? '🌟' : '✨'}</button>
          {actions}
        </div>
      </div>
    )
  }

  const previewFriend = profilePreview.friend

  return (
    <div className="stack-page friends-page">
      <section className="card friends-shell">
        <div className="friends-topbar">
          <div></div>
          <div className="friends-top-actions">
            <button type="button" className="ghost icon-button" onClick={() => setSearchOpen(v => !v)}>검색</button>
            <div className="dropdown-wrap friends-main-menu">
              <button type="button" className="ghost icon-button menu-button-with-badge" onClick={() => setMenuOpen(v => !v)}>메뉴{data.received_requests.length > 0 && <span className="notification-badge menu-badge">{data.received_requests.length}</span>}</button>
              {menuOpen && (
                <div className="dropdown-menu right">
                  <button type="button" className="dropdown-item" onClick={() => { setPanel('add'); setMenuOpen(false); setSearchParams({ panel: 'add' }) }}>친구추가</button>
                  <button type="button" className="dropdown-item" onClick={() => { setPanel('requests'); setMenuOpen(false); setSearchParams({ panel: 'requests' }) }}>친구요청목록 {data.received_requests.length > 0 ? `(${data.received_requests.length})` : ''}</button>
                  <button type="button" className="dropdown-item" onClick={() => { createGroup(); setMenuOpen(false) }}>그룹추가</button>
                  <button type="button" className="dropdown-item" onClick={() => openGroupEditor('rename')}>그룹명편집</button>
                  <button type="button" className="dropdown-item" onClick={() => openGroupEditor('delete')}>그룹삭제</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {searchOpen && <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="친구 검색" className="friends-search-input" />}

        <div className="friends-section-label">내 정보</div>
        {profile && (
          <button type="button" className="my-profile-card clickable-profile" onClick={() => openMyProfileCard().catch(err => window.alert(err.message))}>
            <AvatarCircle src={profile.photo_url} label={profile.nickname} className="friend-avatar large" size={56} />
            <div className="friend-row-body">
              <div className="friend-row-title">{profile.nickname}</div>
              <div className="friend-row-subtitle">{profile.one_liner || profile.bio || '한줄소개를 입력해 주세요.'}</div>
            </div>
          </button>
        )}

        <div className="friends-section-label">즐겨찾기</div>
        <div className="friends-group-list">
          {favorites.length > 0 ? favorites.map(item => <FriendRow key={`fav-${item.id}`} item={item} section="favorite" />) : <div className="muted">즐겨찾기 친구가 없습니다.</div>}
        </div>

        <div className="friends-section-label">그룹</div>
        <div className="friends-group-list grouped-stack">
          {groupedFriends.length > 0 ? groupedFriends.map(group => (
            <div key={group.id} className="group-card-block">
              <strong>{group.name}</strong>
              <div className="friends-group-list inner">
                {group.items.length > 0 ? group.items.map(item => <FriendRow key={`group-${group.id}-${item.id}`} item={item} section={`group-${group.id}`} />) : <div className="muted">배정된 친구가 없습니다.</div>}
              </div>
            </div>
          )) : <div className="muted">등록된 그룹이 없습니다.</div>}
        </div>

        <div className="friends-section-label">전체친구</div>
        <div className="friends-group-list">
          {filteredFriends.length > 0 ? filteredFriends.map(item => <FriendRow key={`friend-${item.id}`} item={item} section="all" />) : <div className="muted">표시할 친구가 없습니다.</div>}
        </div>

        {panel === 'add' && (
          <section className="friends-subpanel">
            <div className="between"><strong>친구추가</strong><button type="button" className="ghost small" onClick={() => { setPanel(''); setSearchParams({}) }}>닫기</button></div>
            <div className="friends-group-list">
              {candidateUsers.map(item => (
                <FriendRow
                  key={`candidate-${item.id}`}
                  item={item}
                  section="candidate"
                  actions={sentRequestIds.has(item.id) ? (
                    <button className="small ghost" disabled>요청완료</button>
                  ) : (
                    <button className="small" onClick={() => doAction(async () => {
                      await api(`/api/friends/request/${item.id}`, { method: 'POST' })
                      setToast(`${item.nickname || '회원'}님에게 친구요청을 신청했습니다.`)
                    }, `${item.nickname || '회원'}님에게 친구요청을 신청했습니다.`)}>요청</button>
                  )}
                />
              ))}
              {candidateUsers.length === 0 && <div className="muted">추가 가능한 친구가 없습니다.</div>}
            </div>
          </section>
        )}

        {panel === 'requests' && (
          <section className="friends-subpanel">
            <div className="between"><strong>친구요청목록 {data.received_requests.length > 0 ? `(${data.received_requests.length})` : ''}</strong><button type="button" className="ghost small" onClick={() => { setPanel(''); setSearchParams({}) }}>닫기</button></div>
            <div className="friends-group-list">
              {receivedProfiles.map(req => (
                <FriendRow
                  key={`req-${req.id}`}
                  item={{ ...req.profile, nickname: req.profile.nickname || req.requester_nickname, one_liner: req.profile.one_liner || req.profile.region || '친구 요청을 보냈습니다.' }}
                  section="requests"
                  actions={
                    <div className="inline-actions wrap">
                      <button className="small" onClick={() => doAction(() => api(`/api/friends/respond/${req.id}`, { method: 'POST', body: JSON.stringify({ action: 'accepted' }) }), '친구 요청을 수락했습니다.')}>수락</button>
                      <button className="small ghost" onClick={() => doAction(() => api(`/api/friends/respond/${req.id}`, { method: 'POST', body: JSON.stringify({ action: 'rejected' }) }), '친구 요청을 거절했습니다.')}>거절</button>
                    </div>
                  }
                />
              ))}
              {receivedProfiles.length === 0 && <div className="muted">받은 친구 요청이 없습니다.</div>}
            </div>
          </section>
        )}

        {message && <div className="success">{message}</div>}
        {toast && <div className="mention-toast action-toast">{toast}</div>}
      </section>

      {groupPicker.open && (
        <div className="sheet-backdrop" onClick={() => setGroupPicker({ open: false, friend: null })}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">그룹설정</div>
            <div className="stack">
              <div className="muted">{groupPicker.friend?.nickname} 님을 배정할 그룹을 선택하세요.</div>
              <select value={selectedGroupId} onChange={e => setSelectedGroupId(e.target.value)}>
                <option value="">그룹 해제</option>
                {(groupState.groups || []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <div className="inline-actions wrap end">
                <button type="button" className="ghost" onClick={() => setGroupPicker({ open: false, friend: null })}>닫기</button>
                <button type="button" onClick={applyFriendGroup}>적용</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {groupRenamePicker.open && (
        <div className="sheet-backdrop" onClick={() => setGroupRenamePicker({ open: false, mode: 'rename' })}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">{groupRenamePicker.mode === 'rename' ? '그룹명편집' : '그룹삭제'}</div>
            <div className="stack">
              <select value={selectedGroupId} onChange={e => {
                const group = (groupState.groups || []).find(item => String(item.id) === e.target.value)
                setSelectedGroupId(e.target.value)
                setEditingGroupName(group?.name || '')
              }}>
                {(groupState.groups || []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              {groupRenamePicker.mode === 'rename' && <input value={editingGroupName} onChange={e => setEditingGroupName(e.target.value)} placeholder="새 그룹명" />}
              {groupRenamePicker.mode === 'delete' && <div className="muted">선택한 그룹을 삭제하면 해당 그룹 배정만 해제되고 전체 친구 목록은 유지됩니다.</div>}
              <div className="inline-actions wrap end">
                <button type="button" className="ghost" onClick={() => setGroupRenamePicker({ open: false, mode: 'rename' })}>닫기</button>
                <button type="button" className={groupRenamePicker.mode === 'delete' ? 'danger-text' : ''} onClick={submitGroupEditor}>{groupRenamePicker.mode === 'rename' ? '저장' : '삭제'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewFriend && profilePreview.mode === 'image' && (
        <div className="profile-preview-backdrop" onClick={() => setProfilePreview({ mode: '', friend: null })}>
          <div className="profile-image-viewer" onClick={e => e.stopPropagation()}>
            <AvatarCircle src={previewFriend.photo_url} label={previewFriend.nickname} size={220} className="friend-avatar-preview" />
          </div>
        </div>
      )}

      {previewFriend && profilePreview.mode === 'card' && (
        <div className="profile-preview-backdrop" onClick={() => setProfilePreview({ mode: '', friend: null, section: '' })}>
          <div className="profile-preview-card" onClick={e => e.stopPropagation()}>
            <div className="profile-preview-cover" style={previewFriend.cover_url ? { backgroundImage: `url(${previewFriend.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
              {profilePreview.section === 'me' && (
                <div className="dropdown-wrap profile-preview-menu">
                  <button type="button" className="small ghost" onClick={e => { e.stopPropagation(); setOpenFriendMenuId(prev => prev === 'my-profile-preview' ? null : 'my-profile-preview') }}>메뉴</button>
                  <div className={`dropdown-menu right inline-friend-menu ${openFriendMenuId === 'my-profile-preview' ? 'open-inline-menu' : ''}`}>
                    <button type="button" className="dropdown-item" onClick={() => { setOpenFriendMenuId(null); openMyProfileEditor() }}>상세 프로필 편집</button>
                  </div>
                </div>
              )}
            </div>
            <div className="profile-preview-main">
              <AvatarCircle src={previewFriend.photo_url} label={previewFriend.nickname} size={88} className="profile-preview-avatar" />
              <div className="profile-preview-name">{previewFriend.nickname || '회원'}</div>
              <div className="profile-preview-oneliner">{previewFriend.one_liner || previewFriend.bio || previewFriend.region || '한줄소개가 없습니다.'}</div>
              <div className="inline-actions wrap center profile-preview-actions">
                {profilePreview.section === 'me' ? (
                  <button type="button" onClick={() => goDirectChat(previewFriend.id)}>나에게 채팅</button>
                ) : (
                  <>
                    <button type="button" onClick={() => goDirectChat(previewFriend.id)}>채팅</button>
                    <button type="button" className="ghost" onClick={() => window.alert('음성 기능은 다음 단계에서 연결됩니다.')}>음성</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {profilePreview.mode === 'edit' && profileEditForm && (
        <div className="profile-preview-backdrop" onClick={() => { setProfilePreview(prev => ({ ...prev, mode: 'card' })); setProfileEditForm(null) }}>
          <div className="profile-preview-card profile-edit-card" onClick={e => e.stopPropagation()}>
            <div className="profile-preview-cover editable profile-cover-button" style={profileEditForm.cover_url ? { backgroundImage: `url(${profileEditForm.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} onClick={() => document.getElementById('profile-cover-input')?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('profile-cover-input')?.click() }}>
              <input id="profile-cover-input" type="file" accept="image/*" hidden onChange={e => handleProfileImageUpload('cover', e.target.files?.[0]).catch(err => window.alert(err.message))} />
              <div className="inline-actions wrap center profile-media-actions">
                <span className="small ghost profile-cover-hint">배경화면을 눌러 변경</span>
                <button type="button" className="ghost small" onClick={e => { e.stopPropagation(); setProfileEditForm(prev => ({ ...prev, cover_url: '' })) }}>배경화면 삭제(기본그림)</button>
              </div>
            </div>
            <div className="profile-preview-main">
              <button type="button" className="ghost profile-avatar-edit-button" onClick={() => document.getElementById('profile-photo-input')?.click()}>
                <AvatarCircle src={profileEditForm.photo_url} label={profileEditForm.nickname} size={88} className="profile-preview-avatar" />
              </button>
              <input id="profile-photo-input" type="file" accept="image/*" hidden onChange={e => handleProfileImageUpload('photo', e.target.files?.[0]).catch(err => window.alert(err.message))} />
              <div className="inline-actions wrap center profile-media-actions">
                <button type="button" className="ghost small" onClick={async () => { const updated = await updateMyProfileField({ photo_url: '', one_liner: profileEditForm.one_liner }); setProfile(updated); setProfileEditForm(prev => ({ ...prev, photo_url: '' })) }}>프로필 삭제(기본그림)</button>
                <label className="small profile-upload-label">프로필 추가 및 변경<input type="file" accept="image/*" hidden onChange={e => handleProfileImageUpload('photo', e.target.files?.[0]).catch(err => window.alert(err.message))} /></label>
              </div>
              <input value={profileEditForm.nickname} onChange={e => setProfileEditForm(prev => ({ ...prev, nickname: e.target.value }))} placeholder="닉네임" />
              <button type="button" className="profile-edit-oneliner clickable" onClick={() => { const next = window.prompt('한줄소개를 입력하세요.', profileEditForm.one_liner || ''); if (next !== null) setProfileEditForm(prev => ({ ...prev, one_liner: next })) }}>
                {profileEditForm.one_liner || '한줄소개를 눌러 입력해 주세요.'}
              </button>
              <div className="inline-actions wrap center profile-preview-actions">
                <button type="button" className="ghost" onClick={() => { setProfilePreview(prev => ({ ...prev, mode: 'card' })); setProfileEditForm(null) }}>취소</button>
                <button type="button" onClick={() => saveMyProfileEditor().catch(err => window.alert(err.message))}>저장</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const CHAT_CATEGORIES = [
  ['all', '전체'],
  ['general', '일반'],
  ['group', '단체'],
  ['favorite', '즐겨찾기'],
]

const QUICK_REACTIONS = ['👍', '❤️', '👏', '🔥', '✅']

const CHAT_PLUS_ACTIONS = [
  ['image', '이미지첨부'],
  ['file', '파일첨부'],
  ['voiceRoom', '음성방개설'],
  ['voiceMessage', '음성메세지'],
  ['shareLocation', '내위치공유'],
  ['schedule', '카톡방일정'],
]

const ENCLOSED_NUMBERS = {
  1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨', 10: '⑩',
  11: '⑪', 12: '⑫', 13: '⑬', 14: '⑭', 15: '⑮', 16: '⑯', 17: '⑰', 18: '⑱', 19: '⑲', 20: '⑳',
  21: '㉑', 22: '㉒', 23: '㉓', 24: '㉔', 25: '㉕', 26: '㉖', 27: '㉗', 28: '㉘', 29: '㉙', 30: '㉚',
  31: '㉛', 32: '㉜', 33: '㉝', 34: '㉞', 35: '㉟', 36: '㊱', 37: '㊲', 38: '㊳', 39: '㊴', 40: '㊵',
  41: '㊶', 42: '㊷', 43: '㊸', 44: '㊹', 45: '㊺', 46: '㊻', 47: '㊼', 48: '㊽', 49: '㊾', 50: '㊿',
}



function formatChatUpdatedAt(value) {
  const raw = String(value || '')
  if (!raw) return ''
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return raw.slice(5, 16).replace('T', ' ')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

function AvatarCircle({ src, label, size = 44, className = '' }) {
  const fallback = (String(label || '').trim()[0] || '•')
  return src ? (
    <img src={src} alt={label || '프로필'} className={`avatar-circle ${className}`.trim()} style={{ width: size, height: size }} />
  ) : (
    <div className={`avatar-circle avatar-fallback ${className}`.trim()} style={{ width: size, height: size }}>{fallback}</div>
  )
}

function RoomAvatar({ room }) {
  if (room.room_type === 'group') return <AvatarCircle label={room.title || '단체'} className="room-avatar" />
  return <AvatarCircle src={room.target_user?.photo_url} label={room.target_user?.nickname || room.title} className="room-avatar" />
}

function resolveScheduleStartTime(value) {
  return value && value !== '미정' ? value : '00:00'
}

function resolveScheduleCustomerName(value) {
  return String(value || '').trim() || '(성함)'
}

function isDepositPending(item) {
  return !item.deposit_method || item.deposit_method === '계약금입금전'
}

function buildDepositLine(item) {
  if (isDepositPending(item)) return '계약금 입금전'
  return [item.deposit_method, item.deposit_amount].filter(Boolean).join(' / ') || '계약금 입금완료'
}

function buildSchedulePrimaryLine(item) {
  const startDisplay = resolveScheduleStartTime(item.start_time)
  const platformDisplay = item.platform || '플랫폼미정'
  const customerDisplay = resolveScheduleCustomerName(item.customer_name)
  const costDisplay = buildCostSummary(item)
  return [startDisplay, platformDisplay, customerDisplay, costDisplay].join(' ').trim()
}

function buildMobileScheduleLines(item) {
  const authorDisplay = item.created_by_nickname || item.author_nickname || '작성자'
  return {
    line1: buildSchedulePrimaryLine(item),
    line2: buildDepositLine(item),
    line3: `[${item.department_info || '미지정'}] [${authorDisplay}]`,
    depositPending: isDepositPending(item),
  }
}

function buildRoomPath(item) {
  return item.room_type === 'group' ? `/chats/group/${item.room_ref}` : `/chats/direct/${item.room_ref}`
}

function useLongPress(onLongPress, delay = 550) {
  let timer = null
  const start = (event) => {
    clearTimeout(timer)
    timer = setTimeout(() => onLongPress(event), delay)
  }
  const clear = () => clearTimeout(timer)
  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
    onContextMenu: (event) => {
      event.preventDefault()
      onLongPress(event)
    },
  }
}

function AttachmentPreview({ message }) {
  if (message.attachment_type === 'image' && message.attachment_url) {
    return <img className="chat-image-preview" src={message.attachment_url} alt={message.attachment_name || '첨부 이미지'} />
  }
  if (message.attachment_type === 'file' && message.attachment_url) {
    return <a className="attachment-link" href={message.attachment_url} download={message.attachment_name || '첨부파일'}>{message.attachment_name || '첨부파일 다운로드'}</a>
  }
  if (message.attachment_type === 'location' && message.attachment_url) {
    return <a className="attachment-link" href={message.attachment_url} target="_blank" rel="noreferrer">공유된 위치 보기</a>
  }
  return null
}

function ChatActionSheet({ title, actions, reactions, onReact, onClose }) {
  if (!actions) return null
  return (
    <div className="profile-preview-backdrop" onClick={onClose}>
      <div className="chat-popup-menu" onClick={e => e.stopPropagation()}>
        {title && <div className="sheet-title">{title}</div>}
        {!!reactions?.length && (
          <div className="chat-action-reaction-bar">
            {reactions.map(emoji => (
              <button key={emoji} type="button" className="chat-action-emoji-button" onClick={() => { onReact?.(emoji); onClose?.() }}>{emoji}</button>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          {actions.map(action => (
            <button key={action.label} type="button" className={action.danger ? 'sheet-action danger-text' : 'sheet-action'} onClick={() => { action.onClick?.(); onClose?.() }}>{action.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}


function ChatsPage() {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const [category, setCategory] = useState('all')
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [actionRoom, setActionRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pinArrangeOpen, setPinArrangeOpen] = useState(false)
  const [pinOrder, setPinOrder] = useState(() => loadChatPinnedOrder(currentUser?.id))

  useEffect(() => {
    setPinOrder(loadChatPinnedOrder(currentUser?.id))
  }, [currentUser?.id])

  function updatePinOrder(updater) {
    setPinOrder(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveChatPinnedOrder(currentUser?.id, next)
      return next
    })
  }

  async function load() {
    setLoading(true)
    try {
      const [items, userList] = await Promise.all([
        api(`/api/chat-list?category=${category}`),
        api('/api/users'),
      ])
      setRooms(items)
      setUsers(userList)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [category])

  async function updateRoomSetting(room, patch) {
    const endpoint = room.room_type === 'group'
      ? `/api/chat-rooms/group/${room.room_ref}/settings`
      : `/api/chat-rooms/direct/${room.room_ref}/settings`
    await api(endpoint, { method: 'PUT', body: JSON.stringify(patch) })
    if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) {
      updatePinOrder(prev => {
        const filtered = prev.filter(id => id !== room.id)
        return patch.pinned ? [room.id, ...filtered] : filtered
      })
    }
    await load()
  }

  async function handleInvite(room) {
    const selectable = users.filter(item => String(item.id) !== String(room.room_ref))
    const guide = selectable.map(item => `${item.id}: ${item.nickname}`).join('\n')
    const picked = window.prompt(`초대할 회원 번호를 입력하세요.
${guide}`)
    if (!picked) return
    if (room.room_type === 'group') {
      await api(`/api/group-rooms/${room.room_ref}/invite`, { method: 'POST', body: JSON.stringify({ user_id: Number(picked) }) })
    } else {
      const res = await api(`/api/direct-chat/${room.room_ref}/invite`, { method: 'POST', body: JSON.stringify({ user_id: Number(picked) }) })
      navigate(`/chats/group/${res.room_id}`)
      return
    }
    alert('초대가 완료되었습니다.')
    await load()
  }

  async function handleLeave(room) {
    if (room.room_type === 'group') {
      await api(`/api/group-rooms/${room.room_ref}/leave`, { method: 'POST' })
    } else {
      await updateRoomSetting(room, { hidden: true })
      return
    }
    await load()
  }

  async function handleCreateGroupRoom() {
    const title = window.prompt('새 단체 채팅방 이름을 입력하세요.')
    if (!title || !title.trim()) return
    const created = await api('/api/group-rooms', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), description: '', region: '' }),
    })
    setMenuOpen(false)
    navigate(`/chats/group/${created.id}`)
  }

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pinRankMap = new Map(pinOrder.map((id, index) => [id, index]))
    const ordered = [...rooms].sort((a, b) => {
      const aPinned = Boolean(a.pinned)
      const bPinned = Boolean(b.pinned)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      if (aPinned && bPinned) {
        const aRank = pinRankMap.has(a.id) ? pinRankMap.get(a.id) : Number.MAX_SAFE_INTEGER
        const bRank = pinRankMap.has(b.id) ? pinRankMap.get(b.id) : Number.MAX_SAFE_INTEGER
        if (aRank !== bRank) return aRank - bRank
      }
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    })
    if (!q) return ordered
    return ordered.filter(room => [room.title, room.subtitle, room.target_user?.nickname].join(' ').toLowerCase().includes(q))
  }, [rooms, query, pinOrder])

  const pinnedRooms = useMemo(() => filteredRooms.filter(room => room.pinned), [filteredRooms])

  function movePinnedRoom(roomId, direction) {
    updatePinOrder(prev => {
      const next = prev.filter(id => pinnedRooms.some(room => room.id === id))
      const currentIndex = next.indexOf(roomId)
      if (currentIndex < 0) return next
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= next.length) return next
      const clone = [...next]
      const [moved] = clone.splice(currentIndex, 1)
      clone.splice(targetIndex, 0, moved)
      return clone
    })
  }

  const roomActions = actionRoom ? [
    { label: '채팅방 이름변경', onClick: async () => {
      const nextName = window.prompt('새 채팅방 이름을 입력하세요.', actionRoom.title || '')
      if (nextName === null) return
      await updateRoomSetting(actionRoom, { custom_name: nextName })
    } },
    ...((actionRoom.room_type === 'group' && actionRoom.room?.can_manage) || actionRoom.room_type !== 'group' ? [{ label: '채팅방 초대', onClick: async () => { await handleInvite(actionRoom) } }] : []),
    { label: '채팅방 나가기', danger: true, onClick: async () => { await handleLeave(actionRoom) } },
    { label: actionRoom.pinned ? '채팅방 상단고정 해제' : '채팅방 상단고정', onClick: async () => { await updateRoomSetting(actionRoom, { pinned: !actionRoom.pinned }) } },
    { label: actionRoom.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가', onClick: async () => { await updateRoomSetting(actionRoom, { favorite: !actionRoom.favorite }) } },
    { label: actionRoom.muted ? '채팅방 알람켜기' : '채팅방 알람끄기', onClick: async () => { await updateRoomSetting(actionRoom, { muted: !actionRoom.muted }) } },
  ] : null

  return (
    <div className="stack-page">
      <section className="card chat-list-card">
        <div className="chat-list-toolbar">
          <div className="chat-list-toolbar-top">
            <div className="chat-toolbar-spacer" />
            <div className="chat-search-trigger">
              <button type="button" className="small ghost" onClick={() => setSearchOpen(v => !v)}>검색</button>
              <div className="dropdown-wrap">
                <button type="button" className="small ghost" onClick={() => setMenuOpen(v => !v)}>메뉴</button>
                {menuOpen && (
                  <div className="dropdown-menu right">
                    <button type="button" className="dropdown-item" onClick={handleCreateGroupRoom}>채팅개설</button>
                    <button type="button" className="dropdown-item" onClick={() => { setPinArrangeOpen(true); setMenuOpen(false) }}>채팅방고정 위치변경</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="chat-category-row evenly-spaced chat-category-row-spaced">
            {CHAT_CATEGORIES.map(([value, label]) => (
              <button key={value} type="button" className={category === value ? 'small chat-tab active equal-width selected-toggle' : 'small ghost chat-tab equal-width'} onClick={() => setCategory(value)}>{label}</button>
            ))}
          </div>
        </div>
        {searchOpen && (
          <div className="chat-list-searchbar">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="채팅방 검색" />
          </div>
        )}
        {loading ? <div className="muted">불러오는 중...</div> : (
          <div className="chat-room-list chat-room-list-spaced">
            {filteredRooms.map(room => (
              <button key={`${room.room_type}-${room.room_ref}`} type="button" className="chat-room-row" onClick={() => navigate(buildRoomPath(room))}>
                <RoomAvatar room={room} />
                <div className="chat-room-body-single">
                  <div className="chat-room-topline">
                    <strong className="chat-room-name-single">{room.title}</strong>
                    {room.pinned && <span className="chat-pin-indicator" aria-label="고정">📌</span>}
                    <span className="muted chat-room-datetime">{formatChatUpdatedAt(room.updated_at || room.last_message_at || '')}</span>
                    <button type="button" className="small ghost chat-room-menu-button" onClick={(event) => { event.stopPropagation(); setActionRoom(room) }}>메뉴</button>
                  </div>
                  <div className="chat-room-subtitle-two-line">{room.subtitle || room.last_message || '대화를 시작해 보세요.'}</div>
                </div>
              </button>
            ))}
            {filteredRooms.length === 0 && <div className="muted">표시할 채팅방이 없습니다.</div>}
          </div>
        )}
      </section>
      <ChatActionSheet title={actionRoom?.title} actions={roomActions} onClose={() => setActionRoom(null)} />
      {pinArrangeOpen && (
        <div className="profile-preview-backdrop" onClick={() => setPinArrangeOpen(false)}>
          <div className="chat-popup-menu" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">고정 채팅방 위치변경</div>
            <div className="stack compact-gap pin-arrange-list">
              {pinnedRooms.map((room, index) => (
                <div key={room.id} className="pin-arrange-item">
                  <span className="pin-arrange-title">{room.title}</span>
                  <div className="inline-actions">
                    <button type="button" className="small ghost" disabled={index === 0} onClick={() => movePinnedRoom(room.id, 'up')}>위로</button>
                    <button type="button" className="small ghost" disabled={index === pinnedRooms.length - 1} onClick={() => movePinnedRoom(room.id, 'down')}>아래로</button>
                  </div>
                </div>
              ))}
              {pinnedRooms.length === 0 && <div className="muted">상단 고정된 채팅방이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function ChatRoomPage({ roomType }) {
  const navigate = useNavigate()
  const params = useParams()
  const isMobile = useIsMobile()
  const [roomData, setRoomData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [pickerOpenFor, setPickerOpenFor] = useState(null)
  const [replyTarget, setReplyTarget] = useState(null)
  const [chatActionSheet, setChatActionSheet] = useState(null)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [memberProfilePreview, setMemberProfilePreview] = useState(null)
  const [hiddenMessageIds, setHiddenMessageIds] = useState(() => new Set())
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState(() => new Set())
  const imageInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const roomId = roomType === 'group' ? params.roomId : params.targetUserId

  async function loadRoom() {
    setLoading(true)
    try {
      const data = roomType === 'group'
        ? await api(`/api/group-rooms/${roomId}/messages`)
        : await api(`/api/chat/${roomId}`)
      setRoomData(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRoom().catch(() => setLoading(false))
  }, [roomType, roomId])

  useEffect(() => {
    if (!roomData?.pending_mentions?.length) return
    roomData.pending_mentions.forEach(item => {
      api(`/api/chat-mentions/${item.id}/seen`, { method: 'POST' }).catch(() => {})
    })
  }, [roomData?.pending_mentions])

  async function handleSend(event) {
    event?.preventDefault?.()
    if (sending) return
    const trimmed = message.trim()
    if (!trimmed && !selectedFile) return
    setSending(true)
    try {
      let attachmentPayload = {}
      if (selectedFile) {
        const uploaded = await uploadFile(selectedFile, 'chat')
        const isImage = String(selectedFile.type || '').startsWith('image/')
        attachmentPayload = {
          attachment_name: uploaded.original_name || selectedFile.name,
          attachment_url: uploaded.url,
          attachment_type: isImage ? 'image' : 'file',
        }
      }
      const payload = {
        message: trimmed,
        reply_to_id: replyTarget?.id || null,
        mention_user_id: null,
        ...attachmentPayload,
      }
      if (roomType === 'group') {
        await api(`/api/group-rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await api(`/api/chat/${roomId}`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setMessage('')
      setSelectedFile(null)
      setReplyTarget(null)
      await loadRoom()
    } finally {
      setSending(false)
    }
  }

  async function handleReaction(messageId, emoji) {
    const endpoint = roomType === 'group'
      ? `/api/group-messages/${messageId}/reactions`
      : `/api/dm-messages/${messageId}/reactions`
    await api(endpoint, { method: 'POST', body: JSON.stringify({ emoji }) })
    await loadRoom()
  }

  async function handleStartVoice() {
    try {
      if (roomType === 'group') {
        window.alert('단체 음성통화 기능은 다음 단계에서 연동 예정입니다.')
        return
      }
      const existing = await api(`/api/chat/${roomId}/voice-room`)
      if (existing?.id || existing?.room?.id || existing?.room_id) {
        window.alert('이미 진행 중인 음성통화 방이 있습니다.')
        return
      }
      await api(`/api/chat/${roomId}/voice-room`, { method: 'POST' })
      window.alert('음성통화 요청을 보냈습니다.')
    } catch (error) {
      window.alert(error.message)
    }
  }

  async function handleSendSharedLocation() {
    if (!navigator.geolocation) {
      window.alert('현재 브라우저에서는 위치 공유를 지원하지 않습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const payload = {
          message: '내 위치를 공유했습니다.',
          reply_to_id: replyTarget?.id || null,
          mention_user_id: null,
          attachment_name: '공유 위치',
          attachment_url: `https://maps.google.com/?q=${lat},${lng}`,
          attachment_type: 'location',
        }
        if (roomType === 'group') {
          await api(`/api/group-rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
        } else {
          await api(`/api/chat/${roomId}`, { method: 'POST', body: JSON.stringify(payload) })
        }
        setPlusMenuOpen(false)
        setReplyTarget(null)
        await loadRoom()
      } catch (error) {
        window.alert(error.message)
      }
    }, () => {
      window.alert('위치 권한이 허용되지 않아 현재 위치를 공유할 수 없습니다.')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 })
  }


  function toggleHiddenMessage(messageId) {
    setHiddenMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  function toggleBookmarkMessage(messageId) {
    setBookmarkedMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  async function shareMessage(item) {
    const text = item.message || item.attachment_name || '메시지'
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
    }
    await navigator.clipboard?.writeText(text)
    window.alert('메시지 내용을 클립보드에 복사했습니다.')
  }

  async function sendMessageToSelf(item) {
    const currentUser = getStoredUser()
    if (!currentUser?.id) {
      window.alert('로그인이 필요합니다.')
      return
    }
    const text = item.message || item.attachment_name || '공유 메시지'
    try {
      await api(`/api/chat/${currentUser.id}`, {
        method: 'POST',
        body: JSON.stringify({ message: `[나에게] ${text}`, reply_to_id: null, mention_user_id: null }),
      })
      window.alert('나와의 채팅방으로 메시지를 보냈습니다.')
    } catch (error) {
      window.alert(error.message)
    }
  }

  async function captureMessageText(item) {
    const text = item.message || item.attachment_name || '메시지'
    await navigator.clipboard?.writeText(text)
    window.alert('메시지 내용을 복사했습니다. 필요한 경우 화면 캡처를 진행해 주세요.')
  }

  function deleteMessageLocal(item) {
    if (!window.confirm('이 메시지를 현재 화면에서 숨기시겠습니까?')) return
    toggleHiddenMessage(item.id)
  }

  function openReplyComposer(item) {
    setReplyTarget(item)
    setChatActionSheet(null)
    setMessage(prev => prev || '')
  }

  function openMessageActions(item) {
    setChatActionSheet({
      title: '메시지 메뉴',
      reactions: ['👍', '❤️', '😂', '👏', '🔥'],
      onReact: emoji => {
        setPickerOpenFor(null)
        handleReaction(item.id, emoji).catch(err => window.alert(err.message))
      },
      actions: [
        { label: hiddenMessageIds.has(item.id) ? '가리기 해제' : '가리기', onClick: () => toggleHiddenMessage(item.id) },
        { label: '답장', onClick: () => openReplyComposer(item) },
        { label: '공유', onClick: () => { shareMessage(item).catch(err => window.alert(err.message)) } },
        { label: '나에게', onClick: () => { sendMessageToSelf(item).catch(err => window.alert(err.message)) } },
        { label: bookmarkedMessageIds.has(item.id) ? '책갈피 해제' : '책갈피', onClick: () => toggleBookmarkMessage(item.id) },
        { label: '캡쳐', onClick: () => { captureMessageText(item).catch?.(err => window.alert(err.message)) } },
        ...(String(item.sender_id) === String(getStoredUser()?.id) ? [{ label: '삭제', danger: true, onClick: () => deleteMessageLocal(item) }] : []),
      ],
    })
  }

  function handlePlusAction(action) {
    setPlusMenuOpen(false)
    if (action === 'image') {
      imageInputRef.current?.click()
      return
    }
    if (action === 'file') {
      fileInputRef.current?.click()
      return
    }
    if (action === 'voiceRoom') {
      handleStartVoice().catch(err => window.alert(err.message))
      return
    }
    if (action === 'shareLocation') {
      handleSendSharedLocation().catch?.(() => {})
      return
    }
    if (action === 'voiceMessage') {
      window.alert('음성메세지 기능은 다음 단계에서 연결됩니다.')
      return
    }
    if (action === 'schedule') {
      window.alert('카톡방일정 기능은 다음 단계에서 연결됩니다.')
    }
  }

  const roomTitle = roomType === 'group'
    ? roomData?.room?.title || '단체 채팅방'
    : roomData?.target_user?.nickname || '1:1 채팅'

  const currentUser = getStoredUser()
  const roomMembers = roomType === 'group'
    ? (roomData?.members || [])
    : [currentUser, roomData?.target_user].filter(Boolean)

  const roomMemberCount = roomMembers.length
  const messages = (roomData?.messages || []).filter(item => !hiddenMessageIds.has(item.id))

  function isGroupedMessage(currentItem, previousItem) {
    if (!currentItem || !previousItem) return false
    if (String(currentItem.sender_id || '') !== String(previousItem.sender_id || '')) return false
    const currentTime = new Date(currentItem.created_at || '').getTime()
    const previousTime = new Date(previousItem.created_at || '').getTime()
    if (Number.isNaN(currentTime) || Number.isNaN(previousTime)) return false
    return currentTime - previousTime <= 60 * 1000
  }

  function openMemberProfile(member) {
    setMemberProfilePreview({ ...member, cover_url: loadProfileCover(member?.id) })
  }

  function goDirectChatWithUser(targetId) {
    if (!targetId) return
    setMembersOpen(false)
    setMemberProfilePreview(null)
    navigate(`/chats/${targetId}`)
  }

  return (
    <div className="stack-page chat-room-page-shell">
      <section className="card chat-room-card segmented-chat-layout">
        <header className="chat-room-topbar-section">
          <div className="chat-room-topbar-grid">
            <div className="chat-room-topbar-left">
              <button type="button" className="small ghost icon-button" onClick={() => navigate('/chats')}>뒤로</button>
              <div className="chat-room-heading compact">
                <strong>{roomTitle}</strong>
                <button type="button" className="chat-member-count-button" onClick={() => setMembersOpen(true)}>{roomMemberCount}명</button>
              </div>
            </div>
            <div className="chat-room-topbar-actions">
              <button type="button" className="small ghost icon-button" onClick={() => window.alert('채팅방 검색 기능은 다음 단계에서 연결됩니다.')}>검색</button>
              <button type="button" className="small ghost icon-button" onClick={() => setChatActionSheet({ title: roomTitle, actions: [{ label: '참여자 보기', onClick: () => setMembersOpen(true) }] })}>메뉴</button>
            </div>
          </div>
        </header>

        <div className="chat-room-messages-section">
          <div className="chat-room-messages">
            {loading && <div className="muted">대화 내용을 불러오는 중...</div>}
            {!loading && messages.length === 0 && <div className="muted">아직 메시지가 없습니다. 첫 메시지를 보내보세요.</div>}
            {!loading && messages.map((item, index) => {
              const mine = String(item.sender_id) === String(currentUser?.id)
              const previousItem = index > 0 ? messages[index - 1] : null
              const groupedWithPrevious = isGroupedMessage(item, previousItem)
              const longPressHandlers = isMobile ? useLongPress(() => openMessageActions(item), 500) : {}
              return (
                <div key={item.id} className={`chat-message-row${mine ? ' mine' : ''}${groupedWithPrevious ? ' grouped' : ''}`} {...longPressHandlers}>
                  {!mine && !groupedWithPrevious && <AvatarCircle src={item.sender?.photo_url} label={item.sender?.nickname || '회원'} size={36} className="chat-message-avatar" />}
                  {!mine && groupedWithPrevious && <div className="chat-message-avatar-spacer" aria-hidden="true" />}
                  <div className={`chat-message-content${mine ? ' mine' : ''}${groupedWithPrevious ? ' grouped' : ''}`}>
                    {!mine && !groupedWithPrevious && (
                      <div className="chat-message-headerline">
                        <strong>{item.sender?.nickname || '회원'}</strong>
                        <span className="muted">{formatChatUpdatedAt(item.created_at || '')}</span>
                      </div>
                    )}
                    <div className={`chat-message-bubble-row${mine ? ' mine' : ''}${groupedWithPrevious ? ' grouped' : ''}`}>
                      {!isMobile && mine && (
                        <div className={`chat-message-tools inline${mine ? ' mine' : ''}`}>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => openReplyComposer(item)}>답장</button>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => setPickerOpenFor(pickerOpenFor === item.id ? null : item.id)}>반응</button>
                        </div>
                      )}
                      {mine && !groupedWithPrevious && <span className="chat-message-inline-time muted">{formatChatUpdatedAt(item.created_at || '')}</span>}
                      <div className={`chat-bubble${mine ? ' mine' : ''}`}>
                        {item.reply_to?.message && <div className="chat-reply-preview">↳ {item.reply_to.message}</div>}
                        {item.message && <div className="chat-bubble-text">{item.message}</div>}
                        <AttachmentPreview message={item} />
                      </div>
                      {!isMobile && !mine && (
                        <div className={`chat-message-tools inline${mine ? ' mine' : ''}`}>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => openReplyComposer(item)}>답장</button>
                          <button type="button" className="small ghost chat-tool-button" onClick={() => setPickerOpenFor(pickerOpenFor === item.id ? null : item.id)}>반응</button>
                        </div>
                      )}
                    </div>
                    {(item.reaction_summary || []).length > 0 && (
                      <div className={`chat-message-reaction-summary${mine ? ' mine' : ''}`}>
                        {(item.reaction_summary || []).map(reaction => (
                          <button
                            key={`${item.id}-${reaction.emoji}`}
                            type="button"
                            className="reaction-pill"
                            onClick={() => handleReaction(item.id, reaction.emoji).catch(err => window.alert(err.message))}
                          >
                            {reaction.emoji} {reaction.count}
                          </button>
                        ))}
                      </div>
                    )}
                    {pickerOpenFor === item.id && (
                      <div className="emoji-picker-row">
                        {['👍', '❤️', '😂', '👏', '🔥'].map(emoji => (
                          <button
                            key={`${item.id}-${emoji}`}
                            type="button"
                            className="emoji-button"
                            onClick={() => {
                              setPickerOpenFor(null)
                              handleReaction(item.id, emoji).catch(err => window.alert(err.message))
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="chat-room-compose-section">
          {replyTarget && (
            <div className="chat-reply-draft-bar">
              <div className="chat-reply-draft-text">
                <strong>{replyTarget.sender?.nickname || '회원'}에게 답장</strong>
                <div>{replyTarget.message || replyTarget.attachment_name || '첨부 메시지'}</div>
              </div>
              <button type="button" className="small ghost" onClick={() => setReplyTarget(null)}>취소</button>
            </div>
          )}
          {selectedFile && (
            <div className="chat-selected-file-bar">
              <span>{selectedFile.name}</span>
              <button type="button" className="small ghost" onClick={() => setSelectedFile(null)}>제거</button>
            </div>
          )}
          <form className="chat-compose-box compact" onSubmit={handleSend}>
            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={event => setSelectedFile(event.target.files?.[0] || null)} />
            <input ref={fileInputRef} type="file" hidden onChange={event => setSelectedFile(event.target.files?.[0] || null)} />
            <button type="button" className="chat-plus-button" onClick={() => setPlusMenuOpen(true)}>＋</button>
            <input
              value={message}
              onChange={event => setMessage(event.target.value)}
              placeholder="메시지를 입력하세요"
              className="chat-message-input"
            />
            <button type="submit" className="chat-send-button" disabled={sending}>{sending ? '전송중' : '전송'}</button>
          </form>
        </div>
      </section>

      <ChatActionSheet
        title={chatActionSheet?.title}
        actions={chatActionSheet?.actions}
        reactions={chatActionSheet?.reactions}
        onReact={chatActionSheet?.onReact}
        onClose={() => setChatActionSheet(null)}
      />

      {plusMenuOpen && (
        <div className="sheet-backdrop sheet-backdrop-bottom" onClick={() => setPlusMenuOpen(false)}>
          <div className="chat-bottom-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">채팅 부가 기능</div>
            <div className="chat-plus-grid">
              {CHAT_PLUS_ACTIONS.map(([value, label]) => (
                <button key={value} type="button" className="chat-plus-action" onClick={() => handlePlusAction(value)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {membersOpen && (
        <div className="profile-preview-backdrop" onClick={() => setMembersOpen(false)}>
          <div className="chat-popup-menu member-list-popup" onClick={e => e.stopPropagation()}>
            <div className="member-list-popup-header">
              <button type="button" className="small ghost member-list-back-button" onClick={() => setMembersOpen(false)}>뒤로</button>
              <div className="sheet-title member-list-title">참여 인원 {roomMemberCount}명</div>
              <span className="member-list-header-spacer" aria-hidden="true" />
            </div>
            <div className="chat-member-list">
              {roomMembers.map(member => (
                <button key={`member-${member.id || member.nickname}`} type="button" className="chat-member-list-item clickable" onClick={() => openMemberProfile(member)}>
                  <AvatarCircle src={member.photo_url} label={member.nickname || '회원'} size={40} />
                  <span>{member.nickname || '회원'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {memberProfilePreview && (
        <div className="profile-preview-backdrop" onClick={() => setMemberProfilePreview(null)}>
          <div className="profile-preview-card" onClick={e => e.stopPropagation()}>
            <div className="profile-preview-cover" style={memberProfilePreview.cover_url ? { backgroundImage: `url(${memberProfilePreview.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
            <div className="profile-preview-main">
              <AvatarCircle src={memberProfilePreview.photo_url} label={memberProfilePreview.nickname} size={88} className="profile-preview-avatar" />
              <div className="profile-preview-name">{memberProfilePreview.nickname || '회원'}</div>
              <div className="profile-preview-oneliner">{memberProfilePreview.one_liner || memberProfilePreview.bio || memberProfilePreview.region || '한줄소개가 없습니다.'}</div>
              <div className="inline-actions wrap center profile-preview-actions">
                <button type="button" onClick={() => goDirectChatWithUser(memberProfilePreview.id)}>채팅</button>
                {String(memberProfilePreview.id) !== String(currentUser?.id) && <button type="button" className="ghost" onClick={() => window.alert('음성 기능은 다음 단계에서 연결됩니다.')}>음성</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function MapPage() {
  const isMobile = useIsMobile()
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const markerLayerRef = useRef(null)
  const watchIdRef = useRef(null)
  const shareToastTimerRef = useRef(null)
  const [users, setUsers] = useState([])
  const [shareNotice, setShareNotice] = useState('')
  const [shareStatus, setShareStatus] = useState({ eligible: false, consent_granted: false, sharing_enabled: false, active_now: false, active_assignment: null })

  function showShareNotice(message) {
    setShareNotice(message)
    if (shareToastTimerRef.current) window.clearTimeout(shareToastTimerRef.current)
    shareToastTimerRef.current = window.setTimeout(() => setShareNotice(''), 2600)
  }

  function buildMapUsersWithDemo(list) {
    const base = Array.isArray(list) ? [...list] : []
    const hasDemo = base.some(item => String(item?.id) === 'demo-vehicle')
    if (!hasDemo) {
      base.push({
        id: 'demo-vehicle',
        nickname: '테스트 차량',
        branch_no: 99,
        vehicle_number: '테스트-0000',
        region: '서울 테스트위치',
        latitude: 37.5665,
        longitude: 126.978,
        map_status: { status_text: '현위치 서울 테스트위치에 있고 정차 중', current_location: '서울 테스트위치', is_moving: false },
      })
    }
    return base
  }

  async function loadMapUsers() {
    try {
      const list = await api('/api/map-users')
      setUsers(buildMapUsersWithDemo(list || []))
    } catch (_) {
      setUsers(buildMapUsersWithDemo([]))
    }
  }

  async function refreshStatus() {
    try {
      const status = await api('/api/location-sharing/status')
      setShareStatus(status || {})
    } catch (_) {}
  }

  useEffect(() => {
    loadMapUsers().catch(() => {})
    refreshStatus().catch(() => {})
    return () => {
      if (shareToastTimerRef.current) window.clearTimeout(shareToastTimerRef.current)
    }
  }, [])

  async function handleToggleShare(nextEnabled) {
    if (!nextEnabled) {
      await api('/api/location-sharing/consent', { method: 'POST', body: JSON.stringify({ enabled: false }) })
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      await refreshStatus()
      return
    }
    const status = await api('/api/location-sharing/status')
    if (!status?.eligible) {
      window.alert('차량번호와 호점이 등록된 계정에서만 사용할 수 있습니다.')
      return
    }
    if (!isMobile) {
      window.alert('내 위치 공유는 모바일에서만 실제 위치가 갱신됩니다. PC 로그인 상태에서는 위치가 업데이트되지 않습니다.')
    }
    const approved = window.confirm('배정된 일정 시간대(시작 1시간 전 ~ 종료 30분 후)에만 위치를 공유합니다. 계속하시겠습니까?')
    if (!approved) return
    await api('/api/location-sharing/consent', { method: 'POST', body: JSON.stringify({ enabled: true }) })
    await refreshStatus()
    showShareNotice('내위치 공유가 켜져 있습니다. 배정 시간대에 자동 공유됩니다.')
  }

  useEffect(() => {
    let cancelled = false
    async function syncWatcher() {
      try {
        const status = await api('/api/location-sharing/status')
        if (cancelled) return
        setShareStatus(status || {})
        if (!status?.sharing_enabled || !Array.isArray(status?.today_assignments) || status.today_assignments.length === 0 || !navigator.geolocation || !isMobile) {
          if (watchIdRef.current !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
          }
          return
        }
        if (watchIdRef.current !== null) return
        watchIdRef.current = navigator.geolocation.watchPosition(async pos => {
          try {
            const currentUser = getStoredUser()
            await api('/api/profile/location', {
              method: 'POST',
              body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, region: currentUser?.region || '서울' }),
            })
            if (!cancelled) loadMapUsers().catch(() => {})
          } catch (_) {}
        }, () => {
          showShareNotice('위치 권한이 거부되어 지도 공개를 진행할 수 없습니다.')
        }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })
      } catch (_) {}
    }
    syncWatcher()
    const timer = window.setInterval(syncWatcher, 45000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true }).setView([37.5665, 126.9780], 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    leafletRef.current = map
    return () => {
      map.remove()
      leafletRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!leafletRef.current || !markerLayerRef.current) return
    markerLayerRef.current.clearLayers()
    if (users.length === 0) return
    const bounds = []
    users.forEach(item => {
      const label = ENCLOSED_NUMBERS[item.branch_no] || String(item.branch_no || '?')
      const markerClass = item.map_status?.is_moving ? 'branch-marker moving' : 'branch-marker stopped'
      const icon = L.divIcon({ className: 'branch-marker-wrap', html: `<div class="${markerClass}">${label}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] })
      L.marker([item.latitude, item.longitude], { icon })
        .bindPopup(`<strong>${item.branch_no || '-'}호점</strong><br/>${item.nickname}<br/>${item.vehicle_number || '-'}<br/>${item.region}`)
        .addTo(markerLayerRef.current)
      bounds.push([item.latitude, item.longitude])
    })
    if (bounds.length === 1) leafletRef.current.setView(bounds[0], 12)
    else leafletRef.current.fitBounds(bounds, { padding: [30, 30] })
  }, [users])

  return (
    <div className="stack-page">
      <section className="card map-card enhanced-map-card">
        <div className={`map-card-head ${isMobile ? 'mobile' : ''}`}>
          <div className="map-head-spacer" />
          <label className="share-toggle map-share-toggle">
            <span>내위치 공유</span>
            <input type="checkbox" checked={Boolean(shareStatus?.sharing_enabled)} onChange={e => handleToggleShare(e.target.checked).catch(err => window.alert(err.message))} />
            <span className="share-toggle-slider" />
          </label>
        </div>
        {shareNotice && <div className="map-toast-notice">{shareNotice}</div>}
        <div ref={mapRef} className="real-map-canvas" />
        <div className="vehicle-list-panel">
          <div className="vehicle-list-title">차량 목록</div>
          <div className="vehicle-list-items">
            {users.map(item => {
              const statusText = item.map_status?.status_text || `현위치 ${item.map_status?.current_location || item.region || '-'}에 있고 정차 중`
              return (
                <div key={item.id} className={`vehicle-list-item ${item.map_status?.is_moving ? 'moving' : 'stopped'}`}>
                  <div className="vehicle-list-line primary">
                    <strong>[{item.branch_no}호점]</strong>
                    <span>[{statusText}]</span>
                  </div>
                  {item.map_status?.is_moving && (
                    <>
                      <div className="vehicle-list-line sub">* {item.branch_no}호점 이동소요시간 카카오맵 API 연동 후 표시 예정</div>
                      <div className="vehicle-list-line sub">* {item.branch_no}호점 예상도착시간 카카오맵 API 연동 후 표시 예정</div>
                    </>
                  )}
                </div>
              )
            })}
            {users.length === 0 && <div className="muted">지도에 표시할 차량 위치가 없습니다.</div>}
          </div>
        </div>
      </section>
    </div>
  )
}


function MeetupsPage() {

  const [meetups, setMeetups] = useState([])
  const [reviews, setReviews] = useState([])
  const [form, setForm] = useState({ title: '', place: '', meetup_date: '', start_time: '', end_time: '', content: '', cautions: '', notes: '' })
  const [review, setReview] = useState({ schedule_id: '', content: '' })
  async function load() {
    const [m, r] = await Promise.all([api('/api/meetup-schedules'), api('/api/meetup-reviews')])
    setMeetups(m)
    setReviews(r)
  }
  useEffect(() => { load() }, [])
  async function createMeetup(e) {
    e.preventDefault()
    await api('/api/meetup-schedules', { method: 'POST', body: JSON.stringify(form) })
    setForm({ title: '', place: '', meetup_date: '', start_time: '', end_time: '', content: '', cautions: '', notes: '' })
    load()
  }
  async function createReview(e) {
    e.preventDefault()
    await api('/api/meetup-reviews', { method: 'POST', body: JSON.stringify({ schedule_id: Number(review.schedule_id), content: review.content }) })
    setReview({ schedule_id: '', content: '' })
    load()
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>모임 일정 등록</h2>
        <form onSubmit={createMeetup} className="stack">
          <input placeholder="모임 제목" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input placeholder="장소" value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} />
          <input type="date" placeholder="모임 날짜" value={form.meetup_date} onChange={e => setForm({ ...form, meetup_date: e.target.value })} />
          <div className="grid2">
            <input type="time" placeholder="시작 시간" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
            <input type="time" placeholder="종료 시간" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
          </div>
          <textarea placeholder="모임 내용" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
          <textarea placeholder="주의사항" value={form.cautions} onChange={e => setForm({ ...form, cautions: e.target.value })} />
          <textarea placeholder="추가 메모" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <button>등록</button>
        </form>
      </section>
      <section className="card">
        <h2>모임 목록 / 후기</h2>
        <div className="list">
          {meetups.map(item => (
            <div className="list-item block" key={item.id}>
              <div><strong>{item.title}</strong></div>
              <div className="muted">{item.meetup_date} {item.start_time}-{item.end_time} / {item.place}</div>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
        <form onSubmit={createReview} className="stack">
          <input placeholder="일정 번호" value={review.schedule_id} onChange={e => setReview({ ...review, schedule_id: e.target.value })} />
          <textarea placeholder="후기 내용" value={review.content} onChange={e => setReview({ ...review, content: e.target.value })} />
          <button>후기 등록</button>
        </form>
        <div className="list">
          {reviews.map(item => (
            <div key={item.id} className="list-item block">
              <strong>{item.user.nickname}</strong>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function BoardsPage() {
  const [category, setCategory] = useState('free')
  const [posts, setPosts] = useState([])
  const [form, setForm] = useState({ title: '', content: '' })
  const categories = [
    ['free', '자유'],
    ['anonymous', '익명'],
    ['tips', '팁'],
  ]
  async function load() {
    const data = await api(`/api/boards/${category}`)
    setPosts(data)
  }
  useEffect(() => { load() }, [category])
  async function createPost(e) {
    e.preventDefault()
    await api(`/api/boards/${category}`, { method: 'POST', body: JSON.stringify(form) })
    setForm({ title: '', content: '' })
    load()
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>게시판</h2>
        <div className="inline-actions wrap">
          {categories.map(([value, label]) => <button key={value} className={category === value ? 'small selected-toggle' : 'small ghost'} onClick={() => setCategory(value)}>{label}</button>)}
        </div>
        <div className="list">
          {posts.map(item => (
            <div className="list-item block" key={item.id}>
              <strong>{item.title}</strong>
              <div className="muted">{item.user.nickname} / {item.created_at}</div>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>게시글 작성</h2>
        <form onSubmit={createPost} className="stack">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="제목" />
          <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="내용" />
          <button>등록</button>
        </form>
      </section>
    </div>
  )
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}
function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}
function addDays(date, amount) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}
function fmtDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildMonthDays(date) {
  const start = startOfMonth(date)
  const firstGridDate = addDays(start, -start.getDay())
  return Array.from({ length: 42 }, (_, index) => addDays(firstGridDate, index))
}

function isSameMonthDate(left, right) {
  if (!left || !right) return false
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

const DEFAULT_DEPARTMENT_OPTIONS = [
  '본사업무',
  '당일이사 2인 업무',
  '당일이사 3인 이상업무',
  '짐보관이사 2인 업무',
  '짐보관이사 3인 이상업무',
  '당일이사 1인 업무',
  '연차',
  '월차',
  '기타(예비군, 병가, 조사 등)',
  '손 없는 날',
  '이청잘 휴가',
]

const DEPARTMENT_AUTO_ASSIGN_OPTIONS = [
  '당일이사 1인 업무',
  '당일이사 2인 업무',
  '당일이사 3인 이상업무',
  '짐보관이사 2인 업무',
  '짐보관이사 3인 이상업무',
]

const DEFAULT_DEPARTMENT_COLOR_MAP = {
  '본사업무': '#2563eb',
  '당일이사 1인 업무': '#2563eb',
  '당일이사 2인 업무': '#1d4ed8',
  '당일이사 3인 이상업무': '#1e40af',
  '짐보관이사 2인 업무': '#0ea5e9',
  '짐보관이사 3인 이상업무': '#0369a1',
  '연차': '#8b5cf6',
  '월차': '#7c3aed',
  '기타(예비군, 병가, 조사 등)': '#64748b',
  '손 없는 날': '#16a34a',
  '이청잘 휴가': '#f59e0b',
}

function getStoredDepartmentColorMap() {
  if (typeof window === 'undefined') return { ...DEFAULT_DEPARTMENT_COLOR_MAP }
  try {
    const raw = window.localStorage.getItem('icj_department_color_map')
    if (!raw) return { ...DEFAULT_DEPARTMENT_COLOR_MAP }
    return { ...DEFAULT_DEPARTMENT_COLOR_MAP, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_DEPARTMENT_COLOR_MAP }
  }
}

const PLATFORM_OPTIONS = ['숨고', '오늘', '공홈']
const DEPOSIT_METHOD_OPTIONS = ['계약금입금전', '계좌이체', '숨고페이']
const DEPOSIT_AMOUNT_OPTIONS = ['50,000원', '100,000원']

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false))
  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return isMobile
}

function formatNumericAmount(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('ko-KR')
}

function formatMoneyDisplay(value) {
  const formatted = formatNumericAmount(value)
  return formatted ? `${formatted}원` : ''
}

function formatRangeAmount(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/([\d,]+)\s*[~\-]\s*([\d,]+)/)
  if (!match) return ''
  return `${formatNumericAmount(match[1])} ~ ${formatNumericAmount(match[2])}`
}

function buildCostSummary(form) {
  const rangeAmount = formatRangeAmount(form.amount1)
  if (rangeAmount) return `금액미정 / ${rangeAmount}`
  const primary = formatMoneyDisplay(form.amount1)
  if (primary) return primary
  return '금액미정'
}

function buildCostTitlePart(form) {
  const rangeAmount = formatRangeAmount(form.amount1)
  if (rangeAmount) return `((금액미정)) (${rangeAmount})`
  return `((${buildCostSummary(form)}))`
}

function buildScheduleTypeTitlePart(scheduleType) {
  const normalized = String(scheduleType || '').trim()
  if (!normalized || normalized === '선택') return ''
  return normalized
}

function buildScheduleTitle(form) {
  const startDisplay = resolveScheduleStartTime(form.visit_time || form.start_time)
  const scheduleTypeDisplay = buildScheduleTypeTitlePart(form.schedule_type)
  const platformDisplay = form.platform || '플랫폼미정'
  const customerDisplay = resolveScheduleCustomerName(form.customer_name)
  const costDisplay = buildCostTitlePart(form)
  return [startDisplay, scheduleTypeDisplay, platformDisplay, customerDisplay, costDisplay].filter(Boolean).join(' ').trim()
}

function normalizeShortDateInput(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const groups = raw.split(/[^\d]+/).filter(Boolean)
  if (groups.length >= 3) {
    const [yearRaw, monthRaw, dayRaw] = groups
    const year = yearRaw.slice(-2).padStart(2, '0')
    const month = monthRaw.padStart(2, '0')
    const day = dayRaw.padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  }
  if (digits.length === 8) {
    return `${digits.slice(2, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }
  return raw
}

function toIsoDateInputValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{2}-\d{2}-\d{2}$/.test(raw)) return `20${raw}`
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  if (digits.length === 6) return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  return ''
}

function displayShortDate(value) {
  if (!value) return ''
  return toIsoDateInputValue(value) || normalizeShortDateInput(value)
}

function formatSelectedDateLabel(value) {
  if (!value) return '날짜를 선택해 주세요.'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`
}

function applyAlphaToHex(hex, alpha = '22') {
  const raw = String(hex || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return `${raw}${alpha}`
  return raw || '#2563eb'
}

function eventTimeLine(item) {
  const start = item.start_time || '미정'
  const end = item.end_time || '미정'
  return `${start} ~ ${end}`
}

function ScheduleCardLine({ item, mobileCompact = false, colorized = false }) {
  const colorStyle = colorized ? { background: applyAlphaToHex(item.color, '24'), borderColor: applyAlphaToHex(item.color, '88') } : undefined
  const lines = buildMobileScheduleLines(item)
  if (mobileCompact) {
    return (
      <div className="schedule-line-mobile" style={colorStyle}>
        <div className="schedule-line-mobile-title">{lines.line1}</div>
        <div className={lines.depositPending ? 'schedule-line-mobile-deposit pending' : 'schedule-line-mobile-deposit confirmed'}>{lines.line2}</div>
        <div className="schedule-line-mobile-meta">{lines.line3}</div>
      </div>
    )
  }
  return (
    <div className="schedule-line-default" style={colorStyle}>
      <div className="schedule-line-default-title">{lines.line1}</div>
      <div className={lines.depositPending ? 'schedule-line-default-deposit pending' : 'schedule-line-default-deposit confirmed'}>{lines.line2}</div>
      <div className="schedule-line-default-meta">{lines.line3}</div>
    </div>
  )
}


function normalizeBusinessExclusionDetails(items = [], fallback = []) {
  const seeded = Array.isArray(items) && items.length > 0
    ? items.map(item => ({ name: String(item?.name || item?.label || '').trim(), reason: String(item?.reason || '').trim() }))
    : (fallback || []).map(item => {
        const raw = String(item || '').trim()
        const match = raw.match(/^(.*?)(?:\s*\(사유\s*:\s*(.*?)\))?$/)
        return { name: String(match?.[1] || raw).replace(/-열외$/, '').trim(), reason: String(match?.[2] || '').trim() }
      })
  while (seeded.length < 6) seeded.push({ name: '', reason: '' })
  return seeded.slice(0, 6)
}

function normalizeStaffExclusionDetails(items = [], fallback = []) {
  const seeded = Array.isArray(items) && items.length > 0
    ? items.map(item => ({ name: String(item?.name || '').trim(), reason: String(item?.reason || '').trim() }))
    : (fallback || []).map(item => {
        const raw = String(item || '').trim()
        const match = raw.match(/^(.*?)(?:\s*\(사유\s*:\s*(.*?)\))?$/)
        return { name: String(match?.[1] || raw).replace(/-열외$/, '').trim(), reason: String(match?.[2] || '').trim() }
      })
  while (seeded.length < 6) seeded.push({ name: '', reason: '' })
  return seeded.slice(0, 6)
}

function compactExclusionDetails(items = []) {
  return (items || []).map(item => ({
    name: String(item?.name || '').trim(),
    reason: String(item?.reason || '').trim(),
  })).filter(item => item.name)
}

function exclusionCount(items = []) {
  return compactExclusionDetails(items).length
}

function renderExclusionText(items = [], emptyLabel = '-') {
  const normalized = compactExclusionDetails(items)
  if (normalized.length === 0) return emptyLabel
  return normalized.map(item => `${item.name}(${item.reason || '-'})`).join(' / ')
}

function formatBusinessExceptionLabel(item = {}) {
  const branchLabel = item?.branch_no ? `[${item.branch_no}호점]` : '[미지정]'
  const nameLabel = item?.name ? `[${item.name}]` : '[이름미지정]'
  const reasonLabel = `[${String(item?.reason || '').trim() || '-'}]`
  return `${branchLabel} ${nameLabel} ${reasonLabel}`
}

function CalendarPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const initialDate = searchParams.get('date') || fmtDate(new Date())
  const initialMonth = (() => {
    const parsed = new Date(`${initialDate}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? startOfMonth(new Date()) : startOfMonth(parsed)
  })()
  const [items, setItems] = useState([])
  const [workDays, setWorkDays] = useState([])
  const [monthCursor, setMonthCursor] = useState(initialMonth)
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [overflowPopup, setOverflowPopup] = useState({ dateKey: '', items: [], title: '', x: 0, y: 0 })
  const [calendarStatusDate, setCalendarStatusDate] = useState('')
  const [calendarStatusForm, setCalendarStatusForm] = useState(buildDayStatusForm(null))
  const [mobileStatusPopup, setMobileStatusPopup] = useState(null)
  const [calendarStatusEditMode, setCalendarStatusEditMode] = useState(false)
  const [businessExclusionDraft, setBusinessExclusionDraft] = useState(() => normalizeBusinessExclusionDetails())
  const [staffExclusionDraft, setStaffExclusionDraft] = useState(() => normalizeStaffExclusionDetails())
  const [legendOpen, setLegendOpen] = useState(false)
  const [vehicleListPopup, setVehicleListPopup] = useState({ open: false, title: '', items: [] })
  const [exceptionManagerOpen, setExceptionManagerOpen] = useState(false)
  const [exceptionAccounts, setExceptionAccounts] = useState([])
  const [exceptionLoading, setExceptionLoading] = useState(false)
  const [exceptionAction, setExceptionAction] = useState('add')
  const [exceptionForm, setExceptionForm] = useState({ user_id: '', start_date: initialDate, end_date: initialDate, reason: '' })
  const [exceptionItems, setExceptionItems] = useState([])
  const [editingExceptionId, setEditingExceptionId] = useState(null)
  const days = useMemo(() => buildMonthDays(monthCursor), [monthCursor])

  async function load() {
    const firstDate = fmtDate(days[0] || new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1))
    const [calendarData, workData] = await Promise.all([
      api('/api/calendar/events'),
      api(`/api/work-schedule?start_date=${firstDate}&days=42`),
    ])
    setItems(calendarData)
    setWorkDays(workData.days || [])
  }
  useEffect(() => { load().catch(() => {}) }, [monthCursor, days])
  useEffect(() => {
    const preset = searchParams.get('date')
    if (preset) {
      setSelectedDate(preset)
      const parsed = new Date(`${preset}T00:00:00`)
      if (!Number.isNaN(parsed.getTime())) {
        setMonthCursor(startOfMonth(parsed))
      }
    }
  }, [searchParams])

  const monthLabel = useMemo(() => `${monthCursor.getFullYear()}년 ${monthCursor.getMonth() + 1}월`, [monthCursor])
  const grouped = useMemo(() => {
    const map = new Map()
    items.forEach(item => {
      const key = item.event_date
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    })
    for (const [, value] of map.entries()) {
      value.sort((a, b) => {
        const aTime = a.start_time === '미정' ? '99:99' : a.start_time
        const bTime = b.start_time === '미정' ? '99:99' : b.start_time
        return `${aTime}-${a.id}`.localeCompare(`${bTime}-${b.id}`)
      })
    }
    return map
  }, [items])
  const visibleLaneCount = isMobile ? 3 : 5
  const workDayMap = useMemo(() => new Map((workDays || []).map(day => [day.date, day])), [workDays])
  const detailItems = grouped.get(selectedDate) || []
  const selectedDaySummary = workDayMap.get(selectedDate) || buildDayStatusForm({ date: selectedDate })

  function openDateForm(date) {
    navigate(`/schedule/new?date=${fmtDate(date)}`)
  }

  function selectDate(date) {
    const key = fmtDate(date)
    setSelectedDate(key)
    navigate(`/schedule?date=${key}`, { replace: true })
  }

  function moveMonth(amount) {
    const nextMonth = addMonths(monthCursor, amount)
    setMonthCursor(nextMonth)
    const nextSelected = fmtDate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1))
    setSelectedDate(nextSelected)
    navigate(`/schedule?date=${nextSelected}`, { replace: true })
  }

  function openOverflowPopup(date, dayItems, event) {
    if (event) event.stopPropagation()
    const rect = event?.currentTarget?.getBoundingClientRect?.()
    const anchorX = rect ? Math.min(window.innerWidth - 320, Math.max(12, rect.left - 120)) : 24
    const anchorY = rect ? Math.min(window.innerHeight - 260, rect.bottom + 8) : 120
    setOverflowPopup({ dateKey: fmtDate(date), items: dayItems, title: '일정목록', x: anchorX, y: anchorY })
  }

  function closeOverflowPopup() {
    setOverflowPopup({ dateKey: '', items: [], title: '', x: 0, y: 0 })
  }

  function openCalendarStatus(daySummary) {
    const nextForm = buildDayStatusForm(daySummary)
    setCalendarStatusForm(nextForm)
    setCalendarStatusDate(daySummary.date)
    setMobileStatusPopup(daySummary)
    setCalendarStatusEditMode(false)
    setBusinessExclusionDraft(normalizeBusinessExclusionDetails(nextForm.excluded_business_details, daySummary?.excluded_business_names || []))
    setStaffExclusionDraft(normalizeStaffExclusionDetails(nextForm.excluded_staff_details, daySummary?.excluded_staff_names || []))
  }

  function closeCalendarStatusPopup() {
    setCalendarStatusDate('')
    setMobileStatusPopup(null)
    setCalendarStatusEditMode(false)
  }

  function openVehicleListPopup(daySummary) {
    const items = Array.isArray(daySummary?.available_vehicle_accounts) ? daySummary.available_vehicle_accounts : []
    setVehicleListPopup({
      open: true,
      title: `${formatSelectedDateLabel(daySummary?.date || selectedDate)} 가용차량 목록`,
      items,
    })
  }

  function closeVehicleListPopup() {
    setVehicleListPopup({ open: false, title: '', items: [] })
  }

  function updateBusinessExclusion(index, field, value) {
    setBusinessExclusionDraft(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  function updateStaffExclusion(index, field, value) {
    setStaffExclusionDraft(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  async function submitCalendarStatus(e) {
    e.preventDefault()
    const normalizedBusiness = compactExclusionDetails(businessExclusionDraft)
    const normalizedStaff = compactExclusionDetails(staffExclusionDraft)
    const payload = {
      ...calendarStatusForm,
      available_vehicle_count: Number(selectedDaySummary?.available_vehicle_count || 0),
      excluded_business_details: normalizedBusiness,
      excluded_staff_details: normalizedStaff,
      excluded_business: normalizedBusiness.map(item => item.name).join(', '),
      excluded_staff: normalizedStaff.map(item => item.name).join(', '),
    }
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify(payload) })
    closeCalendarStatusPopup()
    await load()
  }

  async function callVehicleExclusionManagerApi(accountId, action = 'list', payload = null, exclusionId = null) {
    const primaryBase = `/api/admin/accounts/${accountId}/vehicle-exclusions`
    const aliasBase = `/api/admin/vehicle-exclusions/${accountId}`
    const attempt = async (path, options = {}) => api(path, options)
    const isRetryable = error => {
      const message = String(error?.message || '')
      return message.includes('(404)') || message.includes('(405)') || message.includes('Not Found') || message.includes('Method Not Allowed')
    }
    try {
      if (action === 'list') return await attempt(primaryBase)
      if (action === 'create') return await attempt(primaryBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'update') return await attempt(`${primaryBase}/${exclusionId}`, { method: 'PUT', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${primaryBase}/${exclusionId}`, { method: 'DELETE' })
      throw new Error('지원하지 않는 차량열외 요청입니다.')
    } catch (error) {
      if (!isRetryable(error)) throw error
      if (action === 'list') return await attempt(aliasBase)
      if (action === 'create') return await attempt(aliasBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'update') return await attempt(`${aliasBase}/${exclusionId}`, { method: 'PUT', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${aliasBase}/${exclusionId}`, { method: 'DELETE' })
      throw error
    }
  }

  async function openExceptionManager() {
    if (Number(currentUser?.grade || 6) > 2) return
    setExceptionManagerOpen(true)
    setExceptionAction('add')
    setEditingExceptionId(null)
    setExceptionForm({ user_id: '', start_date: selectedDate, end_date: selectedDate, reason: '' })
    setExceptionLoading(true)
    try {
      const adminData = await api('/api/admin-mode')
      const accounts = (adminData?.accounts || [])
        .filter(item => Number(item?.branch_no || 0) > 0)
        .map(item => ({
          id: item.id,
          branch_no: item.branch_no,
          name: item.nickname || item.name || item.email || `계정 ${item.id}`,
          label: `[${item.branch_no}호점] ${item.nickname || item.name || item.email || `계정 ${item.id}`}`,
        }))
      setExceptionAccounts(accounts)
      const dayItems = Array.isArray(selectedDaySummary?.auto_unavailable_business) ? selectedDaySummary.auto_unavailable_business : []
      setExceptionItems(dayItems)
      if (accounts.length) {
        setExceptionForm(prev => ({ ...prev, user_id: prev.user_id || String(accounts[0].id) }))
      }
    } catch (error) {
      window.alert(error.message || '열외관리 데이터를 불러오지 못했습니다.')
      setExceptionManagerOpen(false)
    } finally {
      setExceptionLoading(false)
    }
  }

  function startExceptionEdit(item) {
    setExceptionAction('edit')
    setEditingExceptionId(item?.exclusion_id || item?.id || null)
    setExceptionForm({
      user_id: String(item?.user_id || ''),
      start_date: String(item?.start_date || selectedDate),
      end_date: String(item?.end_date || selectedDate),
      reason: String(item?.reason || ''),
    })
  }

  async function submitExceptionAction() {
    const userId = Number(exceptionForm.user_id || 0)
    if (userId <= 0) {
      window.alert('열외 계정을 선택해 주세요.')
      return
    }
    const payload = { start_date: exceptionForm.start_date || selectedDate, end_date: exceptionForm.end_date || selectedDate, reason: exceptionForm.reason || '' }
    setExceptionLoading(true)
    try {
      if (exceptionAction === 'edit' && editingExceptionId) {
        await callVehicleExclusionManagerApi(userId, 'update', payload, editingExceptionId)
      } else {
        await callVehicleExclusionManagerApi(userId, 'create', payload)
      }
      await load()
      const refreshed = (workDayMap.get(selectedDate)?.auto_unavailable_business || [])
      setExceptionItems(refreshed)
      setExceptionAction('add')
      setEditingExceptionId(null)
      setExceptionForm(prev => ({ ...prev, start_date: selectedDate, end_date: selectedDate, reason: '' }))
    } catch (error) {
      window.alert(error.message || '열외관리 저장에 실패했습니다.')
    } finally {
      setExceptionLoading(false)
    }
  }

  async function deleteExceptionItem(item) {
    const targetId = Number(item?.user_id || 0)
    const exclusionId = Number(item?.exclusion_id || 0)
    if (targetId <= 0 || exclusionId <= 0) return
    setExceptionLoading(true)
    try {
      await callVehicleExclusionManagerApi(targetId, 'delete', null, exclusionId)
      await load()
    } catch (error) {
      window.alert(error.message || '열외삭제에 실패했습니다.')
    } finally {
      setExceptionLoading(false)
    }
  }

  return (
    <div className={`stack-page schedule-page${isMobile ? ' mobile' : ''}`}>
      <section className="card schedule-card">
        <div className="calendar-toolbar upgraded">
          <div className="schedule-toolbar-head">
            <div className="inline-actions">
              <button type="button" className="ghost small icon-month-button" onClick={() => moveMonth(-1)}>◀</button>
              <strong>{monthLabel}</strong>
              <button type="button" className="ghost small icon-month-button" onClick={() => moveMonth(1)}>▶</button>
            </div>
            <button type="button" className="small ghost schedule-legend-trigger" onClick={() => setLegendOpen(true)}>표 설명</button>
          </div>
          <div className={`inline-actions wrap schedule-toolbar-actions${isMobile ? ' mobile-stacked' : ' desktop-vertical'}`}>
            {!readOnly && <button type="button" className="small" onClick={() => navigate(`/schedule/new?date=${selectedDate || fmtDate(new Date())}`)}>일정등록</button>}
            {!readOnly && <button type="button" className="small ghost" onClick={() => navigate(`/schedule/handless?month=${fmtDate(monthCursor).slice(0, 7)}`)}>손없는날등록</button>}
          </div>
        </div>
        <div className="calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day} className="weekday">{day}</div>)}</div>
        <div className={`calendar-grid schedule-grid detail-mode${isMobile ? ' mobile-calendar-grid' : ''}`}>
          {days.map((date, idx) => {
            const key = date ? fmtDate(date) : `blank-${idx}`
            const today = date && fmtDate(date) === fmtDate(new Date())
            const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6)
            const isSelected = date && fmtDate(date) === selectedDate
            const dayItems = date ? (grouped.get(fmtDate(date)) || []) : []
            const visibleItems = dayItems.slice(0, visibleLaneCount)
            const extraCount = Math.max(dayItems.length - visibleLaneCount, 0)
            const daySummary = date ? (workDayMap.get(fmtDate(date)) || buildDayStatusForm({ date: fmtDate(date) })) : null
            const dayCapacity = daySummary ? analyzeScheduleDayCapacity(daySummary) : null
            const dayCapacityClass = daySummary ? buildCalendarDayStatusClass(daySummary) : ''
            const isCurrentMonth = date ? isSameMonthDate(date, monthCursor) : false
            return (
              <div key={key} className={date ? `calendar-cell schedule-cell detail-cell${today ? ' today' : ''}${isWeekend ? ' weekend' : ''}${isSelected ? ' selected' : ''}${dayCapacityClass ? ` ${dayCapacityClass}` : ''}${!isCurrentMonth ? ' outside-month-cell' : ''}` : 'calendar-cell empty'}>
                {date && (
                  <>
                    <div className="calendar-cell-topline schedule-header-line">
                      <button type="button" className={`calendar-date-select ${dayCapacityClass}`.trim()} title={dayCapacity?.detail || ''} onClick={() => selectDate(date)}>
                        <span className="calendar-date">{date.getDate()}</span>
                      </button>
                      {!isMobile && (
                        <div className="calendar-top-actions filled">
                          <button type="button" className="calendar-entry-band secondary filled" onClick={() => setOverflowPopup({ dateKey: fmtDate(date), items: daySummary?.entries || [], title: '스케줄목록' })}>
                            <span className="calendar-entry-label two-line">스케줄<br />목록</span>
                          </button>
                          <button type="button" className="calendar-entry-band filled" onClick={() => openDateForm(date)}>
                            <span className="calendar-entry-label two-line">일정<br />등록</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <button type="button" className={`calendar-day-summary-button redesigned${isMobile ? ' mobile-compact' : ''}`} title={dayCapacity?.detail || ''} onClick={() => openCalendarStatus(daySummary)}>
                      {isMobile ? (
                        <div className="calendar-mobile-summary-stack">
                          <span className="calendar-mobile-vehicle-line">{String(daySummary?.available_vehicle_count ?? 0).padStart(2, '0')}</span>
                          <span className={`calendar-handless-pill mobile-compact ${daySummary?.is_handless_day ? 'active' : 'inactive'}`}>{daySummary?.is_handless_day ? '손없는날' : '일반'}</span>
                        </div>
                      ) : (
                        <>
                          <span className="calendar-day-summary-vehicle">{String(daySummary?.available_vehicle_count ?? 0).padStart(2, '0')}</span>
                          <span className="calendar-day-summary-chip">A:{String(daySummary?.status_a_count ?? 0).padStart(2, '0')}</span>
                          <span className="calendar-day-summary-chip">B:{String(daySummary?.status_b_count ?? 0).padStart(2, '0')}</span>
                          <span className="calendar-day-summary-chip">C:{String(daySummary?.status_c_count ?? 0).padStart(2, '0')}</span>
                        </>
                      )}
                    </button>
                    {!isMobile && <div className={`calendar-handless-banner ${daySummary?.is_handless_day ? 'handless' : 'general'}`}><span>{daySummary?.is_handless_day ? '손없는날' : '일반'}</span></div>}

                    {!isMobile && (
                      <div className="calendar-lanes-stack" role="button" tabIndex={0} onClick={() => selectDate(date)}>
                        <div className="calendar-lanes">
                          {visibleItems.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              className="calendar-lane filled clickable"
                              style={{ background: item.color || '#2563eb', boxShadow: `inset 0 0 0 1px ${applyAlphaToHex(item.color, '55')}` }}
                              title={item.title}
                              onClick={(event) => {
                                event.stopPropagation()
                                navigate(`/schedule/${item.id}`)
                              }}
                            >
                              <span>{item.title}</span>
                            </button>
                          ))}
                          {Array.from({ length: Math.max(visibleLaneCount - visibleItems.length, 0) }).map((_, laneIndex) => (
                            <span key={`empty-${key}-${laneIndex}`} className="calendar-lane" />
                          ))}
                        </div>
                        <div className="calendar-plus-row">
                          {extraCount > 0 ? <button type="button" className="calendar-more-indicator single-plus" onClick={(event) => openOverflowPopup(date, dayItems, event)}>+</button> : <span />}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {isMobile && (
          <div className="mobile-schedule-detail-panel">
            <div className="between">
              <strong>{formatSelectedDateLabel(selectedDate)}</strong>
            </div>
            <div className={`calendar-handless-banner ${selectedDaySummary?.is_handless_day ? 'handless' : 'general'}`}><span>{selectedDaySummary?.is_handless_day ? '손없는날' : '일반'}</span></div>
            <div className="schedule-popup-list embedded">
              {detailItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="detail-schedule-item popup-item colorized"
                  style={{ background: applyAlphaToHex(item.color, '24'), borderColor: applyAlphaToHex(item.color, '88') }}
                  onClick={() => navigate(`/schedule/${item.id}`)}
                >
                  <ScheduleCardLine item={item} colorized={false} />
                </button>
              ))}
              {detailItems.length === 0 && <div className="muted">등록된 일정이 없습니다.</div>}
            </div>
          </div>
        )}
      </section>

      {legendOpen && <ScheduleLegendModal onClose={() => setLegendOpen(false)} />}

      {calendarStatusDate && (
        <div className="schedule-popup-backdrop" onClick={closeCalendarStatusPopup}>
          <section className="schedule-popup-card day-status-popup expanded" onClick={event => event.stopPropagation()}>
            <form onSubmit={submitCalendarStatus} className="work-day-status-editor popup detailed">
              <div className="between work-day-status-editor-head">
                <button type="button" className="ghost small" onClick={closeCalendarStatusPopup}>닫기</button>
                {!readOnly && (
                  <div className="inline-actions wrap">
                    {!calendarStatusEditMode ? (
                      <button type="button" className="small ghost" onClick={() => setCalendarStatusEditMode(true)}>편집</button>
                    ) : (
                      <button type="submit" className="small">저장</button>
                    )}
                  </div>
                )}
              </div>
              <div className="work-day-status-summary-top detailed">
                <button type="button" className="work-day-status-line-button" onClick={() => openVehicleListPopup(selectedDaySummary)}><span className="work-day-status-line">가용차량 {String(calendarStatusForm.available_vehicle_count ?? 0).padStart(2, '0')} / A {String(calendarStatusForm.status_a_count ?? 0).padStart(2, '0')} / B {String(calendarStatusForm.status_b_count ?? 0).padStart(2, '0')} / C {String(calendarStatusForm.status_c_count ?? 0).padStart(2, '0')}</span></button>
                <div className={`calendar-handless-pill ${calendarStatusForm.is_handless_day ? 'active' : ''}`}>{calendarStatusForm.is_handless_day ? '손없음' : '일반'}</div>
              </div>

              {!calendarStatusEditMode && (
                <div className="day-status-detail-view stack">
                  <div className="day-status-detail-row">
                    <strong>가용차량</strong>
                    <button type="button" className="ghost small" onClick={() => openVehicleListPopup(selectedDaySummary)}>{String(calendarStatusForm.available_vehicle_count ?? 0).padStart(2, '0')}대 보기</button>
                  </div>
                  <div className="day-status-detail-row">
                    <strong>A/B/C</strong>
                    <span>A {String(calendarStatusForm.status_a_count ?? 0).padStart(2, '0')}건 · B {String(calendarStatusForm.status_b_count ?? 0).padStart(2, '0')}건 · C {String(calendarStatusForm.status_c_count ?? 0).padStart(2, '0')}건</span>
                  </div>
                  <div className="day-status-detail-row block">
                    <div className="between day-status-exclusion-head">
                      <strong>* 열외자 : {exclusionCount(businessExclusionDraft) + exclusionCount(staffExclusionDraft) + ((selectedDaySummary?.auto_unavailable_business || []).length)}건</strong>
                      {Number(currentUser?.grade || 6) <= 2 ? <button type="button" className="small ghost" onClick={openExceptionManager}>열외관리</button> : null}
                    </div>
                    <div className="muted">- 사업자</div>
                    <div className="day-status-exclusion-list">
                      {(selectedDaySummary?.auto_unavailable_business || []).length ? (selectedDaySummary.auto_unavailable_business || []).map(item => (
                        <div key={`auto-exclusion-${item.exclusion_id || item.user_id}-${item.start_date || ''}`} className="day-status-exclusion-item">{formatBusinessExceptionLabel(item)}</div>
                      )) : <div className="muted">표시할 사업자 열외가 없습니다.</div>}
                    </div>
                    <div className="muted">- 직원 : {renderExclusionText(staffExclusionDraft)}</div>
                  </div>
                  {calendarStatusForm.day_memo ? (
                    <div className="day-status-detail-row block">
                      <strong>상세 메모</strong>
                      <div className="muted">{calendarStatusForm.day_memo}</div>
                    </div>
                  ) : null}
                </div>
              )}

              {calendarStatusEditMode && !readOnly && (
                <>
                  <div className="work-day-status-editor-grid">
                    <label>가용차량수(자동연동)<input type="number" min="0" value={calendarStatusForm.available_vehicle_count} readOnly disabled /></label>
                    <label>A : 숫자입력칸<input type="number" min="0" value={calendarStatusForm.status_a_count} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, status_a_count: Number(e.target.value || 0) })} /></label>
                    <label>B : 숫자입력칸<input type="number" min="0" value={calendarStatusForm.status_b_count} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, status_b_count: Number(e.target.value || 0) })} /></label>
                    <label>C : 숫자입력칸<input type="number" min="0" value={calendarStatusForm.status_c_count} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, status_c_count: Number(e.target.value || 0) })} /></label>
                  </div>
                  <label className="checkbox-line"><input type="checkbox" checked={Boolean(calendarStatusForm.is_handless_day)} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, is_handless_day: e.target.checked })} /> 손없는날 지정</label>
                  <div className="status-exclusion-editor stack">
                    <div className="status-exclusion-title">사업자 열외 편집</div>
                    {businessExclusionDraft.map((item, index) => (
                      <div key={`business-exclusion-${index}`} className="status-exclusion-row">
                        <input value={item.name} onChange={e => updateBusinessExclusion(index, 'name', e.target.value)} placeholder="대표자 입력칸" />
                        <input value={item.reason} onChange={e => updateBusinessExclusion(index, 'reason', e.target.value)} placeholder="사유 입력칸" />
                      </div>
                    ))}
                  </div>
                  <div className="status-exclusion-editor stack">
                    <div className="status-exclusion-title">직원 열외 편집</div>
                    {staffExclusionDraft.map((item, index) => (
                      <div key={`staff-exclusion-${index}`} className="status-exclusion-row">
                        <input value={item.name} onChange={e => updateStaffExclusion(index, 'name', e.target.value)} placeholder="직원 입력칸" />
                        <input value={item.reason} onChange={e => updateStaffExclusion(index, 'reason', e.target.value)} placeholder="사유 입력칸" />
                      </div>
                    ))}
                  </div>
                  <textarea value={calendarStatusForm.day_memo} onChange={e => setCalendarStatusForm({ ...calendarStatusForm, day_memo: e.target.value })} placeholder="상세 메모 입력" className="work-day-status-editor-memo" />
                </>
              )}
            </form>
          </section>
        </div>
      )}

      {vehicleListPopup.open && (
        <div className="schedule-popup-backdrop" onClick={closeVehicleListPopup}>
          <section className="schedule-popup-card vehicle-list-popup" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>{vehicleListPopup.title}</strong>
                <div className="muted">가용차량 {String((vehicleListPopup.items || []).length).padStart(2, '0')}대 목록입니다.</div>
              </div>
              <button type="button" className="ghost small" onClick={closeVehicleListPopup}>닫기</button>
            </div>
            <div className="vehicle-list-stack">
              {(vehicleListPopup.items || []).map((item, index) => (
                <div key={`${item.branch_no || 'x'}-${item.display_name || index}`} className="vehicle-list-row">{item.label}</div>
              ))}
              {!(vehicleListPopup.items || []).length && <div className="muted">표시할 가용차량 목록이 없습니다.</div>}
            </div>
          </section>
        </div>
      )}

      {exceptionManagerOpen && (
        <div className="schedule-popup-backdrop" onClick={() => setExceptionManagerOpen(false)}>
          <section className="schedule-popup-card exception-manager-popup" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>열외관리</strong>
                <div className="muted">관리자 / 부관리자만 차량열외 데이터를 추가·편집·삭제할 수 있습니다.</div>
              </div>
              <button type="button" className="ghost small" onClick={() => setExceptionManagerOpen(false)}>닫기</button>
            </div>
            <div className="inline-actions wrap exception-manager-actions">
              <button type="button" className={exceptionAction === 'add' ? 'small' : 'small ghost'} onClick={() => { setExceptionAction('add'); setEditingExceptionId(null); setExceptionForm(prev => ({ ...prev, start_date: selectedDate, end_date: selectedDate, reason: '' })) }}>열외추가</button>
              <button type="button" className={exceptionAction === 'edit' ? 'small' : 'small ghost'} onClick={() => setExceptionAction('edit')}>열외편집</button>
              <button type="button" className="small ghost" onClick={() => setExceptionAction('delete')}>열외삭제</button>
            </div>
            <div className="exception-manager-grid">
              <label>사업자
                <select value={exceptionForm.user_id} onChange={e => setExceptionForm(prev => ({ ...prev, user_id: e.target.value }))}>
                  <option value="">선택</option>
                  {exceptionAccounts.map(item => <option key={`exception-account-${item.id}`} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>시작일<input type="date" value={exceptionForm.start_date} onChange={e => setExceptionForm(prev => ({ ...prev, start_date: e.target.value }))} /></label>
              <label>종료일<input type="date" value={exceptionForm.end_date} onChange={e => setExceptionForm(prev => ({ ...prev, end_date: e.target.value }))} /></label>
              <label className="exception-reason-field">열외사유<textarea rows={2} value={exceptionForm.reason} onChange={e => setExceptionForm(prev => ({ ...prev, reason: e.target.value }))} placeholder="열외사유 입력" /></label>
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small" disabled={exceptionLoading} onClick={submitExceptionAction}>{exceptionAction === 'edit' ? '편집저장' : '열외추가'}</button>
            </div>
            <div className="day-status-exclusion-list exception-manager-list">
              {(selectedDaySummary?.auto_unavailable_business || []).map(item => (
                <div key={`manager-ex-${item.exclusion_id || item.user_id}-${item.start_date || ''}`} className="exception-manager-item">
                  <div className="exception-manager-text">{formatBusinessExceptionLabel(item)}<div className="muted tiny-text">{item.start_date} ~ {item.end_date}</div></div>
                  <div className="inline-actions wrap">
                    <button type="button" className="small ghost" onClick={() => startExceptionEdit(item)}>열외편집</button>
                    <button type="button" className="small ghost" onClick={() => deleteExceptionItem(item)}>열외삭제</button>
                  </div>
                </div>
              ))}
              {!(selectedDaySummary?.auto_unavailable_business || []).length && <div className="muted">선택한 날짜의 사업자 열외 데이터가 없습니다.</div>}
            </div>
          </section>
        </div>
      )}

      {overflowPopup.items.length > 0 && (
        <div className="schedule-inline-overlay" onClick={closeOverflowPopup}>
          <section className="schedule-inline-popup-card" style={{ left: overflowPopup.x, top: overflowPopup.y }} onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <div>
                <strong>{formatSelectedDateLabel(overflowPopup.dateKey)}</strong>
                <div className="muted">{overflowPopup.title === '스케줄목록' ? '해당 날짜의 스케줄 목록입니다.' : '해당 날짜의 전체 일정 목록입니다.'}</div>
              </div>
              <button type="button" className="ghost small" onClick={closeOverflowPopup}>닫기</button>
            </div>
            <div className="schedule-popup-list">
              {overflowPopup.items.map(item => {
                const isWorkEntry = item.entry_type === 'manual' || item.source_summary === ''
                return (
                <button
                  key={item.id}
                  type="button"
                  className="detail-schedule-item popup-item colorized"
                  style={{ background: applyAlphaToHex(item.color || '#334155', '24'), borderColor: applyAlphaToHex(item.color || '#334155', '88') }}
                  onClick={() => {
                    closeOverflowPopup()
                    if (!isWorkEntry && item.event_id) navigate(`/schedule/${item.event_id}`)
                  }}
                >
                  {isWorkEntry ? <ScheduleCardLine item={item} colorized={false} /> : <ScheduleCardLine item={item} colorized={false} />}
                </button>
              )})}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function emptyWorkScheduleForm(scheduleDate) {
  return {
    id: '',
    entry_type: 'manual',
    event_id: null,
    schedule_date: scheduleDate,
    schedule_time: '',
    customer_name: '',
    representative_names: '',
    staff_names: '',
    memo: '',
  }
}

function buildWorkScheduleForm(item, scheduleDate = '') {
  return {
    id: item?.id ?? '',
    entry_type: item?.entry_type || 'manual',
    event_id: item?.event_id ?? null,
    schedule_date: item?.schedule_date || scheduleDate || '',
    schedule_time: item?.schedule_time || '',
    customer_name: item?.customer_name || '',
    representative_names: item?.representative_names || '',
    staff_names: item?.staff_names || '',
    memo: item?.memo || '',
  }
}

function buildAbcInlineText(item) {
  const a = Number(item?.status_a_count || 0)
  const b = Number(item?.status_b_count || 0)
  const c = Number(item?.status_c_count || 0)
  return `A: ${String(a).padStart(2, '0')} / B: ${String(b).padStart(2, '0')} / C: ${String(c).padStart(2, '0')}`
}

function toNonNegativeInt(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(Math.trunc(parsed), 0)
}

function analyzeScheduleDayCapacity(daySummary) {
  const available = toNonNegativeInt(daySummary?.available_vehicle_count)
  const a = toNonNegativeInt(daySummary?.status_a_count)
  const b = toNonNegativeInt(daySummary?.status_b_count)
  const c = toNonNegativeInt(daySummary?.status_c_count)
  const morningUsed = a + b
  const remainingMorning = available - morningUsed
  const afternoonCapacity = a + Math.max(remainingMorning, 0)
  const remainingAfternoon = afternoonCapacity - c
  const hasMismatch = c > afternoonCapacity
  const effectiveRemaining = remainingMorning > 0 ? remainingMorning : Math.max(remainingAfternoon, 0)

  let level = 'normal'
  let label = '여유'
  if (hasMismatch) {
    level = 'error'
    label = '일정오류'
  } else if (remainingMorning <= 0 && remainingAfternoon <= 0) {
    level = 'full'
    label = '완전마감'
  } else if (effectiveRemaining <= 1) {
    level = 'critical'
    label = '완전마감 직전'
  } else if (effectiveRemaining === 2) {
    level = 'warning'
    label = '마감 거의 직전'
  }

  const detail = hasMismatch
    ? `일정오류 · 가용 ${available} / A ${a} / B ${b} / C ${c} / 오전잔여 ${Math.max(remainingMorning, 0)} / 오후가능 ${afternoonCapacity} / 초과 ${Math.max(c - afternoonCapacity, 0)}`
    : `${label} · 가용 ${available} / A ${a} / B ${b} / C ${c} / 오전잔여 ${Math.max(remainingMorning, 0)} / 오후잔여 ${Math.max(remainingAfternoon, 0)}`

  return {
    available,
    a,
    b,
    c,
    morningUsed,
    remainingMorning,
    afternoonCapacity,
    remainingAfternoon,
    effectiveRemaining,
    hasMismatch,
    level,
    label,
    detail,
  }
}

function buildCalendarDayStatusClass(daySummary) {
  const analysis = analyzeScheduleDayCapacity(daySummary)
  return `calendar-day-state-${analysis.level}`
}

function ScheduleLegendModal({ onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card schedule-legend-modal" onClick={event => event.stopPropagation()}>
        <div className="between">
          <strong>표 설명</strong>
          <button type="button" className="small ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="stack compact-gap schedule-legend-body">
          <div><strong>일자 칸 색상의미</strong></div>
          <div className="schedule-legend-list">
            <div><span className="schedule-legend-chip full">검정</span> 완전 마감</div>
            <div><span className="schedule-legend-chip critical">빨강</span> 완전 마감 직전(차량 1대 여유)</div>
            <div><span className="schedule-legend-chip warning">노랑</span> 마감 거의 직전(차량 2대 여유)</div>
            <div><span className="schedule-legend-chip normal">흰색</span> 여유(차량 3대 이상 여유)</div>
            <div><span className="schedule-legend-chip error">분홍</span> 일정 오류 또는 검토 필요</div>
          </div>
          <div><strong>가용 차량수</strong> : 실제 출동 가능한 차량 수입니다.<br />* [가맹점 총 차량수] - [열외차량] = [가용차량수]을 의미합니다.</div>
          <div><strong>A</strong> : 오후 재출동 가능한 오전일정<br /><strong>B</strong> : 오후 재출동 불가한 오전일정<br /><strong>C</strong> : 오후 2시 30분 이후 일정</div>
          <div><strong>손없음</strong> : 손 없는 날에 해당<br /><strong>일반</strong> : 일반 날짜</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function splitScheduleNames(value) {
  return String(value || '')
    .split(/[\n,/]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function buildAssigneeTagValue(user) {
  return String(user?.nickname || user?.email || '').trim()
}

function buildAssigneeOptionMeta(user) {
  const parts = [String(user?.nickname || '').trim(), String(user?.email || '').trim(), String(user?.phone || '').trim()].filter(Boolean)
  return parts.join(' · ')
}

function filterAssignableUsers(users, query, selectedValues = [], predicate = null) {
  const normalized = String(query || '').trim().toLowerCase()
  const selectedSet = new Set((selectedValues || []).map(item => String(item || '').trim()).filter(Boolean))
  return (users || [])
    .filter(user => {
      const value = buildAssigneeTagValue(user)
      if (!value || selectedSet.has(value)) return false
      if (predicate && !predicate(user)) return false
      if (!normalized) return true
      const haystack = [user?.nickname, user?.email, user?.phone, user?.vehicle_number, user?.branch_no].join(' ').toLowerCase()
      return haystack.includes(normalized)
    })
    .slice(0, 8)
}

function AssigneeInput({ label, value, onChange, users, placeholder, predicate = null, maxCount = 3 }) {
  const [query, setQuery] = useState('')
  const [portalStyle, setPortalStyle] = useState(null)
  const shellRef = useRef(null)
  const selectedValues = useMemo(() => splitScheduleNames(value), [value])
  const suggestions = useMemo(() => filterAssignableUsers(users, query, selectedValues, predicate), [users, query, selectedValues, predicate])

  function syncNext(values) {
    onChange(values.slice(0, maxCount).join(' / '))
  }

  function addByText(raw) {
    const token = String(raw || '').trim()
    if (!token) return
    if (selectedValues.includes(token)) {
      setQuery('')
      return
    }
    syncNext([...selectedValues, token])
    setQuery('')
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ',' || event.key === '@') {
      event.preventDefault()
      addByText(query.replace(/@/g, ''))
    }
    if (event.key === 'Backspace' && !query && selectedValues.length > 0) {
      event.preventDefault()
      syncNext(selectedValues.slice(0, -1))
    }
  }

  useLayoutEffect(() => {
    if (!query.trim() || suggestions.length === 0 || !shellRef.current) {
      setPortalStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = shellRef.current?.getBoundingClientRect()
      if (!rect) return
      setPortalStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        zIndex: 5000,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [query, suggestions.length])

  const suggestionLayer = query.trim() && suggestions.length > 0 && portalStyle ? createPortal(
    <div className="assignee-suggestion-list portal" style={portalStyle}>
      {suggestions.map(user => {
        const tagValue = buildAssigneeTagValue(user)
        return (
          <button
            key={`${label || 'assignee'}-${user.id}`}
            type="button"
            className="assignee-suggestion-item"
            onMouseDown={event => event.preventDefault()}
            onClick={() => addByText(tagValue)}
          >
            <strong>{tagValue}</strong>
            <span>{buildAssigneeOptionMeta(user)}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  ) : null

  return (
    <div className="stack compact-gap assignee-field-wrap">
      {label && <label>{label}</label>}
      <div className="assignee-input-shell" ref={shellRef}>
        <div className="assignee-chip-list">
          {selectedValues.map(item => (
            <span key={item} className="assignee-chip">
              {item}
              <button type="button" className="assignee-chip-remove" onClick={() => syncNext(selectedValues.filter(selected => selected !== item))}>×</button>
            </span>
          ))}
          <input
            value={query}
            placeholder={placeholder}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (query.trim()) addByText(query.replace(/@/g, ''))
            }}
          />
        </div>
      </div>
      {suggestionLayer}
    </div>
  )
}

function workScheduleHeading(index) {
  if (index === 0) return '당일일정'
  if (index === 1) return '내일일정'
  if (index === 2) return '모레일정'
  return `${index + 1}일차 일정`
}

function workScheduleDateLine(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`
}

function buildDayStatusForm(day) {
  return {
    schedule_date: day?.date || fmtDate(new Date()),
    excluded_business: day?.excluded_business || '',
    excluded_staff: day?.excluded_staff || '',
    excluded_business_details: day?.excluded_business_details || [],
    excluded_staff_details: day?.excluded_staff_details || [],
    available_vehicle_count: Number(day?.available_vehicle_count || 0),
    available_vehicle_accounts: day?.available_vehicle_accounts || [],
    auto_unavailable_business: day?.auto_unavailable_business || [],
    status_a_count: Number(day?.status_a_count || 0),
    status_b_count: Number(day?.status_b_count || 0),
    status_c_count: Number(day?.status_c_count || 0),
    day_memo: day?.day_memo || '',
    is_handless_day: Boolean(day?.is_handless_day),
  }
}


function HandlessDaysPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const monthParam = searchParams.get('month')
  const baseDate = monthParam ? new Date(`${monthParam}-01T00:00:00`) : startOfMonth(new Date())
  const [monthCursor, setMonthCursor] = useState(Number.isNaN(baseDate.getTime()) ? startOfMonth(new Date()) : startOfMonth(baseDate))
  const [workDays, setWorkDays] = useState([])
  const [selectedDates, setSelectedDates] = useState(new Set())
  const isMobile = useIsMobile()
  const days = useMemo(() => buildMonthDays(monthCursor), [monthCursor])

  async function load() {
    const firstDate = fmtDate(days[0] || new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1))
    const data = await api(`/api/work-schedule?start_date=${firstDate}&days=42`)
    setWorkDays(data.days || [])
    setSelectedDates(new Set((data.days || []).filter(item => item.is_handless_day).map(item => item.date)))
  }

  useEffect(() => { load().catch(() => {}) }, [monthCursor, days])

  const dayMap = useMemo(() => new Map(workDays.map(item => [item.date, item])), [workDays])
  const monthLabel = `${monthCursor.getFullYear()}년 ${monthCursor.getMonth() + 1}월`

  async function saveSelected() {
    const visibleDates = days.filter(date => isSameMonthDate(date, monthCursor)).map(date => fmtDate(date))
    await api('/api/work-schedule/handless-bulk', {
      method: 'POST',
      body: JSON.stringify({ month: fmtDate(monthCursor).slice(0, 7), visible_dates: visibleDates, selected_dates: Array.from(selectedDates) }),
    })
    window.alert('손없는날 설정이 저장되었습니다.')
    navigate(`/schedule?date=${fmtDate(monthCursor)}`)
  }

  function toggleDate(key) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="stack-page">
      <section className={`card schedule-card handless-page${isMobile ? ' mobile' : ''}`}>
        <div className="calendar-toolbar upgraded">
          <div className="inline-actions">
            <button type="button" className="ghost small icon-month-button" onClick={() => setMonthCursor(addMonths(monthCursor, -1))}>◀</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="ghost small icon-month-button" onClick={() => setMonthCursor(addMonths(monthCursor, 1))}>▶</button>
          </div>
          <div className="inline-actions wrap">
            <button type="button" className="ghost small" onClick={() => navigate('/schedule')}>닫기</button>
            <button type="button" className="small" onClick={() => saveSelected().catch(err => window.alert(err.message))}>편집저장</button>
          </div>
        </div>
        <div className="calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day} className="weekday">{day}</div>)}</div>
        <div className="calendar-grid handless-grid">
          {days.map((date, idx) => {
            const key = fmtDate(date)
            const active = selectedDates.has(fmtDate(date))
            const isCurrentMonth = isSameMonthDate(date, monthCursor)
            const dayInfo = dayMap.get(key)
            return (
              <div key={key} className={`calendar-cell handless-picker-cell${active ? ' selected handless-day-cell' : ''}${!isCurrentMonth ? ' outside-month-cell' : ''}`}>
                <button type="button" className="handless-date-button" onClick={() => toggleDate(fmtDate(date))}>
                  <span className={`handless-date-number${active ? ' active' : ''}`}>{date.getDate()}</span>
                  {dayInfo?.is_handless_day && <span className="calendar-handless-pill mobile-compact active handless-inline-pill">손없음</span>}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function WorkSchedulePage() {
  const isMobile = useIsMobile()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const [daysData, setDaysData] = useState([])
  const [loading, setLoading] = useState(true)
  const [entryForm, setEntryForm] = useState(emptyWorkScheduleForm(fmtDate(new Date())))
  const [activeFormDate, setActiveFormDate] = useState('')
  const [noteForm, setNoteForm] = useState({ schedule_date: '', excluded_business_slots: Array(6).fill(''), excluded_staff: '' })
  const [activeNoteDate, setActiveNoteDate] = useState('')
  const [message, setMessage] = useState('')
  const [editingKey, setEditingKey] = useState('')
  const [editingForm, setEditingForm] = useState(emptyWorkScheduleForm(fmtDate(new Date())))
  const [bulkEditDate, setBulkEditDate] = useState('')
  const [bulkForms, setBulkForms] = useState({})
  const [activeStatusDate, setActiveStatusDate] = useState('')
  const [statusForm, setStatusForm] = useState(buildDayStatusForm(null))
  const [assignableUsers, setAssignableUsers] = useState([])

  async function load() {
    setLoading(true)
    try {
      const [data, users] = await Promise.all([
        api('/api/work-schedule'),
        api('/api/users'),
      ])
      setDaysData(data.days || [])
      const me = getStoredUser(); setAssignableUsers(me ? [me, ...(users || [])] : (users || []))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [])

  function openCreate(dateText) {
    setActiveFormDate(dateText)
    setEntryForm(emptyWorkScheduleForm(dateText))
    setMessage('')
  }

  function closeEntryForm() {
    setActiveFormDate('')
  }

  function openNotes(day) {
    setActiveNoteDate(day.date)
    setNoteForm({
      schedule_date: day.date,
      excluded_business_slots: parseExcludedBusinessSlots(day.excluded_business),
      excluded_staff: day.excluded_staff || '',
    })
    setMessage('')
  }

  function closeNotes() {
    setActiveNoteDate('')
  }

  async function submitEntry(e) {
    e.preventDefault()
    await api('/api/work-schedule/entries', { method: 'POST', body: JSON.stringify({ ...entryForm, schedule_time: entryForm.schedule_time || '' }) })
    setMessage('스케줄이 등록되었습니다.')
    closeEntryForm()
    await load()
  }

  async function submitNotes(e) {
    e.preventDefault()
    const payload = {
      schedule_date: noteForm.schedule_date,
      excluded_business: serializeExcludedBusinessSlots(noteForm.excluded_business_slots),
      excluded_staff: noteForm.excluded_staff,
    }
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify(payload) })
    setMessage('열외자 목록이 저장되었습니다.')
    closeNotes()
    await load()
  }

  function rowKey(dayDate, item) {
    return `${dayDate}-${item.id}`
  }

  function formatSummary(item) {
    const timeText = item.schedule_time || '미정'
    const customerText = item.customer_name || '(고객명)'
    const repText = item.representative_names || '-'
    const staffText = item.staff_names || '-'
    const memoText = item.memo || '-'
    return `(${timeText}) (${customerText}) (${repText}) (${staffText}) (${memoText})`
  }

  function openRowEdit(dayDate, item) {
    setEditingKey(rowKey(dayDate, item))
    setEditingForm(buildWorkScheduleForm(item, dayDate))
    setMessage('')
  }

  function closeRowEdit() {
    setEditingKey('')
  }

  function openBulkEdit(day) {
    if (bulkEditDate === day.date) {
      setBulkEditDate('')
      return
    }
    setBulkEditDate(day.date)
    setBulkForms(prev => ({
      ...prev,
      [day.date]: day.entries.map(item => buildWorkScheduleForm(item, day.date)),
    }))
    setMessage('')
  }

  function updateBulkForm(dayDate, index, field, value) {
    setBulkForms(prev => ({
      ...prev,
      [dayDate]: (prev[dayDate] || []).map((form, formIndex) => formIndex === index ? { ...form, [field]: value } : form),
    }))
  }

  async function saveScheduleForm(form) {
    const normalizedTime = normalizeScheduleTimeInput(form.schedule_time || '', form.schedule_time || '')
    if (form.entry_type === 'calendar' && form.event_id) {
      const existing = await api(`/api/calendar/events/${form.event_id}`)
      const repNames = splitScheduleNames(form.representative_names)
      const staffNames = splitScheduleNames(form.staff_names)
      const payload = {
        ...existing,
        start_time: normalizedTime || '미정',
        customer_name: form.customer_name || '',
        content: form.memo || '',
        representative1: repNames[0] || '',
        representative2: repNames[1] || '',
        representative3: repNames[2] || '',
        staff1: staffNames[0] || '',
        staff2: staffNames[1] || '',
        staff3: staffNames[2] || '',
      }
      await api(`/api/calendar/events/${form.event_id}`, { method: 'PUT', body: JSON.stringify(payload) })
      return
    }
    const entryId = String(form.id || '').replace(/^manual-/, '')
    await api(`/api/work-schedule/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify({
        schedule_date: form.schedule_date,
        schedule_time: normalizedTime || '',
        customer_name: form.customer_name || '',
        representative_names: form.representative_names || '',
        staff_names: form.staff_names || '',
        memo: form.memo || '',
      }),
    })
  }

  async function submitRowEdit(e) {
    e.preventDefault()
    await saveScheduleForm(editingForm)
    setMessage('스케줄이 수정되었습니다.')
    closeRowEdit()
    await load()
  }

  async function submitBulkEdit(dayDate) {
    const forms = bulkForms[dayDate] || []
    for (const form of forms) {
      await saveScheduleForm(form)
    }
    setMessage('일자별 스케줄이 전체 수정되었습니다.')
    setBulkEditDate('')
    await load()
  }

  function openStatusEditor(day) {
    setStatusForm(buildDayStatusForm(day))
    setActiveStatusDate(day.date)
  }

  async function submitStatusEditor(e) {
    e.preventDefault()
    await api('/api/work-schedule/day-note', { method: 'PUT', body: JSON.stringify({ ...statusForm, available_vehicle_count: Number(daysData.find(item => item.date === activeStatusDate)?.available_vehicle_count || 0) }) })
    setMessage('일정현황 정보가 저장되었습니다.')
    setActiveStatusDate('')
    await load()
  }

  return (
    <div className={`stack-page work-schedule-page${isMobile ? ' mobile' : ''}`}>
      {message && <div className="success">{message}</div>}
      {loading && <div className="card">불러오는 중...</div>}
      {!loading && daysData.map((day, index) => {
        const businessCount = day.excluded_business_names?.length || 0
        const staffCount = day.excluded_staff_names?.length || 0
        const isBulkEdit = bulkEditDate === day.date
        const dayBulkForms = bulkForms[day.date] || []
        return (
          <section key={day.date} className={`card work-schedule-day${day.entries.length > 0 ? ' has-entries' : ' empty-day'}`}>
            <div className="between work-schedule-head">
              <div className="work-schedule-headline">
                <strong>{workScheduleHeading(index)}</strong>
                <span className="muted">{workScheduleDateLine(day.date)}</span>
              </div>
            </div>

            <button type="button" className="work-day-status-button" onClick={() => openStatusEditor(day)} disabled={readOnly}>
              <span className="work-day-status-vehicle">가용차량 {String(day.available_vehicle_count ?? 0).padStart(2, '0')}</span>
              <span className="work-day-status-divider" />
              <span className="work-day-status-summary">A: {String(day.status_a_count ?? 0).padStart(2, '0')} / B: {String(day.status_b_count ?? 0).padStart(2, '0')} / C: {String(day.status_c_count ?? 0).padStart(2, '0')}</span>
            </button>

            <section className="work-schedule-section">
              <div className="between work-schedule-section-head">
                <div className="work-schedule-section-title-wrap">
                  <strong className="work-schedule-section-title">스케줄 목록</strong>
                  <span className="muted">일정 화면에 등록된 고객 일정과 스케줄을 함께 표시합니다.</span>
                </div>
                {!readOnly && <button type="button" className="small ghost" onClick={() => openCreate(day.date)}>스케줄추가</button>}
              </div>

            {activeFormDate === day.date && !readOnly && (
              <form onSubmit={submitEntry} className="work-schedule-entry-form">
                <div className="work-schedule-table header">
                  <div>시간</div><div>고객명</div><div>담당대표명1/2/3</div><div>직원명1/2/3</div><div>기타메모</div>
                </div>
                <div className="work-schedule-table work-schedule-assignee-table">
                  <input value={entryForm.schedule_time} placeholder="09:00" onChange={e => setEntryForm({ ...entryForm, schedule_time: normalizeScheduleTimeInput(e.target.value, e.target.value) })} />
                  <input value={entryForm.customer_name} placeholder="고객명" onChange={e => setEntryForm({ ...entryForm, customer_name: e.target.value })} />
                  <AssigneeInput users={assignableUsers} value={entryForm.representative_names} onChange={value => setEntryForm({ ...entryForm, representative_names: value })} placeholder="대표자 이름/계정 입력 후 선택" />
                  <AssigneeInput users={assignableUsers} value={entryForm.staff_names} onChange={value => setEntryForm({ ...entryForm, staff_names: value })} placeholder="직원 이름/계정 입력 후 선택" />
                  <input value={entryForm.memo} placeholder="기타 메모" onChange={e => setEntryForm({ ...entryForm, memo: e.target.value })} />
                </div>
                <div className="inline-actions wrap">
                  <button>스케줄 저장</button>
                  <button type="button" className="ghost" onClick={closeEntryForm}>닫기</button>
                </div>
              </form>
            )}

            <div className="work-schedule-list unified-list">
              {day.entries.length > 0 && !isBulkEdit && day.entries.map(item => {
                const key = rowKey(day.date, item)
                const isEditing = editingKey === key
                return (
                  <div key={key} className={`work-schedule-line-item${item.entry_type === 'calendar' ? ' calendar-linked' : ' manual-linked'}`}>
                    <div className="work-schedule-line-head">
                      <div className="work-schedule-line-body">
                        <div className="work-schedule-line-primary">
                          <span className="work-schedule-chip time">{item.schedule_time || '미정'}</span>
                          <span className="work-schedule-chip customer">{item.customer_name || '고객명'}</span>
                          {item.platform && <span className="work-schedule-chip platform">{item.platform}</span>}
                        </div>
                        <div className="work-schedule-line-text" title={formatSummary(item)}>{formatSummary(item)}</div>
                        {item.entry_type === 'calendar' && <div className="work-schedule-line-subtext">{buildAbcInlineText(item)}</div>}
                      </div>
                      {!readOnly && <button type="button" className="small ghost compact-edit-button" onClick={() => openRowEdit(day.date, item)}>스케줄편집</button>}
                    </div>
                    {isEditing && !readOnly && (
                      <form onSubmit={submitRowEdit} className="work-schedule-inline-editor">
                        <div className="work-schedule-inline-grid work-schedule-assignee-grid">
                          <input value={editingForm.schedule_time} placeholder="09:00" onChange={e => setEditingForm({ ...editingForm, schedule_time: normalizeScheduleTimeInput(e.target.value, e.target.value) })} />
                          <input value={editingForm.customer_name} placeholder="고객명" onChange={e => setEditingForm({ ...editingForm, customer_name: e.target.value })} />
                          <AssigneeInput users={assignableUsers} value={editingForm.representative_names} onChange={value => setEditingForm({ ...editingForm, representative_names: value })} placeholder="대표자 이름/계정 입력 후 선택" />
                          <AssigneeInput users={assignableUsers} value={editingForm.staff_names} onChange={value => setEditingForm({ ...editingForm, staff_names: value })} placeholder="직원 이름/계정 입력 후 선택" />
                          <input value={editingForm.memo} placeholder="메모" onChange={e => setEditingForm({ ...editingForm, memo: e.target.value })} className="schedule-inline-memo" />
                        </div>
                        <div className="inline-actions wrap end">
                          <button type="submit">저장</button>
                          <button type="button" className="ghost" onClick={closeRowEdit}>취소</button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}

              {day.entries.length > 0 && isBulkEdit && (
                <form onSubmit={e => { e.preventDefault(); submitBulkEdit(day.date) }} className="work-schedule-bulk-editor">
                  {dayBulkForms.map((form, index) => (
                    <div key={`${day.date}-bulk-${form.id}-${index}`} className="work-schedule-inline-editor bulk-row">
                      <div className="work-schedule-inline-grid work-schedule-assignee-grid">
                        <input value={form.schedule_time} placeholder="09:00" onChange={e => updateBulkForm(day.date, index, 'schedule_time', normalizeScheduleTimeInput(e.target.value, e.target.value))} />
                        <input value={form.customer_name} placeholder="고객명" onChange={e => updateBulkForm(day.date, index, 'customer_name', e.target.value)} />
                        <AssigneeInput users={assignableUsers} value={form.representative_names} onChange={value => updateBulkForm(day.date, index, 'representative_names', value)} placeholder="대표자 이름/계정 입력 후 선택" />
                        <AssigneeInput users={assignableUsers} value={form.staff_names} onChange={value => updateBulkForm(day.date, index, 'staff_names', value)} placeholder="직원 이름/계정 입력 후 선택" />
                        <input value={form.memo} placeholder="메모" onChange={e => updateBulkForm(day.date, index, 'memo', e.target.value)} className="schedule-inline-memo" />
                      </div>
                    </div>
                  ))}
                  <div className="inline-actions wrap end">
                    <button type="submit">전체 저장</button>
                    <button type="button" className="ghost" onClick={() => setBulkEditDate('')}>닫기</button>
                  </div>
                </form>
              )}

              {day.entries.length === 0 && <div className="muted">등록된 스케줄이 없습니다.</div>}
            </div>
            </section>

            {activeStatusDate === day.date && !readOnly && (
              <form onSubmit={submitStatusEditor} className="work-day-status-editor">
                <div className="between work-day-status-editor-head">
                  <button type="button" className="ghost small" onClick={() => setActiveStatusDate('')}>뒤로가기</button>
                  <button type="submit" className="small">저장</button>
                </div>
                <div className="work-day-status-editor-grid">
                  <label>가용차량수(자동연동)<input type="number" min="0" value={statusForm.available_vehicle_count} readOnly disabled /></label>
                  <label>A : 숫자입력칸<input type="number" min="0" value={statusForm.status_a_count} onChange={e => setStatusForm({ ...statusForm, status_a_count: Number(e.target.value || 0) })} /></label>
                  <label>B : 숫자입력칸<input type="number" min="0" value={statusForm.status_b_count} onChange={e => setStatusForm({ ...statusForm, status_b_count: Number(e.target.value || 0) })} /></label>
                  <label>C : 숫자입력칸<input type="number" min="0" value={statusForm.status_c_count} onChange={e => setStatusForm({ ...statusForm, status_c_count: Number(e.target.value || 0) })} /></label>
                </div>
                <textarea value={statusForm.day_memo} onChange={e => setStatusForm({ ...statusForm, day_memo: e.target.value })} placeholder="상세 메모 입력" className="work-day-status-editor-memo" />
              </form>
            )}

            <section className="work-schedule-section work-exclusion-section">
              <div className="between work-schedule-section-head">
                <div className="work-schedule-section-title-wrap">
                  <strong className="work-schedule-section-title">열외자 목록</strong>
                  <span className="muted">관리자/부관리자만 열외자 편집이 가능합니다.</span>
                </div>
                {!readOnly && <button type="button" className="small ghost" onClick={() => openNotes(day)}>열외자편집</button>}
              </div>

            {activeNoteDate === day.date && !readOnly && (
              <form onSubmit={submitNotes} className="work-notes-form">
                <div className="stack compact-gap">
                  <label>열외자 목록 - 사업자</label>
                  <div className="work-excluded-business-grid">
                    {noteForm.excluded_business_slots.map((slot, index) => (
                      <select key={`${day.date}-business-${index}`} value={slot} onChange={e => {
                        const next = [...noteForm.excluded_business_slots]
                        next[index] = e.target.value
                        setNoteForm({ ...noteForm, excluded_business_slots: next })
                      }}>
                        <option value="">선택 안 함</option>
                        {BRANCH_NUMBER_OPTIONS.map(num => (
                          <option key={num} value={String(num)} disabled={noteForm.excluded_business_slots.some((selected, slotIndex) => slotIndex !== index && selected === String(num))}>{num}호점</option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>
                <div className="stack compact-gap">
                  <label>열외자 목록 - 직원</label>
                  <textarea value={noteForm.excluded_staff} placeholder="직원명-사유 / 직원명-사유" onChange={e => setNoteForm({ ...noteForm, excluded_staff: e.target.value })} />
                </div>
                <div className="inline-actions wrap">
                  <button>열외자 저장</button>
                  <button type="button" className="ghost" onClick={closeNotes}>닫기</button>
                </div>
              </form>
            )}

            <div className="work-schedule-exclusion">
              <div className="work-schedule-exclusion-row"><strong>사업자</strong><span>{businessCount ? day.excluded_business_names.join(' / ') : '-'}</span></div>
              <div className="work-schedule-exclusion-row"><strong>직원</strong><span>{staffCount ? day.excluded_staff_names.join(' / ') : '-'}</span></div>
            </div>
            </section>
          </section>
        )
      })}
    </div>
  )
}

function normalizeScheduleTimeInput(rawValue, fallback = '') {
  if (rawValue === '미정') return '미정'
  const value = String(rawValue || '').trim()
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length === 4) {
    const hours = Number(digits.slice(0, 2))
    const minutes = Number(digits.slice(2, 4))
    if (hours >= 0 && hours <= 24 && minutes >= 0 && minutes <= 59 && !(hours === 24 && minutes > 0)) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    }
  }
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (match) {
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours >= 0 && hours <= 24 && minutes >= 0 && minutes <= 59 && !(hours === 24 && minutes > 0)) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    }
  }
  return fallback || value
}

function ScheduleFormPage({ mode }) {
  const navigate = useNavigate()
  const currentUser = getStoredUser()
  const readOnly = isReadOnlyMember(currentUser)
  const { eventId } = useParams()
  const [searchParams] = useSearchParams()
  const presetDate = searchParams.get('date') || fmtDate(new Date())
  const [loading, setLoading] = useState(mode === 'edit')
  const [error, setError] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [preview, setPreview] = useState('')
  const visitTimeInputRef = useRef(null)
  const mobilePlatformSelectRef = useRef(null)
  const desktopPlatformSelectRef = useRef(null)
  const customerNameInputRef = useRef(null)
  const amountInputRef = useRef(null)
  const depositMethodSelectRef = useRef(null)
  const depositAmountSelectRef = useRef(null)
  const scheduleEditorFormRef = useRef(null)
  const [titleLocked, setTitleLocked] = useState(true)
  const [departmentColorConfigOpen, setDepartmentColorConfigOpen] = useState(false)
  const [departmentColorMap, setDepartmentColorMap] = useState(() => getStoredDepartmentColorMap())

  function handleScheduleEditorKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
      e.preventDefault()
      scheduleEditorFormRef.current?.requestSubmit?.()
    }
  }
  const [visitTimeText, setVisitTimeText] = useState('')
  const [startTimeText, setStartTimeText] = useState('')
  const [endTimeText, setEndTimeText] = useState('')
  const [assignableUsers, setAssignableUsers] = useState([])
  const [form, setForm] = useState({
    title: '',
    content: '',
    event_date: presetDate,
    visit_time: '미정',
    start_time: '미정',
    end_time: '미정',
    location: '',
    color: '#2563eb',
    move_start_date: presetDate,
    move_end_date: presetDate,
    start_address: '',
    end_address: '',
    platform: PLATFORM_OPTIONS[0],
    customer_name: '',
    department_info: DEFAULT_DEPARTMENT_OPTIONS[0],
    schedule_type: '선택',
    status_a_count: 0,
    status_b_count: 0,
    status_c_count: 0,
    amount1: '',
    amount2: '',
    amount_item: '',
    deposit_method: DEPOSIT_METHOD_OPTIONS[0],
    deposit_amount: DEPOSIT_AMOUNT_OPTIONS[0],
    representative1: '',
    representative2: '',
    representative3: '',
    staff1: '',
    staff2: '',
    staff3: '',
    image_data: '',
  })

  useEffect(() => {
    if (mode !== 'edit') {
      setForm(prev => ({
        ...prev,
        event_date: presetDate,
        move_start_date: prev.move_start_date || presetDate,
        move_end_date: prev.move_end_date || presetDate,
      }))
      setVisitTimeText(prev => prev || '')
      api('/api/users').then(users => setAssignableUsers(users || [])).catch(() => {})
      return
    }
    async function loadDetail() {
      setLoading(true)
      setError('')
      try {
        const [data, users] = await Promise.all([
          api(`/api/calendar/events/${eventId}`),
          api('/api/users'),
        ])
        const me = getStoredUser(); setAssignableUsers(me ? [me, ...(users || [])] : (users || []))
        setForm({
          title: data.title || '',
          content: data.content || '',
          event_date: data.event_date || presetDate,
          visit_time: data.visit_time || '미정',
          start_time: data.start_time || '미정',
          end_time: data.end_time || '미정',
          location: data.location || '',
          color: data.color || '#2563eb',
          move_start_date: toIsoDateInputValue(data.move_start_date || data.event_date || presetDate) || presetDate,
          move_end_date: toIsoDateInputValue(data.move_end_date || data.event_date || presetDate) || presetDate,
          start_address: data.start_address || data.location || '',
          end_address: data.end_address || '',
          platform: data.platform || PLATFORM_OPTIONS[0],
          customer_name: data.customer_name || '',
          department_info: data.department_info || DEFAULT_DEPARTMENT_OPTIONS[0],
          schedule_type: data.schedule_type || (Number(data.status_b_count || 0) > 0 ? 'B' : Number(data.status_c_count || 0) > 0 ? 'C' : Number(data.status_a_count || 0) > 0 ? 'A' : '선택'),
          status_a_count: Number(data.status_a_count || 0),
          status_b_count: Number(data.status_b_count || 0),
          status_c_count: Number(data.status_c_count || 0),
          amount1: data.amount1 || '',
          amount2: data.amount2 || '',
          amount_item: data.amount_item || '',
          deposit_method: data.deposit_method || DEPOSIT_METHOD_OPTIONS[0],
          deposit_amount: data.deposit_amount || DEPOSIT_AMOUNT_OPTIONS[0],
          representative1: data.representative1 || '',
          representative2: data.representative2 || '',
          representative3: data.representative3 || '',
          staff1: data.staff1 || '',
          staff2: data.staff2 || '',
          staff3: data.staff3 || '',
          image_data: data.image_data || '',
        })
        setPreview(data.image_data || '')
        setVisitTimeText(data.visit_time && data.visit_time !== '미정' ? data.visit_time : '')
        setStartTimeText(data.start_time && data.start_time !== '미정' ? data.start_time : '')
        setEndTimeText(data.end_time && data.end_time !== '미정' ? data.end_time : '')
        setTitleLocked(!(data.title || '').trim() || (data.title || '').trim() === buildScheduleTitle({ ...data, amount1: data.amount1 || '' }).trim())
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [mode, eventId, presetDate])

  useEffect(() => {
    if (!titleLocked) return
    setForm(prev => ({ ...prev, title: buildScheduleTitle(prev) }))
  }, [form.visit_time, form.platform, form.customer_name, form.amount1, titleLocked])

  useEffect(() => {
    const mappedColor = departmentColorMap[form.department_info]
    if (!mappedColor || mappedColor === form.color) return
    setForm(prev => ({ ...prev, color: departmentColorMap[prev.department_info] || prev.color }))
  }, [form.department_info, departmentColorMap])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('icj_department_color_map', JSON.stringify(departmentColorMap))
  }, [departmentColorMap])

  useEffect(() => {
    if (form.visit_time === '미정') {
      setVisitTimeText('')
      return
    }
    setVisitTimeText(form.visit_time || '')
  }, [form.visit_time])

  useEffect(() => {
    if (form.start_time === '미정') {
      setStartTimeText('')
      return
    }
    setStartTimeText(form.start_time || '')
  }, [form.start_time])

  useEffect(() => {
    if (loading) return
    requestAnimationFrame(() => {
      visitTimeInputRef.current?.focus()
      visitTimeInputRef.current?.select?.()
    })
  }, [loading, mode, eventId, presetDate])

  useEffect(() => {
    if (form.end_time === '미정') {
      setEndTimeText('')
      return
    }
    setEndTimeText(form.end_time || '')
  }, [form.end_time])

  function commitVisitTimeInput(rawValue) {
    const normalized = normalizeScheduleTimeInput(rawValue, form.visit_time === '미정' ? '' : form.visit_time)
    if (normalized === '미정') {
      setForm(prev => ({ ...prev, visit_time: '미정' }))
      setVisitTimeText('')
      return normalized
    }
    if (!normalized) {
      setForm(prev => ({ ...prev, visit_time: '미정' }))
      setVisitTimeText('')
      return ''
    }
    setForm(prev => ({ ...prev, visit_time: normalized }))
    setVisitTimeText(normalized)
    return normalized
  }


  function commitGenericTimeInput(field, rawValue, currentValue, setText) {
    const normalized = normalizeScheduleTimeInput(rawValue, currentValue === '미정' ? '' : currentValue)
    if (normalized === '미정') {
      setForm(prev => ({ ...prev, [field]: '미정' }))
      setText('')
      return normalized
    }
    if (!normalized) {
      setForm(prev => ({ ...prev, [field]: '미정' }))
      setText('')
      return ''
    }
    setForm(prev => ({ ...prev, [field]: normalized }))
    setText(normalized)
    return normalized
  }

  function focusNextField(ref) {
    requestAnimationFrame(() => ref?.current?.focus())
  }

  function handleVisitTimeKeyDown(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      const normalized = commitVisitTimeInput(visitTimeText)
      if (normalized) {
        e.preventDefault()
        focusNextField(desktopPlatformSelectRef)
      }
    }
  }

  function handleVisitTimeBlur() {
    commitVisitTimeInput(visitTimeText)
  }


  function handleStartTimeBlur() {
    commitGenericTimeInput('start_time', startTimeText, form.start_time, setStartTimeText)
  }

  function handleEndTimeBlur() {
    commitGenericTimeInput('end_time', endTimeText, form.end_time, setEndTimeText)
  }

  async function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) {
      setPreview('')
      setForm(prev => ({ ...prev, image_data: '' }))
      return
    }
    setUploadingImage(true)
    setError('')
    try {
      const uploaded = await uploadFile(file, 'schedule')
      setPreview(uploaded.url)
      setForm(prev => ({ ...prev, image_data: uploaded.url }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadingImage(false)
      e.target.value = ''
    }
  }

  function changeTimeField(field, value) {
    const normalized = normalizeScheduleTimeInput(value, value)
    setForm(prev => ({ ...prev, [field]: normalized }))
  }

  function updateRepresentativeNames(value) {
    const [first, second, third] = splitScheduleNames(value)
    setForm(prev => ({ ...prev, representative1: first || '', representative2: second || '', representative3: third || '' }))
  }

  function updateStaffNames(value) {
    const [first, second, third] = splitScheduleNames(value)
    setForm(prev => ({ ...prev, staff1: first || '', staff2: second || '', staff3: third || '' }))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    const normalizedScheduleType = String(form.schedule_type || '선택')
    const normalizedScheduleGroup = normalizedScheduleType.replace(/[()]/g, '')
    const payload = {
      ...form,
      schedule_type: normalizedScheduleType,
      status_a_count: normalizedScheduleGroup === 'A' ? 1 : 0,
      status_b_count: normalizedScheduleGroup === 'B' ? 1 : 0,
      status_c_count: normalizedScheduleGroup === 'C' ? 1 : 0,
      title: titleLocked ? buildScheduleTitle(form) : (form.title || buildScheduleTitle(form)),
      event_date: form.move_start_date || presetDate,
      move_start_date: form.move_start_date || presetDate,
      move_end_date: form.move_end_date || form.move_start_date || presetDate,
      location: form.start_address || '',
      amount2: '',
      amount_item: '',
    }
    try {
      if (mode === 'edit') {
        await api(`/api/calendar/events/${eventId}`, { method: 'PUT', body: JSON.stringify(payload) })
        navigate(`/schedule/${eventId}`)
      } else {
        await api('/api/calendar/events', { method: 'POST', body: JSON.stringify(payload) })
        navigate(`/schedule?date=${payload.event_date}`)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const titlePreview = titleLocked ? buildScheduleTitle(form) : (form.title || buildScheduleTitle(form))

  if (loading) return <div className="card">불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card schedule-editor-card">
        <form ref={scheduleEditorFormRef} onSubmit={submit} onKeyDown={handleScheduleEditorKeyDown} className="stack schedule-editor-form">
          <div className="schedule-form-topbar">
            <button
              type="button"
              className="ghost small icon-only"
              aria-label={mode === 'edit' ? '상세로 돌아가기' : '달력으로 돌아가기'}
              onClick={() => navigate(mode === 'edit' ? `/schedule/${eventId}` : '/schedule')}
            >
              ←
            </button>
            <div className="inline-actions wrap end">
              <button type="button" className="ghost small" onClick={() => setDepartmentColorConfigOpen(v => !v)}>설정</button>
              <button type="submit" className="small schedule-save-button top-save-button">일정 저장</button>
            </div>
          </div>
          <div className="schedule-form-grid-1 schedule-type-row">
            <div className="stack compact-gap">
              <label>일정구분</label>
              <select value={form.schedule_type || '선택'} onChange={e => setForm({ ...form, schedule_type: e.target.value })}>
                <option value="선택">선택</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="(A)">(A)</option>
                <option value="(B)">(B)</option>
                <option value="(C)">(C)</option>
              </select>
              <div className="muted tiny-text">괄호 없는 값은 확정 일정, 괄호 값은 예상 일정이며 A/B/C 카운트는 동일하게 반영됩니다.</div>
            </div>
            <div className="stack compact-gap schedule-locked-action">
              <label>&nbsp;</label>
              <button type="button" className="small ghost" onClick={() => window.alert('견적데이터연동 기능은 준비만 완료된 상태이며, 추후 견적 목록 연동 시 활성화됩니다.')} >견적데이터연동</button>
            </div>
          </div>
          {departmentColorConfigOpen && (
            <div className="schedule-settings-panel">
              <div className="between">
                <strong>담당부서/인원 표시색상 설정</strong>
                <button type="button" className="ghost small" onClick={() => setDepartmentColorMap({ ...DEFAULT_DEPARTMENT_COLOR_MAP })}>기본값</button>
              </div>
              <div className="schedule-settings-grid">
                {DEFAULT_DEPARTMENT_OPTIONS.map(option => (
                  <label key={`dept-color-${option}`}>{option}<input type="color" value={departmentColorMap[option] || '#2563eb'} onChange={e => setDepartmentColorMap(prev => ({ ...prev, [option]: e.target.value }))} /></label>
                ))}
              </div>
              <div className="muted tiny-text">특정 담당부서/인원을 선택하면 여기서 연결한 표시색상이 자동 반영됩니다. 아래 항목은 추후 견적데이터 연동 시 자동 지정 대상으로 사용됩니다: {DEPARTMENT_AUTO_ASSIGN_OPTIONS.join(', ')}</div>
            </div>
          )}
          <div className="stack compact-gap">
            <label>일정 제목</label>
            <div className="schedule-title-edit-row">
              <input value={titlePreview} placeholder="자동 생성 제목" readOnly={titleLocked} className={`readonly-input ${titleLocked ? '' : 'editable-title-input'}`.trim()} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
              <button type="button" className="ghost small" onClick={() => {
                if (titleLocked) {
                  setTitleLocked(false)
                  setForm(prev => ({ ...prev, title: prev.title || buildScheduleTitle(prev) }))
                  return
                }
                setTitleLocked(true)
                setForm(prev => ({ ...prev, title: buildScheduleTitle(prev) }))
              }}>{titleLocked ? '편집' : '저장'}</button>
            </div>
          </div>
          <div className="schedule-form-grid-2 visit-platform-row">
            <div className="stack compact-gap highlight-blue-field">
              <label>출발지 이사방문시각</label>
              <div className="inline-actions visit-time-actions">
                <input
                  ref={visitTimeInputRef}
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={visitTimeText}
                  onChange={e => setVisitTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                  onBlur={handleVisitTimeBlur}
                  onKeyDown={handleVisitTimeKeyDown}
                />
                <button type="button" tabIndex={-1} className={form.visit_time === '미정' ? 'ghost small active-icon mobile-visit-undecided' : 'ghost small mobile-visit-undecided'} onClick={() => changeTimeField('visit_time', form.visit_time === '미정' ? '09:00' : '미정')}>미정</button>
              </div>
            </div>
            <div className="stack compact-gap platform-select-field highlight-blue-field">
              <label>플랫폼</label>
              <select
                ref={desktopPlatformSelectRef}
                value={form.platform}
                onChange={e => setForm({ ...form, platform: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault()
                    focusNextField(customerNameInputRef)
                  }
                }}
              >
                {PLATFORM_OPTIONS.map(platform => <option key={platform} value={platform}>{platform}</option>)}
              </select>
            </div>
          </div>
          <div className="schedule-form-grid-2">
            <div className="stack compact-gap highlight-blue-field">
              <label>고객성함</label>
              <input ref={customerNameInputRef} value={form.customer_name} placeholder="고객 성함" onChange={e => setForm({ ...form, customer_name: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(amountInputRef) } }} />
            </div>
            <div className="stack compact-gap highlight-blue-field">
              <label>이사금액</label>
              <input ref={amountInputRef} inputMode="numeric" value={form.amount1} placeholder="예: 150000" onChange={e => setForm({ ...form, amount1: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(depositMethodSelectRef) } }} />
            </div>
          </div>
          <div className="schedule-form-grid-2">
            <div className="stack compact-gap">
              <label>계약입금방법</label>
              <select ref={depositMethodSelectRef} value={form.deposit_method} onChange={e => setForm({ ...form, deposit_method: e.target.value })} onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); focusNextField(depositAmountSelectRef) } }}>
                {DEPOSIT_METHOD_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="stack compact-gap">
              <label>계약입금금액</label>
              <select ref={depositAmountSelectRef} value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: e.target.value })}>
                {DEPOSIT_AMOUNT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>
          <div className="memo-side-layout">
            <div className="stack compact-gap memo-main-field">
              <label>일정 메모</label>
              <textarea value={form.content} placeholder="일정 메모" onChange={e => setForm({ ...form, content: e.target.value })} className="schedule-memo-box" />
            </div>
            <div className="memo-side-controls">
              <div className="stack compact-gap memo-side-control upload-control-field highlight-blue-field">
                <label>사진파일첨부</label>
                <div className="schedule-upload-row compact-upload-row">
                  <label className={`icon-upload-trigger${uploadingImage ? ' disabled' : ''}`}>
                    <input type="file" accept="image/*" onChange={handleImageChange} disabled={uploadingImage} className="visually-hidden" />
                    <span className="icon-upload-symbol" aria-hidden="true">📎</span>
                    <span className="sr-only">사진파일첨부</span>
                  </label>
                  {uploadingImage && <div className="muted upload-status-text">업로드 중...</div>}
                  {preview && (
                    <div className="image-preview-wrap compact-image-preview">
                      <img src={preview} alt="일정 첨부 미리보기" className="image-preview" />
                    </div>
                  )}
                </div>
              </div>
              <div className="stack compact-gap memo-side-control highlight-blue-field">
                <label>담당부서/인원</label>
                <select value={form.department_info} onChange={e => setForm(prev => ({ ...prev, department_info: e.target.value, color: departmentColorMap[e.target.value] || prev.color }))}>
                  {DEFAULT_DEPARTMENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="stack compact-gap memo-side-control form-field-inline color-control-field">
                <label>표시색상</label>
                <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="schedule-date-time-row">
            <div className="stack compact-gap schedule-date-field">
              <label>이사시작일</label>
              <input type="date" value={form.move_start_date} onChange={e => setForm({ ...form, move_start_date: e.target.value, event_date: e.target.value })} />
            </div>
            <div className="schedule-date-time-fields">
              <div className="stack compact-gap schedule-time-field">
                <label>이사시작시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={startTimeText}
                    onChange={e => setStartTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleStartTimeBlur}
                  />
                  <button type="button" className={form.start_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('start_time', form.start_time === '미정' ? '09:00' : '미정')}>미정</button>
                </div>
              </div>
              <div className="stack compact-gap schedule-time-field">
                <label>이사종료예상시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={endTimeText}
                    onChange={e => setEndTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleEndTimeBlur}
                  />
                  <button type="button" className={form.end_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('end_time', form.end_time === '미정' ? '10:00' : '미정')}>미정</button>
                </div>
              </div>
            </div>
          </div>
          <div className="schedule-date-time-row">
            <div className="stack compact-gap schedule-date-field">
              <label>이사종료일</label>
              <input type="date" value={form.move_end_date} onChange={e => setForm({ ...form, move_end_date: e.target.value })} />
            </div>
            <div className="schedule-date-time-fields">
              <div className="stack compact-gap schedule-time-field">
                <label>이사시작시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={startTimeText}
                    onChange={e => setStartTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleStartTimeBlur}
                  />
                  <button type="button" className={form.start_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('start_time', form.start_time === '미정' ? '09:00' : '미정')}>미정</button>
                </div>
              </div>
              <div className="stack compact-gap schedule-time-field">
                <label>이사종료예상시각</label>
                <div className="inline-actions schedule-time-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={endTimeText}
                    onChange={e => setEndTimeText(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={handleEndTimeBlur}
                  />
                  <button type="button" className={form.end_time === '미정' ? 'ghost small active-icon' : 'ghost small'} onClick={() => changeTimeField('end_time', form.end_time === '미정' ? '10:00' : '미정')}>미정</button>
                </div>
              </div>
            </div>
          </div>
          <div className="stack compact-gap">
            <input value={form.start_address} placeholder="출발지 상세주소" onChange={e => setForm({ ...form, start_address: e.target.value, location: e.target.value })} />
          </div>
          <div className="stack compact-gap">
            <input value={form.end_address} placeholder="도착지 상세주소" onChange={e => setForm({ ...form, end_address: e.target.value })} />
          </div>
          <div className="schedule-form-grid-2 schedule-assignee-grid">
            <AssigneeInput label="담당대표자" users={assignableUsers} value={[form.representative1, form.representative2, form.representative3].filter(Boolean).join(' / ')} onChange={updateRepresentativeNames} placeholder="이름/아이디 입력 후 태그 선택" />
            <AssigneeInput label="담당직원" users={assignableUsers} value={[form.staff1, form.staff2, form.staff3].filter(Boolean).join(' / ')} onChange={updateStaffNames} placeholder="이름/아이디 입력 후 태그 선택" />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="schedule-form-footer">
            <button type="submit" className="small schedule-save-button">일정 저장</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ScheduleDetailPage() {
  const navigate = useNavigate()
  const { eventId } = useParams()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await api(`/api/calendar/events/${eventId}`)
        setItem(data)
      } catch (err) {
        setError(err.message)
      }
    }
    load()
  }, [eventId])

  if (error) return <div className="card error">{error}</div>
  if (!item) return <div className="card">불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card">
        <div className="between schedule-detail-topbar">
          <button type="button" className="ghost small" onClick={() => navigate(`/schedule?date=${item.event_date}`)}>일정으로 돌아가기</button>
          <div className="dropdown-wrap">
            <button type="button" className="ghost small" onClick={() => setMenuOpen(v => !v)}>설정</button>
            {menuOpen && (
              <div className="dropdown-menu right">
                <button type="button" className="dropdown-item" onClick={() => navigate(`/schedule/${item.id}/edit`)}>일정수정</button>
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="stack compact-gap">
            <h2>{item.title}</h2>
            <div className="muted">[{item.department_info || '미지정'}] / [{item.created_by_nickname || '작성자'}]</div>
          </div>
          <div className="detail-meta-grid">
            <div className="stat"><span>플랫폼</span><strong>{item.platform || '-'}</strong></div>
            <div className="stat"><span>고객성함</span><strong>{item.customer_name || '-'}</strong></div>
            <div className="stat"><span>출발지 이사방문시각</span><strong>{item.visit_time || '-'}</strong></div>
            <div className="stat"><span>이사시간</span><strong>{eventTimeLine(item)}</strong></div>
          </div>
          <div className="list-item block">
            <div><strong>이사시작일 상세주소</strong></div>
            <div>{item.start_address || item.location || '-'}</div>
          </div>
          <div className="list-item block">
            <div><strong>이사종료일 상세주소</strong></div>
            <div>{item.end_address || '-'}</div>
          </div>
          <div className="detail-meta-grid">
            <div className="stat"><span>이사 시작일</span><strong>{item.move_start_date || '-'}</strong></div>
            <div className="stat"><span>이사 종료일</span><strong>{item.move_end_date || '-'}</strong></div>
            <div className="stat"><span>이사금액</span><strong>{formatMoneyDisplay(item.amount1) || '-'}</strong></div>
            <div className="stat"><span>계약입금</span><strong>{[item.deposit_method, item.deposit_amount].filter(Boolean).join(' / ') || '-'}</strong></div>
          </div>
          <div className="list-item block">
            <div><strong>메모</strong></div>
            <div>{item.content || '등록된 메모가 없습니다.'}</div>
          </div>
          <div className="detail-meta-grid">
            <div className="stat"><span>담당대표1</span><strong>{item.representative1 || '-'}</strong></div>
            <div className="stat"><span>담당대표2</span><strong>{item.representative2 || '-'}</strong></div>
            <div className="stat"><span>담당대표3</span><strong>{item.representative3 || '-'}</strong></div>
            <div className="stat"><span>담당직원1</span><strong>{item.staff1 || '-'}</strong></div>
            <div className="stat"><span>담당직원2</span><strong>{item.staff2 || '-'}</strong></div>
            <div className="stat"><span>담당직원3</span><strong>{item.staff3 || '-'}</strong></div>
          </div>
          {item.image_data && (
            <div className="image-preview-wrap">
              <img src={item.image_data} alt="일정 첨부" className="image-preview" />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function NotificationsPage({ user }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [prefs, setPrefs] = useState({})
  const [settingsView, setSettingsView] = useState('list')
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const alertSettings = useMemo(() => normalizeAlertSettings(prefs), [prefs])

  async function load() {
    const [n, p] = await Promise.all([api('/api/notifications'), api('/api/preferences')])
    setItems((n || []).filter(item => !['follow', 'favorite'].includes(String(item?.type || ''))))
    setPrefs(p || {})
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function handleNotificationClick(item) {
    try {
      if (!item?.is_read) {
        await api(`/api/notifications/${item.id}/read`, { method: 'POST' })
      }
    } catch (_) {}
    if (item?.type === 'friend_request') {
      navigate('/friends?panel=requests')
      return
    }
    if (item?.type === 'materials_pending_settlement') {
      navigate('/materials?tab=requesters')
      return
    }
    await load().catch(() => {})
  }

  function updateAlertSettings(path, value) {
    setPrefs(prev => {
      const nextSettings = deepMerge(normalizeAlertSettings(prev), {})
      if (path.length === 1) {
        nextSettings[path[0]] = value
      } else if (path.length === 2) {
        nextSettings[path[0]] = { ...(nextSettings[path[0]] || {}), [path[1]]: value }
      }
      return { ...prev, alertSettings: nextSettings }
    })
  }

  async function saveAlertSettings() {
    setSaving(true)
    try {
      await api('/api/preferences', { method: 'POST', body: JSON.stringify({ data: { ...prefs, alertSettings } }) })
      setPrefs(prev => ({ ...prev, alertSettings }))
      setSettingsMenuOpen(false)
      window.alert('알림 설정이 저장되었습니다.')
    } catch (error) {
      window.alert(error.message || '알림 설정 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function requestBrowserPermission() {
    if (typeof Notification === 'undefined') {
      window.alert('현재 환경에서는 휴대폰 알림 권한 요청을 지원하지 않습니다.')
      return
    }
    try {
      const result = await Notification.requestPermission()
      window.alert(result === 'granted' ? '휴대폰 알림 권한이 허용되었습니다.' : '휴대폰 알림 권한이 허용되지 않았습니다.')
    } catch (_) {
      window.alert('알림 권한 요청 중 오류가 발생했습니다.')
    }
  }

  const scheduleItems = items.filter(item => isScheduleAlertNotification(item))
  const generalItems = items.filter(item => !isScheduleAlertNotification(item))

  function renderAlertSettings(channel) {
    const isMobile = channel === 'mobile'
    const typeMap = isMobile ? alertSettings.mobileTypes : alertSettings.appTypes
    return (
      <section className="card">
        <div className="between align-center notification-settings-header">
          <button type="button" className="ghost small notification-back-button" onClick={() => setSettingsView('list')}>←</button>
          <h2>{isMobile ? '휴대폰 알림' : '앱 내 알림'}</h2>
          <span />
        </div>
        <div className="stack">
          <label className="check"><input type="checkbox" checked={isMobile ? !!alertSettings.mobileEnabled : !!alertSettings.appEnabled} onChange={e => updateAlertSettings([isMobile ? 'mobileEnabled' : 'appEnabled'], e.target.checked)} /> {isMobile ? '휴대폰 알림 사용' : '앱 내 알림 사용'}</label>
          <div className="quote-inline-grid three compact-grid">
            <label>반복 알림 간격(시간)<input type="number" min="1" max="24" className="quote-form-input" value={alertSettings.repeatHours} onChange={e => updateAlertSettings(['repeatHours'], Math.max(1, Math.min(24, Number(e.target.value || 1))))} /></label>
            <label>조용한 시간 시작<input type="time" className="quote-form-input" value={alertSettings.quietStart} onChange={e => updateAlertSettings(['quietStart'], e.target.value)} /></label>
            <label>조용한 시간 종료<input type="time" className="quote-form-input" value={alertSettings.quietEnd} onChange={e => updateAlertSettings(['quietEnd'], e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={!!alertSettings.quietHoursEnabled} onChange={e => updateAlertSettings(['quietHoursEnabled'], e.target.checked)} /> 지정한 시간에는 알림 울리지 않기</label>
          <div className="stack notification-type-settings">
            <strong>알림 유형</strong>
            <label className="check"><input type="checkbox" checked={!!typeMap.assignment} onChange={e => updateAlertSettings([isMobile ? 'mobileTypes' : 'appTypes', 'assignment'], e.target.checked)} /> 담당자 변경 알림</label>
            <label className="check"><input type="checkbox" checked={!!typeMap.time} onChange={e => updateAlertSettings([isMobile ? 'mobileTypes' : 'appTypes', 'time'], e.target.checked)} /> 이사시간 변경 알림</label>
            <label className="check"><input type="checkbox" checked={!!typeMap.address} onChange={e => updateAlertSettings([isMobile ? 'mobileTypes' : 'appTypes', 'address'], e.target.checked)} /> 출발지 주소변경 알림</label>
          </div>
          {isMobile && <div className="inline-actions wrap"><button type="button" className="ghost" onClick={requestBrowserPermission}>권한 허용 요청</button><div className="muted small-text">브라우저/앱 환경에서 지원되는 경우 시스템 알림으로 표시됩니다.</div></div>}
          <div className="inline-actions wrap"><button type="button" onClick={saveAlertSettings} disabled={saving}>{saving ? '저장 중...' : '설정 저장'}</button></div>
        </div>
      </section>
    )
  }

  return (
    <div className="grid2 notifications-page-grid notifications-page-grid-stacked">
      {settingsView === 'mobile' ? renderAlertSettings('mobile') : settingsView === 'app' ? renderAlertSettings('app') : (
        <>
          <section className="card">
            <div className="between align-center notification-page-topbar">
              <h2>스케줄 알림</h2>
              <div className="dropdown-wrap">
                <button type="button" className="ghost small" onClick={() => setSettingsMenuOpen(v => !v)}>설정</button>
                {settingsMenuOpen && (
                  <div className="dropdown-menu right notification-settings-menu">
                    <button type="button" className="dropdown-item" onClick={() => { setSettingsView('mobile'); setSettingsMenuOpen(false) }}>휴대폰 알림</button>
                    <button type="button" className="dropdown-item" onClick={() => { setSettingsView('app'); setSettingsMenuOpen(false) }}>앱 내 알림</button>
                  </div>
                )}
              </div>
            </div>
            <div className="list">
              {scheduleItems.map(item => (
                <button key={item.id} type="button" className={item.is_read ? 'list-item block notification-item' : 'list-item block notification-item unread'} onClick={() => handleNotificationClick(item)}>
                  <strong>{item.title}</strong>
                  <div style={{ whiteSpace: 'pre-line' }}>{item.body}</div>
                </button>
              ))}
              {scheduleItems.length === 0 && <div className="muted">스케줄 알림이 없습니다.</div>}
            </div>
          </section>
          <section className="card">
            <h2>일반 알림</h2>
            <div className="list">
              {generalItems.map(item => (
                <button key={item.id} type="button" className={item.is_read ? 'list-item block notification-item' : 'list-item block notification-item unread'} onClick={() => handleNotificationClick(item)}>
                  <strong>{item.title}</strong>
                  <div style={{ whiteSpace: 'pre-line' }}>{item.body}</div>
                </button>
              ))}
              {generalItems.length === 0 && <div className="muted">알림이 없습니다.</div>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}


function PointsPage() {
  return (
    <div className="stack-page">
      <section className="card">
        <h2>포인트</h2>
        <div className="muted">포인트 기능은 다음 업데이트에서 연결할 예정입니다.</div>
      </section>
    </div>
  )
}


const QUOTE_FORM_RADIO_OPTIONS = {
  household: ['1인 가구 or 1인 분가', '2인 가구', '3인 가구 이상', '기타(사무실이사, 일반용달)'],
  structure: ['원룸', '복층원룸', '1.5룸', '투룸', '쓰리룸 이상'],
  area: ['7평 이하', '8평 ~ 10평', '11평 ~ 15평', '15평 초과'],
  elevator: ['가능', '불가능'],
  destinationElevator: ['가능', '불가능', '미정(도착지가 정해지지 않은 경우)'],
  wasteService: ['희망 (신고부터 수거까지 원스탑 서비스)', '비희망 (신고는 고객님이, 운반은 저희가)'],
  companion: ['희망 (장거리 이동 동승 불가)', '비희망'],
}

const QUOTE_FORM_MOVE_TYPES = ['일반이사', '반포장이사(추천)', '포장이사']
const QUOTE_FORM_PREMIUM_OPTIONS = ['침대 이중 비닐 커버(위생 보호)', '위생 덧신 착용(청결)']
const QUOTE_FORM_FURNITURE_OPTIONS = ['해당 사항 없음(가전/가구 없음)', '침대(프레임 X)', '침대(프레임 O)', '건조기', '세탁기', '워시타워(건조기+세탁기)', '소파(3-4인)', 'TV(65인치 이하)', 'TV(65인치 초과)', '에어컨', '에어컨 철거 필요(철거 안 되어 있을 경우 필수 체크)', '스타일러(높이 191CM 이하)', '스타일러(높이 191CM 초과)', '양문형 냉장고', '일반냉장고(300L 초과)', '책장(높이 191CM 초과)', '옷장(높이 191CM 이하)', '옷장(높이 191CM 초과)', '왕자행거(봉형)', '드레스룸 행거(시스템행거 / 수납장 있는 행거)']
const QUOTE_FORM_DISASSEMBLY_OPTIONS = ['해당 사항 없음(분해/조립 필요 가전/가구 없음)', '일반 침대 프레임', '모션 배드 침대', '돌침대', '벙커 침대 프레임', '비데', '블라인드 / 커텐', '왕자 행거(봉형)', '드레스룸 행거(시스템 행거 / 수납장 있는 행거)', '책 있음(50권 이상)']
const QUOTE_FORM_LARGE_ITEM_OPTIONS = ['해당 사항 없음(폐기물 없음)', '스타일러', '세탁기', '건조기', '양문형 냉장고', '책장(높이 191cm 초과)', '드레스룸 행거(시스템 행거 / 수납장 있는 행거)', '옷장']

const PRIVACY_NOTICE_TEXT = `이청잘 이집청년 이사잘하네(이하 ‘이청잘’)는 개인정보 보호법 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리하기 위해 필요한 범위에서 개인정보를 처리합니다.

수집 목적: 견적 안내, 상담 연락, 접수 내역 관리, 고객 문의 대응
보유 기간: 견적/상담 처리 완료 후 관련 법령 및 내부 기준에 따라 보관
수집 항목: 고객 성함, 연락처, 주소, 이사 희망일, 가전/가구 및 옵션 정보 등 신청 양식에 직접 입력한 정보

본 양식은 상담 및 견적 발송 목적의 접수용이며, 제출 시 관리자가 접수 목록과 상세 내용을 확인할 수 있습니다.`


function validateGuestCustomerName(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) return '이름(또는 닉네임)을 입력해 주세요.'
  if (/[^A-Za-z0-9가-힣\s]/.test(value)) return '이름에는 특수문자를 사용할 수 없습니다.'
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(value)) return '한글 이름은 자음/모음 단독 입력 없이 완성형으로 입력해 주세요.'

  const compact = value.replace(/\s+/g, '')
  const hasHangul = /[가-힣]/.test(compact)
  const hasAlpha = /[A-Za-z]/.test(compact)
  const hasDigit = /\d/.test(compact)

  if (hasHangul && !hasAlpha && !hasDigit) {
    if (compact.length < 2) return '한글 이름은 2자리 이상 입력해 주세요.'
    return ''
  }
  if (!hasHangul && hasAlpha && !hasDigit) {
    if (compact.length < 4) return '영문 이름은 4자리 이상 입력해 주세요.'
    return ''
  }
  if (!hasHangul && !hasAlpha && hasDigit) {
    if (compact.length < 4) return '숫자 이름은 4자리 이상 입력해 주세요.'
    return ''
  }
  if (hasHangul) {
    if (compact.length < 2) return '한글과 영문/숫자를 함께 쓰는 경우 2자리 이상 입력해 주세요.'
    return ''
  }
  if (compact.length < 4) return '영문과 숫자 조합 이름은 4자리 이상 입력해 주세요.'
  return ''
}



function formatPhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

function formatQuoteDesiredDate(item) {
  const value = String(item?.desired_date || '').trim()
  if (value) return value
  const payload = item?.payload || {}
  if (item?.form_type === 'storage') return [payload.storage_start_date, payload.storage_end_date].filter(Boolean).join(' ~ ')
  return payload.move_date || '-'
}

function formatQuoteFieldValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-'
  if (value === null || value === undefined) return '-'
  const text = String(value).trim()
  return text || '-'
}

function QuoteField({ label, required = false, children, hint = '' }) {
  return <div className="quote-form-group"><label className="quote-form-label">{required ? '＊ ' : ''}{label}</label>{hint && <div className="quote-form-hint">{hint}</div>}{children}</div>
}

function QuoteRadioGroup({ name, value, options, onChange }) {
  return <div className="quote-choice-list">{options.map(option => <label key={option} className="quote-choice quote-choice-radio"><input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} /><span>{option}</span></label>)}</div>
}

function QuoteCheckboxGroup({ values, options, onChange }) {
  const current = Array.isArray(values) ? values : []
  function toggle(option) {
    if (current.includes(option)) onChange(current.filter(item => item !== option))
    else onChange([...current, option])
  }
  return <div className="quote-choice-list">{options.map(option => <label key={option} className="quote-choice quote-choice-check"><input type="checkbox" checked={current.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}</div>
}


function QuoteFormsPage({ user, guestMode = false }) {
  const navigate = useNavigate()
  const isAdminUser = !guestMode && canAccessAdminMode(user)
  const [mode, setMode] = useState('')
  const [pageTab, setPageTab] = useState('form')
  const [listTypeTab, setListTypeTab] = useState('same_day')
  const [submitting, setSubmitting] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [adminItems, setAdminItems] = useState([])
  const [detailItem, setDetailItem] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [guestIntro, setGuestIntro] = useState({
    customer_name: user?.name || user?.nickname || '',
    contact_phone: user?.phone || '',
  })
  const [guestIntroCompleted, setGuestIntroCompleted] = useState(!guestMode)
  const [submittedSummary, setSubmittedSummary] = useState(null)
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState(() => {
    try {
      const raw = localStorage.getItem('icj_quote_favorites')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : []
    } catch (_) {
      return []
    }
  })
  const buildBaseForm = (nameValue = user?.name || user?.nickname || '', phoneValue = user?.phone || '') => ({
    privacy_agreed: false,
    customer_name: nameValue,
    move_date: '',
    storage_start_date: '',
    storage_end_date: '',
    household: '',
    structure: '',
    area: '',
    origin_address: '',
    origin_address_detail: '',
    origin_elevator: '',
    destination_address: '',
    destination_address_detail: '',
    destination_elevator: '',
    move_types: [],
    contact_phone: phoneValue,
    premium_options: [],
    furniture_types: [],
    extra_furniture: '',
    duplicate_furniture: '',
    disassembly_types: [],
    extra_disassembly: '',
    duplicate_disassembly: '',
    large_item_types: [],
    extra_large_items: '',
    duplicate_large_items: '',
    waste_service: '',
    companion_preference: '',
    via_address: '',
    via_address_detail: '',
    via_elevator: '',
    via_pickup_items: '',
    via_drop_items: '',
    move_scope_notice: false,
    kakao_notice: false,
    request_memo: '',
  })
  const [form, setForm] = useState(() => buildBaseForm())

  useEffect(() => {
    if (pageTab === 'list' && isAdminUser) loadAdminList()
  }, [pageTab, isAdminUser])

  useEffect(() => {
    try {
      localStorage.setItem('icj_quote_favorites', JSON.stringify(favoriteIds))
    } catch (_) {}
  }, [favoriteIds])

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleGuestIntroChange(key, value) {
    setGuestIntro(prev => ({ ...prev, [key]: value }))
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function proceedGuestIntro(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    const nameError = validateGuestCustomerName(guestIntro.customer_name)
    if (nameError) {
      setError(nameError)
      return
    }
    if (!String(guestIntro.contact_phone || '').trim()) {
      setError('연락처를 입력해 주세요.')
      return
    }
    const trimmedName = String(guestIntro.customer_name || '').trim()
    const trimmedPhone = String(guestIntro.contact_phone || '').trim()
    setGuestIntro({ customer_name: trimmedName, contact_phone: trimmedPhone })
    setForm(prev => ({ ...prev, customer_name: trimmedName, contact_phone: trimmedPhone }))
    setGuestIntroCompleted(true)
  }

  function selectMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    setError('')
    setSubmittedSummary(null)
  }

  function resetModeSelection() {
    setMode('')
    setMessage('')
    setError('')
    setSubmittedSummary(null)
  }

  function openPrivacyModal() {
    setPrivacyModalOpen(true)
  }

  function closePrivacyModal(agree = false) {
    setPrivacyModalOpen(false)
    if (agree) updateField('privacy_agreed', true)
  }

  function resetFormForCurrentUser() {
    const nextName = guestMode ? guestIntro.customer_name : (user?.name || user?.nickname || '')
    const nextPhone = guestMode ? guestIntro.contact_phone : (user?.phone || '')
    setForm(buildBaseForm(nextName, nextPhone))
  }

  function restartGuestFlow() {
    setSubmittedSummary(null)
    setMode('')
    setMessage('')
    setError('')
    if (guestMode) {
      setGuestIntroCompleted(false)
    }
    resetFormForCurrentUser()
  }

  function buildPayload() {
    const payload = { ...form, request_kind: mode === 'storage' ? '짐보관이사' : '당일이사' }
    const desiredDate = mode === 'storage'
      ? [form.storage_start_date, form.storage_end_date].filter(Boolean).join(' ~ ')
      : form.move_date
    return {
      form_type: mode === 'storage' ? 'storage' : 'same_day',
      requester_name: form.customer_name,
      contact_phone: form.contact_phone,
      desired_date: desiredDate,
      summary_title: `${mode === 'storage' ? '짐보관이사' : '당일이사'} · ${form.customer_name || '고객'}`,
      privacy_agreed: !!form.privacy_agreed,
      payload,
    }
  }

  async function submitForm(e) {
    e.preventDefault()
    setMessage('')
    setError('')
    if (!form.privacy_agreed) { setError('개인정보 수집 및 이용 동의가 필요합니다.'); return }
    if (!form.customer_name.trim()) { setError('고객 성함을 입력해 주세요.'); return }
    if (!form.contact_phone.trim()) { setError('견적 받으실 연락처를 입력해 주세요.'); return }
    if (mode === 'storage') {
      if (!form.storage_start_date || !form.storage_end_date) { setError('짐보관 시작/종료 일자를 입력해 주세요.'); return }
    } else if (!form.move_date) { setError('이사 희망 날짜를 입력해 주세요.'); return }
    setSubmitting(true)
    try {
      await api('/api/quote-forms/submit', { method: 'POST', body: JSON.stringify(buildPayload()) })
      const summaryDate = mode === 'storage'
        ? [form.storage_start_date, form.storage_end_date].filter(Boolean).join(' ~ ')
        : form.move_date
      setSubmittedSummary({
        customer_name: form.customer_name,
        contact_phone: form.contact_phone,
        desired_date: summaryDate || '-',
        origin_address: [form.origin_address, form.origin_address_detail].filter(Boolean).join(' '),
        destination_address: [form.destination_address, form.destination_address_detail].filter(Boolean).join(' '),
      })
      setMessage('양식이 정상 접수되었습니다. 관리자는 견적목록에서 내용을 확인할 수 있습니다.')
      resetFormForCurrentUser()
      if (isAdminUser) {
        setPageTab('list')
        loadAdminList()
      }
    } catch (err) {
      setError(err.message || '양식 접수 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function loadAdminList() {
    setListLoading(true)
    setError('')
    try {
      const result = await api('/api/admin/quote-forms')
      const nextItems = result.items || []
      setAdminItems(nextItems)
      if (nextItems.length > 0) {
        const matched = detailItem ? nextItems.find(item => item.id === detailItem.id) : nextItems[0]
        setDetailItem(matched || nextItems[0])
      } else {
        setDetailItem(null)
      }
    } catch (err) {
      setError(err.message || '견적목록을 불러오지 못했습니다.')
    } finally {
      setListLoading(false)
    }
  }

  async function openDetail(itemId) {
    setDetailLoading(true)
    try {
      const result = await api(`/api/admin/quote-forms/${itemId}`)
      setDetailItem(result.item || null)
    } catch (err) {
      setError(err.message || '상세작성양식을 불러오지 못했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }

  function toggleFavorite(itemId) {
    setFavoriteIds(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId])
  }

  function toggleSelected(itemId) {
    setSelectedIds(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId])
  }

  function toggleSelectAll(checked) {
    if (!checked) {
      setSelectedIds([])
      return
    }
    setSelectedIds(filteredAdminItems.map(item => item.id))
  }

  const currentDesiredLabel = detailItem?.form_type === 'storage' ? '짐보관 시작 / 종료 일자' : '이사 희망 날짜'
  const adminDetailPayload = detailItem?.payload || {}
  const filteredAdminItems = adminItems.filter(item => listTypeTab === 'storage' ? item.form_type === 'storage' : item.form_type !== 'storage')
  const allSelected = filteredAdminItems.length > 0 && filteredAdminItems.every(item => selectedIds.includes(item.id))

  return <div className="stack-page quote-forms-page quotes-page">
    <section className="card quote-form-shell">
      <div className="quote-form-title-block">
        <h2>{guestMode && mode ? `${mode === 'storage' ? '짐보관이사 상세 견적요청서' : '당일이사 상세 견적요청서'}` : guestMode && !mode ? '' : '견적'}</h2>
        {!guestMode && <div className="quote-form-note">견적양식 작성과 관리자용 견적목록을 한 화면에서 관리합니다.</div>}
      </div>

      {!guestMode && <div className="quote-page-tabs">
        <button type="button" className={pageTab === 'form' ? 'active' : ''} onClick={() => setPageTab('form')}>견적양식</button>
        <button type="button" className={pageTab === 'list' ? 'active' : ''} onClick={() => setPageTab('list')}>견적목록</button>
      </div>}

      {message && <div className="success-banner">{message}</div>}
      {error && <div className="error-banner">{error}</div>}

      {(pageTab === 'form' || guestMode) && <>
        {guestMode && !guestIntroCompleted && !submittedSummary && (
          <section className="quote-mode-select-card quote-guest-intro-card">
            <div className="quote-step-header centered">
              <button type="button" className="quote-step-nav-text" onClick={() => navigate('/login')}>로그인이동</button>
              <div className="quote-step-title quote-step-title-two-line"><span>로그인 없이 견적받기</span><span>(비회원)(1단계)</span></div>
              <span className="quote-step-nav-spacer" aria-hidden="true">로그인이동</span>
            </div>
            <div className="quote-form-mode-intro quote-guest-intro-layout refined">
              <div className="quote-guest-intro-title">이름과 연락처 입력</div>
              <div className="quote-guest-intro-help emphasis">※ 안내 : 이름 작성은 고객 구분을 위해 필요한 정보이며, 연락처는 문의주신 견적요청서에 대해 답변드리기 위한 용도로 사용됩니다.</div>
              <form className="quote-guest-intro-form" onSubmit={proceedGuestIntro}>
                <label className="quote-input-block">
                  <span>＊ 이름(또는 닉네임)</span>
                  <input className="quote-form-input" placeholder="예: 성규 / 규A1 / mover01" value={guestIntro.customer_name} onChange={e => handleGuestIntroChange('customer_name', e.target.value)} />
                </label>
                <label className="quote-input-block">
                  <span>＊ 연락처</span>
                  <input className="quote-form-input" inputMode="numeric" maxLength={13} placeholder="010-0000-0000" value={guestIntro.contact_phone} onChange={e => handleGuestIntroChange('contact_phone', formatPhoneDigits(e.target.value))} />
                </label>
                <div className="quote-guest-intro-help-panel">
                  <div className="quote-guest-intro-help-title">입력 조건</div>
                  <ul className="quote-guest-intro-help-list muted tiny-text">
                    <li>이름에는 특수문자를 사용할 수 없습니다.</li>
                    <li>한글은 완성형 2자리 이상 입력해야 합니다. 예: 성규</li>
                    <li>영문만 또는 숫자만 입력하는 경우 4자리 이상이어야 합니다.</li>
                    <li>한글과 영문/숫자를 함께 입력하는 경우 2자리 이상이면 가능합니다. 예: 성01, 규A1</li>
                  </ul>
                </div>
                <div className="quote-submit-bar guest-intro-submit"><button type="submit">다음 단계</button></div>
              </form>
            </div>
          </section>
        )}

        {!submittedSummary && (!guestMode || guestIntroCompleted) && !mode && (
          <section className="quote-mode-select-card quote-mode-select-compact">
            {guestMode && (
              <div className="quote-step-header centered">
                <button type="button" className="quote-step-nav-text" onClick={() => setGuestIntroCompleted(false)}>이전</button>
                <div className="quote-step-title quote-step-title-two-line"><span>로그인 없이 견적받기</span><span>(비회원)(2단계)</span></div>
                <span className="quote-step-nav-spacer" aria-hidden="true">이전</span>
              </div>
            )}
            <div className="quote-form-mode-intro quote-step-body">
              <div className="quote-form-mode-title centered">이사방법 선택</div>
              <div className="quote-mode-choice-row style-ref">
                <button type="button" className="quote-mode-button compact styled-choice" onClick={() => selectMode('same_day')}><span className="choice-name">당일이사</span><span className="choice-arrow">→</span></button>
              </div>
              <div className="quote-mode-help centered">짐 보관 필요 없이 바로 입주 가능한 경우</div>
              <div className="quote-mode-choice-row style-ref">
                <button type="button" className="quote-mode-button compact styled-choice" onClick={() => selectMode('storage')}><span className="choice-name">짐보관이사</span><span className="choice-arrow">→</span></button>
              </div>
              <div className="quote-mode-help centered">당일에 바로 입주가 안되어 짐을 보관해뒀다가 추후에 입주를 해야할 경우</div>
            </div>
          </section>
        )}

        {!submittedSummary && (!!mode) && <>
        {guestMode && (
          <div className="quote-step-card stage-three">
            <div className="quote-step-header centered quote-step-header-boxed">
              <button type="button" className="quote-step-nav-text" onClick={resetModeSelection}>이전</button>
              <div className="quote-step-heading-group">
                <div className="quote-step-title quote-step-title-two-line"><span>로그인 없이 견적받기</span><span>(비회원)(3단계)</span></div>
                <div className="quote-step-subtitle centered">{mode === 'storage' ? '짐보관이사 상세 견적요청서' : '당일이사 상세 견적요청서'}</div>
              </div>
              <span className="quote-step-nav-spacer" aria-hidden="true">이전</span>
            </div>
          </div>
        )}
        <div className="quote-move-type-table-wrapper compact integrated">
          <table className="quote-move-type-table compact-table">
            <tbody>
              <tr><th></th><th></th><th>일반이사</th><th className="blue">반포장이사(추천)</th><th className="red">포장이사</th></tr>
              <tr><th rowSpan="2" className="sky">출발지</th><th className="sky">짐포장</th><td>고객님</td><td rowSpan="3" className="blue">이청잘</td><td rowSpan="4" className="red">이청잘</td></tr>
              <tr><th className="sky">가전/가구포장</th><td>이청잘</td></tr>
              <tr><th rowSpan="2" className="rose">도착지</th><th className="rose">가전/가구 배치</th><td>이청잘</td></tr>
              <tr><th className="rose">짐 뒷정리</th><td>고객님</td><td className="blue">고객님</td></tr>
            </tbody>
          </table>
        </div>

        <form className="quote-form-body" onSubmit={submitForm}>
          <section className="quote-form-section">
            <QuoteField label="개인정보 수집 및 이용 동의" required>
              <div className="quote-privacy-actions">
                <button type="button" className="ghost small" onClick={openPrivacyModal}>상세보기</button>
                <label className="quote-choice quote-choice-check quote-inline-check"><input type="checkbox" checked={form.privacy_agreed} onChange={e => updateField('privacy_agreed', e.target.checked)} /><span>개인정보 수집 및 이용에 동의합니다.</span></label>
              </div>
            </QuoteField>
            <QuoteField label="고객 성함" required><input className="quote-form-input" value={form.customer_name} onChange={e => updateField('customer_name', e.target.value)} /></QuoteField>
            {mode === 'storage' ? <div className="quote-inline-grid two"><QuoteField label="짐보관 시작 희망일" required><input type="date" className="quote-form-input" value={form.storage_start_date} onChange={e => updateField('storage_start_date', e.target.value)} /></QuoteField><QuoteField label="짐보관 종료 희망일" required><input type="date" className="quote-form-input" value={form.storage_end_date} onChange={e => updateField('storage_end_date', e.target.value)} /></QuoteField></div> : <QuoteField label="이사 희망 날짜" required><input type="date" className="quote-form-input" value={form.move_date} onChange={e => updateField('move_date', e.target.value)} /></QuoteField>}
            <div className="quote-inline-grid three">
              <QuoteField label="출발지 거주 가구원" required><QuoteRadioGroup name="household" value={form.household} options={QUOTE_FORM_RADIO_OPTIONS.household} onChange={value => updateField('household', value)} /></QuoteField>
              <QuoteField label="출발지 구조" required><QuoteRadioGroup name="structure" value={form.structure} options={QUOTE_FORM_RADIO_OPTIONS.structure} onChange={value => updateField('structure', value)} /></QuoteField>
              <QuoteField label="출발지 평수" required><QuoteRadioGroup name="area" value={form.area} options={QUOTE_FORM_RADIO_OPTIONS.area} onChange={value => updateField('area', value)} /></QuoteField>
            </div>
            <div className="quote-inline-grid two">
              <QuoteField label="출발지 주소" required><input className="quote-form-input" placeholder="주소" value={form.origin_address} onChange={e => updateField('origin_address', e.target.value)} /><input className="quote-form-input" placeholder="상세주소" value={form.origin_address_detail} onChange={e => updateField('origin_address_detail', e.target.value)} /></QuoteField>
              <QuoteField label="출발지 엘레베이터" required><QuoteRadioGroup name="originElevator" value={form.origin_elevator} options={QUOTE_FORM_RADIO_OPTIONS.elevator} onChange={value => updateField('origin_elevator', value)} /></QuoteField>
            </div>
            <div className="quote-inline-grid two">
              <QuoteField label="도착지 주소" required><input className="quote-form-input" placeholder="주소" value={form.destination_address} onChange={e => updateField('destination_address', e.target.value)} /><input className="quote-form-input" placeholder="상세주소" value={form.destination_address_detail} onChange={e => updateField('destination_address_detail', e.target.value)} /></QuoteField>
              <QuoteField label="도착지 엘레베이터" required><QuoteRadioGroup name="destinationElevator" value={form.destination_elevator} options={QUOTE_FORM_RADIO_OPTIONS.destinationElevator} onChange={value => updateField('destination_elevator', value)} /></QuoteField>
            </div>
            <QuoteField label="희망 이사 종류" required><QuoteCheckboxGroup values={form.move_types} options={QUOTE_FORM_MOVE_TYPES} onChange={value => updateField('move_types', value)} /></QuoteField>
            <QuoteField label="견적 받으실 연락처" required><input className="quote-form-input" inputMode="numeric" maxLength={13} placeholder="010-0000-0000" value={form.contact_phone} onChange={e => updateField('contact_phone', formatPhoneDigits(e.target.value))} /></QuoteField>
          </section>

          <section className="quote-form-section">
            <QuoteField label="프리미엄 추가 옵션(무료)"><QuoteCheckboxGroup values={form.premium_options} options={QUOTE_FORM_PREMIUM_OPTIONS} onChange={value => updateField('premium_options', value)} /></QuoteField>
            <QuoteField label="가전/가구 종류" required><QuoteCheckboxGroup values={form.furniture_types} options={QUOTE_FORM_FURNITURE_OPTIONS} onChange={value => updateField('furniture_types', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="위에 없는 중형/대형 가전/가구 별도 기재"><input className="quote-form-input" placeholder="ex) 소파(2인) / tv장" value={form.extra_furniture} onChange={e => updateField('extra_furniture', e.target.value)} /></QuoteField>
              <QuoteField label="가전/가구 2개 이상 별도 기재"><input className="quote-form-input" placeholder="ex) 행거 2개 / 옷장 191cm 초과 2개" value={form.duplicate_furniture} onChange={e => updateField('duplicate_furniture', e.target.value)} /></QuoteField>
            </div>
            <QuoteField label="분해/조립 필요 가전/가구 및 책" required><QuoteCheckboxGroup values={form.disassembly_types} options={QUOTE_FORM_DISASSEMBLY_OPTIONS} onChange={value => updateField('disassembly_types', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="위에 없는 분해/조립 필요 가전/가구"><input className="quote-form-input" placeholder="ex) 블라인드 / 커텐 / 행거" value={form.extra_disassembly} onChange={e => updateField('extra_disassembly', e.target.value)} /></QuoteField>
              <QuoteField label="분해/조립 필요 가전/가구 2개 이상 기재"><input className="quote-form-input" placeholder="ex) 행거 2개 / 커텐 2개 / 블라인드 3개" value={form.duplicate_disassembly} onChange={e => updateField('duplicate_disassembly', e.target.value)} /></QuoteField>
            </div>
            <QuoteField label="대형 가전/가구 / 폐기물" required hint="* 폐기물 대리 신고 서비스 가능합니다."><QuoteCheckboxGroup values={form.large_item_types} options={QUOTE_FORM_LARGE_ITEM_OPTIONS} onChange={value => updateField('large_item_types', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="위에 없는 중/대형 가전/가구 별도 기재"><input className="quote-form-input" value={form.extra_large_items} onChange={e => updateField('extra_large_items', e.target.value)} /></QuoteField>
              <QuoteField label="중/대형 가전/가구 2개 이상 별도 기재"><input className="quote-form-input" value={form.duplicate_large_items} onChange={e => updateField('duplicate_large_items', e.target.value)} /></QuoteField>
            </div>
          </section>

          <section className="quote-form-section">
            <QuoteField label="폐기물 원스탑 신고 서비스 접수 희망"><QuoteRadioGroup name="wasteService" value={form.waste_service} options={QUOTE_FORM_RADIO_OPTIONS.wasteService} onChange={value => updateField('waste_service', value)} /></QuoteField>
            <QuoteField label="동승 희망 여부"><QuoteRadioGroup name="companion" value={form.companion_preference} options={QUOTE_FORM_RADIO_OPTIONS.companion} onChange={value => updateField('companion_preference', value)} /></QuoteField>
            <div className="quote-inline-grid two">
              <QuoteField label="경유지 주소" hint="경유지가 있는 경우에만 작성"><input className="quote-form-input" placeholder="주소" value={form.via_address} onChange={e => updateField('via_address', e.target.value)} /><input className="quote-form-input" placeholder="상세주소" value={form.via_address_detail} onChange={e => updateField('via_address_detail', e.target.value)} /></QuoteField>
              <QuoteField label="경유지 엘레베이터"><QuoteRadioGroup name="viaElevator" value={form.via_elevator} options={QUOTE_FORM_RADIO_OPTIONS.elevator} onChange={value => updateField('via_elevator', value)} /></QuoteField>
            </div>
            <div className="quote-inline-grid two">
              <QuoteField label="경유지 상차 물품"><input className="quote-form-input" value={form.via_pickup_items} onChange={e => updateField('via_pickup_items', e.target.value)} /></QuoteField>
              <QuoteField label="경유지 하차 물품"><input className="quote-form-input" value={form.via_drop_items} onChange={e => updateField('via_drop_items', e.target.value)} /></QuoteField>
            </div>
            <QuoteField label="추가 메모"><textarea className="quote-form-textarea" value={form.request_memo} onChange={e => updateField('request_memo', e.target.value)} /></QuoteField>
            <div className="quote-notice-stack">
              <label className="quote-choice quote-choice-check quote-inline-check"><input type="checkbox" checked={form.move_scope_notice} onChange={e => updateField('move_scope_notice', e.target.checked)} /><span>'이청잘'은 원룸/투룸/소형이사 전문 브랜드이며, 집/짐량 사이즈에 따라 견적 발송이 제한될 수 있음을 확인했습니다.</span></label>
              <label className="quote-choice quote-choice-check quote-inline-check"><input type="checkbox" checked={form.kakao_notice} onChange={e => updateField('kakao_notice', e.target.checked)} /><span>견적은 카카오톡으로 발송되며, 전화번호로 친구 추가 허용이 필요함을 확인했습니다.</span></label>
            </div>
          </section>

          <div className="quote-submit-bar"><button type="submit" disabled={submitting}>{submitting ? '접수 중...' : '신청 보내기'}</button></div>
        </form>
        </>}

        {privacyModalOpen && <div className="modal-overlay" onClick={() => closePrivacyModal(true)}>
          <div className="modal-card quote-privacy-modal" onClick={event => event.stopPropagation()}>
            <div className="between schedule-popup-head">
              <h3>개인정보 수집 및 이용 동의</h3>
              <button type="button" className="ghost small" onClick={() => closePrivacyModal(true)}>닫기</button>
            </div>
            <pre className="quote-privacy-modal-text">{PRIVACY_NOTICE_TEXT}</pre>
          </div>
        </div>}

        {submittedSummary && <section className="quote-mode-select-card quote-completion-card">
          <div className="quote-form-mode-intro">
            <div className="quote-form-mode-title">최종 접수 완료</div>
            <div className="quote-completion-message">{submittedSummary.customer_name} {submittedSummary.contact_phone} {submittedSummary.desired_date} {submittedSummary.origin_address || '-'} {submittedSummary.destination_address || '-'} 이사 견적요청 접수가 완료되었습니다.</div>
            <div className="quote-completion-actions row gap wrap">
              <button type="button" onClick={restartGuestFlow}>새 견적 다시 작성</button>
              {guestMode ? <button type="button" className="ghost" onClick={() => navigate('/login')}>로그인 화면으로 이동</button> : <button type="button" className="ghost" onClick={() => { setSubmittedSummary(null); setMode(''); }}>견적 화면으로 돌아가기</button>}
            </div>
          </div>
        </section>}
      </>}

      {pageTab === 'list' && !isAdminUser && !guestMode && <section className="card quote-admin-list-card"><div className="muted">견적목록은 관리자/부관리자 계정에서 확인할 수 있습니다.</div></section>}

      {pageTab === 'list' && isAdminUser && <div className="quote-admin-layout">
        <section className="card quote-admin-list-card">
          <div className="between quote-list-toolbar">
            <div className="quote-list-tabs">
              <button type="button" className={listTypeTab === 'same_day' ? 'active' : ''} onClick={() => setListTypeTab('same_day')}>당일이사</button>
              <button type="button" className={listTypeTab === 'storage' ? 'active' : ''} onClick={() => setListTypeTab('storage')}>짐보관이사</button>
            </div>
            <button type="button" className="ghost small" onClick={loadAdminList} disabled={listLoading}>{listLoading ? '불러오는 중...' : '새로고침'}</button>
          </div>

          <div className="quote-list-table-wrapper">
            <table className="quote-list-table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allSelected} onChange={e => toggleSelectAll(e.target.checked)} /></th>
                  <th>즐겨찾기</th>
                  <th>견적양식작성시각</th>
                  <th>고객성함</th>
                  <th>이사희망날짜</th>
                  <th>출발지가구원</th>
                  <th>댓글수</th>
                  <th>메뉴</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdminItems.length === 0 ? <tr><td colSpan="8" className="quote-list-empty">접수된 견적이 없습니다.</td></tr> : filteredAdminItems.map(item => {
                  const payload = item.payload || {}
                  const isFavorite = favoriteIds.includes(item.id)
                  const isChecked = selectedIds.includes(item.id)
                  return <tr key={item.id} className={detailItem?.id === item.id ? 'active' : ''} onClick={() => openDetail(item.id)}>
                    <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={isChecked} onChange={() => toggleSelected(item.id)} /></td>
                    <td onClick={e => e.stopPropagation()}><button type="button" className={`quote-star-button ${isFavorite ? 'active' : ''}`} onClick={() => toggleFavorite(item.id)} aria-label="즐겨찾기">{isFavorite ? '★' : '☆'}</button></td>
                    <td>{String(item.created_at || '').replace('T', ' ').slice(0, 16) || '-'}</td>
                    <td>{item.requester_name || '-'}</td>
                    <td>{formatQuoteDesiredDate(item)}</td>
                    <td>{payload.household || '-'}</td>
                    <td>{Number(payload.comment_count || 0)}</td>
                    <td><button type="button" className="quote-menu-button" onClick={(e) => { e.stopPropagation(); openDetail(item.id) }}>⋮</button></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card quote-admin-detail-card">
          <div className="between"><h3>상세작성양식</h3>{detailLoading && <span className="muted">불러오는 중...</span>}</div>
          {!detailItem ? <div className="muted">목록에서 견적을 선택해 주세요.</div> : <div className="quote-admin-detail-body">
            <div className="quote-detail-hero"><div><div className="quote-detail-title">{detailItem.summary_title || '-'}</div><div className="quote-detail-meta">접수유형: {detailItem.form_type === 'storage' ? '짐보관이사' : '당일이사'}</div><div className="quote-detail-meta">접수일: {String(detailItem.created_at || '').replace('T', ' ').slice(0, 16)}</div></div><div className="quote-detail-badges"><span>{detailItem.requester_name || '-'}</span><span>{detailItem.contact_phone || '-'}</span><span>{formatQuoteDesiredDate(detailItem)}</span></div></div>
            <div className="quote-detail-grid">
              <div className="quote-detail-section"><h4>기본 정보</h4><dl>{[
                ['고객 성함', adminDetailPayload.customer_name],
                [currentDesiredLabel, formatQuoteDesiredDate(detailItem)],
                ['출발지 거주 가구원', adminDetailPayload.household],
                ['출발지 구조', adminDetailPayload.structure],
                ['출발지 평수', adminDetailPayload.area],
                ['출발지 주소', [adminDetailPayload.origin_address, adminDetailPayload.origin_address_detail].filter(Boolean).join(' ')],
                ['출발지 엘레베이터', adminDetailPayload.origin_elevator],
                ['도착지 주소', [adminDetailPayload.destination_address, adminDetailPayload.destination_address_detail].filter(Boolean).join(' ')],
                ['도착지 엘레베이터', adminDetailPayload.destination_elevator],
                ['연락처', adminDetailPayload.contact_phone || detailItem.contact_phone],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
              <div className="quote-detail-section"><h4>세부 옵션</h4><dl>{[
                ['희망 이사 종류', joinQuoteValue(adminDetailPayload.move_types)],
                ['프리미엄 추가 옵션', joinQuoteValue(adminDetailPayload.premium_options)],
                ['가전/가구 종류', joinQuoteValue(adminDetailPayload.furniture_types)],
                ['추가 가전/가구', joinQuoteValue([adminDetailPayload.extra_furniture, adminDetailPayload.duplicate_furniture])],
                ['분해/조립 필요 가전/가구', joinQuoteValue(adminDetailPayload.disassembly_types)],
                ['추가 분해/조립', joinQuoteValue([adminDetailPayload.extra_disassembly, adminDetailPayload.duplicate_disassembly])],
                ['대형 가전/가구 / 폐기물', joinQuoteValue(adminDetailPayload.large_item_types)],
                ['대형 추가기재', joinQuoteValue([adminDetailPayload.extra_large_items, adminDetailPayload.duplicate_large_items])],
                ['폐기물 원스탑 신고 서비스 접수 희망', adminDetailPayload.waste_service],
                ['동승 희망 여부', adminDetailPayload.companion_preference],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
              <div className="quote-detail-section"><h4>경유지 / 메모</h4><dl>{[
                ['경유지 주소', joinQuoteValue([adminDetailPayload.via_address, adminDetailPayload.via_address_detail])],
                ['경유지 엘레베이터', adminDetailPayload.via_elevator],
                ['경유지 상차 물품', adminDetailPayload.via_pickup_items],
                ['경유지 하차 물품', adminDetailPayload.via_drop_items],
                ['추가 메모', adminDetailPayload.request_memo],
                ['원룸/투룸/소형이사 고지 확인', boolLabel(adminDetailPayload.move_scope_notice)],
                ['카카오톡 친구 추가 고지 확인', boolLabel(adminDetailPayload.kakao_notice)],
                ['개인정보 수집 이용 동의', boolLabel(adminDetailPayload.privacy_agreed)],
              ].map(([label, value]) => <QuoteDetailRow key={label} label={label} value={value} />)}</dl></div>
            </div>
          </div>}
        </section>
      </div>}
    </section>
  </div>
}



function joinQuoteValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value
}

function boolLabel(value) {
  return value ? '확인' : '-'
}

function QuoteDetailRow({ label, value }) {
  return <div className="quote-detail-row"><dt>{label}</dt><dd>{formatQuoteFieldValue(value)}</dd></div>
}

function PlaceholderFeaturePage({ title, description }) {
  return (
    <div className="stack-page">
      <section className="card">
        <h2>{title}</h2>
        <div className="muted">{description}</div>
      </section>
    </div>
  )
}

function MenuPermissionPage() {
  const currentUser = getStoredUser()
  const isAdminUser = isAdministrator(currentUser)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [configForm, setConfigForm] = useState({
    total_vehicle_count: '',
    branch_count_override: '',
    admin_mode_access_grade: 2,
    role_assign_actor_max_grade: 3,
    role_assign_target_min_grade: 3,
    account_suspend_actor_max_grade: 3,
    account_suspend_target_min_grade: 3,
    signup_approve_actor_max_grade: 3,
    signup_approve_target_min_grade: 7,
    menu_permissions_json: '',
  })
  const [permissionMap, setPermissionMap] = useState(() => buildDefaultMenuPermissions())

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await api('/api/admin-mode')
        if (ignore) return
        const nextConfig = {
          total_vehicle_count: String(response.config?.total_vehicle_count || ''),
          branch_count_override: String(response.config?.branch_count_override || response.branch_count || ''),
          ...response.permission_config,
        }
        setConfigForm(nextConfig)
        setPermissionMap(normalizeMenuPermissions(nextConfig.menu_permissions_json))
      } catch (err) {
        if (!ignore) setError(err.message || '메뉴권한 정보를 불러오지 못했습니다.')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    return () => { ignore = true }
  }, [])

  function togglePermission(entryKey, position) {
    setPermissionMap(prev => ({
      ...prev,
      [entryKey]: {
        ...(prev[entryKey] || {}),
        [position]: !(prev[entryKey]?.[position] ?? true),
      },
    }))
  }

  async function savePermissions() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const nextConfig = { ...configForm, menu_permissions_json: JSON.stringify(permissionMap) }
      await api('/api/admin-mode/config', { method: 'POST', body: JSON.stringify(nextConfig) })
      setConfigForm(nextConfig)
      const storedUser = getStoredUser()
      if (storedUser) {
        const nextUser = { ...storedUser, permission_config: { ...(storedUser.permission_config || {}), ...nextConfig } }
        sessionStorage.setItem('icj_user', JSON.stringify(nextUser))
        if (getRememberedLogin()) localStorage.setItem('icj_user', JSON.stringify(nextUser))
      }
      setMessage('메뉴권한 설정이 저장되었습니다.')
    } catch (err) {
      setError(err.message || '메뉴권한 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdminUser) return <AccessDeniedRedirect message="관리자만 메뉴권한을 변경할 수 있습니다." />
  if (loading) return <div className="card">메뉴권한 정보를 불러오는 중...</div>

  return (
    <div className="stack-page">
      <section className="card">
        <div className="between admin-mode-section-head">
          <div>
            <h2>메뉴권한</h2>
            <div className="muted">카테고리와 개별 메뉴를 직급별로 노출/비노출 설정할 수 있습니다.</div>
          </div>
          <button type="button" className="small" onClick={savePermissions} disabled={saving}>{saving ? '저장중...' : '메뉴권한 저장'}</button>
        </div>
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}
        <div className="menu-permission-table-wrap">
          <table className="menu-permission-table">
            <thead>
              <tr>
                <th>메뉴</th>
                {POSITION_PERMISSION_OPTIONS.map(position => <th key={position}>{position}</th>)}
              </tr>
            </thead>
            <tbody>
              {MENU_PERMISSION_ITEMS.map(entry => (
                <tr key={entry.key} className={entry.type === 'section' ? 'menu-permission-section-row' : ''}>
                  <td><div className={entry.type === 'section' ? 'menu-permission-label section' : 'menu-permission-label item'}>{entry.label}</div></td>
                  {POSITION_PERMISSION_OPTIONS.map(position => (
                    <td key={`${entry.key}-${position}`}>
                      <label className="check center-check">
                        <input type="checkbox" checked={!!permissionMap?.[entry.key]?.[position]} onChange={() => togglePermission(entry.key, position)} />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function SettingsPage({ onLogout }) {
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState({})
  const [blocks, setBlocks] = useState([])
  const [inquiry, setInquiry] = useState({ category: '기능문의', title: '', content: '' })
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)
  async function load() {
    const [p, b] = await Promise.all([api('/api/preferences'), api('/api/blocked-users')])
    setPrefs(p)
    setBlocks(b)
  }
  useEffect(() => { load() }, [])
  async function savePrefs() {
    await api('/api/preferences', { method: 'POST', body: JSON.stringify({ data: prefs }) })
    setMessage('설정이 저장되었습니다.')
  }
  async function submitInquiry(e) {
    e.preventDefault()
    await api('/api/inquiries', { method: 'POST', body: JSON.stringify(inquiry) })
    setInquiry({ category: '기능문의', title: '', content: '' })
    setMessage('문의가 접수되었습니다.')
  }
  async function deleteAccount() {
    if (!window.confirm('계정삭제시 관련 정보가 삭제됩니다. 그래도 삭제하시겠습니까?')) {
      return
    }
    setDeleting(true)
    try {
      await api('/api/account', { method: 'DELETE' })
      window.alert('계정이 삭제되었습니다.')
      clearSession()
      navigate('/login', { replace: true })
      window.location.reload()
    } catch (error) {
      window.alert(error.message || '계정 삭제 중 오류가 발생했습니다.')
      setDeleting(false)
    }
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>환경설정</h2>
        <label className="check"><input type="checkbox" checked={!!prefs.groupChatNotifications} onChange={e => setPrefs({ ...prefs, groupChatNotifications: e.target.checked })} /> 그룹채팅 알림</label>
        <label className="check"><input type="checkbox" checked={!!prefs.directChatNotifications} onChange={e => setPrefs({ ...prefs, directChatNotifications: e.target.checked })} /> 1:1 채팅 알림</label>
        <label className="check"><input type="checkbox" checked={!!prefs.likeNotifications} onChange={e => setPrefs({ ...prefs, likeNotifications: e.target.checked })} /> 좋아요 알림</label>
        <div className="inline-actions wrap">
          <button onClick={savePrefs}>설정 저장</button>
          <button type="button" className="danger" onClick={deleteAccount} disabled={deleting}>{deleting ? '삭제 중...' : '계정삭제'}</button>
        </div>
        <div className="muted small-text">계정삭제시 관련 정보가 삭제됩니다. 삭제 후에는 복구할 수 없습니다.</div>
        <h3>차단 사용자</h3>
        <div className="list">
          {blocks.map(item => (
            <div className="list-item block" key={item.id}>
              <strong>{item.blocked_user.nickname}</strong>
              <div className="muted">{item.reason}</div>
            </div>
          ))}
          {blocks.length === 0 && <div className="muted">차단된 사용자가 없습니다.</div>}
        </div>
      </section>
      <section className="card">
        <h2>문의 접수</h2>
        <form onSubmit={submitInquiry} className="stack">
          <input value={inquiry.category} placeholder="문의 분류" onChange={e => setInquiry({ ...inquiry, category: e.target.value })} />
          <input value={inquiry.title} placeholder="문의 제목" onChange={e => setInquiry({ ...inquiry, title: e.target.value })} />
          <textarea value={inquiry.content} placeholder="문의 내용" onChange={e => setInquiry({ ...inquiry, content: e.target.value })} />
          <button>문의 등록</button>
        </form>
        {message && <div className="success">{message}</div>}
        {toast && <div className="mention-toast action-toast">{toast}</div>}
      </section>
    </div>
  )
}


function AdminModePage() {
  const currentUser = getStoredUser()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [accountManageOpen, setAccountManageOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [authorityOpen, setAuthorityOpen] = useState(false)
  const [materialsRequestDeleteOpen, setMaterialsRequestDeleteOpen] = useState(false)
  const [materialsRequestDeleteFilters, setMaterialsRequestDeleteFilters] = useState({ userId: 'all', startDate: '', endDate: '', status: 'all' })
  const [materialsRequestDeleteRows, setMaterialsRequestDeleteRows] = useState([])
  const [materialsRequestDeleteSelection, setMaterialsRequestDeleteSelection] = useState([])
  const [materialsRequestDeleteLoading, setMaterialsRequestDeleteLoading] = useState(false)
  const [materialsRequestDeleteSubmitting, setMaterialsRequestDeleteSubmitting] = useState(false)
  const [materialsTableSizeOpen, setMaterialsTableSizeOpen] = useState(false)
  const [materialsTableEditor, setMaterialsTableEditor] = useState({ mode: 'width', target: 'sales' })
  const [materialsTableLayouts, setMaterialsTableLayouts] = useState(() => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, [...MATERIALS_TABLE_WIDTH_DEFAULTS[key]]])))
  const [materialsTableScaleSettings, setMaterialsTableScaleSettings] = useState(() => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, 100])))
  const [materialsTableSaving, setMaterialsTableSaving] = useState(false)
  const [accountManageTab, setAccountManageTab] = useState('list')
  const [accountDeleteSelection, setAccountDeleteSelection] = useState({})
  const [accountDeleteDialogOpen, setAccountDeleteDialogOpen] = useState(false)
  const [accountDeleteConfirmText, setAccountDeleteConfirmText] = useState('')
  const [selectedSwitchAccountId, setSelectedSwitchAccountId] = useState(null)
  const [switchLoading, setSwitchLoading] = useState(false)
  const [createForm, setCreateForm] = useState({
    email: '', password: '', name: '', nickname: '', gender: '', birth_year: 1995, region: '서울', phone: '', recovery_email: '', vehicle_number: '', branch_no: '', grade: 6, position_title: '', approved: true, vehicle_available: true,
  })
  const [configForm, setConfigForm] = useState({
    total_vehicle_count: '',
    branch_count_override: '',
    admin_mode_access_grade: 2,
    role_assign_actor_max_grade: 3,
    role_assign_target_min_grade: 3,
    account_suspend_actor_max_grade: 3,
    account_suspend_target_min_grade: 3,
    signup_approve_actor_max_grade: 3,
    signup_approve_target_min_grade: 7,
    menu_permissions_json: '',
  })
  const [accountRows, setAccountRows] = useState([])
  const [accountRowsSortBase, setAccountRowsSortBase] = useState([])
  const [branchRows, setBranchRows] = useState([])
  const [employeeRows, setEmployeeRows] = useState([])
  const [branchOpen, setBranchOpen] = useState({})
  const [employeeOpen, setEmployeeOpen] = useState({})
  const [branchEditMode, setBranchEditMode] = useState(false)
  const [employeeEditMode, setEmployeeEditMode] = useState(false)
  const [accountPage, setAccountPage] = useState(1)
  const [accountManagePages, setAccountManagePages] = useState({ list: 1, edit: 1, delete: 1 })
  const [accountListOpen, setAccountListOpen] = useState({})
  const [accountEditOpen, setAccountEditOpen] = useState({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusTab, setStatusTab] = useState('all')
  const [branchArchiveModalOpen, setBranchArchiveModalOpen] = useState(false)
  const [branchArchiveMode, setBranchArchiveMode] = useState('archive')
  const [branchArchiveSelection, setBranchArchiveSelection] = useState('')
  const [vehicleExceptionModal, setVehicleExceptionModal] = useState({ open: false, account: null, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: false })
  const [sortConfigs, setSortConfigs] = useState({ manage: { mode: 'group_number', keys: [] }, status: { mode: 'group_number', keys: [] }, authority: { mode: 'group_number', keys: [] } })
  const [sortModal, setSortModal] = useState({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })
  const [statusAddPickerOpen, setStatusAddPickerOpen] = useState({ branch: false, employee: false })
  const [statusAddSelection, setStatusAddSelection] = useState({ branch: '', employee: '' })
  const ACCOUNTS_PER_PAGE = 10

  function isStaffGradeValue(value) {
    return Number(value || 0) === 5
  }

  function enforceVehicleRules(item) {
    const next = { ...item }
    if (isStaffGradeValue(next?.grade)) {
      next.vehicle_available = false
    }
    return next
  }

  function parseVehicleAvailable(value) {
    if (value === false || value === 0 || value === '0' || value === 'false' || value === 'False' || value === '불가') return false
    return true
  }

  function normalizeAdminRow(item) {
    const accountType = item?.account_type || ((item?.role === 'business' || Number(item?.branch_no || 0) > 0) ? 'business' : 'employee')
    const rawGroupNumber = item?.group_number_text ?? item?.group_number ?? '0'
    return enforceVehicleRules({ ...item, group_number: String(rawGroupNumber || '0'), group_number_text: String(rawGroupNumber || '0'), vehicle_available: parseVehicleAvailable(item?.vehicle_available), approved: !!item?.approved, account_type: accountType })
  }

  function vehicleAvailableSelectValue(item) {
    return parseVehicleAvailable(item?.vehicle_available) ? '가용' : '불가'
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [response, materialsScaleResponse, desktopLayoutResponse] = await Promise.all([
        api('/api/admin-mode'),
        api('/api/materials/table-scale').catch(() => ({ scales: {} })),
        api('/api/materials/table-layout?device=desktop').catch(() => ({ layouts: {} })),
      ])
      setData(response)
      setMaterialsTableScaleSettings(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, clampMaterialsScale(materialsScaleResponse?.scales?.[key] ?? prev[key] ?? 100)])))
      setMaterialsTableLayouts(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, normalizeMaterialsColumnWidths(key, desktopLayoutResponse?.layouts?.[key] ?? prev[key] ?? MATERIALS_TABLE_WIDTH_DEFAULTS[key], false)])))
      setConfigForm({
        total_vehicle_count: String(response.config?.total_vehicle_count || ''),
        branch_count_override: String(response.config?.branch_count_override || response.branch_count || ''),
        ...response.permission_config,
      })
      const normalizedAccounts = (response.accounts || []).map(normalizeAdminRow)
      setAccountRows(normalizedAccounts)
      setAccountRowsSortBase(normalizedAccounts)
      setBranchRows((response.branches || []).map(normalizeAdminRow))
      setEmployeeRows((response.employees || []).map(normalizeAdminRow))
      setAccountPage(1)
      setAccountManagePages({ list: 1, edit: 1, delete: 1, switch: 1 })
      setAccountListOpen({})
      setAccountEditOpen({})
      setAccountDeleteSelection({})
      setAccountDeleteDialogOpen(false)
      setAccountDeleteConfirmText('')
      setSelectedSwitchAccountId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function saveConfig() {
    await api('/api/admin-mode/config', {
      method: 'POST',
      body: JSON.stringify(configForm),
    })
    const storedUser = getStoredUser()
    if (storedUser) {
      const nextUser = { ...storedUser, permission_config: { ...(storedUser.permission_config || {}), ...configForm } }
      localStorage.setItem('icj_user', JSON.stringify(nextUser))
    }
    setMessage('관리자모드 설정이 저장되었습니다.')
    await load()
  }

  async function saveAccounts() {
    await api('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({ accounts: accountRows.map(({ id, grade, approved, position_title, vehicle_available }) => ({ id, grade: Number(grade), approved, position_title: position_title || '', vehicle_available: parseVehicleAvailable(vehicle_available) })) }),
    })
    setMessage('계정 권한 정보가 저장되었습니다.')
    await load()
  }

  async function loadMaterialsDeleteRequests(nextFilters = materialsRequestDeleteFilters) {
    setMaterialsRequestDeleteLoading(true)
    try {
      const params = new URLSearchParams()
      if (String(nextFilters.userId || 'all') !== 'all') params.set('user_id', String(nextFilters.userId))
      if (String(nextFilters.status || 'all') !== 'all') params.set('status', String(nextFilters.status))
      if (String(nextFilters.startDate || '').trim()) params.set('start_date', String(nextFilters.startDate).trim())
      if (String(nextFilters.endDate || '').trim()) params.set('end_date', String(nextFilters.endDate).trim())
      const result = await api(`/api/admin/materials/purchase-requests${params.toString() ? `?${params.toString()}` : ''}`)
      setMaterialsRequestDeleteRows(Array.isArray(result?.requests) ? result.requests : [])
      setMaterialsRequestDeleteSelection([])
    } catch (err) {
      window.alert(err.message || '자재신청현황 데이터를 불러오지 못했습니다.')
    } finally {
      setMaterialsRequestDeleteLoading(false)
    }
  }

  async function deleteMaterialsDeleteRequests() {
    if (!materialsRequestDeleteSelection.length) {
      window.alert('삭제할 신청현황을 선택해 주세요.')
      return
    }
    if (!window.confirm('선택한 자재 신청현황을 삭제하시겠습니까?')) return
    setMaterialsRequestDeleteSubmitting(true)
    try {
      await api('/api/admin/materials/purchase-requests/delete', {
        method: 'POST',
        body: JSON.stringify({ request_ids: materialsRequestDeleteSelection }),
      })
      setMessage('선택한 자재 신청현황이 삭제되었습니다.')
      await loadMaterialsDeleteRequests()
    } catch (err) {
      window.alert(err.message || '자재 신청현황 삭제 중 오류가 발생했습니다.')
    } finally {
      setMaterialsRequestDeleteSubmitting(false)
    }
  }

  useEffect(() => {
    if (materialsRequestDeleteOpen) {
      loadMaterialsDeleteRequests()
    }
  }, [materialsRequestDeleteOpen])

  function updateMaterialsTableEditorField(field, value) {
    setMaterialsTableEditor(prev => ({ ...prev, [field]: value }))
  }

  function updateMaterialsTableWidth(target, index, value) {
    setMaterialsTableLayouts(prev => {
      const next = { ...prev }
      const current = Array.isArray(next[target]) ? [...next[target]] : [...(MATERIALS_TABLE_WIDTH_DEFAULTS[target] || [])]
      current[index] = clampMaterialsColumnWidth(value)
      next[target] = current
      return next
    })
  }

  async function saveMaterialsTableEditor() {
    setMaterialsTableSaving(true)
    try {
      if (materialsTableEditor.mode === 'width') {
        const target = materialsTableEditor.target
        const desktopWidths = normalizeMaterialsColumnWidths(target, materialsTableLayouts[target] || MATERIALS_TABLE_WIDTH_DEFAULTS[target] || [], false)
        const mobileWidths = normalizeMaterialsColumnWidths(target, materialsTableLayouts[target] || MATERIALS_TABLE_WIDTH_DEFAULTS[target] || [], true)
        const desktopLayouts = { [target]: desktopWidths }
        const mobileLayouts = { [target]: mobileWidths }
        await Promise.all([
          api('/api/materials/table-layout', {
            method: 'POST',
            body: JSON.stringify({ data: { device: 'desktop', layouts: desktopLayouts } }),
          }),
          api('/api/materials/table-layout', {
            method: 'POST',
            body: JSON.stringify({ data: { device: 'mobile', layouts: mobileLayouts } }),
          }),
        ])
        setMaterialsTableLayouts(prev => ({ ...prev, [target]: desktopWidths }))
        setMessage('표 가로 사이즈 설정이 저장되었습니다.')
      } else {
        const nextScales = Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, clampMaterialsScale(materialsTableScaleSettings[key] ?? 100)]))
        const response = await api('/api/materials/table-scale', {
          method: 'POST',
          body: JSON.stringify({ data: { scales: nextScales } }),
        })
        const savedScales = response?.scales || nextScales
        setMaterialsTableScaleSettings(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, clampMaterialsScale(savedScales[key] ?? prev[key] ?? 100)])))
        setMessage('표 가로 배율 설정이 저장되었습니다.')
      }
    } catch (error) {
      window.alert(error.message || '표 사이즈 설정 저장 중 오류가 발생했습니다.')
    } finally {
      setMaterialsTableSaving(false)
    }
  }

  function normalizeDetailPayload(row) {
    const rawGroupNumber = String(row.group_number_text ?? row.group_number ?? '0')
    return {
      id: row.id,
      name: row.name || '',
      nickname: row.nickname || '',
      account_unique_id: row.account_unique_id || '',
      gender: row.gender || '',
      birth_year: Number(row.birth_year || 1995),
      region: row.region || '',
      phone: row.phone || '',
      recovery_email: row.recovery_email || '',
      vehicle_number: row.vehicle_number || '',
      branch_no: row.branch_no ? Number(row.branch_no) : null,
      marital_status: row.marital_status || '',
      resident_address: row.resident_address || '',
      business_name: row.business_name || '',
      business_number: row.business_number || '',
      business_type: row.business_type || '',
      business_item: row.business_item || '',
      business_address: row.business_address || '',
      bank_account: row.bank_account || '',
      bank_name: row.bank_name || '',
      mbti: row.mbti || '',
      email: row.email || '',
      google_email: row.google_email || '',
      resident_id: row.resident_id || '',
      position_title: row.position_title || '',
      vehicle_available: isStaffGradeValue(row?.grade) ? false : parseVehicleAvailable(row.vehicle_available),
      show_in_branch_status: !!row.show_in_branch_status,
      show_in_employee_status: !!row.show_in_employee_status,
      archived_in_branch_status: !!row.archived_in_branch_status,
      group_number: rawGroupNumber,
      group_number_text: rawGroupNumber,
    }
  }

  function groupNumberDisplay(item) {
    return String(item?.group_number_text ?? item?.group_number ?? '0') || '0'
  }

  async function saveBranchDetails() {
    await api('/api/admin-mode/config', {
      method: 'POST',
      body: JSON.stringify(configForm),
    })
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: branchRows.map(normalizeDetailPayload) }),
    })
    setMessage('가맹현황 정보가 저장되었습니다.')
    setBranchEditMode(false)
    await load()
  }

  async function saveEmployeeDetails() {
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: employeeRows.map(normalizeDetailPayload) }),
    })
    setMessage('직원현황 정보가 저장되었습니다.')
    setEmployeeEditMode(false)
    await load()
  }

  async function saveAccountEdits() {
    await api('/api/admin/users/details-bulk', {
      method: 'POST',
      body: JSON.stringify({ users: accountRows.map(normalizeDetailPayload) }),
    })
    await api('/api/admin/accounts/bulk', {
      method: 'POST',
      body: JSON.stringify({
        accounts: accountRows.map(row => ({
          id: row.id,
          grade: Number(row.grade || 6),
          approved: !!row.approved,
          position_title: row.position_title || '',
          vehicle_available: isStaffGradeValue(row?.grade) ? false : parseVehicleAvailable(row.vehicle_available),
        })),
      }),
    })
    setMessage('계정편집 정보가 저장되었습니다.')
    await load()
  }

  async function submitCreateAccount(e) {
    e.preventDefault()
    const requiredFields = [
      ['name', '이름'],
      ['email', '아이디'],
      ['password', '비밀번호'],
      ['nickname', '닉네임'],
    ]
    for (const [fieldKey, fieldLabel] of requiredFields) {
      if (!String(createForm?.[fieldKey] || '').trim()) {
        window.alert(`[${fieldLabel}]를 입력해주세요.`)
        return
      }
    }
    await api('/api/admin/accounts/create', {
      method: 'POST',
      body: JSON.stringify({
        ...createForm,
        email: String(createForm.email || '').trim(),
        password: String(createForm.password || ''),
        name: String(createForm.name || '').trim(),
        nickname: String(createForm.nickname || '').trim(),
        gender: String(createForm.gender || '').trim(),
        region: String(createForm.region || '').trim() || '서울',
        phone: String(createForm.phone || '').trim(),
        recovery_email: String(createForm.recovery_email || '').trim(),
        vehicle_number: String(createForm.vehicle_number || '').trim(),
        birth_year: Number(createForm.birth_year || 1995),
        branch_no: createForm.branch_no ? Number(createForm.branch_no) : null,
        grade: Number(createForm.grade || 6),
        position_title: Number(createForm.branch_no || '') > 0 ? '호점대표' : String(createForm.position_title || '').trim(),
        approved: !!createForm.approved,
        vehicle_available: isStaffGradeValue(createForm.grade) ? false : parseVehicleAvailable(createForm.vehicle_available),
      }),
    })
    setMessage('계정이 생성되었습니다.')
    setCreateForm({ email: '', password: '', name: '', nickname: '', gender: '', birth_year: 1995, region: '서울', phone: '', recovery_email: '', vehicle_number: '', branch_no: '', grade: 6, position_title: '', approved: true, vehicle_available: true })
    await load()
  }

  async function switchAccountType(targetType) {
    if (!selectedSwitchAccountId) {
      setMessage('전환할 계정을 먼저 선택해주세요.')
      return
    }
    setSwitchLoading(true)
    try {
      await api('/api/admin/accounts/switch-type', {
        method: 'POST',
        body: JSON.stringify({ user_id: Number(selectedSwitchAccountId), target_type: targetType }),
      })
      setMessage(targetType === 'business' ? '사업자 계정으로 전환되었습니다.' : '직원 계정으로 전환되었습니다.')
      await load()
    } finally {
      setSwitchLoading(false)
    }
  }

  function requestDeleteAccounts() {
    const ids = Object.entries(accountDeleteSelection).filter(([, checked]) => !!checked).map(([id]) => Number(id))
    if (!ids.length) {
      setMessage('삭제할 계정을 먼저 선택해주세요.')
      return
    }
    setAccountDeleteConfirmText('')
    setAccountDeleteDialogOpen(true)
  }

  async function submitDeleteAccountsConfirmed() {
    const ids = Object.entries(accountDeleteSelection).filter(([, checked]) => !!checked).map(([id]) => Number(id))
    if (!ids.length) {
      setAccountDeleteDialogOpen(false)
      setMessage('삭제할 계정을 먼저 선택해주세요.')
      return
    }
    if (accountDeleteConfirmText.trim() !== '삭제') {
      setMessage("삭제를 진행하려면 텍스트창에 '삭제'라고 입력해주세요.")
      return
    }
    await api('/api/admin/accounts/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    setMessage('선택한 계정이 삭제되었습니다.')
    setAccountDeleteSelection({})
    setAccountDeleteDialogOpen(false)
    setAccountDeleteConfirmText('')
    await load()
  }

  function toggleDeleteSelection(userId) {
    setAccountDeleteSelection(prev => ({ ...prev, [userId]: !prev[userId] }))
  }



  async function callVehicleExclusionApi(accountId, action = 'list', payload = null) {
    const primaryBase = `/api/admin/accounts/${accountId}/vehicle-exclusions`
    const aliasBase = `/api/admin/vehicle-exclusions/${accountId}`
    const attempt = async (path, options = {}) => api(path, options)
    const isRetryable = error => {
      const message = String(error?.message || '')
      return message.includes('(404)') || message.includes('(405)') || message.includes('Not Found') || message.includes('Method Not Allowed')
    }
    try {
      if (action === 'list') return await attempt(primaryBase)
      if (action === 'create') return await attempt(primaryBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${primaryBase}/${payload}`, { method: 'DELETE' })
      throw new Error('지원하지 않는 차량열외 요청입니다.')
    } catch (error) {
      if (!isRetryable(error)) throw error
      if (action === 'list') return await attempt(aliasBase)
      if (action === 'create') return await attempt(aliasBase, { method: 'POST', body: JSON.stringify(payload || {}) })
      if (action === 'delete') return await attempt(`${aliasBase}/${payload}`, { method: 'DELETE' })
      throw error
    }
  }

  function updateAccountRow(userId, patch) {
    const normalizedPatch = { ...patch }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'grade')) {
      normalizedPatch.grade = Number(normalizedPatch.grade || 6)
      normalizedPatch.grade_label = gradeLabel(normalizedPatch.grade)
    }
    setAccountRows(prev => prev.map(item => item.id === userId ? enforceVehicleRules({ ...item, ...normalizedPatch }) : item))
    setBranchRows(prev => prev.map(item => item.id === userId ? enforceVehicleRules({ ...item, ...normalizedPatch }) : item))
    setEmployeeRows(prev => prev.map(item => item.id === userId ? enforceVehicleRules({ ...item, ...normalizedPatch }) : item))
  }

  async function openVehicleExceptionModal(account) {
    if (isStaffGradeValue(account?.grade)) {
      setMessage('직원 권한 계정은 차량열외를 설정할 수 없습니다.')
      return
    }
    setVehicleExceptionModal({ open: true, account, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: true })
    try {
      const response = await callVehicleExclusionApi(account.id, 'list')
      setVehicleExceptionModal(prev => ({ ...prev, items: response.items || [], loading: false }))
    } catch (error) {
      setMessage(error.message || '차량열외 목록을 불러오지 못했습니다. 백엔드 배포 상태와 API 경로를 확인해 주세요.')
      setVehicleExceptionModal(prev => ({ ...prev, loading: false, items: [] }))
    }
  }

  async function saveVehicleException() {
    if (!vehicleExceptionModal.account) return
    await callVehicleExclusionApi(vehicleExceptionModal.account.id, 'create', vehicleExceptionModal.form)
    const response = await callVehicleExclusionApi(vehicleExceptionModal.account.id, 'list')
    setVehicleExceptionModal(prev => ({ ...prev, items: response.items || [], form: { start_date: '', end_date: '', reason: '' } }))
    setMessage('차량열외 일정이 저장되었습니다.')
    await load()
  }

  async function deleteVehicleException(exclusionId) {
    if (!vehicleExceptionModal.account) return
    const response = await callVehicleExclusionApi(vehicleExceptionModal.account.id, 'delete', exclusionId)
    setVehicleExceptionModal(prev => ({ ...prev, items: response.items || prev.items }))
    setMessage('차량열외 일정이 삭제되었습니다.')
    await load()
  }

  function updateBranchRow(userId, patch) {
    setBranchRows(prev => prev.map(item => item.id === userId ? { ...item, ...patch } : item))
  }

  function updateEmployeeRow(userId, patch) {
    setEmployeeRows(prev => prev.map(item => item.id === userId ? { ...item, ...patch } : item))
  }

  function toggleBranch(id) {
    setBranchOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function isHeadOfficeRow(item) {
    const email = String(item?.email || '').trim()
    const name = String(item?.name || '').trim()
    const nickname = String(item?.nickname || '').trim()
    return ['이청잘A', '이청잘B', '이청잘C'].includes(email) || ['최성규', '이준희', '손지민'].includes(name) || ['최성규', '이준희', '손지민'].includes(nickname)
  }

  function addAccountToStatus(target) {
    const selectedId = Number(statusAddSelection[target] || 0)
    if (!selectedId) return
    const source = accountRows.find(item => Number(item.id) === selectedId)
    if (!source) return
    if (target === 'branch') {
      const nextRow = { ...source, show_in_branch_status: true, archived_in_branch_status: false }
      setBranchRows(prev => prev.some(item => item.id === selectedId) ? prev.map(item => item.id === selectedId ? nextRow : item) : [...prev, nextRow])
      setAccountRows(prev => prev.map(item => item.id === selectedId ? { ...item, show_in_branch_status: true, archived_in_branch_status: false } : item))
    }
    if (target === 'employee') {
      const nextRow = { ...source, show_in_employee_status: true }
      setEmployeeRows(prev => prev.some(item => item.id === selectedId) ? prev.map(item => item.id === selectedId ? nextRow : item) : [...prev, nextRow])
      setAccountRows(prev => prev.map(item => item.id === selectedId ? { ...item, show_in_employee_status: true } : item))
    }
    setStatusAddSelection(prev => ({ ...prev, [target]: '' }))
  }

  function toggleBranchArchive(flag) {
    const selectedId = Number(branchArchiveSelection || 0)
    if (!selectedId) return
    setBranchRows(prev => prev.map(item => item.id === selectedId ? { ...item, archived_in_branch_status: flag } : item))
    setAccountRows(prev => prev.map(item => item.id === selectedId ? { ...item, archived_in_branch_status: flag } : item))
    setBranchArchiveSelection('')
  }

  function toggleAccountListRow(id) {
    setAccountListOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleAccountEditRow(id) {
    setAccountEditOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }


  function adminSortValue(item, key) {
    if (key === 'group_number') return String(item?.group_number ?? '0').padStart(6, '0')
    if (key === 'account_type') return item?.account_type === 'business' ? '0-business' : '1-employee'
    if (key === 'vehicle_available') return parseVehicleAvailable(item?.vehicle_available) ? '0-available' : '1-unavailable'
    if (key === 'position_title') return defaultPositionForRow(item) || 'zzz'
    if (key === 'role') return String(item?.role || '')
    if (key === 'grade') return String(Number(item?.grade || 999)).padStart(3, '0')
    if (key === 'email') return String(item?.email || '').toLowerCase()
    return ''
  }

  function applyAdminSort(rows, sectionKey) {
    const config = sortConfigs?.[sectionKey] || { mode: 'group_number', keys: [] }
    const activeKeys = config.mode === 'custom'
      ? (config.keys || []).filter(Boolean).slice(0, 5)
      : [config.mode || 'group_number']
    return [...rows].sort((left, right) => {
      for (const sortKey of activeKeys) {
        const av = adminSortValue(left, sortKey)
        const bv = adminSortValue(right, sortKey)
        if (av < bv) return -1
        if (av > bv) return 1
      }
      return Number(left?.id || 0) - Number(right?.id || 0)
    })
  }

  function openSortModal(section) {
    const existing = sortConfigs?.[section]?.keys || []
    setSortModal({ open: true, section, draftKeys: [...existing, '', '', '', ''].slice(0, 5) })
  }

  function applyCustomSort() {
    const keys = (sortModal.draftKeys || []).filter(Boolean)
    const uniqueKeys = Array.from(new Set(keys)).slice(0, 5)
    if (uniqueKeys.length < 2) {
      window.alert('사용자 지정 정렬은 최소 2개의 필터를 설정해야 합니다.')
      return
    }
    setSortConfigs(prev => ({ ...prev, [sortModal.section]: { mode: 'custom', keys: uniqueKeys } }))
    setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })
  }

  function handleSortModeChange(section, mode) {
    if (mode === 'custom') {
      openSortModal(section)
      return
    }
    setSortConfigs(prev => ({ ...prev, [section]: { mode, keys: [] } }))
  }

  const sortedAccountRows = applyAdminSort(accountRows, 'manage')
  const sortedAccountBaseRows = applyAdminSort(accountRowsSortBase, 'manage')
  const sortedAuthorityRows = applyAdminSort(accountRows, 'authority')
  const sortedBranchRows = applyAdminSort(branchRows, 'status')
  const sortedEmployeeRows = applyAdminSort(employeeRows, 'status')

  const pagedAccounts = (() => {
    const start = (accountPage - 1) * ACCOUNTS_PER_PAGE
    return sortedAuthorityRows.slice(start, start + ACCOUNTS_PER_PAGE)
  })()

  const pageCount = Math.max(1, Math.ceil(sortedAuthorityRows.length / ACCOUNTS_PER_PAGE))

  const searchResults = (() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return sortedAuthorityRows.filter(item => `${item.name || ''} ${item.nickname || ''} ${item.email || ''} ${item.account_unique_id || ''} ${item.phone || ''}`.toLowerCase().includes(q))
  })()

  const actorGrade = Number(currentUser?.grade || 6)
  const actorRoleLimit = Number(configForm.role_assign_actor_max_grade || 1)
  const targetRoleFloor = Number(configForm.role_assign_target_min_grade || 7)
  const franchisePositionSet = new Set(['대표', '부대표', '호점대표'])
  const visibleBranchRows = sortedBranchRows.filter(item => !item.archived_in_branch_status)
  const archivedBranchRows = sortedBranchRows.filter(item => item.archived_in_branch_status)
  const franchiseRows = visibleBranchRows.filter(item => franchisePositionSet.has(defaultPositionForRow(item)))
  const fieldEmployeeRows = sortedEmployeeRows.filter(item => !isHeadOfficeRow(item))
  const headOfficeRows = applyAdminSort(accountRows.filter(item => isHeadOfficeRow(item)), 'status')
  const combinedStatusRows = applyAdminSort([...visibleBranchRows, ...fieldEmployeeRows, ...headOfficeRows.filter(item => !fieldEmployeeRows.some(emp => emp.id === item.id))], 'status')
  const franchiseCount = franchiseRows.length
  const derivedTotalVehicleCount = franchiseRows.filter(item => parseVehicleAvailable(item?.vehicle_available)).length
  const branchStatusCandidates = sortedAccountRows.filter(item => !branchRows.some(row => row.id === item.id))
  const employeeStatusCandidates = sortedAccountRows.filter(item => !employeeRows.some(row => row.id === item.id))
  const deletableAccounts = sortedAccountRows.filter(item => {
    if (Number(item.id) === Number(currentUser?.id || 0)) return false
    if (actorGrade === 1) return true
    if (actorGrade === 2) return Number(item.grade || 6) > 2
    return false
  })
  const selectedSwitchAccount = sortedAccountRows.find(item => Number(item.id) === Number(selectedSwitchAccountId || 0)) || null

  function canEditAccountGrade(targetUserId, targetCurrentGrade, nextGrade) {
    if (actorGrade === 1) return true
    if (actorGrade > actorRoleLimit) return false
    const safeCurrentGrade = Number(targetCurrentGrade || 6)
    const safeNextGrade = Number(nextGrade || safeCurrentGrade)
    if (safeCurrentGrade <= actorGrade) return false
    if (safeNextGrade <= actorGrade) return false
    if (safeNextGrade < targetRoleFloor) return false
    if (Number(targetUserId) === Number(currentUser?.id || 0) && safeNextGrade !== safeCurrentGrade) return false
    return true
  }

  function roleOptionsForTarget(target) {
    return ROLE_OPTIONS.map(option => ({
      ...option,
      disabled: !canEditAccountGrade(target.id, target.grade, option.value) || (actorGrade === 2 && option.value <= 2),
    }))
  }

  function defaultPositionForRow(row) {
    return row?.position_title || (Number(row?.branch_no || 0) > 0 ? '호점대표' : '')
  }

  function canEditPosition() {
    return actorGrade <= 2
  }

  function renderActionButton(top, bottom, onClick, extraClass = '') {
    return (
      <button type="button" className={`multiline-action-button ${extraClass}`.trim()} onClick={onClick}>
        <span>{top}<br />{bottom}</span>
      </button>
    )
  }

  function gradeOptionsWithSuffix(suffix) {
    return ROLE_OPTIONS.map(option => (
      <option key={option.value} value={option.value}>{option.label}까지{suffix || ''}</option>
    ))
  }

  function setManagePage(tab, pageNo) {
    setAccountManagePages(prev => ({ ...prev, [tab]: pageNo }))
  }

  function getPagedRows(rows, tab) {
    const pageNo = Number(accountManagePages[tab] || 1)
    const start = (pageNo - 1) * ACCOUNTS_PER_PAGE
    return rows.slice(start, start + ACCOUNTS_PER_PAGE)
  }

  function renderPagination(totalCount, tab) {
    const totalPageCount = Math.max(1, Math.ceil(totalCount / ACCOUNTS_PER_PAGE))
    return (
      <div className="admin-pagination">
        {Array.from({ length: totalPageCount }, (_, index) => index + 1).map(pageNo => (
          <button key={`${tab}-${pageNo}`} type="button" className={(accountManagePages[tab] || 1) === pageNo ? 'small selected-toggle' : 'small ghost'} onClick={() => setManagePage(tab, pageNo)}>{pageNo}</button>
        ))}
      </div>
    )
  }

  const pagedManageList = getPagedRows(sortedAccountRows, 'list')
  const pagedManageDeleteRows = getPagedRows(deletableAccounts, 'delete')
  const pagedManageEditRows = (() => {
    const liveMap = new Map(accountRows.map(item => [Number(item.id), item]))
    const stableRows = sortedAccountBaseRows.map(item => liveMap.get(Number(item.id)) || item)
    return getPagedRows(stableRows, 'edit')
  })()
  const pagedManageSwitchRows = getPagedRows(sortedAccountRows, 'switch')

  if (loading) return <div className="card">관리자 정보를 불러오는 중...</div>
  if (error) return <div className="card error">{error}</div>
  if (!data) return null

  return (
    <div className="admin-mode-page stack-page">
      {message && <div className="success">{message}</div>}

      {actorGrade <= 2 && (
        <section className="card admin-mode-card">
          <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setAccountManageOpen(v => !v)} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setAccountManageOpen(v => !v)
            }
          }}>
            <h2>계정관리</h2>
            <span className="admin-section-chevron">{accountManageOpen ? '−' : '+'}</span>
          </div>

          {accountManageOpen && (
            <div className="stack compact-gap">
              <div className="between admin-section-toolbar">
                <div className="inline-actions wrap admin-section-tabbar">
                  <button type="button" className={accountManageTab === 'list' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('list')}>계정목록</button>
                  <button type="button" className={accountManageTab === 'edit' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('edit')}>계정편집</button>
                  <button type="button" className={accountManageTab === 'create' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('create')}>계정추가</button>
                  <button type="button" className={accountManageTab === 'switch' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('switch')}>계정전환</button>
                  <button type="button" className={accountManageTab === 'delete' ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountManageTab('delete')}>계정삭제</button>
                  {accountManageTab !== 'create' && (
                    <select className="small admin-sort-select admin-sort-select-inline" value={sortConfigs.manage.mode} onChange={e => handleSortModeChange('manage', e.target.value)}>
                      {ADMIN_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  )}
                </div>
                <div className="inline-actions wrap admin-section-save-actions">
                  {accountManageTab === 'create' && actorGrade <= 2 && (
                    <button type="submit" form="admin-create-account-form" className="small">계정생성</button>
                  )}
                  {accountManageTab === 'edit' && actorGrade <= 2 && (
                    <button type="button" className="small" onClick={saveAccountEdits}>계정편집 저장</button>
                  )}
                  {accountManageTab === 'delete' && actorGrade <= 2 && (
                    <button type="button" className="small danger" onClick={requestDeleteAccounts}>계정삭제</button>
                  )}
                  {accountManageTab === 'switch' && actorGrade <= 2 && (
                    <>
                      <button type="button" className="small" onClick={() => switchAccountType('business')} disabled={switchLoading || !selectedSwitchAccount || selectedSwitchAccount?.account_type === 'business' || (actorGrade === 2 && Number(selectedSwitchAccount?.grade || 6) <= 2)}>사업자 전환</button>
                      <button type="button" className="small ghost" onClick={() => switchAccountType('employee')} disabled={switchLoading || !selectedSwitchAccount || selectedSwitchAccount?.account_type === 'employee' || (actorGrade === 2 && Number(selectedSwitchAccount?.grade || 6) <= 2)}>직원 전환</button>
                    </>
                  )}
                </div>
              </div>

              {accountManageTab === 'list' && (
                <>
                  <div className="admin-account-list-grid">
                    {pagedManageList.map(item => {
                      const isOpen = !!accountListOpen[item.id]
                      return (
                        <div key={`account-manage-list-${item.id}`} className="list-item block admin-detail-card compact-card collapsible-account-card">
                          <button type="button" className="admin-account-summary-button admin-account-summary-button-list" onClick={() => toggleAccountListRow(item.id)} aria-expanded={isOpen}>
                            <div className="admin-account-summary-line admin-account-summary-line-primary">
                              <span>[{groupNumberDisplay(item)}]</span>
                              <span>[{item.name || '-'}]</span>
                              <span>[{item.email || '-'}]</span>
                              <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                              <span>[{gradeLabel(item.grade)}]</span>
                            </div>
                            <div className="admin-account-summary-line admin-account-summary-line-secondary">
                              <span>[{item.account_unique_id || '-'}]</span>
                              <span>[{item.recovery_email || '-'}]</span>
                            </div>
                          </button>
                          {isOpen && (
                            <div className="admin-account-list-body">
                              <div><strong>구분숫자</strong> {groupNumberDisplay(item)}</div>
                              <div><strong>아이디</strong> {item.email || '-'}</div>
                              <div><strong>고유ID값</strong> {item.account_unique_id || '-'}</div>
                              <div><strong>이름</strong> {item.name || '-'}</div>
                              <div><strong>닉네임</strong> {item.nickname || '-'}</div>
                              <div><strong>직급</strong> {defaultPositionForRow(item) || '미지정'}</div>
                              <div><strong>권한등급</strong> {gradeLabel(item.grade)}</div>
                              <div><strong>연락처</strong> {item.phone || '-'}</div>
                              <div><strong>복구이메일</strong> {item.recovery_email || '-'}</div>
                              <div><strong>성별</strong> {item.gender || '-'}</div>
                              <div><strong>출생연도</strong> {item.birth_year || '-'}</div>
                              <div><strong>지역</strong> {item.region || '-'}</div>
                              <div><strong>차량번호</strong> {item.vehicle_number || '-'}</div>
                              <div><strong>호점</strong> {branchDisplayLabel(item.branch_no, '-')}</div>
                              <div><strong>결혼여부</strong> {item.marital_status || '-'}</div>
                              <div><strong>거주지주소</strong> {item.resident_address || '-'}</div>
                              <div><strong>사업자명</strong> {item.business_name || '-'}</div>
                              <div><strong>사업자번호</strong> {item.business_number || '-'}</div>
                              <div><strong>업태</strong> {item.business_type || '-'}</div>
                              <div><strong>종목</strong> {item.business_item || '-'}</div>
                              <div><strong>사업장주소</strong> {item.business_address || '-'}</div>
                              <div><strong>계좌번호</strong> {item.bank_account || '-'}</div>
                              <div><strong>은행명</strong> {item.bank_name || '-'}</div>
                              <div><strong>MBTI</strong> {item.mbti || '-'}</div>
                              <div><strong>구글이메일</strong> {item.google_email || '-'}</div>
                              <div><strong>주민등록번호</strong> {item.resident_id || '-'}</div>
                              <div><strong>승인상태</strong> {item.approved ? '승인됨' : '미승인'}</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {renderPagination(sortedAccountRows.length, 'list')}
                </>
              )}

              {accountManageTab === 'create' && (
                <form id="admin-create-account-form" onSubmit={submitCreateAccount} className="stack">
                  <div className="admin-inline-grid compact-inline-grid">
                    <label>이름 <input autoComplete="name" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} /></label>
                    <label>아이디 <input autoComplete="username" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} /></label>
                    <label>비밀번호 <input type="password" autoComplete="new-password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} /></label>
                    <label>닉네임 <input autoComplete="nickname" value={createForm.nickname} onChange={e => setCreateForm({ ...createForm, nickname: e.target.value })} /></label>
                    <label>성별 <input value={createForm.gender} onChange={e => setCreateForm({ ...createForm, gender: e.target.value })} /></label>
                    <label>출생연도 <input value={createForm.birth_year} onChange={e => setCreateForm({ ...createForm, birth_year: e.target.value })} /></label>
                    <label>지역 <input value={createForm.region} onChange={e => setCreateForm({ ...createForm, region: e.target.value })} /></label>
                    <label>연락처 <input autoComplete="tel" value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} /></label>
                    <label>복구이메일 <input value={createForm.recovery_email} onChange={e => setCreateForm({ ...createForm, recovery_email: e.target.value })} /></label>
                    <label>차량번호 <input value={createForm.vehicle_number} onChange={e => setCreateForm({ ...createForm, vehicle_number: e.target.value })} /></label>
                    <label>호점
                      <select value={createForm.branch_no} onChange={e => setCreateForm({ ...createForm, branch_no: e.target.value })}>
                        <option value="">선택 안 함</option>
                        {BRANCH_NUMBER_OPTIONS.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
                      </select>
                    </label>
                    <label>권한등급
                      <select value={Number(createForm.grade)} onChange={e => setCreateForm({ ...createForm, grade: Number(e.target.value) })}>
                        {roleOptionsForTarget(createForm).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>직급
                      <select value={Number(createForm.branch_no || '') > 0 ? '호점대표' : (createForm.position_title || '')} onChange={e => setCreateForm({ ...createForm, position_title: e.target.value })} disabled={Number(createForm.branch_no || '') > 0}>
                        <option value="">미지정</option>
                        {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="check"><input type="checkbox" checked={!!createForm.approved} onChange={e => setCreateForm({ ...createForm, approved: e.target.checked })} /> 승인됨</label>
                  </div>
                </form>
              )}

              {accountManageTab === 'switch' && (
                <>
                  <div className="muted">계정을 선택한 뒤 우측 상단의 사업자 전환 / 직원 전환 버튼을 눌러 전환하세요. 기존 계정 정보는 유지됩니다.</div>
                  <div className="admin-account-switch-list">
                    {pagedManageSwitchRows.map(item => {
                      const isSelected = Number(selectedSwitchAccountId || 0) === Number(item.id)
                      return (
                        <button type="button" key={`account-switch-${item.id}`} className={`admin-account-switch-row ${isSelected ? 'selected' : ''}`.trim()} onClick={() => setSelectedSwitchAccountId(item.id)}>
                          <div className="admin-account-switch-main">
                            <strong>[{item.name || item.nickname || '-'}]</strong>
                            <span>[{item.email || '-'}]</span>
                            <span>[{item.account_unique_id || '-'}]</span>
                          </div>
                          <div className="admin-account-switch-sub muted">
                            <span>현재유형 : {item.account_type === 'business' ? '사업자' : '직원'}</span>
                            <span>직급 : {defaultPositionForRow(item) || '미지정'}</span>
                            <span>권한 : {gradeLabel(item.grade)}</span>
                          </div>
                        </button>
                      )
                    })}
                    {!sortedAccountRows.length && <div className="muted">전환할 계정이 없습니다.</div>}
                  </div>
                  {renderPagination(sortedAccountRows.length, 'switch')}
                </>
              )}

              {accountManageTab === 'edit' && (
                <>
                  <div className="admin-account-edit-list">
                    {pagedManageEditRows.map(item => {
                      const isOpen = !!accountEditOpen[item.id]
                      return (
                        <div key={`account-edit-${item.id}`} className="list-item block admin-detail-card compact-card collapsible-account-card">
                          <button type="button" className="admin-account-summary-button admin-account-summary-button-edit" onClick={() => toggleAccountEditRow(item.id)} aria-expanded={isOpen}>
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{item.name || '-'}]</span>
                            <span>[{item.email || '-'}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                            <span>[{gradeLabel(item.grade)}]</span>
                          </button>
                          {isOpen && (
                            <div className="admin-inline-grid compact-inline-grid admin-edit-expanded-grid">
                              <label>구분숫자 <input type="text" inputMode="numeric" pattern="[0-9]*" value={groupNumberDisplay(item)} onChange={e => { const nextValue = e.target.value.replace(/[^0-9]/g, ''); updateAccountRow(item.id, { group_number: nextValue === '' ? '0' : nextValue, group_number_text: nextValue === '' ? '0' : nextValue }) }} /></label>
                              <label>이름 <input value={item.name || ''} onChange={e => updateAccountRow(item.id, { name: e.target.value })} /></label>
                              <label>닉네임 <input value={item.nickname || ''} onChange={e => updateAccountRow(item.id, { nickname: e.target.value })} /></label>
                              <label>아이디 <input value={item.email || ''} onChange={e => updateAccountRow(item.id, { email: e.target.value })} /></label>
                              <label>고유ID값 <input value={item.account_unique_id || ''} onChange={e => updateAccountRow(item.id, { account_unique_id: e.target.value })} /></label>
                              <label>직급
                                <select value={defaultPositionForRow(item)} onChange={e => updateAccountRow(item.id, { position_title: e.target.value })}>
                                  <option value="">미지정</option>
                                  {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                </select>
                              </label>
                              <label>권한등급
                                <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2}>
                                  {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                                </select>
                              </label>
                              <label>연락처 <input value={item.phone || ''} onChange={e => updateAccountRow(item.id, { phone: e.target.value })} /></label>
                              <label>복구이메일 <input value={item.recovery_email || ''} onChange={e => updateAccountRow(item.id, { recovery_email: e.target.value })} /></label>
                              <label>성별 <input value={item.gender || ''} onChange={e => updateAccountRow(item.id, { gender: e.target.value })} /></label>
                              <label>출생연도 <input value={item.birth_year || ''} onChange={e => updateAccountRow(item.id, { birth_year: e.target.value })} /></label>
                              <label>지역 <input value={item.region || ''} onChange={e => updateAccountRow(item.id, { region: e.target.value })} /></label>
                              <label>차량번호 <input value={item.vehicle_number || ''} onChange={e => updateAccountRow(item.id, { vehicle_number: e.target.value })} /></label>
                              <label>호점
                                <select value={isAssignedBranchNo(item.branch_no) ? String(item.branch_no) : ''} onChange={e => updateAccountRow(item.id, { branch_no: normalizeBranchNo(e.target.value) })} disabled={actorGrade > 2}>
                                  <option value="">선택 안 함</option>
                                  {BRANCH_NUMBER_OPTIONS.map(num => <option key={num} value={num}>{branchOptionLabel(num)}</option>)}
                                </select>
                              </label>
                              <label>결혼여부 <input value={item.marital_status || ''} onChange={e => updateAccountRow(item.id, { marital_status: e.target.value })} /></label>
                              <label>거주지주소 <input value={item.resident_address || ''} onChange={e => updateAccountRow(item.id, { resident_address: e.target.value })} /></label>
                              <label>사업자명 <input value={item.business_name || ''} onChange={e => updateAccountRow(item.id, { business_name: e.target.value })} /></label>
                              <label>사업자번호 <input value={item.business_number || ''} onChange={e => updateAccountRow(item.id, { business_number: e.target.value })} /></label>
                              <label>업태 <input value={item.business_type || ''} onChange={e => updateAccountRow(item.id, { business_type: e.target.value })} /></label>
                              <label>종목 <input value={item.business_item || ''} onChange={e => updateAccountRow(item.id, { business_item: e.target.value })} /></label>
                              <label>사업장주소 <input value={item.business_address || ''} onChange={e => updateAccountRow(item.id, { business_address: e.target.value })} /></label>
                              <label>계좌번호 <input value={item.bank_account || ''} onChange={e => updateAccountRow(item.id, { bank_account: e.target.value })} /></label>
                              <label>은행명 <input value={item.bank_name || ''} onChange={e => updateAccountRow(item.id, { bank_name: e.target.value })} /></label>
                              <label>MBTI <input value={item.mbti || ''} onChange={e => updateAccountRow(item.id, { mbti: e.target.value })} /></label>
                              <label>구글이메일 <input value={item.google_email || ''} onChange={e => updateAccountRow(item.id, { google_email: e.target.value })} /></label>
                              <label>주민등록번호 <input value={item.resident_id || ''} onChange={e => updateAccountRow(item.id, { resident_id: e.target.value })} /></label>
                              <label className="check"><input type="checkbox" checked={!!item.show_in_branch_status} onChange={e => updateAccountRow(item.id, { show_in_branch_status: e.target.checked })} /> 가맹현황 포함</label>
                              <label className="check"><input type="checkbox" checked={!!item.show_in_employee_status} onChange={e => updateAccountRow(item.id, { show_in_employee_status: e.target.checked })} /> 직원현황 포함</label>
                              <label className="check"><input type="checkbox" checked={!!item.approved} onChange={e => updateAccountRow(item.id, { approved: e.target.checked })} /> 승인됨</label>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {renderPagination(sortedAccountRows.length, 'edit')}
                </>
              )}

              {accountManageTab === 'delete' && (
                <>
                  <div className="admin-delete-list">
                    {pagedManageDeleteRows.map(item => (
                      <label key={`delete-${item.id}`} className="admin-delete-row">
                        <input type="checkbox" checked={!!accountDeleteSelection[item.id]} onChange={() => toggleDeleteSelection(item.id)} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2} />
                        <span className="admin-delete-row-text">[{item.name || item.nickname || '이름 미입력'}] [{item.email || '-'}] [{item.account_unique_id || '-'}]</span>
                      </label>
                    ))}
                    {!deletableAccounts.length && <div className="muted">삭제 가능한 계정이 없습니다.</div>}
                  </div>
                  {renderPagination(deletableAccounts.length, 'delete')}
                </>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle admin-status-head" role="button" tabIndex={0} onClick={() => setStatusOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setStatusOpen(v => !v)
          }
        }}>
          <div className="inline-actions wrap admin-status-title-row">
            <h2>운영현황</h2>
            {statusOpen && !isMobile && (
              <div className="inline-actions wrap admin-status-category-tabs" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                <button type="button" className={statusTab === 'all' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('all')}>전체</button>
                <button type="button" className={statusTab === 'branch' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('branch')}>가맹대표</button>
                <button type="button" className={statusTab === 'employee' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('employee')}>현장직원</button>
                <button type="button" className={statusTab === 'hq' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('hq')}>본사직원</button>
              </div>
            )}
          </div>
          <span className="admin-section-chevron">{statusOpen ? '−' : '+'}</span>
        </div>
        {statusOpen && (
          <>
            <div className="between admin-section-toolbar admin-status-toolbar">
              <div className="inline-actions wrap admin-status-toolbar-spacer" />
              <div className="inline-actions wrap admin-section-save-actions">
                {actorGrade === 1 && ((statusTab === 'all' || statusTab === 'branch')
                  ? renderActionButton('가맹현황', '정보저장', saveBranchDetails)
                  : renderActionButton(statusTab === 'hq' ? '본사직원' : '현장직원', '정보저장', saveEmployeeDetails))}
                {actorGrade === 1 && <button type="button" className={((statusTab === 'all' || statusTab === 'branch') ? branchEditMode : employeeEditMode) ? 'small selected-toggle' : 'small ghost'} onClick={() => {
                  if (statusTab === 'all' || statusTab === 'branch') setBranchEditMode(v => !v)
                  else setEmployeeEditMode(v => !v)
                }}>수정</button>}
                {actorGrade === 1 && (statusTab === 'branch' || statusTab === 'employee') && <button type="button" className={statusAddPickerOpen[statusTab] ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusAddPickerOpen(prev => ({ ...prev, [statusTab]: !prev[statusTab] }))}>추가</button>}
                {actorGrade === 1 && statusTab === 'branch' && <button type="button" className="small ghost" onClick={() => { setBranchArchiveModalOpen(true); setBranchArchiveMode('archive') }}>보관</button>}
                {actorGrade === 1 && <button type="button" className="small ghost" onClick={() => setMessage('삭제할 계정은 펼침 카드 또는 계정관리 영역에서 제외해 주세요.')}>삭제</button>}
              </div>
            </div>
            {isMobile && (
              <div className="inline-actions wrap admin-status-category-tabs">
                <button type="button" className={statusTab === 'all' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('all')}>전체</button>
                <button type="button" className={statusTab === 'branch' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('branch')}>가맹대표</button>
                <button type="button" className={statusTab === 'employee' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('employee')}>현장직원</button>
                <button type="button" className={statusTab === 'hq' ? 'small selected-toggle' : 'small ghost'} onClick={() => setStatusTab('hq')}>본사직원</button>
              </div>
            )}
            {(statusTab === 'branch' || statusTab === 'employee') && statusAddPickerOpen[statusTab] && actorGrade === 1 && (
              <div className="admin-status-add-row">
                <select value={statusAddSelection[statusTab]} onChange={e => setStatusAddSelection(prev => ({ ...prev, [statusTab]: e.target.value }))}>
                  <option value="">추가할 계정 선택</option>
                  {(statusTab === 'branch' ? branchStatusCandidates : employeeStatusCandidates).map(item => (
                    <option key={`${statusTab}-candidate-${item.id}`} value={item.id}>
                      {(item.name || item.nickname || '이름 미입력')} / {item.email || '-'} / {item.account_unique_id || '-'}
                    </option>
                  ))}
                </select>
                <button type="button" className="small" onClick={() => addAccountToStatus(statusTab)}>추가확인</button>
              </div>
            )}
            {(statusTab === 'all' || statusTab === 'branch') && (
              <>
                <div className="admin-inline-grid compact-inline-grid summary-grid summary-grid-inline-labels branch-summary-grid-mobile-two">
                  <label>가맹현황수 <input value={String(franchiseCount || 0)} readOnly /></label>
                  <label>총차량수 <input value={String(derivedTotalVehicleCount || 0)} readOnly /></label>
                </div>
                <div className="admin-subtitle">가맹현황/상세정보</div>
                <div className="list">
                  {(statusTab === 'all' ? combinedStatusRows.filter(item => franchiseRows.some(branch => branch.id === item.id)) : franchiseRows).map(item => (
                    <div key={item.id} className="list-item block admin-detail-card compact-card">
                      <div className="between admin-detail-summary-row admin-detail-summary-row-clickable" onClick={() => toggleBranch(item.id)}>
                        <div className="admin-summary-lines branch-summary-lines">
                          <div className="admin-summary-line admin-summary-line-primary">
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                            <span>[{branchDisplayLabel(item.branch_no)}]</span>
                            <span>[{item.name || item.nickname || '이름 미입력'}]</span>
                            <span>[{item.phone || '연락처 미입력'}]</span>
                          </div>
                        </div>
                      </div>
                      {branchOpen[item.id] && (
                        <div className="stack compact-gap admin-detail-stack">
                          <div className="admin-inline-grid compact-inline-grid">
                            <label>이름 <input value={item.name || ''} onChange={e => updateBranchRow(item.id, { name: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>닉네임 <input value={item.nickname || ''} onChange={e => updateBranchRow(item.id, { nickname: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>연락처 <input value={item.phone || ''} onChange={e => updateBranchRow(item.id, { phone: e.target.value })} disabled={!branchEditMode} /></label>
                          </div>
                          <div className="admin-inline-grid compact-inline-grid">
                            <label>차량번호 <input value={item.vehicle_number || ''} onChange={e => updateBranchRow(item.id, { vehicle_number: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>직급 <input value={defaultPositionForRow(item)} onChange={e => updateBranchRow(item.id, { position_title: e.target.value })} disabled={!branchEditMode} /></label>
                            <label>호점 <input value={isAssignedBranchNo(item.branch_no) ? String(item.branch_no) : ''} onChange={e => updateBranchRow(item.id, { branch_no: e.target.value })} disabled={!branchEditMode} /></label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {(statusTab === 'all' || statusTab === 'employee') && (
              <>
                <div className="admin-subtitle">현장직원</div>
                <div className="list">
                  {(statusTab === 'all' ? fieldEmployeeRows : fieldEmployeeRows).map(item => (
                    <div key={item.id} className="list-item block admin-detail-card compact-card">
                      <div className="between admin-detail-summary-row admin-detail-summary-row-clickable" onClick={() => toggleEmployee(item.id)}>
                        <div className="admin-summary-lines employee-summary-lines">
                          <div className="admin-summary-line admin-summary-line-primary">
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{item.nickname || item.name || '이름 미입력'}]</span>
                            <span>[{item.phone || '연락처 미입력'}]</span>
                            <span>[{item.vehicle_number || '차량번호 미입력'}]</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {(statusTab === 'all' || statusTab === 'hq') && (
              <>
                <div className="admin-subtitle">본사직원</div>
                <div className="list">
                  {headOfficeRows.map(item => (
                    <div key={item.id} className="list-item block admin-detail-card compact-card">
                      <div className="between admin-detail-summary-row">
                        <div className="admin-summary-lines employee-summary-lines">
                          <div className="admin-summary-line admin-summary-line-primary">
                            <span>[{groupNumberDisplay(item)}]</span>
                            <span>[{item.name || item.nickname || '이름 미입력'}]</span>
                            <span>[{item.email || '-'}]</span>
                            <span>[{defaultPositionForRow(item) || '미지정'}]</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {branchArchiveModalOpen && createPortal(
              <div className="modal-overlay" onClick={() => setBranchArchiveModalOpen(false)}>
                <div className="modal-card" onClick={e => e.stopPropagation()}>
                  <div className="between">
                    <strong>보관함</strong>
                    <button type="button" className="small ghost" onClick={() => setBranchArchiveModalOpen(false)}>닫기</button>
                  </div>
                  <div className="inline-actions wrap">
                    <button type="button" className={branchArchiveMode === 'archive' ? 'small selected-toggle' : 'small ghost'} onClick={() => setBranchArchiveMode('archive')}>보관하기</button>
                    <button type="button" className={branchArchiveMode === 'restore' ? 'small selected-toggle' : 'small ghost'} onClick={() => setBranchArchiveMode('restore')}>불러오기</button>
                  </div>
                  <div className="admin-status-add-row">
                    <select value={branchArchiveSelection} onChange={e => setBranchArchiveSelection(e.target.value)}>
                      <option value="">{branchArchiveMode === 'archive' ? '보관할 가맹 선택' : '불러올 가맹 선택'}</option>
                      {(branchArchiveMode === 'archive' ? franchiseRows : archivedBranchRows).map(item => (
                        <option key={`archive-${item.id}`} value={item.id}>{item.name || item.nickname || '이름 미입력'} / {item.phone || '-'} / {branchDisplayLabel(item.branch_no)}</option>
                      ))}
                    </select>
                    <button type="button" className="small" onClick={() => toggleBranchArchive(branchArchiveMode === 'archive')}>{branchArchiveMode === 'archive' ? '보관하기' : '불러오기'}</button>
                  </div>
                  <div className="stack compact-gap">
                    {(archivedBranchRows.length ? archivedBranchRows : []).map(item => (
                      <div key={`archived-row-${item.id}`} className="quick-edit-row">
                        <span>{item.name || item.nickname || '이름 미입력'} / {item.phone || '-'} / {branchDisplayLabel(item.branch_no)}</span>
                      </div>
                    ))}
                    {archivedBranchRows.length === 0 && <div className="muted">보관된 가맹 정보가 없습니다.</div>}
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setAuthorityOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setAuthorityOpen(v => !v)
          }
        }}>
          <h2>계정권한</h2>
          <span className="admin-section-chevron">{authorityOpen ? '−' : '+'}</span>
        </div>
        {authorityOpen && (
          <>
            <div className="between admin-section-toolbar">
              <div className="inline-actions wrap admin-section-tabbar">
                <select className="small admin-sort-select admin-sort-select-inline" value={sortConfigs.authority.mode} onChange={e => handleSortModeChange('authority', e.target.value)}>
                  {ADMIN_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="inline-actions wrap admin-section-save-actions">
                {renderActionButton('계정권한', '정보저장', saveAccounts)}
                {actorGrade === 1 && <button type="button" className="small ghost" onClick={() => navigate('/menu-permissions')}>메뉴권한</button>}
                <button type="button" className="small ghost admin-search-icon" onClick={() => setSearchOpen(true)}>🔍</button>
              </div>
            </div>
            <div className="admin-account-table">
          {pagedAccounts.map(item => (
            <div key={item.id} className="admin-account-grid compact labeled-account-grid authority-grid-8 authority-grid-responsive">
              <div className="admin-select-field locked-field admin-field-group"><span>구분</span><input value={groupNumberDisplay(item)} readOnly disabled /></div>
              <div className="admin-select-field locked-field admin-field-branch"><span>호점</span><input value={isAssignedBranchNo(item.branch_no) ? String(item.branch_no) : ''} readOnly disabled /></div>
              <div className="admin-select-field locked-field admin-field-name"><span>이름</span><input value={item.name || item.nickname || ''} readOnly disabled /></div>
              <div className="admin-select-field locked-field admin-field-id"><span>아이디</span><input value={item.email || ''} readOnly disabled /></div>
              <label className="admin-select-field admin-field-vehicle-available">
                <span>차량가용여부</span>
                <select value={vehicleAvailableSelectValue(item)} onChange={e => updateAccountRow(item.id, { vehicle_available: e.target.value === '가용' })} disabled={isStaffGradeValue(item?.grade)}>
                  <option value="가용">가용</option>
                  <option value="불가">불가</option>
                </select>
              </label>
              <label className="admin-select-field admin-action-field admin-field-vehicle-exception">
                <span>차량열외</span>
                <button type="button" className="small ghost" onClick={() => openVehicleExceptionModal(item)} disabled={isStaffGradeValue(item?.grade)}>차량열외</button>
              </label>
              <label className="admin-select-field admin-field-position">
                <span>직급</span>
                <select value={defaultPositionForRow(item)} onChange={e => updateAccountRow(item.id, { position_title: e.target.value })} disabled={!canEditPosition(item)}>
                  <option value="">미지정</option>
                  {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="admin-select-field admin-field-grade">
                <span>계정권한</span>
                <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2}>
                  {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>
            <div className="admin-pagination">
              {Array.from({ length: pageCount }, (_, index) => index + 1).map(pageNo => (
                <button key={pageNo} type="button" className={accountPage === pageNo ? 'small selected-toggle' : 'small ghost'} onClick={() => setAccountPage(pageNo)}>{pageNo}</button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setMaterialsRequestDeleteOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setMaterialsRequestDeleteOpen(v => !v)
          }
        }}>
          <h2>자재신청현황삭제</h2>
          <span className="admin-section-chevron">{materialsRequestDeleteOpen ? '−' : '+'}</span>
        </div>
        {materialsRequestDeleteOpen && (
          <div className="stack compact-gap materials-table-admin-editor-body materials-table-admin-section-body">
            <div className="admin-inline-grid compact-inline-grid materials-table-admin-controls">
              <label>계정
                <select value={materialsRequestDeleteFilters.userId} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, userId: e.target.value }))}>
                  <option value="all">전체 계정</option>
                  {accountRows.map(item => (
                    <option key={`materials-delete-user-${item.id}`} value={item.id}>
                      {item.name || item.nickname || item.email || `계정 ${item.id}`} / {item.email || '-'}
                    </option>
                  ))}
                </select>
              </label>
              <label>상태
                <select value={materialsRequestDeleteFilters.status} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, status: e.target.value }))}>
                  <option value="all">전체</option>
                  <option value="pending">신청접수</option>
                  <option value="rejected">반려됨</option>
                  <option value="settled">결산완료</option>
                </select>
              </label>
              <label>시작일
                <input type="date" value={materialsRequestDeleteFilters.startDate} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, startDate: e.target.value }))} />
              </label>
              <label>종료일
                <input type="date" value={materialsRequestDeleteFilters.endDate} onChange={e => setMaterialsRequestDeleteFilters(prev => ({ ...prev, endDate: e.target.value }))} />
              </label>
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" disabled={materialsRequestDeleteLoading} onClick={() => loadMaterialsDeleteRequests()}>조회</button>
              <button type="button" className="small ghost" disabled={materialsRequestDeleteSubmitting || materialsRequestDeleteLoading} onClick={deleteMaterialsDeleteRequests}>삭제</button>
            </div>
            <div className="admin-account-table materials-admin-delete-table">
              {materialsRequestDeleteLoading ? (
                <div className="muted">불러오는 중...</div>
              ) : materialsRequestDeleteRows.length ? materialsRequestDeleteRows.map(request => {
                const meta = parseRequesterMeta(request)
                const checked = materialsRequestDeleteSelection.includes(request.id)
                return (
                  <label key={`materials-delete-row-${request.id}`} className="materials-admin-delete-row">
                    <div className="materials-admin-delete-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => setMaterialsRequestDeleteSelection(prev => e.target.checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))}
                      />
                    </div>
                    <div>{formatRequesterBranchLabel(meta.branch)}</div>
                    <div>{meta.name}</div>
                    <div>{meta.uniqueId || '-'}</div>
                    <div>{formatFullDateLabel(request.created_at)}</div>
                    <div>{materialsStageStatusLabel(request.status)}</div>
                    <div>{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</div>
                  </label>
                )
              }) : (
                <div className="muted">조건에 맞는 신청현황이 없습니다.</div>
              )}
            </div>
            <div className="muted tiny-text">선택한 신청현황은 모든 계정 화면에서 즉시 삭제됩니다.</div>
          </div>
        )}
      </section>

      <section className="card admin-mode-card">
        <div className="between admin-mode-section-head admin-mode-section-toggle" role="button" tabIndex={0} onClick={() => setMaterialsTableSizeOpen(v => !v)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setMaterialsTableSizeOpen(v => !v)
          }
        }}>
          <h2>표 사이즈 조절</h2>
          <span className="admin-section-chevron">{materialsTableSizeOpen ? '−' : '+'}</span>
        </div>
        {materialsTableSizeOpen && (
          <div className="stack compact-gap materials-table-admin-editor-body materials-table-admin-section-body">
            <div className="admin-inline-grid compact-inline-grid materials-table-admin-controls">
              <label>기능
                <select value={materialsTableEditor.mode} onChange={e => updateMaterialsTableEditorField('mode', e.target.value)}>
                  {MATERIALS_TABLE_EDIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>화면
                <select value={materialsTableEditor.target} onChange={e => updateMaterialsTableEditorField('target', e.target.value)}>
                  {MATERIALS_TABLE_TARGET_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            {materialsTableEditor.mode === 'width' ? (
              <div className="materials-table-admin-width-list">
                {(MATERIALS_TABLE_COLUMN_LABELS[materialsTableEditor.target] || []).map((label, index) => (
                  <label key={`materials-table-width-${materialsTableEditor.target}-${index}`} className="materials-table-admin-width-row">
                    <span>{label}</span>
                    <input type="number" min="56" max="360" step="1" value={materialsTableLayouts[materialsTableEditor.target]?.[index] ?? ''} onChange={e => updateMaterialsTableWidth(materialsTableEditor.target, index, e.target.value)} />
                  </label>
                ))}
              </div>
            ) : (
              <label className="materials-table-admin-scale-field">
                <span>표 가로 배율 (%)</span>
                <input type="number" min="80" max="140" step="1" value={materialsTableScaleSettings[materialsTableEditor.target] ?? 100} onChange={e => setMaterialsTableScaleSettings(prev => ({ ...prev, [materialsTableEditor.target]: clampMaterialsScale(e.target.value) }))} />
              </label>
            )}
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" disabled={materialsTableSaving} onClick={() => saveMaterialsTableEditor()}>저장</button>
            </div>
            <div className="muted tiny-text">저장 시 모든 계정에 동일하게 적용됩니다.</div>
          </div>
        )}
      </section>


      {sortModal.open && createPortal(
        <div className="modal-overlay" onClick={() => setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })}>
          <div className="modal-card admin-sort-modal" onClick={e => e.stopPropagation()}>
            <div className="between">
              <strong>사용자 지정 정렬</strong>
              <button type="button" className="small ghost" onClick={() => setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })}>닫기</button>
            </div>
            <div className="muted">최소 2개, 최대 5개 필터를 1순위부터 설정해 주세요.</div>
            <div className="stack compact-gap admin-sort-modal-body">
              {Array.from({ length: 5 }, (_, index) => (
                <label key={`custom-sort-${index}`}>
                  <span>{index + 1}순위</span>
                  <select value={sortModal.draftKeys[index] || ''} onChange={e => {
                    const next = [...sortModal.draftKeys]
                    next[index] = e.target.value
                    setSortModal(prev => ({ ...prev, draftKeys: next }))
                  }}>
                    <option value="">선택 안 함</option>
                    {ADMIN_CUSTOM_SORT_FIELDS.map(option => <option key={`${index}-${option.value}`} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="inline-actions wrap end">
              <button type="button" className="small ghost" onClick={() => setSortModal({ open: false, section: 'manage', draftKeys: ['', '', '', '', ''] })}>취소</button>
              <button type="button" className="small" onClick={applyCustomSort}>적용</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {searchOpen && createPortal(
        <div className="modal-overlay" onClick={() => setSearchOpen(false)}>
          <div className="modal-card admin-search-modal" onClick={e => e.stopPropagation()}>
            <div className="between">
              <strong>계정 검색</strong>
              <button type="button" className="small ghost" onClick={() => setSearchOpen(false)}>닫기</button>
            </div>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="이름, 닉네임, 아이디, 고유ID, 연락처 검색" />
            <div className="admin-account-table admin-search-results">
              {searchResults.map(item => (
                <div key={item.id} className="admin-account-grid compact">
                  <div>{item.name || item.nickname}<div className="muted tiny-text">{item.account_unique_id || '-'}</div></div>
                  <div>{item.email}</div>
                  <select value={vehicleAvailableSelectValue(item)} onChange={e => updateAccountRow(item.id, { vehicle_available: e.target.value === '가용' })} disabled={isStaffGradeValue(item?.grade)}>
                    <option value="가용">가용</option>
                    <option value="불가">불가</option>
                  </select>
                  <button type="button" className="small ghost" onClick={() => openVehicleExceptionModal(item)} disabled={isStaffGradeValue(item?.grade)}>차량열외</button>
                  <select value={defaultPositionForRow(item)} onChange={e => updateAccountRow(item.id, { position_title: e.target.value })} disabled={!canEditPosition(item)}>
                    <option value="">미지정</option>
                    {POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={Number(item.grade || 6)} onChange={e => updateAccountRow(item.id, { grade: Number(e.target.value) })} disabled={actorGrade === 2 && Number(item.grade || 6) <= 2}>
                    {roleOptionsForTarget(item).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                  </select>
                </div>
              ))}
              {!searchResults.length && <div className="muted">검색 결과가 없습니다.</div>}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {vehicleExceptionModal.open && createPortal(
        <div className="modal-overlay" onClick={() => setVehicleExceptionModal({ open: false, account: null, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: false })}>
          <div className="modal-card vehicle-exclusion-modal" onClick={e => e.stopPropagation()}>
            <div className="between">
              <strong>차량열외 · {vehicleExceptionModal.account?.nickname || vehicleExceptionModal.account?.name || ''}</strong>
              <button type="button" className="small ghost" onClick={() => setVehicleExceptionModal({ open: false, account: null, items: [], form: { start_date: '', end_date: '', reason: '' }, loading: false })}>닫기</button>
            </div>
            <div className="stack compact-gap">
              <div className="admin-inline-grid compact-inline-grid">
                <label>시작일<input type="date" value={vehicleExceptionModal.form.start_date} onChange={e => setVehicleExceptionModal(prev => ({ ...prev, form: { ...prev.form, start_date: e.target.value } }))} /></label>
                <label>종료일<input type="date" value={vehicleExceptionModal.form.end_date} onChange={e => setVehicleExceptionModal(prev => ({ ...prev, form: { ...prev.form, end_date: e.target.value } }))} /></label>
              </div>
              <label>열외사유<textarea rows={3} value={vehicleExceptionModal.form.reason} onChange={e => setVehicleExceptionModal(prev => ({ ...prev, form: { ...prev.form, reason: e.target.value } }))} placeholder="열외 사유를 입력해 주세요." /></label>
              <div className="inline-actions wrap"><button type="button" className="small" onClick={saveVehicleException}>열외일정 추가</button></div>
              <div className="stack compact-gap vehicle-exclusion-list">
                {vehicleExceptionModal.loading ? <div className="muted">불러오는 중...</div> : vehicleExceptionModal.items.map(item => (
                  <div key={item.id} className="vehicle-exclusion-item">
                    <div><strong>{item.start_date} ~ {item.end_date}</strong><div className="muted">{item.reason || '사유 미입력'}</div></div>
                    <button type="button" className="small ghost" onClick={() => deleteVehicleException(item.id)}>삭제</button>
                  </div>
                ))}
                {!vehicleExceptionModal.loading && !vehicleExceptionModal.items.length && <div className="muted">등록된 열외 일정이 없습니다.</div>}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {accountDeleteDialogOpen && createPortal(
        <div className="modal-overlay" onClick={() => setAccountDeleteDialogOpen(false)}>
          <div className="modal-card delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="stack compact-gap">
              <strong>계정을 삭제하시겠습니까?</strong>
              <div className="muted">계정을 삭제하려면 아래 텍스트창에 '삭제'라고 입력 후 삭제 버튼을 누르세요.</div>
              <input value={accountDeleteConfirmText} onChange={e => setAccountDeleteConfirmText(e.target.value)} placeholder="삭제" />
              <div className="inline-actions wrap">
                <button type="button" className="small ghost" onClick={() => setAccountDeleteDialogOpen(false)}>취소</button>
                <button type="button" className="small danger" onClick={submitDeleteAccountsConfirmed}>삭제</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function ReportsPage() {
  const [items, setItems] = useState([])
  async function load() {
    const data = await api('/api/admin/reports')
    setItems(data)
  }
  useEffect(() => { load() }, [])
  async function closeReport(id) {
    await api(`/api/admin/reports/${id}/close`, { method: 'POST' })
    load()
  }
  return (
    <div className="card">
      <h2>관리자 신고 관리</h2>
      <div className="list">
        {items.map(item => (
          <div key={item.id} className="list-item block">
            <div className="between">
              <strong>{item.reason}</strong>
              <span className={item.status === 'open' ? 'status-open' : 'status-closed'}>{item.status}</span>
            </div>
            <div className="muted">신고자: {item.reporter.nickname} / 대상: {item.target.nickname}</div>
            <div>{item.detail}</div>
            {item.status === 'open' && <button className="small" onClick={() => closeReport(item.id)}>종료 처리</button>}
          </div>
        ))}
        {items.length === 0 && <div className="muted">신고 내역이 없습니다.</div>}
      </div>
    </div>
  )
}


function LocationSharingAgent({ user }) {
  const watchIdRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function syncLocationSharing() {
      try {
        const status = await api('/api/location-sharing/status')
        if (cancelled) return
        const shouldWatch = Boolean(status?.sharing_enabled && status?.active_now)
        if (!shouldWatch) {
          if (watchIdRef.current !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
          }
          return
        }
        if (!navigator.geolocation || watchIdRef.current !== null) return
        watchIdRef.current = navigator.geolocation.watchPosition(async pos => {
          try {
            const currentUser = getStoredUser()
            await api('/api/profile/location', {
              method: 'POST',
              body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, region: currentUser?.region || '서울' }),
            })
          } catch (_) {}
        }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 })
      } catch (_) {}
    }

    syncLocationSharing()
    const timer = window.setInterval(syncLocationSharing, 45000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [user?.id])

  return null
}


function formatSettlementValue(label, value) {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  if (raw === '#DIV/0!') return '0.0%'
  const numeric = Number(raw)
  if (!Number.isNaN(numeric) && /계약률/.test(String(label || ''))) {
    return `${(numeric * 100).toFixed(1)}%`
  }
  return raw
}


function cloneSettlementBlock(block) {
  return JSON.parse(JSON.stringify(block || {}))
}

function settlementDateKeyFromText(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const match = text.match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/)
  if (!match) return ''
  const year = match[1].length === 2 ? Number(`20${match[1]}`) : Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || !month || !day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getSettlementBlockDateKey(block) {
  return settlementDateKeyFromText(block?.date || '')
}

function getTodaySettlementDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function applySettlementPlatformMetrics(blocks, platformMetrics, options = {}) {
  const reflectionMap = options.reflectionMap || {}
  const todayKey = options.todayKey || getTodaySettlementDateKey()
  return (blocks || []).map(block => {
    const cloned = cloneSettlementBlock(block)
    const dateKey = getSettlementBlockDateKey(cloned)
    if (dateKey && reflectionMap[dateKey]?.block) {
      const reflectedBlock = cloneSettlementBlock(reflectionMap[dateKey].block)
      reflectedBlock.reflectionMeta = reflectionMap[dateKey]
      return reflectedBlock
    }
    if (dateKey && dateKey !== todayKey) {
      return cloned
    }
    cloned.summaryRows = (cloned.summaryRows || []).map(row => {
      const metric = platformMetrics?.[row.source]
      if (!metric) return row
      return { ...row, count: String(metric.value ?? 0) }
    })
    return cloned
  })
}

function buildSettlementReflectionMap(records) {
  return Object.fromEntries((records || []).map(record => [record.settlement_date, record]))
}

function findPreferredSettlementIndex(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return 0
  const todayKey = getTodaySettlementDateKey()
  const todayIndex = blocks.findIndex(block => getSettlementBlockDateKey(block) === todayKey)
  if (todayIndex >= 0) return todayIndex
  return blocks.length - 1
}

function formatSettlementDateKeyLabel(dateKey) {
  if (!dateKey) return '-'
  const [year, month, day] = String(dateKey).split('-')
  if (!year || !month || !day) return dateKey
  return `${year}.${month}.${day}`
}

function parseSettlementDateKey(dateKey) {
  if (!dateKey) return null
  const [year, month, day] = String(dateKey).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function getSettlementWeekOfMonth(dateKey) {
  const date = parseSettlementDateKey(dateKey)
  if (!date) return 0
  return Math.floor((date.getDate() - 1) / 7) + 1
}

function formatWeeklySettlementTitle(block, fallbackIndex = 0) {
  const dateKey = getSettlementBlockDateKey(block)
  const date = parseSettlementDateKey(dateKey)
  if (!date) return `${fallbackIndex + 1}주차 주간결산`
  return `${date.getMonth() + 1}월 ${getSettlementWeekOfMonth(dateKey)}주차 주간결산`
}

function formatMonthlySettlementTitle(block, fallbackIndex = 0) {
  const dateKey = getSettlementBlockDateKey(block)
  const date = parseSettlementDateKey(dateKey)
  if (!date) return `${fallbackIndex + 1}월 월간결산`
  return `${date.getMonth() + 1}월 월간결산`
}

function getSettlementWeekStartKey(dateKey) {
  const date = parseSettlementDateKey(dateKey)
  if (!date) return ''
  const copy = new Date(date)
  const weekday = copy.getDay()
  const diff = (weekday + 1) % 7
  copy.setDate(copy.getDate() - diff)
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`
}

function buildSettlementWeeklyPages(blocks = []) {
  const map = new Map()
  ;(blocks || []).forEach((block, index) => {
    const dateKey = getSettlementBlockDateKey(block)
    const weekKey = getSettlementWeekStartKey(dateKey) || `fallback-${index}`
    if (!map.has(weekKey)) {
      map.set(weekKey, { weekKey, start: weekKey, blocks: [] })
    }
    map.get(weekKey).blocks.push(block)
  })
  return Array.from(map.values()).map(page => {
    const ordered = [...page.blocks].sort((a, b) => getSettlementBlockDateKey(a).localeCompare(getSettlementBlockDateKey(b)))
    const startKey = getSettlementBlockDateKey(ordered[0])
    const endKey = getSettlementBlockDateKey(ordered[ordered.length - 1])
    return { ...page, start: startKey, end: endKey, blocks: ordered }
  }).sort((a, b) => String(a.start).localeCompare(String(b.start)))
}

function findPreferredSettlementWeekIndex(pages = []) {
  if (!pages.length) return 0
  const todayKey = getTodaySettlementDateKey()
  const todayWeekKey = getSettlementWeekStartKey(todayKey)
  const idx = pages.findIndex(page => page.weekKey === todayWeekKey)
  if (idx >= 0) return idx
  const futureIdx = pages.findIndex(page => String(page.start) > todayKey)
  if (futureIdx >= 0) return futureIdx
  return pages.length - 1
}

function summarizeSettlementRows(summaryRows = [], total = {}) {
  const result = {
    숨고: 0,
    오늘: 0,
    공홈: 0,
    총견적: 0,
    총계약: 0,
    플랫폼리뷰: Number(total.platformReview || 0) || 0,
    호점리뷰: Number(total.branchReview || 0) || 0,
    이슈: Number(total.issues || 0) || 0,
  }
  ;(summaryRows || []).forEach(row => {
    const source = String(row?.source || '').trim()
    const count = Number(String(row?.count ?? 0).replace(/,/g, '')) || 0
    const value = Number(String(row?.value ?? 0).replace(/,/g, '')) || 0
    const label = String(row?.label || '')
    if (source && Object.prototype.hasOwnProperty.call(result, source)) result[source] += count
    if (label.includes('총 견적 발송 수')) result.총견적 += value
    else if (label.includes('총 계약 수')) result.총계약 += value
  })
  return result
}

function buildAggregatedSettlementBlock(baseBlock, records = [], titleText = '') {
  if (!baseBlock) return null
  if (!records.length) return cloneSettlementBlock(baseBlock)
  const aggregated = cloneSettlementBlock(baseBlock)
  const metrics = records.reduce((acc, record) => {
    const current = summarizeSettlementRows(record?.block?.summaryRows || [], record?.block?.total || {})
    Object.keys(acc).forEach(key => {
      acc[key] += current[key] || 0
    })
    return acc
  }, { 숨고: 0, 오늘: 0, 공홈: 0, 총견적: 0, 총계약: 0, 플랫폼리뷰: 0, 호점리뷰: 0, 이슈: 0 })
  aggregated.title = titleText || aggregated.title
  aggregated.summaryRows = (aggregated.summaryRows || []).map(row => {
    const source = String(row?.source || '').trim()
    if (source === '숨고' || source === '오늘' || source === '공홈') {
      return { ...row, count: String(metrics[source] || 0) }
    }
    const label = String(row?.label || '')
    if (label.includes('총 견적 발송 수')) return { ...row, value: String(metrics.총견적 || 0) }
    if (label.includes('총 계약 수')) return { ...row, value: String(metrics.총계약 || 0) }
    if (label.includes('계약률')) {
      const rate = metrics.총견적 ? (metrics.총계약 / metrics.총견적) : 0
      return { ...row, value: String(rate) }
    }
    return row
  })
  aggregated.total = {
    ...(aggregated.total || {}),
    platformReview: String(metrics.플랫폼리뷰 || 0),
    branchReview: String(metrics.호점리뷰 || 0),
    issues: String(metrics.이슈 || 0),
  }
  return aggregated
}

function SettlementSheetCard({ block }) {
  return (
    <section className="settlement-sheet card">
      <div className="settlement-sheet-title">{block.title}</div>
      <div className="settlement-sheet-date">{block.date}</div>
      {block.reflectionMeta?.reflected_at && (
        <div className="settlement-sheet-reflected">
          최종 반영 {String(block.reflectionMeta.reflected_at).replace('T', ' ').slice(0, 16)} · {block.reflectionMeta.reflected_by_name || '기록됨'}
        </div>
      )}

      <div className="settlement-grid-head settlement-grid-head-summary">
        <div>{block.summaryHeaders[0]}</div>
        <div>{block.summaryHeaders[1]}</div>
      </div>
      <div className="settlement-summary-table">
        {block.summaryRows.map((row, index) => (
          <div key={`${block.title}-summary-${index}`} className="settlement-grid-row settlement-grid-row-4">
            <div>{row.source || '-'}</div>
            <div className="number">{formatSettlementValue(row.label, row.count)}</div>
            <div>{row.label || '-'}</div>
            <div className="number">{formatSettlementValue(row.label, row.value)}</div>
          </div>
        ))}
      </div>

      <div className="settlement-grid-head settlement-grid-row-6">
        <div>{block.reviewHeaders[0]}</div>
        <div></div>
        <div>{block.reviewHeaders[1]}</div>
        <div></div>
        <div>{block.reviewHeaders[2]}</div>
        <div>{block.reviewHeaders[3]}</div>
      </div>
      <div className="settlement-detail-table">
        {block.branchRows.map((row, index) => (
          <div key={`${block.title}-branch-${index}`} className="settlement-grid-row settlement-grid-row-6">
            <div>{row.platform || ''}</div>
            <div className="number">{formatSettlementValue('', row.platformCount)}</div>
            <div>{row.branch || '-'}</div>
            <div className="number">{formatSettlementValue('', row.branchCount)}</div>
            <div className="number">{formatSettlementValue('', row.issues)}</div>
            <div className="number">{formatSettlementValue('', row.score)}</div>
          </div>
        ))}
        {block.total && (
          <div className="settlement-grid-row settlement-grid-row-6 settlement-total-row">
            <div>{block.total.label || '총 계'}</div>
            <div className="number">{formatSettlementValue('', block.total.platformReview)}</div>
            <div></div>
            <div className="number">{formatSettlementValue('', block.total.branchReview)}</div>
            <div className="number">{formatSettlementValue('', block.total.issues)}</div>
            <div className="number">{formatSettlementValue('', block.total.score)}</div>
          </div>
        )}
      </div>
    </section>
  )
}

function formatSettlementNextRunLabel(value) {
  if (!value) return '다음 예정 없음'
  const raw = String(value).replace('T', ' ')
  return `다음 예정 ${raw.slice(0, 16)}`
}

function formatSettlementSyncDetail(metric, label) {
  const updated = metric?.updated_at ? ` · 최근 연동 ${String(metric.updated_at).replace('T', ' ')}` : ''
  return `${label} 최신 합계: ${metric?.value ?? 0}건${updated}`
}

function SettlementRecordBoard({ recordsByType, onSaveDailyRecord, canEdit = false }) {
  const [recordTab, setRecordTab] = useState('daily')
  const [editingDate, setEditingDate] = useState('')
  const [editDraft, setEditDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const current = recordTab === 'weekly'
    ? (recordsByType.weekly_records || [])
    : recordTab === 'monthly'
      ? (recordsByType.monthly_records || [])
      : (recordsByType.daily_records || [])

  function openEditRecord(record) {
    setEditingDate(String(record?.settlement_date || ''))
    setEditDraft(cloneSettlementBlock(record?.block || {}))
  }

  function cancelEditRecord() {
    setEditingDate('')
    setEditDraft(null)
  }

  function updateDraft(path, value) {
    setEditDraft(prev => {
      const next = cloneSettlementBlock(prev || {})
      if (path[0] === 'summaryRows') next.summaryRows[path[1]][path[2]] = value
      else if (path[0] === 'branchRows') next.branchRows[path[1]][path[2]] = value
      else if (path[0] === 'total') next.total[path[1]] = value
      else next[path[0]] = value
      return next
    })
  }

  async function saveEditRecord(record) {
    if (!onSaveDailyRecord || !editDraft) return
    setSaving(true)
    try {
      await onSaveDailyRecord(record, editDraft)
      cancelEditRecord()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card settlement-record-board">
      <div className="between settlement-record-head">
        <div>
          <h3>결산기록</h3>
          <div className="muted">일일결산에서 결산반영을 누른 자료가 누적 저장됩니다.</div>
        </div>
        <div className="settlement-record-tabs">
          <button type="button" className={recordTab === 'daily' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setRecordTab('daily')}>일일</button>
          <button type="button" className={recordTab === 'weekly' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setRecordTab('weekly')}>주간</button>
          <button type="button" className={recordTab === 'monthly' ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setRecordTab('monthly')}>월간</button>
        </div>
      </div>

      {!current.length && <div className="muted">아직 저장된 결산기록이 없습니다.</div>}

      <div className="settlement-record-list">
        {recordTab === 'daily' && current.map(record => {
          const isEditing = editingDate === String(record.settlement_date || '') && !!editDraft
          const block = isEditing ? editDraft : (record.block || {})
          return (
            <section key={`daily-${record.settlement_date}`} className="settlement-record-card card">
              <div className="between settlement-record-card-head">
                <strong>{formatSettlementDateKeyLabel(record.settlement_date)}</strong>
                <div className="inline-actions wrap end">
                  <span className="muted">반영 {String(record.reflected_at || '').replace('T', ' ').slice(0, 16)}</span>
                  {canEdit && !isEditing && <button type="button" className="small ghost" onClick={() => openEditRecord(record)}>편집</button>}
                  {canEdit && isEditing && <>
                    <button type="button" className="small ghost" onClick={cancelEditRecord}>취소</button>
                    <button type="button" className="small" onClick={() => saveEditRecord(record)} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
                  </>}
                </div>
              </div>
              <div className="muted">반영자 {record.reflected_by_name || '-'}</div>
              <div className="muted settlement-record-card-title">{block.title || record.title || ''}</div>
              {!isEditing && <div className="settlement-record-summary-grid">
                {(block.summaryRows || []).map((row, index) => (
                  <div key={`daily-summary-${record.settlement_date}-${index}`} className="settlement-record-mini-stat">
                    <span>{row.source || row.label || '-'}</span>
                    <strong>{formatSettlementValue(row.label, row.count || row.value)}</strong>
                  </div>
                ))}
              </div>}
              {isEditing && (
                <div className="settlement-edit-stack">
                  <label>제목<input value={block.title || ''} onChange={e => updateDraft(['title'], e.target.value)} /></label>
                  <label>날짜표기<input value={block.date || ''} onChange={e => updateDraft(['date'], e.target.value)} /></label>
                  <div className="settlement-edit-grid">
                    {(block.summaryRows || []).map((row, index) => (
                      <div key={`edit-summary-${record.settlement_date}-${index}`} className="settlement-edit-row">
                        <strong>{row.source || row.label || '-'}</strong>
                        <input value={row.count || ''} onChange={e => updateDraft(['summaryRows', index, 'count'], e.target.value)} placeholder="건수" />
                        <input value={row.value || ''} onChange={e => updateDraft(['summaryRows', index, 'value'], e.target.value)} placeholder="값" />
                      </div>
                    ))}
                  </div>
                  <div className="settlement-edit-grid">
                    {(block.branchRows || []).map((row, index) => (
                      <div key={`edit-branch-${record.settlement_date}-${index}`} className="settlement-edit-row settlement-edit-row-wide">
                        <strong>{row.branch || row.platform || `행 ${index + 1}`}</strong>
                        <input value={row.platformCount || ''} onChange={e => updateDraft(['branchRows', index, 'platformCount'], e.target.value)} placeholder="플랫폼리뷰" />
                        <input value={row.branchCount || ''} onChange={e => updateDraft(['branchRows', index, 'branchCount'], e.target.value)} placeholder="호점리뷰" />
                        <input value={row.issues || ''} onChange={e => updateDraft(['branchRows', index, 'issues'], e.target.value)} placeholder="이슈" />
                        <input value={row.score || ''} onChange={e => updateDraft(['branchRows', index, 'score'], e.target.value)} placeholder="점수" />
                      </div>
                    ))}
                  </div>
                  <div className="settlement-edit-grid settlement-edit-grid-total">
                    <label>플랫폼 리뷰<input value={block.total?.platformReview || ''} onChange={e => updateDraft(['total', 'platformReview'], e.target.value)} /></label>
                    <label>호점 리뷰<input value={block.total?.branchReview || ''} onChange={e => updateDraft(['total', 'branchReview'], e.target.value)} /></label>
                    <label>이슈<input value={block.total?.issues || ''} onChange={e => updateDraft(['total', 'issues'], e.target.value)} /></label>
                    <label>점수<input value={block.total?.score || ''} onChange={e => updateDraft(['total', 'score'], e.target.value)} /></label>
                  </div>
                </div>
              )}
            </section>
          )
        })}

        {recordTab !== 'daily' && current.map(item => (
          <section key={`${recordTab}-${item.period_key}`} className="settlement-record-card card">
            <div className="between settlement-record-card-head">
              <strong>{item.period_label}</strong>
              <span className="muted">{item.date_range?.start || ''} ~ {item.date_range?.end || ''}</span>
            </div>
            <div className="muted">기록일수 {item.record_count}일 · 마지막 반영 {String(item.last_reflected_at || '').replace('T', ' ').slice(0, 16)}</div>
            <div className="settlement-record-summary-grid settlement-record-summary-grid-wide">
              <div className="settlement-record-mini-stat"><span>숨고</span><strong>{item.summary?.숨고 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>오늘</span><strong>{item.summary?.오늘 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>공홈</span><strong>{item.summary?.공홈 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>총 견적</span><strong>{item.summary?.총견적 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>총 계약</span><strong>{item.summary?.총계약 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>계약률</span><strong>{formatSettlementValue('계약률', item.summary?.계약률 ?? 0)}</strong></div>
              <div className="settlement-record-mini-stat"><span>플랫폼 리뷰</span><strong>{item.summary?.플랫폼리뷰 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>호점 리뷰</span><strong>{item.summary?.호점리뷰 ?? 0}</strong></div>
              <div className="settlement-record-mini-stat"><span>이슈</span><strong>{item.summary?.이슈 ?? 0}</strong></div>
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function SettlementPage() {
  const categories = [
    { id: 'daily', label: '일일결산' },
    { id: 'weekly', label: '주간결산' },
    { id: 'monthly', label: '월간결산' },
    { id: 'records', label: '결산기록' },
  ]
  const [activeCategory, setActiveCategory] = useState('daily')
  const [syncStatus, setSyncStatus] = useState({ platforms: {}, enabled: false, is_running: false, last_message: '' })
  const [syncLoading, setSyncLoading] = useState(false)
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [soomgoEmail, setSoomgoEmail] = useState('')
  const [soomgoPassword, setSoomgoPassword] = useState('')
  const [ohouEmail, setOhouEmail] = useState('')
  const [ohouPassword, setOhouPassword] = useState('')
  const [soomgoAuthStateText, setSoomgoAuthStateText] = useState('')
  const [ohouAuthStateText, setOhouAuthStateText] = useState('')
  const [authStateLoading, setAuthStateLoading] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeSettingPlatform, setActiveSettingPlatform] = useState('')
  const [statusDetailOpen, setStatusDetailOpen] = useState(false)
  const [guidePlatform, setGuidePlatform] = useState('')
  const [guideLoading, setGuideLoading] = useState(false)
  const [guideData, setGuideData] = useState(null)
  const [recordsData, setRecordsData] = useState({ daily_records: [], weekly_records: [], monthly_records: [] })
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [reflectLoading, setReflectLoading] = useState(false)
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false)
  const [dailyIndex, setDailyIndex] = useState(0)
  const [weeklyIndex, setWeeklyIndex] = useState(0)
  const [monthlyIndex, setMonthlyIndex] = useState(0)
  const [monthlyOverrideMap, setMonthlyOverrideMap] = useState({})

  async function loadSyncStatus() {
    try {
      const data = await api('/api/settlement/platform-sync-status')
      setSyncStatus(data || { platforms: {} })
    } catch (error) {
      setSyncStatus(prev => ({ ...prev, last_message: error.message || '연동 상태를 불러오지 못했습니다.' }))
    }
  }

  async function loadRecords() {
    setRecordsLoading(true)
    try {
      const data = await api('/api/settlement/records')
      setRecordsData(data || { daily_records: [], weekly_records: [], monthly_records: [] })
    } catch (error) {
      setRecordsData({ daily_records: [], weekly_records: [], monthly_records: [] })
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    loadSyncStatus()
    loadRecords()
    const timer = window.setInterval(loadSyncStatus, 60000)
    return () => window.clearInterval(timer)
  }, [])

  async function handleRefreshSync() {
    setSyncLoading(true)
    try {
      const data = await api('/api/settlement/platform-sync/refresh', { method: 'POST' })
      setSyncStatus(data || { platforms: {} })
      window.alert('결산자료 연동이 완료되었습니다.')
    } catch (error) {
      window.alert(error.message || '데이터 연동 중 오류가 발생했습니다.')
    } finally {
      setSyncLoading(false)
    }
  }

  async function handleAuthStateUpload(platform) {
    const value = platform === '오늘' ? ohouAuthStateText : soomgoAuthStateText
    if (!String(value || '').trim()) {
      window.alert(`${platform} 인증 세션 JSON 내용을 붙여 넣어 주세요.`)
      return
    }
    setAuthStateLoading(platform)
    try {
      await api('/api/settlement/platform-auth-state', {
        method: 'POST',
        body: JSON.stringify({ platform, storage_state: String(value).trim() }),
      })
      if (platform === '오늘') setOhouAuthStateText('')
      else setSoomgoAuthStateText('')
      await loadSyncStatus()
      window.alert(`${platform} 인증 세션이 서버에 저장되었습니다. 다시 데이터 연동을 눌러 주세요.`)
    } catch (error) {
      window.alert(error.message || `${platform} 인증 세션 저장 중 오류가 발생했습니다.`)
    } finally {
      setAuthStateLoading('')
    }
  }

  async function handleSaveCredentials(platform) {
    const email = platform === '오늘' ? ohouEmail : soomgoEmail
    const password = platform === '오늘' ? ohouPassword : soomgoPassword
    if (!String(email || '').trim() || !String(password || '').trim()) {
      window.alert(`${platform} 아이디와 비밀번호를 입력해 주세요.`)
      return
    }
    setCredentialLoading(true)
    try {
      await api('/api/settlement/platform-credentials', {
        method: 'POST',
        body: JSON.stringify({ platform, email: String(email).trim(), password: String(password).trim() }),
      })
      if (platform === '오늘') setOhouPassword('')
      else setSoomgoPassword('')
      await loadSyncStatus()
      window.alert(`${platform} 계정 정보가 서버에 저장되었습니다. 다시 데이터 연동을 눌러 주세요.`)
    } catch (error) {
      window.alert(error.message || `${platform} 계정 저장 중 오류가 발생했습니다.`)
    } finally {
      setCredentialLoading(false)
    }
  }

  async function handleOpenGuide(platform) {
    setGuidePlatform(platform)
    setGuideLoading(true)
    try {
      const data = await api(`/api/settlement/platform-auth-guide?platform=${encodeURIComponent(platform)}`)
      setGuideData(data || null)
    } catch (error) {
      window.alert(error.message || `${platform} 설명서를 불러오지 못했습니다.`)
      setGuideData(null)
    } finally {
      setGuideLoading(false)
    }
  }

  function handleTogglePlatformSetting(platform) {
    setSettingsOpen(true)
    setGuideData(null)
    setGuidePlatform('')
    setActiveSettingPlatform(prev => (prev === platform ? '' : platform))
  }

  const reflectionMap = useMemo(() => buildSettlementReflectionMap(recordsData.daily_records || []), [recordsData.daily_records])
  const dailyBlocks = useMemo(
    () => applySettlementPlatformMetrics(SETTLEMENT_DATA.daily || [], syncStatus.platforms, { reflectionMap }),
    [syncStatus.platforms, reflectionMap],
  )
  const sortedDailyBlocks = useMemo(() => [...dailyBlocks].sort((left, right) => String(getSettlementBlockDateKey(left)).localeCompare(String(getSettlementBlockDateKey(right)))), [dailyBlocks])
  const weeklyBlocks = useMemo(
    () => (SETTLEMENT_DATA.weekly || []).map((block, index) => ({
      ...applySettlementPlatformMetrics([block], syncStatus.platforms, { reflectionMap: {} })[0],
      title: formatWeeklySettlementTitle(block, index),
    })),
    [syncStatus.platforms],
  )
  const monthlyBlocks = useMemo(
    () => (SETTLEMENT_DATA.monthly || []).map((block, index) => {
      const base = applySettlementPlatformMetrics([block], syncStatus.platforms, { reflectionMap: {} })[0]
      const dateKey = getSettlementBlockDateKey(base)
      const override = dateKey ? monthlyOverrideMap[dateKey] : null
      return override ? override : { ...base, title: formatMonthlySettlementTitle(base, index) }
    }),
    [syncStatus.platforms, monthlyOverrideMap],
  )

  useEffect(() => {
    setDailyIndex(prev => {
      if (!sortedDailyBlocks.length) return 0
      if (prev >= 0 && prev < sortedDailyBlocks.length) return prev
      return findPreferredSettlementIndex(sortedDailyBlocks)
    })
  }, [sortedDailyBlocks])

  useEffect(() => {
    setWeeklyIndex(prev => {
      if (!weeklyBlocks.length) return 0
      if (prev >= 0 && prev < weeklyBlocks.length) return prev
      return weeklyBlocks.length - 1
    })
  }, [weeklyBlocks])

  useEffect(() => {
    setMonthlyIndex(prev => {
      if (!monthlyBlocks.length) return 0
      if (prev >= 0 && prev < monthlyBlocks.length) return prev
      return monthlyBlocks.length - 1
    })
  }, [monthlyBlocks])

  const soomgoMetric = syncStatus.platforms?.['숨고'] || { value: 0, updated_at: '', sync_message: '' }
  const ohouMetric = syncStatus.platforms?.['오늘'] || { value: 0, updated_at: '', sync_message: '' }
  const soomgoConfig = syncStatus.configs?.['숨고'] || syncStatus.config || {}
  const ohouConfig = syncStatus.configs?.['오늘'] || {}
  const nextRunLabel = formatSettlementNextRunLabel(syncStatus.next_run_at)
  const statusText = syncStatus.is_running ? '연동 진행 중' : (syncStatus.last_message || soomgoMetric.sync_message || ohouMetric.sync_message || '대기중')
  const activePlatform = activeSettingPlatform === '오늘' ? '오늘' : '숨고'
  const activeConfig = activePlatform === '오늘' ? ohouConfig : soomgoConfig
  const activeEmail = activePlatform === '오늘' ? ohouEmail : soomgoEmail
  const activePassword = activePlatform === '오늘' ? ohouPassword : soomgoPassword
  const activeAuthStateText = activePlatform === '오늘' ? ohouAuthStateText : soomgoAuthStateText
  const selectedDailyBlock = sortedDailyBlocks[dailyIndex] || null
  const selectedDailyBlockDateKey = getSettlementBlockDateKey(selectedDailyBlock)

  const selectedWeeklyBlock = weeklyBlocks[weeklyIndex] || null
  const selectedMonthlyBlock = monthlyBlocks[monthlyIndex] || null
  const selectedMonthlyDateKey = getSettlementBlockDateKey(selectedMonthlyBlock)

  async function handleRefreshMonthlySummary() {
    if (!selectedMonthlyBlock || !selectedMonthlyDateKey) {
      window.alert('종합할 월간결산 데이터가 없습니다.')
      return
    }
    const monthKey = String(selectedMonthlyDateKey).slice(0, 7)
    const monthRecords = (recordsData.daily_records || []).filter(record => String(record.settlement_date || '').startsWith(monthKey))
    if (!monthRecords.length) {
      window.alert('해당 월에 반영된 일일결산 기록이 아직 없습니다.')
      return
    }
    setMonthlySummaryLoading(true)
    try {
      const updatedBlock = buildAggregatedSettlementBlock(
        selectedMonthlyBlock,
        monthRecords,
        formatMonthlySettlementTitle(selectedMonthlyBlock, monthlyIndex),
      )
      setMonthlyOverrideMap(prev => ({
        ...prev,
        [selectedMonthlyDateKey]: {
          ...updatedBlock,
          title: formatMonthlySettlementTitle(updatedBlock, monthlyIndex),
        },
      }))
      window.alert(`${monthKey} 월간결산이 최신 일일결산 기준으로 종합 반영되었습니다.`)
    } finally {
      setMonthlySummaryLoading(false)
    }
  }

  async function handleReflectSettlement(block) {
    const targetDateKey = getSettlementBlockDateKey(block)
    if (!block || !targetDateKey) {
      window.alert('반영할 일일결산 데이터가 없습니다.')
      return
    }
    setReflectLoading(true)
    try {
      await api('/api/settlement/records/reflect', {
        method: 'POST',
        body: JSON.stringify({
          category: 'daily',
          settlement_date: targetDateKey,
          title: block.title || '',
          block,
        }),
      })
      await loadRecords()
      window.alert(`${formatSettlementDateKeyLabel(targetDateKey)} 결산이 최종 반영되었습니다.`)
    } catch (error) {
      window.alert(error.message || '결산반영 중 오류가 발생했습니다.')
    } finally {
      setReflectLoading(false)
    }
  }

  function setActiveEmailValue(value) {
    if (activePlatform === '오늘') setOhouEmail(value)
    else setSoomgoEmail(value)
  }

  function setActivePasswordValue(value) {
    if (activePlatform === '오늘') setOhouPassword(value)
    else setSoomgoPassword(value)
  }

  function setActiveAuthStateValue(value) {
    if (activePlatform === '오늘') setOhouAuthStateText(value)
    else setSoomgoAuthStateText(value)
  }


  async function handleSaveDailyRecord(record, blockDraft) {
    const targetDateKey = String(record?.settlement_date || getSettlementBlockDateKey(blockDraft) || '').trim()
    if (!targetDateKey) {
      window.alert('저장할 결산 날짜를 찾을 수 없습니다.')
      return
    }
    await api('/api/settlement/records/reflect', {
      method: 'POST',
      body: JSON.stringify({
        category: 'daily',
        settlement_date: targetDateKey,
        title: blockDraft?.title || record?.title || '',
        block: blockDraft,
      }),
    })
    await loadRecords()
    window.alert(`${formatSettlementDateKeyLabel(targetDateKey)} 일일결산이 저장되었습니다.`)
  }

  let content = null
  if (activeCategory === 'records') {
    content = <SettlementRecordBoard recordsByType={recordsData} onSaveDailyRecord={handleSaveDailyRecord} canEdit={true} />
  } else if (activeCategory === 'daily') {
    content = selectedDailyBlock ? (
      <>
        <div className="settlement-day-nav card">
          <button type="button" className="ghost small" onClick={() => setDailyIndex(prev => Math.max(0, prev - 1))} disabled={dailyIndex <= 0}>◀</button>
          <div className="settlement-day-nav-title">
            <strong>{formatSettlementDateKeyLabel(selectedDailyBlockDateKey)}</strong>
            <span className="muted">{dailyIndex + 1} / {sortedDailyBlocks.length} · 토요일 ~ 금요일 일일결산</span>
          </div>
          <button type="button" className="ghost small" onClick={() => setDailyIndex(prev => Math.min(sortedDailyBlocks.length - 1, prev + 1))} disabled={dailyIndex >= sortedDailyBlocks.length - 1}>▶</button>
        </div>
        <div className="settlement-sheet-grid settlement-sheet-grid-single">
          <div className="settlement-daily-week-card-wrap">
            <SettlementSheetCard block={selectedDailyBlock} />
            <div className="settlement-inline-actions">
              <button type="button" onClick={() => handleReflectSettlement(selectedDailyBlock)} disabled={reflectLoading}>
                {reflectLoading ? '반영중...' : `${formatSettlementDateKeyLabel(selectedDailyBlockDateKey)} 결산반영`}
              </button>
            </div>
          </div>
        </div>
      </>
    ) : <div className="card muted">표시할 일일결산 데이터가 없습니다.</div>
  } else if (activeCategory === 'weekly') {
    content = selectedWeeklyBlock ? (
      <>
        <div className="settlement-day-nav card">
          <button type="button" className="ghost small" onClick={() => setWeeklyIndex(prev => Math.max(0, prev - 1))} disabled={weeklyIndex <= 0}>◀</button>
          <div className="settlement-day-nav-title">
            <strong>{selectedWeeklyBlock.title}</strong>
            <span className="muted">{weeklyIndex + 1} / {weeklyBlocks.length}</span>
          </div>
          <button type="button" className="ghost small" onClick={() => setWeeklyIndex(prev => Math.min(weeklyBlocks.length - 1, prev + 1))} disabled={weeklyIndex >= weeklyBlocks.length - 1}>▶</button>
        </div>
        <div className="settlement-sheet-grid settlement-sheet-grid-single">
          <SettlementSheetCard block={selectedWeeklyBlock} />
        </div>
      </>
    ) : <div className="card muted">표시할 주간결산 데이터가 없습니다.</div>
  } else {
    content = selectedMonthlyBlock ? (
      <>
        <div className="settlement-day-nav card">
          <button type="button" className="ghost small" onClick={() => setMonthlyIndex(prev => Math.max(0, prev - 1))} disabled={monthlyIndex <= 0}>◀</button>
          <div className="settlement-day-nav-title">
            <strong>{selectedMonthlyBlock.title}</strong>
            <span className="muted">{monthlyIndex + 1} / {monthlyBlocks.length}</span>
          </div>
          <button type="button" className="ghost small" onClick={() => setMonthlyIndex(prev => Math.min(monthlyBlocks.length - 1, prev + 1))} disabled={monthlyIndex >= monthlyBlocks.length - 1}>▶</button>
        </div>
        <div className="settlement-sheet-grid settlement-sheet-grid-single">
          <SettlementSheetCard block={selectedMonthlyBlock} />
        </div>
        <div className="settlement-float-actions">
          <button type="button" onClick={handleRefreshMonthlySummary} disabled={monthlySummaryLoading}>
            {monthlySummaryLoading ? '종합중...' : '월간결산종합'}
          </button>
        </div>
      </>
    ) : <div className="card muted">표시할 월간결산 데이터가 없습니다.</div>
  }

  return (
    <div className="stack-page settlement-page">
      <section className="card settlement-hero">
        <div className="between settlement-hero-head settlement-hero-head-wrap">
          <div className="settlement-hero-main">
            <h2>결산자료</h2>
            <button type="button" className="ghost settlement-status-toggle" onClick={() => setStatusDetailOpen(prev => !prev)}>
              {nextRunLabel}
            </button>
            <div className="muted settlement-status-caption">현재 상태 {statusText}</div>
            {statusDetailOpen && (
              <div className="settlement-status-detail card">
                <div className="muted">일일결산은 하루씩만 표시되며, 결산반영 버튼으로 결산기록에 저장됩니다.</div>
                <div className="muted settlement-sync-summary">{formatSettlementSyncDetail(soomgoMetric, '숨고')}</div>
                <div className="muted settlement-sync-summary">{formatSettlementSyncDetail(ohouMetric, '오늘')}</div>
                <div className="muted settlement-sync-summary">저장된 결산기록 {recordsLoading ? '불러오는 중...' : `${(recordsData.daily_records || []).length}건`}</div>
              </div>
            )}
          </div>
          <div className="settlement-sync-actions settlement-sync-actions-stack">
            <button type="button" className="small" onClick={handleRefreshSync} disabled={syncLoading || syncStatus.is_running}>
              {syncLoading || syncStatus.is_running ? '연동중...' : '데이터 연동'}
            </button>
            <button type="button" className="ghost small" onClick={() => setSettingsOpen(prev => !prev)}>
              {settingsOpen ? '설정 닫기' : '설정'}
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div className="settlement-settings-panel">
            <div className="settlement-settings-tabs">
              <button type="button" className={activeSettingPlatform === '숨고' ? 'small active' : 'small'} onClick={() => handleTogglePlatformSetting('숨고')}>숨고 인증세션</button>
              <button type="button" className={activeSettingPlatform === '오늘' ? 'small active' : 'small'} onClick={() => handleTogglePlatformSetting('오늘')}>오늘 인증세션</button>
            </div>

            {activeSettingPlatform && (
              <div className="settlement-credential-panel">
                <div className="between settlement-config-head">
                  <div>
                    <strong>{activePlatform} 인증세션 설정</strong>
                    <div className="muted settlement-sync-warning">
                      email 소스: <strong>{activeConfig.email_env || '없음'}</strong> · password 소스: <strong>{activeConfig.password_env || '없음'}</strong> · 인증세션: <strong>{activeConfig.auth_state_present ? '저장됨' : '없음'}</strong>
                    </div>
                  </div>
                  <button type="button" className="ghost small" onClick={() => handleOpenGuide(activePlatform)}>설명서</button>
                </div>

                <div className="settlement-credential-grid">
                  <input value={activeEmail} onChange={e => setActiveEmailValue(e.target.value)} placeholder={`${activePlatform} 아이디(이메일)`} />
                  <input type="password" value={activePassword} onChange={e => setActivePasswordValue(e.target.value)} placeholder={`${activePlatform} 비밀번호`} />
                  <button type="button" className="small" onClick={() => handleSaveCredentials(activePlatform)} disabled={credentialLoading}>{credentialLoading ? '저장중...' : `${activePlatform} 계정 저장`}</button>
                </div>

                <div className="muted settlement-sync-warning">
                  {activePlatform === '숨고' ? '숨고는 로그인 이후 바로 새로고침하지 말고 대시보드가 열린 상태에서 인증세션 저장을 진행해 주세요.' : '오늘의집은 파트너센터 이동 페이지가 열린 상태에서 인증세션 저장을 진행해 주세요.'}
                </div>

                <textarea className="settlement-auth-state-textarea" value={activeAuthStateText} onChange={e => setActiveAuthStateValue(e.target.value)} placeholder={`${activePlatform} storageState JSON 전체를 붙여 넣어 주세요.`} />
                <div className="settlement-sync-actions settlement-sync-actions-inline">
                  <button type="button" className="small" onClick={() => handleAuthStateUpload(activePlatform)} disabled={authStateLoading === activePlatform}>{authStateLoading === activePlatform ? '저장중...' : '인증세션 저장'}</button>
                </div>

                {guidePlatform === activePlatform && (
                  <div className="settlement-guide-card">
                    {guideLoading && <div className="muted">설명서를 불러오는 중입니다.</div>}
                    {!guideLoading && guideData && (
                      <>
                        <div className="settlement-guide-section">
                          <strong>{guideData.title}</strong>
                          <div className="muted">{guideData.description}</div>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>저장 경로</strong>
                          <ul>{(guideData.paths || []).map((item, index) => <li key={`path-${index}`}>{item}</li>)}</ul>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>터미널 명령어</strong>
                          <pre>{(guideData.commands || []).join('\n')}</pre>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>진행 절차</strong>
                          <ol>{(guideData.steps || []).map((item, index) => <li key={`step-${index}`}>{item}</li>)}</ol>
                        </div>
                        <div className="settlement-guide-section">
                          <strong>인증세션 저장 버튼을 눌러야 하는 타이밍</strong>
                          <div>{guideData.timing}</div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="settlement-tabs" role="tablist" aria-label="결산자료 카테고리">
          {categories.map(category => (
            <button key={category.id} type="button" className={activeCategory === category.id ? 'ghost settlement-tab active' : 'ghost settlement-tab'} onClick={() => setActiveCategory(category.id)}>{category.label}</button>
          ))}
        </div>
      </section>

      {content}
    </div>
  )
}


function clampMaterialsScale(value) {
  const parsed = Number(value || 100)
  if (!Number.isFinite(parsed)) return 100
  return Math.min(140, Math.max(80, Math.round(parsed)))
}

function materialsStageStatusLabel(status) {
  if (status === 'settled') return '결산완료'
  if (status === 'rejected') return '반려됨'
  return '신청접수'
}

function isMaterialsAdminUser(user) {
  return Number(user?.grade || 6) <= 2
}

const MATERIALS_TABLE_WIDTH_DEFAULTS = {
  sales: [150, 104, 90, 108, 124],
  confirm: [150, 104, 108, 124],
  incoming: [150, 104, 90, 96, 96, 120, 180],
  inventory: [150, 88, 96, 96, 104, 180],
  myRequests: [180, 108, 108, 124, 120],
  requesters: [112, 108, 150, 148, 148, 124],
  settlements: [112, 108, 150, 148, 148, 124],
  history: [108, 150, 148, 148, 124],
}

const MATERIALS_TABLE_EDIT_OPTIONS = [
  { value: 'width', label: '표 가로 사이즈' },
  { value: 'scale', label: '표 가로 배율(%)' },
]

const MATERIALS_TABLE_TARGET_OPTIONS = [
  { value: 'sales', label: '자재구매(1/2)' },
  { value: 'confirm', label: '자재구매(2/2)' },
  { value: 'myRequests', label: '신청현황' },
  { value: 'requesters', label: '신청목록' },
  { value: 'incoming', label: '자재입고' },
  { value: 'settlements', label: '구매결산' },
  { value: 'history', label: '구매목록' },
]

const MATERIALS_TABLE_COLUMN_LABELS = {
  sales: ['구분', '물품가', '현재고', '구매수량', '합계금액'],
  confirm: ['구분', '물품가', '구매수량', '합계금액'],
  myRequests: ['구매물품', '구매가격', '구매수량', '합계가격', '결산처리상태'],
  requesters: ['선택', '호점', '이름', '구매신청일자', '결산처리완료일자', '물품총합계'],
  incoming: ['구분', '물품가', '현재고', '입고수량', '출고수량', '입고 후 수량', '비고'],
  settlements: ['선택', '호점', '이름', '구매신청일자', '결산처리완료일자', '물품총합계'],
  history: ['호점', '이름', '구매신청일자', '결산처리완료일자', '물품총합계'],
}

function getMaterialsDeviceType(isMobile) {
  return isMobile ? 'mobile' : 'desktop'
}

function clampMaterialsColumnWidth(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return 80
  return Math.min(360, Math.max(56, Math.round(num)))
}

function normalizeMaterialsColumnWidths(key, values, isMobile) {
  const defaults = MATERIALS_TABLE_WIDTH_DEFAULTS[key] || []
  const minWidth = isMobile ? 52 : 64
  return defaults.map((fallback, index) => {
    const raw = Array.isArray(values) ? values[index] : undefined
    const base = raw == null || raw === '' ? fallback : raw
    return Math.max(minWidth, clampMaterialsColumnWidth(base))
  })
}

function buildMaterialsGridTemplate(key, widths, isMobile) {
  if (isMobile) {
    const mobileTemplates = {
      sales: 'minmax(0, 1.34fr) minmax(0, 1fr) minmax(0, 0.82fr) minmax(0, 0.92fr) minmax(0, 1fr)',
      confirm: 'minmax(0, 1.44fr) minmax(0, 1fr) minmax(0, 0.92fr) minmax(0, 1fr)',
      incoming: 'minmax(0, 1.18fr) minmax(0, 0.82fr) minmax(0, 0.7fr) minmax(0, 0.76fr) minmax(0, 0.76fr) minmax(0, 0.88fr) minmax(0, 0.92fr)',
      myRequests: 'minmax(0, 1.32fr) minmax(0, 0.9fr) minmax(0, 0.82fr) minmax(0, 0.96fr) minmax(0, 0.98fr)',
      requesters: 'minmax(0, 0.78fr) minmax(0, 0.86fr) minmax(0, 0.98fr) minmax(0, 0.98fr) minmax(0, 0.9fr) minmax(0, 0.96fr)',
      settlements: 'minmax(0, 0.78fr) minmax(0, 0.86fr) minmax(0, 0.98fr) minmax(0, 0.98fr) minmax(0, 0.9fr) minmax(0, 0.96fr)',
      history: 'minmax(0, 0.72fr) minmax(0, 0.9fr) minmax(0, 0.98fr) minmax(0, 0.98fr) minmax(0, 0.9fr)',
    }
    if (mobileTemplates[key]) return mobileTemplates[key]
  }
  const normalized = normalizeMaterialsColumnWidths(key, widths, isMobile)
  return normalized.map(width => `${width}px`).join(' ')
}

function MaterialsPage({ user }) {

  const isMobile = useIsMobile()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [activeTab, setActiveTab] = useState('sales')
  const [salesStep, setSalesStep] = useState(1)
  const [quantities, setQuantities] = useState({})
  const [requestNote, setRequestNote] = useState('')
  const [selectedRequestIds, setSelectedRequestIds] = useState([])
  const [myEditing, setMyEditing] = useState(false)
  const [mySelectedRequestIds, setMySelectedRequestIds] = useState([])
  const [myRequestDraft, setMyRequestDraft] = useState({})
  const [myPulseRequestIds, setMyPulseRequestIds] = useState([])
  const [myPulseQtyKeys, setMyPulseQtyKeys] = useState([])
  const [myPulseSaveCue, setMyPulseSaveCue] = useState(false)
  const [inventoryDraft, setInventoryDraft] = useState({})
  const [incomingDraft, setIncomingDraft] = useState({})
  const [incomingEntryDate, setIncomingEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notice, setNotice] = useState('')
  const [salesError, setSalesError] = useState('')
  const [settlementFilterDate, setSettlementFilterDate] = useState('')
  const [myRequestStartDate, setMyRequestStartDate] = useState('')
  const [myRequestEndDate, setMyRequestEndDate] = useState('')
  const [myRequestStatusFilter, setMyRequestStatusFilter] = useState('all')
  const [tableScaleSettings, setTableScaleSettings] = useState({ sales: 100, confirm: 100, myRequests: 100, incoming: 100, inventory: 100, requesters: 100, history: 100, settlements: 100 })
  const [tableColumnSettings, setTableColumnSettings] = useState(() => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, normalizeMaterialsColumnWidths(key, MATERIALS_TABLE_WIDTH_DEFAULTS[key], isMobile)])))
  const resizeStateRef = useRef(null)

  const accountGuide = '3333-29-1202673 카카오뱅크 (심진수)'

  async function loadOverview(nextTab) {
    setLoading(true)
    try {
      const [result, scaleResult, layoutResult] = await Promise.all([
        api('/api/materials/overview'),
        api('/api/materials/table-scale').catch(() => ({ scales: {} })),
        api(`/api/materials/table-layout?device=${getMaterialsDeviceType(isMobile)}`).catch(() => ({ layouts: {} })),
      ])
      setData(result)
      const savedScale = scaleResult?.scales || {}
      setTableScaleSettings(prev => ({
        sales: clampMaterialsScale(savedScale.sales ?? prev.sales),
        confirm: clampMaterialsScale(savedScale.confirm ?? prev.confirm),
        myRequests: clampMaterialsScale(savedScale.myRequests ?? prev.myRequests),
        incoming: clampMaterialsScale(savedScale.incoming ?? prev.incoming),
        inventory: clampMaterialsScale(savedScale.inventory ?? prev.inventory),
        requesters: clampMaterialsScale(savedScale.requesters ?? prev.requesters),
        history: clampMaterialsScale(savedScale.history ?? prev.history),
        settlements: clampMaterialsScale(savedScale.settlements ?? prev.settlements),
      }))
      const savedLayouts = layoutResult?.layouts || {}
      setTableColumnSettings(prev => Object.fromEntries(Object.keys(MATERIALS_TABLE_WIDTH_DEFAULTS).map(key => [key, normalizeMaterialsColumnWidths(key, savedLayouts[key] ?? prev[key] ?? MATERIALS_TABLE_WIDTH_DEFAULTS[key], isMobile)])))
      setInventoryDraft(Object.fromEntries((result.inventory_rows || []).map(row => [row.product_id, { incoming_qty: row.incoming_qty || 0, note: row.note || '' }])))
      setIncomingDraft(Object.fromEntries((result.products || []).map(row => {
        const inventoryRow = (result.inventory_rows || []).find(item => Number(item.product_id) === Number(row.id)) || {}
        return [row.id, { incoming_qty: 0, outgoing_qty: Number(inventoryRow.manual_outgoing_qty || 0), note: inventoryRow.note || '' }]
      })))
      setIncomingEntryDate(result?.today || new Date().toISOString().slice(0, 10))
      const tabs = buildVisibleTabs(result?.permissions || {})
      setActiveTab(nextTab && tabs.some(item => item.id === nextTab) ? nextTab : (tabs[0]?.id || 'sales'))
    } catch (error) {
      setNotice(error.message || '자재 데이터를 불러오지 못했습니다.')
      setSalesError('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOverview(searchParams.get('tab') || undefined)
  }, [searchParams])

  useEffect(() => {
    const nextDraft = {}
    for (const request of (data?.my_requests || [])) {
      for (const item of (request.items || [])) {
        nextDraft[`${request.id}-${item.product_id}`] = Number(item.quantity || 0)
      }
    }
    setMyRequestDraft(nextDraft)
    setMySelectedRequestIds([])
    setMyEditing(false)
    setMyPulseRequestIds([])
    setMyPulseQtyKeys([])
    setMyPulseSaveCue(false)
  }, [data?.my_requests])

  function buildVisibleTabs(permissions) {
    return [
      permissions.can_view_sales ? { id: 'sales', label: '자재구매' } : null,
      permissions.can_view_my_requests ? { id: 'myRequests', label: '신청현황' } : null,
      permissions.can_view_requesters ? { id: 'requesters', label: '신청목록' } : null,
      permissions.can_manage_incoming ? { id: 'incoming', label: '자재입고' } : null,
      permissions.can_view_settlements ? { id: 'settlements', label: '구매결산' } : null,
      permissions.can_view_history ? { id: 'history', label: '구매목록' } : null,
    ].filter(Boolean)
  }

  const visibleTabs = buildVisibleTabs(data?.permissions || {})
  const productRows = data?.products || []
  const pendingRequests = data?.pending_requests || []
  const settledRequests = data?.settled_requests || []
  const historyRequests = data?.history_requests || []
  const myRequests = data?.my_requests || []
  const inventoryRows = data?.inventory_rows || []
  const isInventoryManager = Boolean(data?.permissions?.can_manage_inventory)
  const settlementDateOptions = Array.from(new Set(settledRequests.map(request => String(request.created_at || '').slice(0, 10)).filter(Boolean))).sort((a, b) => b.localeCompare(a))
  const filteredSettledRequests = settlementFilterDate ? settledRequests.filter(request => String(request.created_at || '').slice(0, 10) === settlementFilterDate) : settledRequests

  const cartRows = productRows
    .map(product => {
      const quantity = Math.max(0, Number(quantities[product.id] || 0))
      return {
        ...product,
        quantity,
        lineTotal: quantity * Number(product.unit_price || 0),
      }
    })
    .filter(product => product.quantity > 0)

  const cartTotal = cartRows.reduce((sum, item) => sum + item.lineTotal, 0)
  const insufficientCartItem = cartRows.find(item => Number(item.quantity || 0) > Number(item.current_stock || 0))

  function getTableScaleStyle(key) {
    const scale = clampMaterialsScale(tableScaleSettings[key])
    return { '--materials-table-scale': String(scale / 100) }
  }

  function getTableGridStyle(key) {
    return { gridTemplateColumns: buildMaterialsGridTemplate(key, tableColumnSettings[key], isMobile) }
  }

  function getRequestSheetGridStyle(key) {
    return { gridTemplateColumns: buildMaterialsGridTemplate(key, tableColumnSettings[key], isMobile) }
  }

  function renderResizableRowCells(labels) {
    return labels.map((label, index) => (
      <div key={`materials-head-${index}`} className="materials-resize-cell">
        <span>{label}</span>
      </div>
    ))
  }

  function updateQuantity(productId, value) {
    const nextValue = String(value).replace(/[^\d]/g, '')
    const nextQuantity = nextValue ? Number(nextValue) : ''
    const product = productRows.find(item => Number(item.id) === Number(productId))
    const stock = Number(product?.current_stock || 0)
    if (nextValue && Number(nextQuantity) > stock) {
      window.alert('현재고보다 구매수량이 많습니다. 구매수량을 줄여주세요')
    }
    setQuantities(prev => ({ ...prev, [productId]: nextQuantity }))
  }

  async function submitPurchaseRequest() {
    if (cartRows.length === 0) {
      setNotice('구매 수량을 입력한 뒤 진행해 주세요.')
      return
    }
    const confirmed = window.confirm('3333-29-1202673 카카오뱅크 (심진수)으로 입금하였습니까?')
    if (!confirmed) return
    setSaving(true)
    try {
      await api('/api/materials/purchase-requests', {
        method: 'POST',
        body: JSON.stringify({
          request_note: requestNote,
          items: cartRows.map(item => ({ product_id: item.id, quantity: item.quantity })),
        }),
      })
      setNotice('자재구매 신청이 완료되었습니다. 신청현황 화면으로 이동합니다.')
      setSalesError('')
      setQuantities({})
      setRequestNote('')
      setSalesStep(1)
      await loadOverview('myRequests')
    } catch (error) {
      setNotice(error.message || '자재구매 신청 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function settleSelectedRequests() {
    if (selectedRequestIds.length === 0) {
      setNotice('입금확인 처리할 구매신청자를 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/api/materials/purchase-requests/settle', {
        method: 'POST',
        body: JSON.stringify({ request_ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setNotice(`${result.settled_requests?.length || 0}건의 결산이 등록되었습니다.`)
      await loadOverview('settlements')
    } catch (error) {
      setNotice(error.message || '결산등록 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function rejectSelectedRequests() {
    if (selectedRequestIds.length === 0) {
      setNotice('결산반려 처리할 구매신청자를 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/api/materials/purchase-requests/reject', {
        method: 'POST',
        body: JSON.stringify({ request_ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setNotice(`${result.rejected_requests?.length || 0}건의 결산반려가 처리되었습니다.`)
      await loadOverview('requesters')
    } catch (error) {
      setNotice(error.message || '결산반려 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function unsettleSelectedRequests() {
    if (selectedRequestIds.length === 0) {
      setNotice('결산취소할 신청건을 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/api/materials/purchase-requests/unsettle', {
        method: 'POST',
        body: JSON.stringify({ request_ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setNotice(`${result.requests?.length || 0}건의 결산이 취소되었습니다.`)
      await loadOverview('settlements')
    } catch (error) {
      setNotice(error.message || '결산취소 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function saveIncomingStock() {
    const rows = Object.entries(incomingDraft)
      .map(([productId, row]) => ({ product_id: Number(productId), incoming_qty: Number(row?.incoming_qty || 0), outgoing_qty: Number(row?.outgoing_qty || 0), note: row?.note || '' }))
      .filter(row => row.product_id > 0 && (row.incoming_qty > 0 || row.outgoing_qty > 0 || String(row.note || '').trim()))
    if (!rows.length) {
      setNotice('입고수량 또는 출고수량을 1개 이상 입력해 주세요.')
      return
    }
    setSaving(true)
    try {
      await api('/api/materials/incoming', {
        method: 'POST',
        body: JSON.stringify({ entry_date: incomingEntryDate, rows }),
      })
      setNotice('자재입출고가 반영되었습니다.')
      await loadOverview('incoming')
    } catch (error) {
      setNotice(error.message || '자재입고 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function saveInventoryDraft() {
    setSaving(true)
    try {
      await api('/api/materials/inventory', {
        method: 'POST',
        body: JSON.stringify({
          rows: Object.entries(inventoryDraft).map(([productId, row]) => ({
            product_id: Number(productId),
            incoming_qty: Number(row?.incoming_qty || 0),
            note: row?.note || '',
          })),
        }),
      })
      setNotice('재고현황이 저장되었습니다.')
      await loadOverview('inventory')
    } catch (error) {
      setNotice(error.message || '재고현황 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function closeInventoryDay() {
    setSaving(true)
    try {
      await api('/api/materials/inventory/close', { method: 'POST' })
      setNotice('당일 자재 결산이 완료되었습니다.')
      await loadOverview('inventory')
    } catch (error) {
      setNotice(error.message || '당일 자재 결산 처리 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function shareSettlements() {
    const tableOnly = (settledRequests || []).map(request => {
      const header = `${String(request.created_at || '').slice(0, 10)} | ${request.requester_name} | ${Number(request.total_amount || 0).toLocaleString('ko-KR')}원`
      const items = (request.items || []).filter(item => Number(item.quantity || 0) > 0).map(item => `- ${item.short_name || item.name}: ${item.quantity}`)
      return [header, ...items].join('\n')
    }).join('\n\n')
    const shareText = `[구매자결산표]\n${tableOnly || '공유할 결산 데이터가 없습니다.'}`
    try {
      if (navigator.share) {
        await navigator.share({ title: '구매자결산표', text: shareText })
      } else {
        await navigator.clipboard.writeText(shareText)
      }
      setNotice('구매자결산표를 공유용 텍스트로 준비했습니다. 카카오톡 직접 방 선택 연동은 현재 웹 환경 제약으로 브라우저 공유/복사 방식으로 처리됩니다.')
    } catch (error) {
      setNotice('공유를 준비하지 못했습니다.')
    }
  }


  function groupedMyRequests() {
    const groups = []
    const sorted = [...myRequests].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    for (const request of sorted) {
      const visibleItems = (request.items || []).filter(item => Number(item.quantity || 0) > 0 || myEditing)
      groups.push({
        ...request,
        visibleItems,
        totalAmount: visibleItems.reduce((sum, item) => sum + (Number(myRequestDraft[`${request.id}-${item.product_id}`] ?? item.quantity ?? 0) * Number(item.unit_price || 0)), 0),
      })
    }
    return groups
  }

  function filterMyRequests(groups) {
    return groups.filter(request => {
      const createdDate = String(request.created_at || '').slice(0, 10)
      if (myRequestStartDate && createdDate < myRequestStartDate) return false
      if (myRequestEndDate && createdDate > myRequestEndDate) return false
      const statusLabel = formatRequestStatusLabel(request.status, (request.visibleItems || [])[0]?.quantity)
      if (myRequestStatusFilter !== 'all') {
        const matches = {
          pending: statusLabel === '신청접수',
          rejected: statusLabel === '반려됨',
          settled: statusLabel === '결산완료',
          canceled: statusLabel === '취소접수',
        }
        if (!matches[myRequestStatusFilter]) return false
      }
      return true
    })
  }

  async function saveMyRequestEdits() {
    if (mySelectedRequestIds.length === 0) {
      setNotice('수정/취소할 신청건을 선택해 주세요.')
      return
    }

    const changeSummaries = []
    const updatePayloads = []

    for (const requestId of mySelectedRequestIds) {
      const request = myRequests.find(item => item.id === requestId)
      if (!request || ['settled','rejected'].includes(String(request.status || ''))) continue
      const rows = []
      let hasChanges = false
      for (const item of (request.items || [])) {
        const originalQty = Math.max(0, Number(item.quantity || 0))
        const nextQty = Math.max(0, Number(myRequestDraft[`${request.id}-${item.product_id}`] ?? item.quantity ?? 0))
        rows.push({
          product_id: Number(item.product_id),
          quantity: nextQty,
        })
        if (nextQty !== originalQty) {
          hasChanges = true
          const itemName = displayMyRequestItemName(item)
          if (nextQty === 0) {
            changeSummaries.push(`- [${String(request.created_at || '').slice(0, 10)}]으로 신청한 ${itemName} ${originalQty}개가 ${nextQty}개로 수정되어 물품을 취소하겠습니까?`)
          } else {
            changeSummaries.push(`- [${String(request.created_at || '').slice(0, 10)}]으로 신청한 ${itemName} ${originalQty}개가 ${nextQty}개로 수정하겠습니까?`)
          }
        }
      }
      if (hasChanges) {
        updatePayloads.push({ requestId, rows })
      }
    }

    if (updatePayloads.length === 0) {
      setNotice('변경된 신청수량이 없습니다.')
      return
    }

    const confirmed = window.confirm(`아래 내용으로 수정/취소를 진행합니다.\n\n${changeSummaries.join('\n')}`)
    if (!confirmed) return

    setSaving(true)
    try {
      for (const payload of updatePayloads) {
        await api('/api/materials/purchase-requests', {
          method: 'PUT',
          body: JSON.stringify({ request_ids: [payload.requestId], rows: payload.rows }),
        })
      }
      setNotice('신청수량 수정/취소가 반영되었습니다.')
      await loadOverview('myRequests')
    } catch (error) {
      setNotice(error.message || '신청현황 수정 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function displayMaterialName(product, compact = false) {
    const base = String(product?.name || '')
    if (!compact) return base
    if (base === '스티커 인쇄물') return '스티커'
    return base
  }

  function displayMyRequestItemName(item) {
    const full = String(item?.name || '').trim()
    if (full) return full
    const short = String(item?.short_name || '').trim()
    if (short === '노비') return '노란 비닐'
    if (short === '흰비') return '흰색 비닐'
    if (short === '침비') return '침대 비닐'
    return short || '물품'
  }

  function formatDateLabel(value) {
    const raw = String(value || '').slice(0, 10)
    if (!raw) return ''
    const parts = raw.split('-')
    if (parts.length !== 3) return raw.replace(/-/g, '.')
    return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`
  }

  function formatFullDateLabel(value) {
    const raw = String(value || '').slice(0, 10)
    return raw || '-'
  }

  function formatSettlementFilterLabel(value) {
    const raw = String(value || '').slice(0, 10)
    if (!raw) return '전체일자'
    return raw
  }

  function parseRequesterMeta(request) {
    const source = String(request?.requester_name || '').trim()
    const match = source.match(/^\s*([^\s]+호점)\s*(.*)$/)
    if (match) {
      return {
        branch: match[1] || '-',
        name: match[2] || match[1] || '-',
      }
    }
    return {
      branch: '-',
      name: source || '-',
    }
  }

  function renderRequestListHeader(mode) {
    const selectable = mode === 'pending' || mode === 'settled'
    const requestGridKey = mode === 'pending' ? 'requesters' : 'settlements'
    return (
      <div className={`materials-request-sheet-row materials-request-sheet-head materials-request-sheet-head-${mode} ${selectable ? 'with-check' : ''}`.trim()} style={getRequestSheetGridStyle(requestGridKey)}>
        {selectable ? <div className="materials-request-sheet-check">선택</div> : null}
        <div>호점</div>
        <div>이름</div>
        <div>구매신청일자</div>
        <div>결산처리완료일자</div>
        <div>물품총합계</div>
      </div>
    )
  }


  function runTemporaryPulse(setter, values, duration = 2200) {
    setter(Array.isArray(values) ? values : [values])
    window.setTimeout(() => setter([]), duration)
  }

  function runSaveButtonPulse(duration = 2200) {
    setMyPulseSaveCue(true)
    window.setTimeout(() => setMyPulseSaveCue(false), duration)
  }

  function startMyRequestEditing() {
    setMyEditing(true)
    const pendingIds = (myRequests || [])
      .filter(request => String(request.status || '') !== 'settled')
      .map(request => request.id)
    if (pendingIds.length) {
      window.setTimeout(() => runTemporaryPulse(setMyPulseRequestIds, pendingIds), 60)
    }
  }

  function handleMyRequestSelection(request, checked) {
    setMySelectedRequestIds(prev => checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))
    if (checked) {
      runTemporaryPulse(setMyPulseRequestIds, [request.id])
      const qtyKeys = (request.items || []).map(item => `${request.id}-${item.product_id}`)
      if (qtyKeys.length) runTemporaryPulse(setMyPulseQtyKeys, qtyKeys)
    }
  }

  function handleMyRequestDraftChange(request, item, nextValue) {
    const normalized = String(nextValue).replace(/[^\d]/g, '')
    const key = `${request.id}-${item.product_id}`
    const parsed = normalized ? Number(normalized) : 0
    setMyRequestDraft(prev => ({ ...prev, [key]: parsed }))
    if (mySelectedRequestIds.includes(request.id)) {
      runTemporaryPulse(setMyPulseQtyKeys, [key])
    }
    const original = Number(item.quantity || 0)
    if (parsed !== original) {
      runSaveButtonPulse()
    }
  }

  function renderSettlementHeaderLabel(product) {
    const label = String(product?.short_name || displayMaterialName(product, true) || '').trim()
    const match = label.match(/^(.*?)(\([^)]*\))$/)
    if (!match) return label
    return (
      <span className="materials-sheet-header-label">
        <span>{match[1].trim()}</span>
        <span>{match[2]}</span>
      </span>
    )
  }

  function moveCaretToEnd(event) {
    const input = event?.target
    if (!input || typeof input.setSelectionRange !== 'function') return
    window.requestAnimationFrame(() => {
      const length = String(input.value || '').length
      try {
        input.setSelectionRange(length, length)
      } catch {
        // noop
      }
    })
  }


  function renderSettlementTable(requests) {
    if (!requests.length) {
      return <div className="card muted">표시할 데이터가 없습니다.</div>
    }
    const activeProducts = productRows.filter(product => Number(product.is_active ?? 1) !== 0)
    return (
      <section className="materials-settlement-sheet">
        <div className="materials-sheet-banner">◆ 일일 본사 자재 출고 / 입금 현황</div>
        <div className="materials-sheet-table-wrap" style={getTableScaleStyle('settlements')}>
          <table className="materials-sheet-table">
            <thead>
              <tr>
                <th rowSpan={2}>구매신청일</th>
                <th rowSpan={2}>이름</th>
                <th colSpan={activeProducts.length}>묶음 개수</th>
                <th rowSpan={2}>입금 총계</th>
              </tr>
              <tr>
                {activeProducts.map(product => (
                  <th key={`settlement-head-${product.id}`}>{renderSettlementHeaderLabel(product)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(request => {
                const qtyMap = Object.fromEntries((request.items || []).map(item => [Number(item.product_id), Number(item.quantity || 0)]))
                return (
                  <tr key={`settlement-row-${request.id}`}>
                    <td>{formatDateLabel(request.created_at)}</td>
                    <td className="materials-sheet-name">{request.requester_name}</td>
                    {activeProducts.map(product => (
                      <td key={`settlement-${request.id}-${product.id}`} className="materials-sheet-number">{qtyMap[Number(product.id)] || ''}</td>
                    ))}
                    <td className="materials-sheet-number materials-sheet-total">{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    )
  }


  function renderTabButton(tab) {
    const active = activeTab === tab.id
    return (
      <button key={tab.id} type="button" className={active ? 'ghost materials-tab active' : 'ghost materials-tab'} onClick={() => {
        setNotice('')
        setSalesError('')
        setSalesStep(1)
        setActiveTab(tab.id)
      }}>
        {tab.label}
      </button>
    )
  }

  function handleMaterialsPurchaseClick() {
    if (insufficientCartItem) {
      const label = insufficientCartItem.short_name || insufficientCartItem.name || '해당'
      setSalesError(`${label} 물품의 재고가 부족하여 구매를 할 수 없습니다.`)
      return
    }
    setSalesError('')
    setSalesStep(2)
  }

  function renderSalesPurchaseButtons(positionClass = '') {
    return (
      <div className={`row gap materials-actions-right materials-sales-submit-row ${positionClass}`.trim()}>
        <button type="button" className="ghost active materials-bottom-button" onClick={handleMaterialsPurchaseClick}>자재구매</button>
      </div>
    )
  }

  function renderMaterialsPanelSettingsButton() {
    return null
  }

  function goToSettlementProgress() {
    if (!(data?.permissions?.can_view_requesters)) {
      setNotice('신청목록 권한이 없어 결산진행 화면으로 이동할 수 없습니다.')
      return
    }
    setSelectedRequestIds([])
    setActiveTab('requesters')
    setNotice('신청목록 화면에서 결산진행을 계속할 수 있습니다.')
  }

  function formatRequesterBranchLabel(value) {
    const raw = String(value || '').trim()
    if (!raw) return '-'
    return raw.endsWith('호점') ? raw.replace(/호점$/, '') : raw
  }

  function formatRequestStatusLabel(status, quantity = null) {
    const normalized = String(status || '').trim()
    if (normalized === 'settled') return '결산완료'
    if (normalized === 'rejected') return '반려됨'
    if (Number(quantity || 0) === 0) return '취소접수'
    return '신청접수'
  }

  function renderRequestItemSummary(items) {
    const visibleItems = (items || []).filter(item => Number(item.quantity || 0) > 0)
    if (!visibleItems.length) {
      return <div className="materials-request-items-empty muted">상세 내역이 없습니다.</div>
    }
    return (
      <div className="materials-request-items-grid">
        {visibleItems.map(item => (
          <div key={`summary-${item.id || item.product_id}`} className="materials-request-item-box">
            <div className="materials-request-item-box-top">{item.short_name || item.name || '물품'} / {Number(item.unit_price || 0).toLocaleString('ko-KR')}원</div>
            <div className="materials-request-item-box-bottom">{Number(item.quantity || 0)}개</div>
          </div>
        ))}
      </div>
    )
  }

  function buildHistoryDetailLines(items, maxLength = isMobile ? 34 : 88) {
    const tokens = (items || []).map(item => `${item.short_name || item.name || '물품'}(${Number(item.unit_price || 0).toLocaleString('ko-KR')}원*${Number(item.quantity || 0)}개)`).filter(Boolean)
    const lines = []
    let current = []
    let currentLength = 0
    tokens.forEach(token => {
      const nextLength = current.length === 0 ? token.length : currentLength + 3 + token.length
      if (current.length > 0 && nextLength > maxLength) {
        lines.push(`${current.join(' | ')} |`)
        current = [token]
        currentLength = token.length
      } else {
        current.push(token)
        currentLength = nextLength
      }
    })
    if (current.length) lines.push(current.join(' | '))
    return lines
  }

  function renderHistoryRows(requests) {
    if (!requests.length) {
      return <div className="card muted">표시할 데이터가 없습니다.</div>
    }
    return (
      <div className="materials-history-group-list">
        <div className="materials-history-group-header">
          <div>호점</div>
          <div>이름</div>
          <div>구매신청일자</div>
          <div>결산처리완료일자</div>
          <div className="materials-history-group-total">물품총합계</div>
        </div>
        {requests.map(request => {
          const meta = parseRequesterMeta(request)
          const detailLines = buildHistoryDetailLines((request.items || []).filter(item => Number(item.quantity || 0) > 0))
          return (
            <section key={`history-group-${request.id}`} className="materials-history-group-card">
              <div className="materials-history-group-meta materials-history-group-row">
                <div>{formatRequesterBranchLabel(meta.branch)}</div>
                <div><strong>{meta.name}</strong></div>
                <div>{formatFullDateLabel(request.created_at)}</div>
                <div>{formatFullDateLabel(request.settled_at)}</div>
                <div className="materials-history-group-total">{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</div>
              </div>
              <div className="materials-history-group-details">
                {detailLines.length ? detailLines.map((line, index) => <div key={`history-detail-${request.id}-${index}`} className="materials-history-group-detail-line">{line}</div>) : <div className="materials-history-group-detail-line muted">상세 내역이 없습니다.</div>}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  function renderSalesContent() {
    if (salesStep === 2) {
      return (
        <section className="card materials-panel">
          <div className="materials-summary-head materials-summary-head-inline">
            <div><h3>자재구매(2/2)</h3>
            <div className="muted">신청 내역과 입금 계좌를 확인한 뒤 확인 버튼을 눌러 주세요.</div></div>
          </div>
          <div className="materials-account-box materials-account-box-centered">
            <strong>자재 입금 계좌</strong>
            <div>{accountGuide}</div>
          </div>
          <div className="materials-request-history-table materials-confirm-history-table" style={getTableScaleStyle('confirm')}>
            <div className="materials-request-history-row materials-request-history-head materials-confirm-history-row" style={getTableGridStyle('confirm')}>
              {renderResizableRowCells(['구분', '물품가', '구매수량', '합계금액'], 'confirm')}
            </div>
            {cartRows.map(item => (
              <div key={`confirm-${item.id}`} className="materials-request-history-row materials-confirm-history-row" style={getTableGridStyle('confirm')}>
                <div>{displayMaterialName(item, isMobile)}</div>
                <div>{Number(item.unit_price || 0).toLocaleString('ko-KR')}원</div>
                <div>{item.quantity}</div>
                <div>{item.lineTotal.toLocaleString('ko-KR')}원</div>
              </div>
            ))}
            <div className="materials-request-history-row materials-request-history-head materials-row-total materials-confirm-history-row materials-confirm-history-total" style={getTableGridStyle('confirm')}>
              <div>합계</div>
              <div />
              <div>{cartRows.reduce((sum, item) => sum + item.quantity, 0)}</div>
              <div>{cartTotal.toLocaleString('ko-KR')}원</div>
            </div>
          </div>
          <label className="stack-form">
            <span>메모</span>
            <textarea rows={3} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="추가 요청사항을 입력해 주세요." />
          </label>
          <div className="row gap materials-actions-split materials-actions-bottom">
            <button type="button" className="ghost materials-bottom-button materials-bottom-button-left" onClick={() => setSalesStep(1)}>이전</button>
            <button type="button" className="ghost active materials-bottom-button materials-bottom-button-right" disabled={saving} onClick={submitPurchaseRequest}>입금 후 확인</button>
          </div>
        </section>
      )
    }
    return (
      <section className="card materials-panel">
        <div className="materials-summary-head materials-summary-head-sales-top">
          <div>
            <h3>자재구매(1/2)</h3>
            <div className="muted">구매 수량을 입력한 뒤 자재구매 버튼을 눌러 주세요. 현재고보다 많은 수량은 신청할 수 없습니다.</div>
          </div>
        </div>
        <div className="materials-table materials-table-sales" style={getTableScaleStyle('sales')}>
          <div className="materials-row materials-row-head materials-row-head-sales materials-row-sales" style={getTableGridStyle('sales')}>
            {renderResizableRowCells(['구분', '물품가', '현재고', '구매수량', '합계금액'], 'sales')}
          </div>
          {productRows.map(product => {
            const quantity = Number(quantities[product.id] || 0)
            const stock = Number(product.current_stock || 0)
            const hasStockError = quantity > stock
            return (
              <div key={product.id} className={`materials-row materials-row-sales ${hasStockError ? 'materials-row-invalid' : ''}`.trim()} style={getTableGridStyle('sales')}>
                <div>{displayMaterialName(product, isMobile)}</div>
                <div>{Number(product.unit_price || 0).toLocaleString('ko-KR')}원</div>
                <div>{stock}</div>
                <div>
                  <input
                    className={`materials-qty-input ${hasStockError ? 'materials-qty-input-invalid' : ''}`.trim()}
                    inputMode="numeric"
                    value={quantities[product.id] ?? ''}
                    onFocus={moveCaretToEnd}
                    onClick={moveCaretToEnd}
                    onKeyUp={moveCaretToEnd}
                    onChange={(event) => {
                      updateQuantity(product.id, event.target.value)
                      moveCaretToEnd(event)
                    }}
                    placeholder="0"
                  />
                </div>
                <div>{(quantity * Number(product.unit_price || 0)).toLocaleString('ko-KR')}원</div>
              </div>
            )
          })}
          <div className="materials-row materials-row-total materials-row-sales" style={getTableGridStyle('sales')}>
            <div>합계</div>
            <div />
            <div>{cartRows.reduce((sum, item) => sum + Number(item.current_stock || 0), 0)}</div>
            <div>{cartRows.reduce((sum, item) => sum + item.quantity, 0)}</div>
            <div>{cartTotal.toLocaleString('ko-KR')}원</div>
          </div>
        </div>
        {renderSalesPurchaseButtons('materials-actions-bottom')}
        {salesError ? <div className="notice-text materials-inline-notice">{salesError}</div> : null}
      </section>
    )
  }

  function renderRequestRows(requests, mode) {
    if (!requests.length) {
      return <div className="card muted">표시할 데이터가 없습니다.</div>
    }
    if (mode === 'history') {
      return renderHistoryRows(requests)
    }
    const requestGridKey = mode === 'pending' ? 'requesters' : 'settlements'
    const selectable = mode === 'pending' || mode === 'settled'
    return (
      <div className={`materials-request-sheet materials-request-sheet-${mode}`}>
        {renderRequestListHeader(mode)}
        {requests.map(request => {
          const checked = selectedRequestIds.includes(request.id)
          const meta = parseRequesterMeta(request)
          const visibleItems = (request.items || []).filter(item => Number(item.quantity || 0) > 0)
          const isRejected = String(request.status || '') === 'rejected'
          return (
            <section key={`request-${mode}-${request.id}`} className={`${mode === 'settled' ? '' : 'card '}materials-request-card materials-request-sheet-card materials-request-sheet-card-${mode} ${selectable ? 'with-check' : ''}`.trim()}>
              <div className={`materials-request-sheet-row materials-request-sheet-row-${mode} ${selectable ? 'with-check' : ''}`.trim()} style={getRequestSheetGridStyle(requestGridKey)}>
                {selectable ? (
                  <label className="materials-checkbox materials-request-checkbox-cell">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedRequestIds(prev => event.target.checked ? [...new Set([...prev, request.id])] : prev.filter(id => id !== request.id))
                      }}
                    />
                    <span>{mode === 'pending' ? '입금확인' : '결산취소'}</span>
                  </label>
                ) : null}
                <div>{formatRequesterBranchLabel(meta.branch)}</div>
                <div className="materials-request-name-cell">
                  <strong>{meta.name}</strong>
                </div>
                <div>{formatFullDateLabel(request.created_at)}</div>
                <div>{isRejected ? <button type="button" className="ghost small" onClick={() => window.alert('관리자가 반려시킨 신청건입니다. 재신청 해주세요.')}>반려됨</button> : formatFullDateLabel(request.settled_at)}</div>
                <div className="materials-request-total-cell">{Number(request.total_amount || 0).toLocaleString('ko-KR')}원</div>
              </div>
              <div className="materials-request-items materials-request-items-sheet materials-request-items-sheet-grid">
                {renderRequestItemSummary(visibleItems)}
              </div>
              {request.request_note ? <div className="muted">메모: {request.request_note}</div> : null}
            </section>
          )
        })}
      </div>
    )
  }


  function renderMyRequests() {
    const grouped = filterMyRequests(groupedMyRequests())
    return (
      <section className="card materials-panel materials-panel-compact-head">
        <div className="materials-summary-head-inline"><div><h3>신청현황</h3></div></div>
        <div className="materials-myrequest-head">
          <div className="notice-text materials-myrequest-guide">자재구매 신청한 내역입니다.<br />신청수량 변경 및 신청취소 희망시 '수정/취소' 버튼을 누르고, 각 품목별 '구매수량'을 수정하여 저장해주세요.<br />- 절차 : '수정/취소' 버튼 클릭 → '신청날짜' 선택 → '구매수량' 수정 → '저장' 버튼 클릭<br />* 구매수량이 0일 경우 취소 접수가 되며, 1개 이상의 수량일 경우 수량 수정 반영됩니다.<br /><span className="materials-myrequest-warning">※ 주의 : 자재비용 입금 후 본사 결산처리까지 완료된 경우는 '수정/취소'가 불가능합니다.</span></div>
          <button type="button" className={`ghost active materials-bottom-button ${myPulseSaveCue ? 'materials-soft-pulse' : ''}`.trim()} disabled={saving} onClick={() => myEditing ? saveMyRequestEdits() : startMyRequestEditing()}>{myEditing ? '저장' : '수정/취소'}</button>
        </div>
        <div className="materials-myrequest-filter-bar">
          <label className="materials-date-inline-label materials-date-inline-label-left">
            <span>시작기간</span>
            <input type="date" value={myRequestStartDate} onChange={(e) => setMyRequestStartDate(e.target.value)} />
          </label>
          <span className="materials-filter-range-separator">~</span>
          <label className="materials-date-inline-label materials-date-inline-label-left">
            <span>종료기간</span>
            <input type="date" value={myRequestEndDate} onChange={(e) => setMyRequestEndDate(e.target.value)} />
          </label>
          <label className="materials-date-inline-label materials-date-inline-label-left materials-date-inline-label-compact">
            <span>상태</span>
            <select className="materials-filter-select-compact" value={myRequestStatusFilter} onChange={(e) => setMyRequestStatusFilter(e.target.value)}>
              <option value="all">전체</option>
              <option value="pending">신청접수</option>
              <option value="rejected">반려됨</option>
              <option value="settled">결산완료</option>
              <option value="canceled">취소접수</option>
            </select>
          </label>
          <button type="button" className="ghost materials-bottom-button" onClick={() => { setMyRequestStartDate(''); setMyRequestEndDate(''); setMyRequestStatusFilter('all') }}>필터초기화</button>
        </div>
        <div className="materials-request-history-list">
          {grouped.length === 0 ? <div className="card muted">신청 내역이 없습니다.</div> : grouped.map(request => {
            const isSettled = String(request.status || '') === 'settled'
            const isRejected = String(request.status || '') === 'rejected'
            const isLocked = isSettled || isRejected
            const isSelected = mySelectedRequestIds.includes(request.id)
            const shouldPulseDate = myPulseRequestIds.includes(request.id)
            return (
              <section key={`my-request-${request.id}`} className="card materials-request-history-card">
                <div className="materials-request-history-date-row">
                  <div className={`materials-request-history-date-left ${(shouldPulseDate || (isSelected && myEditing && !isLocked)) ? 'materials-soft-pulse' : ''}`.trim()}>
                    {myEditing && !isLocked ? (
                      <label className="materials-checkbox">
                        <input type="checkbox" checked={isSelected} onChange={(event) => handleMyRequestSelection(request, event.target.checked)} />
                      </label>
                    ) : null}
                    <strong>{String(request.created_at || '').slice(0, 10)}</strong>
                  </div>
                  <span className={`materials-status-pill ${isSettled ? 'settled' : (isRejected ? 'rejected materials-status-pill-clickable' : 'pending')}`.trim()} onClick={() => { if (isRejected) window.alert('관리자가 반려시킨 신청건입니다. 재신청 해주세요.') }}>{formatRequestStatusLabel(request.status, request.visibleItems?.[0]?.quantity)}</span>
                </div>
                <div className="materials-request-history-table">
                  <div className="materials-request-history-row materials-request-history-head" style={getTableGridStyle('myRequests')}>
                    {renderResizableRowCells(['구매물품', '구매가격', '구매수량', '합계가격', '결산처리상태'], 'myRequests')}
                  </div>
                  {(request.visibleItems || []).map(item => {
                    const key = `${request.id}-${item.product_id}`
                    const qty = Math.max(0, Number(myRequestDraft[key] ?? item.quantity ?? 0))
                    const lineTotal = qty * Number(item.unit_price || 0)
                    const shouldPulseQty = myPulseQtyKeys.includes(key) || (isSelected && myEditing && !isSettled)
                    return (
                      <div key={key} className="materials-request-history-row" style={getTableGridStyle('myRequests')}>
                        <div>{displayMyRequestItemName(item)}</div>
                        <div>{Number(item.unit_price || 0).toLocaleString('ko-KR')}원</div>
                        <div>{myEditing && isSelected && !isLocked ? <input className={`materials-qty-input materials-history-qty-input ${shouldPulseQty ? 'materials-soft-pulse' : ''}`.trim()} inputMode="numeric" value={qty} onChange={(e) => handleMyRequestDraftChange(request, item, e.target.value)} /> : qty}</div>
                        <div>{lineTotal.toLocaleString('ko-KR')}원</div>
                        <div className={`${qty === 0 && !isSettled ? 'materials-cancel-text' : ''} ${String(request.status || '') === 'rejected' ? 'materials-rejected-help-trigger' : ''}`.trim()} onClick={() => { if (String(request.status || '') === 'rejected') window.alert('관리자가 반려시킨 신청건입니다. 재신청 해주세요.') }}>{formatRequestStatusLabel(request.status, qty)}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="materials-request-history-total">총계가격 {request.totalAmount.toLocaleString('ko-KR')}원</div>
              </section>
            )
          })}
        </div>
        <div className="materials-myrequest-actions-bottom">
          <button type="button" className={`ghost active materials-bottom-button ${myPulseSaveCue ? 'materials-soft-pulse' : ''}`.trim()} disabled={saving} onClick={() => myEditing ? saveMyRequestEdits() : startMyRequestEditing()}>{myEditing ? '저장' : '수정/취소'}</button>
        </div>
      </section>
    )
  }

  function renderIncomingContent() {
    return (
      <section className="card materials-panel materials-panel-compact-head">
        <div className="materials-summary-head-inline materials-summary-head-inventory">
          <div><h3>자재입고</h3></div>
          
        </div>
        <div className="materials-table materials-table-sales materials-table-incoming" style={getTableScaleStyle('incoming')}>
          <div className="materials-row materials-row-head materials-row-confirm-header materials-row-sales" style={getTableGridStyle('incoming')}>
            {renderResizableRowCells(['구분', '물품가', '현재고', '입고수량', '출고수량', '입고 후 수량', '비고'], 'incoming')}
          </div>
          {productRows.map(product => {
            const inventoryRow = inventoryRows.find(row => Number(row.product_id) === Number(product.id)) || {}
            const draftRow = incomingDraft[product.id] || {}
            const draftIncoming = Number(draftRow.incoming_qty || 0)
            const draftOutgoing = Number(draftRow.outgoing_qty || 0)
            const note = draftRow.note || ''
            const afterQty = Math.max(0, Number(product.current_stock || 0) + draftIncoming - draftOutgoing)
            return (
              <div key={`incoming-${product.id}`} className="materials-row materials-row-confirm materials-row-sales" style={getTableGridStyle('incoming')}>
                <div>{displayMaterialName(product, isMobile)}</div>
                <div>{Number(product.unit_price || 0).toLocaleString('ko-KR')}원</div>
                <div>{Number(product.current_stock || 0)}</div>
                <div>
                  <input
                    className="materials-qty-input"
                    inputMode="numeric"
                    value={draftIncoming || ''}
                    onChange={(event) => {
                      const raw = String(event.target.value).replace(/[^\d]/g, '')
                      setIncomingDraft(prev => ({ ...prev, [product.id]: { ...prev[product.id], incoming_qty: raw ? Number(raw) : 0, outgoing_qty: Number(prev[product.id]?.outgoing_qty || 0), note: prev[product.id]?.note || '' } }))
                    }}
                  />
                </div>
                <div>
                  <input
                    className="materials-qty-input"
                    inputMode="numeric"
                    value={draftOutgoing || ''}
                    onChange={(event) => {
                      const raw = String(event.target.value).replace(/[^\d]/g, '')
                      setIncomingDraft(prev => ({ ...prev, [product.id]: { ...prev[product.id], incoming_qty: Number(prev[product.id]?.incoming_qty || 0), outgoing_qty: raw ? Number(raw) : 0, note: prev[product.id]?.note || '' } }))
                    }}
                  />
                </div>
                <div>{afterQty}</div>
                <div>
                  <input
                    className="materials-note-input"
                    value={note}
                    onChange={(event) => setIncomingDraft(prev => ({ ...prev, [product.id]: { ...prev[product.id], incoming_qty: Number(prev[product.id]?.incoming_qty || 0), outgoing_qty: Number(prev[product.id]?.outgoing_qty || 0), note: event.target.value } }))}
                    placeholder="비고"
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="row gap wrap materials-actions-right materials-actions-bottom">
          <label className="materials-date-inline-label">
            <span>입고입력일</span>
            <input type="date" value={incomingEntryDate} onChange={(e) => setIncomingEntryDate(e.target.value)} />
          </label>
          <button type="button" className="ghost active materials-bottom-button materials-register-button" disabled={saving} onClick={saveIncomingStock}>입고입력</button>
        </div>
      </section>
    )
  }

  function renderInventoryContent() {
    return null
  }




  if (loading) return <div className="card">자재 데이터를 불러오는 중입니다...</div>

  return (
    <div className="stack-page materials-page">
      <section className="card materials-hero">
        <div className="materials-tabs" role="tablist" aria-label="자재 카테고리">
          {visibleTabs.map(renderTabButton)}
        </div>
        {notice ? <div className="card notice-text">{notice}</div> : null}
      </section>

      {activeTab === 'sales' && renderSalesContent()}
      {activeTab === 'myRequests' && renderMyRequests()}
      {activeTab === 'incoming' && renderIncomingContent()}
      {activeTab === 'requesters' && (
        <section className="card materials-panel materials-panel-compact-head">
          <div className="materials-summary-head-inline"><div><h3>신청목록</h3></div></div>
          <div style={getTableScaleStyle('requesters')}>{renderRequestRows(pendingRequests, 'pending')}</div>
          <div className="row gap wrap materials-actions-right materials-actions-bottom materials-requesters-actions-bottom">
            <button type="button" className="ghost materials-bottom-button" disabled={saving} onClick={rejectSelectedRequests}>결산반려</button>
            <button type="button" className="ghost active materials-bottom-button materials-register-button" disabled={saving} onClick={settleSelectedRequests}>결산등록</button>
          </div>
        </section>
      )}
      {activeTab === 'settlements' && (
        <section className="card materials-panel materials-panel-compact-head materials-settlement-panel">
          <div className="materials-summary-head-inline"><div><h3>구매결산</h3></div></div>
          <div className="row gap wrap materials-settlement-filter-row">
            <label className="materials-date-inline-label materials-date-inline-label-left materials-date-inline-label-compact">
              <span>구매신청일자</span>
              <select className="materials-filter-select-compact" value={settlementFilterDate} onChange={(e) => setSettlementFilterDate(e.target.value)}>
                <option value="">전체일자</option>
                {settlementDateOptions.map(date => <option key={`settlement-date-${date}`} value={date}>{formatSettlementFilterLabel(date)}</option>)}
              </select>
            </label>
            <button type="button" className="ghost materials-bottom-button" onClick={() => setSettlementFilterDate('')}>필터초기화</button>
          </div>
          {renderRequestRows(filteredSettledRequests, 'settled')}
          <div className="row gap wrap materials-actions-right materials-actions-bottom materials-settlement-actions-bottom">
            <button type="button" className="ghost materials-bottom-button" onClick={shareSettlements}>카톡공유</button>
            <button type="button" className="ghost materials-bottom-button" disabled={saving} onClick={unsettleSelectedRequests}>결산취소</button>
            <button type="button" className="ghost materials-bottom-button materials-register-button" disabled={saving} onClick={goToSettlementProgress}>결산진행</button>
          </div>
        </section>
      )}
      {activeTab === 'history' && (
        <section className="card materials-panel materials-panel-compact-head">
          <div className="materials-summary-head-inline"><div><h3>구매목록</h3></div></div>
          {renderRequestRows(historyRequests, 'history')}
        </section>
      )}
    </div>
  )
}


function SoomgoReviewSettingsModal({ open, onClose, state, setState, onSave, onManualMatch }) {
  if (!open) return null
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card soomgo-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="between">
          <h3>숨은 설정</h3>
          <button type="button" className="ghost small" onClick={onClose}>닫기</button>
        </div>
        <div className="stack compact-gap">
          <label className="stack compact-gap"><span>숨고 로그인 이메일</span><input value={state.settings.soomgo_email || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, soomgo_email: e.target.value } }))} /></label>
          <label className="stack compact-gap"><span>숨고 로그인 비밀번호</span><input type="password" value={state.settings.soomgo_password || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, soomgo_password: e.target.value } }))} /></label>
          <label className="stack compact-gap"><span>outer HTML 코드</span><textarea className="soomgo-hidden-textarea" value={state.settings.outer_html || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, outer_html: e.target.value } }))} /></label>
          <div className="soomgo-hidden-grid">
            <label className="stack compact-gap"><span>익명 이름</span><input value={state.settings.anonymous_name || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, anonymous_name: e.target.value } }))} /></label>
            <label className="stack compact-gap"><span>리뷰 내용 일부</span><textarea className="soomgo-hidden-textarea short" value={state.settings.review_input || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, review_input: e.target.value } }))} /></label>
          </div>
          <div className="row gap wrap">
            <button type="button" onClick={onManualMatch}>수기 작성자 찾기</button>
            <button type="button" className="ghost" onClick={onSave}>설정 저장</button>
          </div>
          <div className="soomgo-result-grid">
            <div className="card"><strong>리뷰작성자 후보</strong><pre>{state.results.candidate_names || '-'}</pre></div>
            <div className="card"><strong>유사도</strong><pre>{state.results.candidate_scores || '-'}</pre></div>
            <div className="card"><strong>고객리뷰</strong><textarea className="soomgo-hidden-textarea short" value={state.results.customer_review || ''} onChange={e => setState(prev => ({ ...prev, results: { ...prev.results, customer_review: e.target.value } }))} /></div>
            <div className="card"><strong>이사현장 / 특이사항</strong><textarea className="soomgo-hidden-textarea short" value={`${state.results.field_status || ''}
${state.results.special_note || ''}`.trim()} readOnly /></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SoomgoReviewSlotCard({ slot, index, onChange, onGenerate }) {
  return (
    <section className="card soomgo-slot-card">
      <div className="soomgo-slot-head">
        <strong>슬롯 {index + 1}</strong>
        <button type="button" className="small" onClick={() => onGenerate(index)}>리뷰초안생성</button>
      </div>
      <div className="soomgo-slot-name-row">
        <label className="stack compact-gap"><span>가명</span><input value={slot.masked_name || ''} onChange={e => onChange(index, 'masked_name', e.target.value)} /></label>
        <label className="stack compact-gap"><span>실명</span><input value={slot.real_name || ''} onChange={e => onChange(index, 'real_name', e.target.value)} /></label>
      </div>
      <div className="soomgo-slot-grid">
        <label className="stack compact-gap"><span>리뷰 내용</span><textarea value={slot.review || ''} onChange={e => onChange(index, 'review', e.target.value)} /></label>
        <label className="stack compact-gap"><span>AI 결과</span><textarea value={slot.reply || ''} onChange={e => onChange(index, 'reply', e.target.value)} /></label>
        <label className="stack compact-gap"><span>이사현장상황</span><textarea value={slot.situation || ''} onChange={e => onChange(index, 'situation', e.target.value)} /></label>
        <label className="stack compact-gap"><span>현장특이사항</span><textarea value={slot.specifics || ''} onChange={e => onChange(index, 'specifics', e.target.value)} /></label>
      </div>
    </section>
  )
}

function SoomgoReviewFinderPage() {
  const [state, setState] = useState({ settings: { prompt: '', outer_html: '', anonymous_name: '', review_input: '', soomgo_email: '', soomgo_password: '', auto_scan_on_open: true }, memos: { soomgo: '', today: '', site: '' }, results: { candidate_names: '', candidate_scores: '', ai_result: '', customer_review: '', field_status: '', special_note: '' }, slots: Array.from({ length: 10 }, (_, index) => ({ index, masked_name: '', real_name: '', review: '', reply: '', situation: '', specifics: '' })), last_scan: { ok: false, message: '', updated_at: '', found_count: 0 } })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)

  async function loadState() {
    const data = await api('/api/soomgo-review/state')
    setState(prev => ({ ...prev, ...data }))
    return data
  }

  useEffect(() => {
    let ignore = false
    loadState().then(data => {
      if (!ignore && data?.settings?.auto_scan_on_open) {
        handleAutoScan()
      }
    }).catch(() => {})
    return () => { ignore = true }
  }, [])

  async function persistState(nextState = state) {
    setSaving(true)
    try {
      const saved = await api('/api/soomgo-review/state', {
        method: 'POST',
        body: JSON.stringify({ settings: nextState.settings, memos: nextState.memos, results: nextState.results, slots: nextState.slots }),
      })
      setState(prev => ({ ...prev, ...saved }))
    } catch (error) {
      window.alert(error.message || '숨고리뷰찾기 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleAutoScan() {
    setLoading(true)
    try {
      const data = await api('/api/soomgo-review/scan-auto', { method: 'POST' })
      setState(prev => ({ ...prev, ...data }))
    } catch (error) {
      window.alert(error.message || '자동 숨고리뷰 찾기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManualScan() {
    setLoading(true)
    try {
      const data = await api('/api/soomgo-review/scan-manual', { method: 'POST' })
      setState(prev => ({ ...prev, ...data }))
    } catch (error) {
      window.alert(error.message || '수동 숨고리뷰 찾기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManualMatch() {
    setLoading(true)
    try {
      const data = await api('/api/soomgo-review/manual-match', {
        method: 'POST',
        body: JSON.stringify({ outer_html: state.settings.outer_html || '', anonymous_name: state.settings.anonymous_name || '', review_input: state.settings.review_input || '' }),
      })
      setState(prev => ({ ...prev, ...(data.state || {}), results: { ...prev.results, candidate_names: data.candidate_names || '', candidate_scores: data.candidate_scores || '' } }))
    } catch (error) {
      window.alert(error.message || '수기 작성자 찾기 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateSlot(index) {
    setLoading(true)
    try {
      const slot = state.slots[index] || {}
      const data = await api('/api/soomgo-review/generate-draft', {
        method: 'POST',
        body: JSON.stringify({ slot_index: index, review: slot.review || '', situation: slot.situation || '', specifics: slot.specifics || '' }),
      })
      setState(prev => ({ ...prev, ...(data.state || {}), results: { ...prev.results, ai_result: data.draft || '' } }))
    } catch (error) {
      window.alert(error.message || '리뷰초안 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function updateSlot(index, key, value) {
    setState(prev => ({
      ...prev,
      slots: prev.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [key]: value } : slot),
    }))
  }

  return (
    <div className="stack-page soomgo-review-page">
      <section className="card soomgo-review-hero">
        <div className="between wrap gap">
          <div>
            <h2>숨고리뷰찾기</h2>
            <div className="muted">첨부한 리뷰 찾기 스크립트의 핵심 흐름을 앱 화면에 옮긴 페이지입니다.</div>
            <div className="muted">최근 검사 {state.last_scan?.updated_at ? String(state.last_scan.updated_at).replace('T', ' ').slice(0, 16) : '-'} · {state.last_scan?.message || '대기중'}</div>
          </div>
          <div className="row gap wrap">
            <button type="button" onClick={handleAutoScan} disabled={loading}>{loading ? '진행중...' : '자동 숨고리뷰 찾기'}</button>
            <button type="button" className="ghost" onClick={handleManualScan} disabled={loading}>{loading ? '진행중...' : '수동 리뷰 찾기'}</button>
            <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>숨은 설정</button>
            <button type="button" className="ghost" onClick={() => persistState()} disabled={saving}>{saving ? '저장중...' : '저장'}</button>
          </div>
        </div>
      </section>

      <section className="soomgo-review-layout">
        <div className="soomgo-review-main stack-page">
          <section className="card soomgo-prompt-card">
            <div className="between"><h3>리뷰초안 프롬프트</h3><span className="muted">리뷰초안생성 기준</span></div>
            <textarea value={state.settings.prompt || ''} onChange={e => setState(prev => ({ ...prev, settings: { ...prev.settings, prompt: e.target.value } }))} className="soomgo-prompt-textarea" />
          </section>

          <section className="card soomgo-ai-result-card">
            <div className="between"><h3>AI 리뷰 답변 결과</h3><button type="button" className="ghost small" onClick={() => navigator.clipboard?.writeText(state.results.ai_result || '')}>복사</button></div>
            <textarea value={state.results.ai_result || ''} onChange={e => setState(prev => ({ ...prev, results: { ...prev.results, ai_result: e.target.value } }))} className="soomgo-prompt-textarea short" />
          </section>

          <section className="soomgo-slot-list-grid">
            {state.slots.slice(0, 5).map((slot, index) => <SoomgoReviewSlotCard key={`slot-top-${index}`} slot={slot} index={index} onChange={updateSlot} onGenerate={handleGenerateSlot} />)}
          </section>

          <section className="card soomgo-extra-slots-card">
            <div className="between"><h3>추가 슬롯 5개</h3><button type="button" className="ghost small" onClick={() => setExtraOpen(v => !v)}>{extraOpen ? '접기' : '펼치기'}</button></div>
            {extraOpen && <div className="soomgo-slot-list-grid">{state.slots.slice(5, 10).map((slot, index) => <SoomgoReviewSlotCard key={`slot-extra-${index + 5}`} slot={slot} index={index + 5} onChange={updateSlot} onGenerate={handleGenerateSlot} />)}</div>}
          </section>
        </div>

        <aside className="soomgo-review-side stack-page">
          <section className="card"><h3>상시 메모장 1. 숨고</h3><textarea className="soomgo-side-memo" value={state.memos.soomgo || ''} onChange={e => setState(prev => ({ ...prev, memos: { ...prev.memos, soomgo: e.target.value } }))} /></section>
          <section className="card"><h3>상시 메모장 2. 오늘</h3><textarea className="soomgo-side-memo" value={state.memos.today || ''} onChange={e => setState(prev => ({ ...prev, memos: { ...prev.memos, today: e.target.value } }))} /></section>
          <section className="card"><h3>상시 메모장 3. 공홈</h3><textarea className="soomgo-side-memo" value={state.memos.site || ''} onChange={e => setState(prev => ({ ...prev, memos: { ...prev.memos, site: e.target.value } }))} /></section>
        </aside>
      </section>

      <SoomgoReviewSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        setState={setState}
        onSave={() => persistState()}
        onManualMatch={handleManualMatch}
      />
    </div>
  )
}


function AppAssignmentNotificationWatcher({ user }) {
  const [toastItems, setToastItems] = useState([])

  useEffect(() => {
    if (!user?.id) return undefined
    let stopped = false

    async function tick() {
      try {
        const [prefsRaw, notifications] = await Promise.all([api('/api/preferences'), api('/api/notifications')])
        if (stopped) return
        const settings = normalizeAlertSettings(prefsRaw || {})
        const scheduleItems = (notifications || []).filter(item => !item?.is_read && isScheduleAlertNotification(item))
        const nextAppState = loadAlertShownMap(user.id, 'app')
        const nextMobileState = loadAlertShownMap(user.id, 'mobile')
        const repeatMs = Math.max(1, Number(settings.repeatHours || 1)) * 60 * 60 * 1000
        const quietNow = isNowInQuietHours(settings)
        const newToasts = []

        for (const item of scheduleItems) {
          const category = scheduleNotificationCategory(item.type)
          const now = Date.now()
          if (settings.appEnabled && settings.appTypes?.[category] && !quietNow) {
            const lastShown = Number(nextAppState[item.id] || 0)
            if (!lastShown || now - lastShown >= repeatMs) {
              newToasts.push({ id: `app-${item.id}-${now}`, title: item.title, body: item.body })
              nextAppState[item.id] = now
            }
          }
          if (settings.mobileEnabled && settings.mobileTypes?.[category] && !quietNow && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const lastShown = Number(nextMobileState[item.id] || 0)
            if (!lastShown || now - lastShown >= repeatMs) {
              try {
                const n = new Notification(item.title, { body: item.body })
                window.setTimeout(() => n.close(), 10000)
              } catch (_) {}
              nextMobileState[item.id] = now
            }
          }
        }

        if (newToasts.length) {
          setToastItems(prev => [...prev, ...newToasts].slice(-6))
        }
        saveAlertShownMap(user.id, 'app', nextAppState)
        saveAlertShownMap(user.id, 'mobile', nextMobileState)
      } catch (_) {}
    }

    tick()
    const timer = window.setInterval(tick, 60000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [user?.id])

  useEffect(() => {
    if (!toastItems.length) return undefined
    const timer = window.setTimeout(() => {
      setToastItems(prev => prev.slice(1))
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [toastItems])

  if (!toastItems.length) return null
  return createPortal(
    <div className="app-alert-toast-stack">
      {toastItems.map(item => (
        <div key={item.id} className="app-alert-toast-card">
          <strong>{item.title}</strong>
          <div style={{ whiteSpace: 'pre-line' }}>{item.body}</div>
        </div>
      ))}
    </div>,
    document.body,
  )
}

function App() {
  const [user, setUser] = useState(getStoredUser())
  const navigate = useNavigate()

  useEffect(() => {
    if (!user || !getStoredUser()) return
    api('/api/me').then((res) => {
      if (res?.user) {
        setUser(res.user)
        sessionStorage.setItem('icj_user', JSON.stringify(res.user))
        if (getRememberedLogin()) {
          localStorage.setItem('icj_user', JSON.stringify(res.user))
        }
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    function handleAuthExpired() {
      clearSession({ preserveRemember: true })
      setUser(null)
      navigate('/login', { replace: true, state: { notice: '로그인 세션이 만료되어 다시 로그인해 주세요.' } })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [navigate])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch (_) {}
    clearSession()
    setUser(null)
    navigate('/login')
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage onLogin={setUser} />} />
        <Route path="/guest-quote" element={<QuoteFormsPage user={null} guestMode />} />
        <Route path="/signup" element={<SignupPage onLogin={setUser} />} />
        <Route path="/find-account" element={<FindAccountPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <LocationSharingAgent user={user} />
      <AppAssignmentNotificationWatcher user={user} />
      <Layout user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/chats/direct/:targetUserId" element={<ChatRoomPage roomType="direct" />} />
        <Route path="/chats/group/:roomId" element={<ChatRoomPage roomType="group" />} />
        <Route path="/calendar" element={<Navigate to="/schedule" replace />} />
        <Route path="/schedule" element={<CalendarPage />} />
        <Route path="/schedule/new" element={<ScheduleFormPage mode="create" />} />
        <Route path="/schedule/handless" element={<HandlessDaysPage />} />
        <Route path="/work-schedule" element={<WorkSchedulePage />} />
        <Route path="/schedule/:eventId" element={<ScheduleDetailPage />} />
        <Route path="/schedule/:eventId/edit" element={<ScheduleFormPage mode="edit" />} />
        <Route path="/profile" element={<ProfilePage onUserUpdate={(u) => { setUser(u); localStorage.setItem('icj_user', JSON.stringify(u)) }} />} />
        <Route path="/meetups" element={<MeetupsPage />} />
        <Route path="/boards" element={<BoardsPage />} />
        <Route path="/notifications" element={<NotificationsPage user={user} />} />
        <Route path="/points" element={<PointsPage />} />
        <Route path="/warehouse" element={<PlaceholderFeaturePage title="창고현황" description="창고현황 기능은 다음 업데이트에서 연결할 예정입니다." />} />
        <Route path="/materials" element={<MaterialsPage user={user} />} />
        <Route path="/quotes" element={<QuoteFormsPage user={user} />} />
        <Route path="/quote-forms" element={<Navigate to="/quotes" replace />} />
        <Route path="/business-card-maker" element={<PlaceholderFeaturePage title="명함만들기" description="명함만들기 기능은 다음 업데이트에서 연결할 예정입니다." />} />
        <Route path="/storage-status" element={<PlaceholderFeaturePage title="짐보관현황" description="짐보관현황 기능은 다음 업데이트에서 연결할 예정입니다." />} />
        <Route path="/settlements" element={<SettlementPage />} />
        <Route path="/soomgo-review-finder" element={<SoomgoReviewFinderPage />} />
        <Route path="/settings" element={<SettingsPage onLogout={logout} />} />
        <Route path="/workday-history" element={<WorkdayHistoryPage />} />
        <Route path="/admin-mode" element={canAccessAdminMode(user) ? <AdminModePage /> : <AccessDeniedRedirect />} />
        <Route path="/menu-permissions" element={isAdministrator(user) ? <MenuPermissionPage /> : <AccessDeniedRedirect message="관리자만 접근할 수 있습니다." />} />
        <Route path="/reports" element={canAccessAdminMode(user) ? <ReportsPage /> : <AccessDeniedRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
          </Layout>
    </>
  )
}

export default App
