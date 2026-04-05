import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, clearSession, getApiBase, getStoredUser, getToken, uploadFile } from './api'
import { NAV_ITEMS, MENU_ITEMS, INDUSTRY_OPTIONS } from './constants'
import AuthPage from './pages/AuthPage'
import AdminPage from './pages/AdminPage'
import { TextField, Metric } from './components/ui'
import TurnstileWidget from './components/TurnstileWidget'
import { useTurnstileConfig } from './hooks/useTurnstileConfig'
import MonetizationAdBanner from './components/MonetizationAdBanner'

function pageTitle(pathname) {
  if (pathname.startsWith('/chats')) return '채팅'
  if (pathname.startsWith('/friends')) return '친구'
  if (pathname.startsWith('/community')) return '대화'
  if (pathname.startsWith('/questions')) return '질문'
  if (pathname.startsWith('/profile')) return '프로필'
  if (pathname.startsWith('/mvp')) return 'MVP센터'
  if (pathname.startsWith('/vault')) return '저장함'
  if (pathname.startsWith('/workspace')) return '종합관리'
  if (pathname.startsWith('/introductions-manager')) return '자기소개서관리'
  if (pathname.startsWith('/share-links-manager')) return '링크공유관리'
  if (pathname.startsWith('/more')) return '더보기'
  if (pathname.startsWith('/rewards')) return '포인트'
  if (pathname.startsWith('/schedule')) return '일정'
  if (pathname.startsWith('/admin')) return '관리자'
  if (pathname.startsWith('/music')) return '음악듣기'
  if (pathname.startsWith('/business-card')) return '명함만들기'
  if (pathname.startsWith('/url-shortener')) return 'URL단축'
  if (pathname.startsWith('/qr-generator')) return 'QR생성'
  if (pathname.startsWith('/p/')) return '공개 프로필'
  return '홈'
}

function useAuth() {
  const [user, setUser] = useState(getStoredUser())
  return { user, setUser }
}

function openDirectMessageRoom(navigate, otherUserId) {
  const targetId = Number(otherUserId || 0)
  if (!targetId) return
  navigate(`/chats?user=${targetId}`)
}

async function claimProfileShareReward(profileId) {
  const targetId = Number(profileId || 0)
  if (!targetId) return null
  try {
    return await api('/api/rewards/profile-share', { method: 'POST', body: JSON.stringify({ profile_id: targetId }) })
  } catch (error) {
    console.warn('profile share reward failed', error)
    return null
  }
}


const ACTIVE_PROFILE_STORAGE_KEY = 'historyprofile_active_profile_id'

function getStoredActiveProfileId() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) || ''
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function setStoredActiveProfileId(value) {
  if (typeof window === 'undefined') return
  const next = Number(value)
  if (Number.isFinite(next) && next > 0) {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, String(next))
  } else {
    window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY)
  }
}

function normalizeBirthYearInput(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '')
  if (!digits) return ''
  if (digits.length >= 4) return digits.slice(0, 4)
  const age = Number(digits)
  if (!Number.isFinite(age) || age <= 0 || age > 120) return ''
  const now = new Date()
  return String(now.getFullYear() - age).slice(0, 4)
}

const CHAT_LAST_VIEWED_AT_KEY = 'historyprofile_chat_last_viewed_at'

function getStoredChatLastViewedAt() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(CHAT_LAST_VIEWED_AT_KEY) || ''
}

function setStoredChatLastViewedAt(value) {
  if (typeof window === 'undefined') return
  if (value) {
    window.localStorage.setItem(CHAT_LAST_VIEWED_AT_KEY, value)
  } else {
    window.localStorage.removeItem(CHAT_LAST_VIEWED_AT_KEY)
  }
}

const CHAT_CATEGORY_STORAGE_KEY = 'historyprofile_chat_categories'
const CHAT_ROOM_CATEGORY_STORAGE_KEY = 'historyprofile_chat_room_categories'

function getStoredChatCategories() {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(window.localStorage.getItem(CHAT_CATEGORY_STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return Array.from(new Set(raw.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 20)
  } catch {
    return []
  }
}

function setStoredChatCategories(items) {
  if (typeof window === 'undefined') return
  const next = Array.from(new Set((Array.isArray(items) ? items : []).map(item => String(item || '').trim()).filter(Boolean))).slice(0, 20)
  window.localStorage.setItem(CHAT_CATEGORY_STORAGE_KEY, JSON.stringify(next))
}

function getStoredChatRoomCategories() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = JSON.parse(window.localStorage.getItem(CHAT_ROOM_CATEGORY_STORAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function setStoredChatRoomCategories(value) {
  if (typeof window === 'undefined') return
  const next = value && typeof value === 'object' ? value : {}
  window.localStorage.setItem(CHAT_ROOM_CATEGORY_STORAGE_KEY, JSON.stringify(next))
}

function formatChatListTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth() && now.getDate() === date.getDate()
  if (sameDay) return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function getRoomPreviewLines(room) {
  const preview = String(room?.last_message || '대화를 시작해보세요.').trim() || '대화를 시작해보세요.'
  const lines = preview.split(/\n+/).map(item => item.trim()).filter(Boolean)
  if (lines.length >= 2) return [lines[0], lines[1]]
  if (lines.length === 1) return [lines[0], lines[0]]
  return ['대화를 시작해보세요.', '대화를 시작해보세요.']
}

function IconGlyph({ name, label }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.9', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const icons = {
    menu: <svg {...common}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></svg>,
    search: <svg {...common}><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></svg>,
    bell: <svg {...common}><path d="M6 17h12" /><path d="M8 17V11a4 4 0 1 1 8 0v6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>,
    settings: <svg {...common}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1 1a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0l-1-1a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1-1a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v.2a1 1 0 0 0 .7.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.7Z" /></svg>,
    home: <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 10v10h14V10" /></svg>,
    chats: <svg {...common}><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4.5 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" /></svg>,
    friends: <svg {...common}><path d="M16.5 19a4.5 4.5 0 0 0-9 0" /><circle cx="12" cy="9" r="3" /><path d="M20 18a3.5 3.5 0 0 0-3-3.4" /><path d="M17 6.5a2.5 2.5 0 1 1 0 5" /></svg>,
    questions: <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.3 9.2a2.7 2.7 0 1 1 4.2 2.2c-.9.7-1.5 1.2-1.5 2.4" /><path d="M12 17h.01" /></svg>,
    conversation: <svg {...common}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H13l-4.5 4V16H6.5A2.5 2.5 0 0 1 4 13.5z" /><path d="M8 9h8" /><path d="M8 12h5" /></svg>,
    profile: <svg {...common}><path d="M18 20a6 6 0 0 0-12 0" /><circle cx="12" cy="9" r="4" /></svg>,
    calendar: <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4" /><path d="M16 3v4" /><path d="M4 10h16" /></svg>,
    link: <svg {...common}><path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 1 0-7.1-7.1L11 5" /><path d="M14 11a5 5 0 0 0-7.1 0L4.8 13.1a5 5 0 1 0 7.1 7.1L13 19" /></svg>,
    qr: <svg {...common}><path d="M4 4h6v6H4z" /><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><path d="M14 14h2" /><path d="M18 14h2v2" /><path d="M14 18h2v2" /><path d="M18 18h2" /></svg>,
    admin: <svg {...common}><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" /><path d="M9.5 12.5 11 14l3.5-4" /></svg>,
    logout: <svg {...common}><path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5" /><path d="M15 12H4" /></svg>,
    userAdd: <svg {...common}><path d="M15 19a5 5 0 0 0-10 0" /><circle cx="10" cy="8" r="3" /><path d="M19 8v6" /><path d="M16 11h6" /></svg>,
    compose: <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>,
    back: <svg {...common}><path d="M15 18l-6-6 6-6" /><path d="M9 12h10" /></svg>,
    trash: <svg {...common}><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></svg>,
    more: <svg {...common}><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></svg>,
    chatMini: <svg {...common}><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4.5 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" /></svg>,
    folder: <svg {...common}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" /></svg>,
    briefcase: <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>,
    businessCard: <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="8" cy="12" r="2" /><path d="M13 10h5" /><path d="M13 13h5" /><path d="M6 16c.8-1.2 1.8-1.8 3-1.8s2.2.6 3 1.8" /></svg>,
    document: <svg {...common}><path d="M8 3h6l5 5v13a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v5h5" /><path d="M10 13h6" /><path d="M10 17h6" /><path d="M10 9h2" /></svg>,
    star: <svg {...common}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" /></svg>,
    coin: <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" /><path d="M12 7.5v9" /></svg>,
    music: <svg {...common}><path d="M9 18V7l10-2v11" /><circle cx="7" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>,
  }
  return <span className="icon-symbol" aria-label={label}>{icons[name] || icons.home}</span>
}

function VerifiedBadge({ profile, compact = false }) {
  if (!profile?.brand_verified) return null
  return <span className={`verified-badge${compact ? ' compact' : ''}`.trim()} title={profile?.verification_badge_text || '브랜드/기업 인증'}>{profile?.verification_badge_text || '브랜드/기업 인증'}</span>
}

function BackIconButton({ onClick, className = '', label = '뒤로가기' }) {
  return (
    <button type="button" className={`icon-button ghost back-icon-button ${className}`.trim()} onClick={onClick} aria-label={label} title={label}>
      <IconGlyph name="back" label={label} />
    </button>
  )
}

const NAV_META = {
  '/': { icon: 'home' },
  '/chats': { icon: 'chats' },
  '/friends': { icon: 'friends' },
  '/community': { icon: 'conversation' },
  '/questions': { icon: 'questions' },
  '/schedule': { icon: 'calendar' },
  '/more': { icon: 'more' },
}

function formatBadgeCount(value, max = 99) {
  const count = Number(value) || 0
  if (count <= 0) return ''
  if (count >= max) return `${max}+`
  return String(count)
}

function useNotificationCounts(user, pathname) {
  const [counts, setCounts] = useState({ notifications: 0, chats: 0, questions: 0, friends: 0 })

  useEffect(() => {
    let cancelled = false

    async function loadCounts() {
      if (!user) return
      try {
        const [profileData, requestData] = await Promise.all([api('/api/profiles'), api('/api/friends/requests')])
        const profiles = profileData.items || []
        const questionUnread = profiles.reduce((sum, profile) => sum + ((profile.questions || []).filter(item => item.status === 'pending').length), 0)
        const friendUnread = (requestData.incoming || []).length

        let chatUnread = 0
        const lastViewedAt = getStoredChatLastViewedAt()
        const lastViewedTime = lastViewedAt ? new Date(lastViewedAt).getTime() : 0

        if (pathname.startsWith('/chats')) {
          setStoredChatLastViewedAt(new Date().toISOString())
        } else {
          const chatData = await api('/api/chats')
          const rooms = chatData.items || []
          const ownUserId = Number(user?.id || 0)
          const unreadCounts = await Promise.all(
            rooms.map(async room => {
              const updatedAt = room.updated_at ? new Date(room.updated_at).getTime() : 0
              if (!updatedAt || updatedAt <= lastViewedTime) return 0
              const messageData = await api(`/api/chats/direct/${room.user_id}/messages`)
              const items = messageData.items || []
              return items.filter(item => Number(item.sender_id) !== ownUserId && new Date(item.created_at).getTime() > lastViewedTime).length
            }),
          )
          chatUnread = unreadCounts.reduce((sum, value) => sum + value, 0)
        }

        if (!cancelled) {
          setCounts({
            chats: Math.min(chatUnread, 100),
            questions: questionUnread,
            friends: friendUnread,
            notifications: chatUnread + questionUnread + friendUnread,
          })
        }
      } catch {
        if (!cancelled) return
      }
    }

    loadCounts()
    const timer = window.setInterval(loadCounts, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [user, pathname])

  return counts
}

function useDismissLayer(isOpen, onClose) {
  const ref = useRef(null)
  useEffect(() => {
    if (!isOpen) return undefined
    function isInsideFloatingPopup(target) {
      return target instanceof Element && Boolean(target.closest('.floating-popup'))
    }
    function handlePointerDown(event) {
      if (!ref.current) return
      if (ref.current.contains(event.target) || isInsideFloatingPopup(event.target)) {
        return
      }
      onClose?.()
    }
    function handleEscape(event) {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])
  return ref
}


function AnchoredPopup({ anchorRef, open, align = 'left', placement = 'auto', viewportEdge = '', className = '', children }) {
  const [style, setStyle] = useState({})

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current || typeof window === 'undefined') return undefined

    function updatePosition() {
      const rect = anchorRef.current.getBoundingClientRect()
      const gap = 10
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const popupWidth = Math.min(360, viewportWidth - 16)
      const preferSide = viewportWidth > 820
      const sideLeft = align === 'right' ? rect.left - popupWidth - gap : rect.right + gap
      const fallbackLeft = align === 'right' ? rect.right - popupWidth : rect.left
      const baseLeft = preferSide ? sideLeft : fallbackLeft
      const sideTop = rect.top
      const fallbackTop = rect.bottom + gap
      const forcedBelowTop = rect.bottom + gap
      const baseTop = placement === 'bottom' ? forcedBelowTop : (preferSide ? sideTop : fallbackTop)
      const nextLeft = viewportEdge === 'left'
        ? 8
        : viewportEdge === 'right'
          ? Math.max(8, viewportWidth - popupWidth - 8)
          : Math.max(8, Math.min(baseLeft, viewportWidth - popupWidth - 8))
      const nextTop = Math.max(8, Math.min(baseTop, viewportHeight - 80))
      setStyle({
        position: 'fixed',
        top: `${Math.round(nextTop)}px`,
        left: `${Math.round(nextLeft)}px`,
        width: `${Math.round(popupWidth)}px`,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [align, anchorRef, open, placement, viewportEdge])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className={`floating-popup anchored-popup ${className}`.trim()} style={style}>{children}</div>,
    document.body,
  )
}

function App() {
  const auth = useAuth()
  return (
    <Routes>
      <Route path="/p/:slug" element={<PublicProfilePage />} />
      <Route path="/*" element={auth.user ? <AppShell {...auth} /> : <AuthPage onLogin={auth.setUser} />} />
    </Routes>
  )
}


function AppShell({ user, setUser }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [activePopup, setActivePopup] = useState('')
  const [searchWord, setSearchWord] = useState('')
  const [searchResult, setSearchResult] = useState({ people: [], profiles: [], careers: [], categories: [] })
  const popupRef = useDismissLayer(Boolean(activePopup), () => setActivePopup(''))
  const menuButtonRef = useRef(null)
  const searchButtonRef = useRef(null)
  const alertButtonRef = useRef(null)
  const settingsButtonRef = useRef(null)
  const profileSwitchButtonRef = useRef(null)
  const counts = useNotificationCounts(user, location.pathname)
  const [multiProfiles, setMultiProfiles] = useState([])
  const [multiProfileManagerOpen, setMultiProfileManagerOpen] = useState(false)
  const [multiProfileManagerBusy, setMultiProfileManagerBusy] = useState(false)
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)
  const activeProfileId = getStoredActiveProfileId()
  const activeProfile = useMemo(() => multiProfiles.find(item => Number(item.id) === Number(activeProfileId)) || multiProfiles[0] || null, [multiProfiles, activeProfileId])
  const activeProfileLabel = activeProfile?.display_name || activeProfile?.title || user?.nickname || user?.name || '내 계정'
  const activeProfileDescription = activeProfile?.headline || activeProfile?.bio || user?.email || ''

  useEffect(() => {
    setActivePopup('')
    setMoreSheetOpen(false)
  }, [location.pathname])

  useEffect(() => {
    loadMultiProfiles().catch(() => null)
  }, [user?.id])

  async function runSearch() {
    if (!searchWord.trim()) return
    const data = await api(`/api/search?q=${encodeURIComponent(searchWord)}`)
    setSearchResult(data)
  }

  function togglePopup(name) {
    setActivePopup(current => current === name ? '' : name)
  }

  function closePopupAndNavigate(path) {
    setActivePopup('')
    setMoreSheetOpen(false)
    navigate(path)
  }

  function openMoreSheet() {
    setActivePopup('')
    setMoreSheetOpen(true)
  }

  function logout() {
    clearSession()
    setUser(null)
    setActivePopup('')
    navigate('/', { replace: true })
  }

  async function loadMultiProfiles() {
    const data = await api('/api/profiles')
    setMultiProfiles(data.items || [])
  }

  async function openMultiProfileManager() {
    setActivePopup('')
    await loadMultiProfiles()
    setMultiProfileManagerOpen(true)
  }

  async function handleMultiProfileSwitch(profileId) {
    const nextId = Number(profileId) || null
    setStoredActiveProfileId(nextId)
    setActivePopup('')
    setMultiProfileManagerOpen(false)
    window.dispatchEvent(new CustomEvent('historyprofile:active-profile-change', { detail: { profileId: nextId } }))
    navigate('/questions', { replace: location.pathname === '/questions' })
  }

  async function handleCreateMultiProfile() {
    if (multiProfiles.length >= 3) return
    const displayName = window.prompt('새 멀티 프로필 이름 또는 닉네임을 입력하세요.', '')
    if (!displayName || !displayName.trim()) return
    const description = window.prompt('멀티프로필 설명을 입력하세요.', '') || ''
    setMultiProfileManagerBusy(true)
    try {
      const payload = {
        ...emptyProfile(),
        title: displayName.trim(),
        display_name: displayName.trim(),
        headline: description.trim(),
        bio: description.trim(),
      }
      const data = await api('/api/profiles', { method: 'POST', body: JSON.stringify(payload) })
      const createdId = data?.item?.id || null
      await loadMultiProfiles()
      if (createdId) {
        setStoredActiveProfileId(createdId)
        window.dispatchEvent(new CustomEvent('historyprofile:active-profile-change', { detail: { profileId: createdId } }))
      }
      setActivePopup('')
    } catch (err) {
      window.alert(err.message)
    } finally {
      setMultiProfileManagerBusy(false)
    }
  }

  function handleOpenProfileLimitGuide() {
    window.alert('멀티프로필 3개 이상 등록 시 5,000원 비용 결제가 필요합니다. 결제 연동 후 추가 개방이 가능합니다.')
  }

  const isAdmin = user?.role === 'admin' || Number(user?.grade || 99) <= 1
  const totalNotificationLabel = formatBadgeCount(counts.notifications, 999)

  return (
    <div className="app-shell">
      <header className="topbar-fixed">
        <div className="topbar" ref={popupRef}>
          <div className="topbar-left popup-anchor-group topbar-left-profile-group">
            <button ref={menuButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button" onClick={() => togglePopup('menu')} aria-expanded={activePopup === 'menu'} aria-label="메뉴">
              <IconGlyph name="menu" label="메뉴" />
            </button>
            <AnchoredPopup anchorRef={menuButtonRef} open={activePopup === 'menu'} className="menu-popup dropdown-popup">
              <div className="dropdown-title">메뉴</div>
              <div className="dropdown-list">
                {MENU_ITEMS.map(item => (
                  <Link key={item.path} className="dropdown-item dropdown-item-with-icon" to={item.path}><IconGlyph name={item.icon || 'home'} label={item.label} /><span>{item.label}</span></Link>
                ))}
              </div>
            </AnchoredPopup>
            <button ref={profileSwitchButtonRef} type="button" className="ghost topbar-profile-switch topbar-text-trigger" onClick={async () => { await loadMultiProfiles(); togglePopup('profiles') }} aria-expanded={activePopup === 'profiles'} aria-label="계정 전환">
              <span className="topbar-profile-name">계정전환</span>
            </button>
            <AnchoredPopup anchorRef={profileSwitchButtonRef} open={activePopup === 'profiles'} placement="bottom" viewportEdge="left" className="dropdown-popup profile-switch-popup stack">
              <div className="dropdown-list profile-shortcuts-list">
                <button type="button" className="dropdown-item ghost dropdown-item-with-icon active-profile-dropdown-item" onClick={() => closePopupAndNavigate('/profile')}>
                  <IconGlyph name="profile" label="내 프로필" />
                  <span>내 프로필</span>
                </button>
              </div>
              <div className="dropdown-list profile-switch-list">
                {multiProfiles.length ? multiProfiles.map(item => {
                  const selected = Number(item.id) === Number(activeProfile?.id)
                  const label = item.display_name || item.title || '멀티 프로필'
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={selected ? 'dropdown-item ghost dropdown-item-between active-profile-dropdown-item' : 'dropdown-item ghost dropdown-item-between'}
                      onClick={() => selected ? closePopupAndNavigate('/profile') : handleMultiProfileSwitch(item.id)}
                    >
                      <span className={selected ? 'current-profile-entry' : ''}>
                        {selected ? <><span className="current-profile-icon"><IconGlyph name="profile" label="내 프로필 관리" /></span><span>{label}(내 프로필 관리)</span></> : label}
                      </span>
                      <span className="muted small-text">{selected ? '현재 계정' : '전환'}</span>
                    </button>
                  )
                }) : <button type="button" className="dropdown-item ghost dropdown-item-between active-profile-dropdown-item" onClick={() => closePopupAndNavigate('/profile')}><span className="current-profile-entry"><span className="current-profile-icon"><IconGlyph name="profile" label="내 프로필 관리" /></span><span>{activeProfileLabel}(내 프로필 관리)</span></span><span className="muted small-text">현재 계정</span></button>}
              </div>
              <div className="dropdown-list profile-switch-actions">
                <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={openMultiProfileManager}><IconGlyph name="settings" label="멀티 프로필 관리" /><span>멀티 프로필 관리</span></button>
                <button type="button" className={multiProfiles.length >= 3 ? 'dropdown-item ghost dropdown-item-with-icon locked-button' : 'dropdown-item ghost dropdown-item-with-icon'} onClick={handleCreateMultiProfile} disabled={multiProfiles.length >= 3 || multiProfileManagerBusy}><IconGlyph name="userAdd" label="멀티 프로필 추가" /><span>멀티 프로필 추가</span></button>
                {multiProfiles.length >= 3 ? <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={handleOpenProfileLimitGuide}><IconGlyph name="compose" label="추가개방" /><span>추가개방</span></button> : null}
                <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={logout}><IconGlyph name="logout" label="로그아웃" /><span>로그아웃</span></button>
              </div>
            </AnchoredPopup>
          </div>
          <div className="topbar-right popup-anchor-group popup-anchor-group-right">
            <button ref={searchButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button" onClick={() => setActivePopup('search')} aria-expanded={activePopup === 'search'} aria-label="검색">
              <IconGlyph name="search" label="검색" />
            </button>
            <button ref={alertButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button badge-button" onClick={() => togglePopup('alerts')} aria-expanded={activePopup === 'alerts'} aria-label="알림">
              <IconGlyph name="bell" label="알림" />
              {totalNotificationLabel ? <span className="count-badge topbar-badge">{totalNotificationLabel}</span> : null}
            </button>
            <AnchoredPopup anchorRef={alertButtonRef} open={activePopup === 'alerts'} align="right" viewportEdge="right" className="settings-popup dropdown-popup stack settings-panel">
              <div className="dropdown-title">알림</div>
              <div className="dropdown-list">
                <button type="button" className="dropdown-item ghost dropdown-item-between" onClick={() => closePopupAndNavigate('/chats')}>
                  <span>채팅</span>
                  {formatBadgeCount(counts.chats, 100) ? <span className="count-badge dropdown-inline-badge">{formatBadgeCount(counts.chats, 100)}</span> : <span className="muted small-text">0</span>}
                </button>
                <button type="button" className="dropdown-item ghost dropdown-item-between" onClick={() => closePopupAndNavigate('/friends')}>
                  <span>친구요청</span>
                  {formatBadgeCount(counts.friends, 999) ? <span className="count-badge dropdown-inline-badge">{formatBadgeCount(counts.friends, 999)}</span> : <span className="muted small-text">0</span>}
                </button>
                <button type="button" className="dropdown-item ghost dropdown-item-between" onClick={() => closePopupAndNavigate('/questions')}>
                  <span>질문</span>
                  {formatBadgeCount(counts.questions, 999) ? <span className="count-badge dropdown-inline-badge">{formatBadgeCount(counts.questions, 999)}</span> : <span className="muted small-text">0</span>}
                </button>
              </div>
            </AnchoredPopup>
            <button ref={settingsButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button" onClick={() => togglePopup('settings')} aria-expanded={activePopup === 'settings'} aria-label="설정">
              <IconGlyph name="settings" label="설정" />
            </button>
            <AnchoredPopup anchorRef={settingsButtonRef} open={activePopup === 'settings'} align="right" viewportEdge="right" className="settings-popup dropdown-popup stack settings-panel">
              <div className="dropdown-title">설정</div>
              <div className="dropdown-list">
                {isAdmin ? <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={() => closePopupAndNavigate('/admin')}><IconGlyph name="admin" label="관리자" /><span>관리자 페이지</span></button> : null}
              </div>
            </AnchoredPopup>
          </div>
          <div className="page-heading"><span className="page-heading-mark">P</span><span>{pageTitle(location.pathname)}</span></div>
        </div>
      </header>
      <MultiProfileManagerModal
        open={multiProfileManagerOpen}
        profiles={multiProfiles}
        busy={multiProfileManagerBusy}
        onClose={() => !multiProfileManagerBusy && setMultiProfileManagerOpen(false)}
        onSelect={handleMultiProfileSwitch}
        onAdd={handleCreateMultiProfile}
        onUnlock={handleOpenProfileLimitGuide}
      />
      {activePopup && activePopup !== 'search' ? <button type="button" className="popup-backdrop" aria-label="팝업 닫기" onClick={() => setActivePopup('')} /> : null}
      {activePopup === 'search' ? (
        <SearchScreen
          searchWord={searchWord}
          setSearchWord={setSearchWord}
          onSearch={runSearch}
          onClose={() => setActivePopup('')}
          result={searchResult}
        />
      ) : null}

      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage user={user} />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/questions" element={<QuestionsPage />} />
          <Route path="/community" element={<CommunityPage user={user} />} />
          <Route path="/community/new" element={<CommunityComposerPage />} />
          <Route path="/questions/:profileId" element={<QuestionProfilePage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/mvp" element={<MvpSuccessPage />} />
          <Route path="/more" element={<MorePage onOpenSheet={openMoreSheet} isAdmin={isAdmin} />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/vault" element={<StorageVaultPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/introductions-manager" element={<IntroductionsManagerPage />} />
          <Route path="/share-links-manager" element={<ShareLinksManagerPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/business-card" element={<BusinessCardBuilderPage />} />
          <Route path="/url-shortener" element={<UrlShortenerPage />} />
          <Route path="/qr-generator" element={<QrGeneratorPage />} />
          <Route path="/music" element={isAdmin ? <MusicPage /> : <Navigate to="/" replace />} />
          <Route path="/video-watch" element={<MusicPage pageTitle="영상시청" introLabel="영상시청" adminOnly={false} />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <MoreBottomSheet open={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} onSelect={closePopupAndNavigate} isAdmin={isAdmin} />

      <nav className="bottom-nav">
        {NAV_ITEMS.map(item => {
          const badgeValue = item.path === '/chats'
            ? formatBadgeCount(counts.chats, 100)
            : item.path === '/questions'
              ? formatBadgeCount(counts.questions, 999)
              : item.path === '/friends'
                ? formatBadgeCount(counts.friends, 999)
                : ''
          const className = (location.pathname === item.path || (item.path === '/more' && moreSheetOpen)) ? 'nav-item active nav-item-with-badge' : 'nav-item nav-item-with-badge'
          if (item.path === '/more') {
            return (
              <button key={item.path} type="button" className={className} onClick={openMoreSheet}>
                <span className="nav-item-label"><span className="nav-item-icon"><IconGlyph name={NAV_META[item.path]?.icon || 'home'} label={item.label} /></span><span className="nav-item-text">{item.label}</span></span>
              </button>
            )
          }
          return (
            <Link key={item.path} to={item.path} className={className}>
              <span className="nav-item-label"><span className="nav-item-icon"><IconGlyph name={NAV_META[item.path]?.icon || 'home'} label={item.label} /></span><span className="nav-item-text">{item.label}</span></span>
              {badgeValue ? <span className="count-badge nav-badge">{badgeValue}</span> : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}


function MorePage({ onOpenSheet, isAdmin }) {
  const businessConfig = readLocalItems(LOCAL_STORAGE_KEYS.businessConfig, buildDefaultBusinessConfig())
  const templateStore = readLocalItems(LOCAL_STORAGE_KEYS.templateStore, buildDefaultTemplateStoreItems())
  const hiringPosts = readLocalItems(LOCAL_STORAGE_KEYS.hiringPosts, buildDefaultHiringPosts())
  const gigPosts = readLocalItems(LOCAL_STORAGE_KEYS.gigPosts, buildDefaultGigPosts())
  const brandPages = readLocalItems(LOCAL_STORAGE_KEYS.brandPages, buildDefaultBrandPages())
  const analyticsEvents = readLocalItems(LOCAL_STORAGE_KEYS.analyticsEvents, [])
  const adSlots = readLocalItems(LOCAL_STORAGE_KEYS.adSlots, buildDefaultAdSlots())
  const storeSales = templateStore.reduce((sum, item) => sum + Number(item.sales || 0), 0)
  const analyticsSummary = summarizeAnalyticsEvents(analyticsEvents)

  const shortcuts = [
    { path: '/mvp', label: 'MVP 성장센터', desc: '실제 성공용 MVP 순서대로 프로필 · QR · 링크 · 소개서 · 저장소를 정리', icon: 'star' },
    { path: '/workspace', label: '수익화 운영센터', desc: '구독 · 템플릿 · SEO · AI · 채용 · 거래 운영', icon: 'briefcase' },
    { path: '/business-card', label: '명함/폼상점', desc: '유료 폼 적용, 판매 폼 확인, QR/링크 전환 최적화', icon: 'businessCard' },
    { path: '/profile', label: '프로필/공개URL', desc: '공개 노출용 프로필과 SEO 슬러그 관리', icon: 'profile' },
    { path: '/share-links-manager', label: '링크공유관리', desc: '영업/채용/소개 링크를 공개 페이지와 연결', icon: 'link' },
    { path: '/introductions-manager', label: 'AI 자기소개서', desc: 'AI 초안 생성 결과를 저장/복원/수정', icon: 'document' },
    { path: '/vault', label: '클라우드 저장함', desc: '요금제별 저장용량 전략과 보관 자산 관리', icon: 'folder' },
    { path: '/video-watch', label: '영상시청', desc: '공개 YouTube 재생목록·영상 링크를 바로 열어 시청', icon: 'music' },
    { path: '/rewards', label: '리워드/정산', desc: '무료 DM·질문 정책, 광고 수익 구조, 출금 신청 현황 확인', icon: 'coin' },
    ...(isAdmin ? [{ path: '/music', label: '음악듣기', desc: '공개 YouTube 재생목록을 관리자 전용 플레이어로 청취', icon: 'music' }] : []),
  ]

  return (
    <section className="page-stack">
      <div className="card stack">
        <div className="split-row responsive-row">
          <div className="stack gap-6">
            <strong>더보기</strong>
            <div className="muted small-text">메모 화면이 아니라 실제 운영 기능으로 바로 이동할 수 있는 실행 허브입니다.</div>
          </div>
          <button type="button" className="ghost" onClick={onOpenSheet}>빠른 이동</button>
        </div>
        <div className="grid-4">
          <Metric label="현재 플랜" value={businessConfigLabel(businessConfig.plan)} />
          <Metric label="템플릿 판매" value={storeSales} />
          <Metric label="채용 공고" value={hiringPosts.length} />
          <Metric label="공개 방문" value={analyticsSummary.visits} />
        </div>
      </div>

      <div className="more-launch-grid">
        {shortcuts.map(item => (
          <Link key={item.path} to={item.path} className="more-launch-card">
            <span className="more-launch-icon"><IconGlyph name={item.icon} label={item.label} /></span>
            <strong>{item.label}</strong>
            <div className="muted small-text">{item.desc}</div>
          </Link>
        ))}
      </div>

      <div className="grid-2">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>운영 현황</strong><Link className="button-link" to="/workspace">종합관리 열기</Link></div>
          <div className="stack compact-list">
            <div className="mini-card"><strong>브랜드 페이지</strong><div className="muted small-text">{brandPages.length}개 등록</div></div>
            <div className="mini-card"><strong>광고 슬롯</strong><div className="muted small-text">{adSlots.filter(item => item.status === '판매중').length}개 판매중</div></div>
            <div className="mini-card"><strong>거래 글</strong><div className="muted small-text">{gigPosts.length}개 운영중</div></div>
          </div>
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>바로 실행</strong><Link className="button-link" to="/qr-generator">QR 생성</Link></div>
          <div className="action-wrap wrap-row">
            <Link className="button-link" to="/business-card">유료 명함폼 적용</Link>
            <Link className="button-link" to="/profile?tab=link">공개 링크 추가</Link>
            <Link className="button-link" to="/profile?tab=qr">프로필 QR 연결</Link>
            <Link className="button-link" to="/url-shortener">단축 URL 생성</Link>
            <Link className="button-link" to="/video-watch">영상시청 열기</Link>
            <Link className="button-link" to="/rewards">포인트 센터 열기</Link>
            {isAdmin ? <Link className="button-link" to="/music">음악듣기 열기</Link> : null}
          </div>
          <div className="muted small-text">공개 URL → 링크 클릭 → QR 스캔 → 문의 전환 흐름을 바로 실행할 수 있게 연결했습니다.</div>
        </div>
      </div>

      {isAdmin ? (
        <div className="card stack admin-music-callout">
          <div className="split-row responsive-row">
            <div className="stack gap-6">
              <strong>관리자 전용 음악듣기</strong>
              <div className="muted small-text">공개 YouTube 재생목록을 공식 임베드 플레이어로 불러와 플레이리스트처럼 재생합니다.</div>
            </div>
            <Link className="button-link" to="/music">바로 열기</Link>
          </div>
        </div>
      ) : null}
    </section>
  )
}


function RewardsPage() {
  const currentUser = getStoredUser()
  const currentUserId = Number(currentUser?.id || 0)
  const [summary, setSummary] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(getStoredActiveProfileId())
  const [withdrawForm, setWithdrawForm] = useState({ account_holder: '', bank_name: '', account_number: '', note: '' })
  const [brandForm, setBrandForm] = useState({ business_name: '', business_category: '', website_url: '', note: '' })
  
  const [directAdForm, setDirectAdForm] = useState({ title: '', subtitle: '', description: '', target_url: '', image_url: '', placement: 'home_feed', category: '', target_keyword: '', bid_points: 3000 })
  const [directAdCompetition, setDirectAdCompetition] = useState(null)
  const [feedItems, setFeedItems] = useState([])
  const [communityItems, setCommunityItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [summaryData, profileData, feedData, communityData] = await Promise.all([api('/api/rewards/summary'), api('/api/profiles'), api('/api/feed/posts?limit=20&offset=0'), api('/api/community/posts')])
      setSummary(summaryData)
      const profileItems = Array.isArray(profileData?.items) ? profileData.items : []
      setProfiles(profileItems)
      const ownFeedItems = (Array.isArray(feedData?.items) ? feedData.items : []).filter(item => Number(item?.owner?.id || item?.user_id || 0) === currentUserId)
      const ownCommunityItems = (Array.isArray(communityData?.items) ? communityData.items : []).filter(item => Number(item?.author?.id || 0) === currentUserId)
      setFeedItems(ownFeedItems)
      setCommunityItems(ownCommunityItems)
      if (!selectedProfileId && profileItems.length) {
        const fallbackId = Number(profileItems[0]?.id || 0)
        setSelectedProfileId(fallbackId)
        setStoredActiveProfileId(fallbackId)
      }
      const firstProfile = profileItems[0] || null
      if (firstProfile) {
        setBrandForm(prev => ({ ...prev, business_name: prev.business_name || firstProfile.display_name || firstProfile.title || '' }))
        setDirectAdForm(prev => ({ ...prev, title: prev.title || `${firstProfile.display_name || firstProfile.title || '프로필'} 소개`, subtitle: prev.subtitle || firstProfile.headline || '' }))
      }
    } catch (err) {
      setError(err.message || '포인트 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const availablePoints = Number(summary?.balance?.available || 0)
  const pendingPoints = Number(summary?.balance?.pending || 0)
  const totalEarned = Number(summary?.balance?.earned || 0)
  const monthEarned = Number(summary?.month_earned || 0)
  const minWithdraw = Number(summary?.min_withdraw_points || 10000)
  const withdrawCount = Number(summary?.monthly_withdraw_count || 0)
  const withdrawLimit = Number(summary?.monthly_withdraw_limit || 1)
  const canWithdraw = Boolean(summary?.can_withdraw)
  const activeProfile = profiles.find(item => Number(item.id) === Number(selectedProfileId))
  const withdrawFeeRate = Number(summary?.withdraw_fee_rate || 0.05)
  const withdrawFeePercent = Math.round(withdrawFeeRate * 100)
  const withdrawCashEstimate = Math.max(0, Math.floor(minWithdraw * (1 - withdrawFeeRate)))

  const businessOverviewItems = [
    { title: '서비스 개요', lines: ['자유롭게 쓰는 공개 프로필 · 질문 · DM 플랫폼', '트래픽이 쌓일수록 AdSense·영상 광고 수익이 커지는 구조'] },
    { title: '고정 수익 모델', lines: ['무료 기능: DM(채팅), 질문(하기·받기)', `유료 기능: 출금 수수료 ${withdrawFeePercent}%`] },
    { title: '비활성화 정책', lines: ['키워드 입찰 미사용', 'DM 과금 미사용'] },
  ]

  const rewardPolicyRows = [
    { label: '질문 받기', value: '무료 기능 유지' },
    { label: '질문 하기', value: '무료 기능 유지' },
    { label: 'DM(채팅)', value: '무료 기능 유지' },
    { label: '출금 신청', value: `수수료 ${withdrawFeePercent}%` },
    { label: '광고 수익', value: 'AdSense / 영상 광고' },
  ]

  const growthGuideRows = [
    '프로필 → 질문 → 광고 → 수익 구조 강화',
    '유저를 광고 매체화',
    'B2B 광고 확장',
  ]

  const riskGuideRows = [
    'AdSense 정책 준수',
    '부정 활동 감지',
    '포인트 남용 방지',
    '광고 클릭 보상 금지',
    '광고 시청 보상 금지',
  ]

  async function handleShareProfile() {
    const profile = profiles.find(item => Number(item.id) === Number(selectedProfileId))
    if (!profile) return
    const publicUrl = `${window.location.origin}/p/${profile.slug}`
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.display_name || profile.title} 공개 프로필`, url: publicUrl })
      } else {
        await navigator.clipboard.writeText(publicUrl)
        window.alert('공개 프로필 주소를 복사했습니다.')
      }
    } catch {
      try { await navigator.clipboard.writeText(publicUrl); window.alert('공개 프로필 주소를 복사했습니다.') } catch {}
    }
    const result = await claimProfileShareReward(profile.id)
    if (result?.summary) setSummary(result.summary)
    if (result && result.awarded === false) window.alert('오늘 공유 적립 한도에 도달했거나 이미 적립된 공유입니다.')
  }

  async function handleCompletionCheck() {
    const profileId = Number(selectedProfileId || 0)
    if (!profileId) return
    setSubmitting(true)
    try {
      const result = await api('/api/rewards/profile-completion-check', { method: 'POST', body: JSON.stringify({ profile_id: profileId }) })
      if (result?.summary) setSummary(result.summary)
      window.alert(result?.awarded ? '프로필 정리 완료 보너스가 적립되었습니다.' : '아직 필수 프로필 정보가 부족하거나 이미 지급된 보너스입니다.')
    } catch (err) {
      window.alert(err.message || '보너스 확인에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleWithdrawSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await api('/api/rewards/withdrawals', { method: 'POST', body: JSON.stringify(withdrawForm) })
      if (result?.summary) setSummary(result.summary)
      setWithdrawForm({ account_holder: '', bank_name: '', account_number: '', note: '' })
      window.alert('출금 신청이 접수되었습니다. 운영 검수 후 순차 지급됩니다.')
    } catch (err) {
      window.alert(err.message || '출금 신청에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleBrandVerificationRequest(e) {
    e.preventDefault()
    if (!selectedProfileId) return window.alert('프로필을 먼저 선택해주세요.')
    setSubmitting(true)
    try {
      const result = await api('/api/rewards/brand-verification/request', { method: 'POST', body: JSON.stringify({ profile_id: Number(selectedProfileId), ...brandForm }) })
      if (result?.summary) setSummary(result.summary)
      window.alert('브랜드/기업 인증 요청이 접수되었습니다. 관리자 검수 후 인증 마크가 반영됩니다.')
    } catch (err) {
      window.alert(err.message || '브랜드 인증 요청에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDirectAdSubmit(e) {
    e.preventDefault()
    if (!selectedProfileId) return window.alert('광고주로 사용할 프로필을 먼저 선택해주세요.')
    setSubmitting(true)
    try {
      const payload = { ...directAdForm, profile_id: Number(selectedProfileId || 0), bid_points: Number(directAdForm.bid_points || 0) }
      const result = await api('/api/rewards/direct-ads', { method: 'POST', body: JSON.stringify(payload) })
      if (result?.summary) setSummary(result.summary)
      if (result?.competition) setDirectAdCompetition(result.competition)
      setDirectAdForm(prev => ({ ...prev, description: '', image_url: '', target_keyword: '' }))
      window.alert('직접 광고 집행 요청이 접수되었습니다. 관리자 승인 후 홈 피드에 노출됩니다.')
    } catch (err) {
      window.alert(err.message || '직접 광고 생성에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDirectAdCompetitionLookup() {
    try {
      const params = new URLSearchParams({ placement: directAdForm.placement, category: directAdForm.category || '' })
      const result = await api(`/api/direct-ads/placements?${params.toString()}`)
      setDirectAdCompetition(result?.competition || null)
    } catch (err) {
      window.alert(err.message || '직접 광고 경쟁 현황 조회에 실패했습니다.')
    }
  }

  return (
    <section className="page-stack">
      <div className="card stack">
        <div className="split-row responsive-row">
          <div className="stack gap-6">
            <strong>마이크로 인플루언서 리워드센터</strong>
            <div className="muted small-text">DM과 질문은 무료로 유지하고, 플랫폼은 AdSense·영상 광고와 출금 수수료 5% 구조로 운영하는 정책을 반영한 화면입니다.</div>
          </div>
          <button type="button" className="ghost" onClick={load}>새로고침</button>
        </div>
        <div className="grid-4 rewards-metric-grid">
          <Metric label="출금 가능 포인트" value={`${availablePoints.toLocaleString()}P`} />
          <Metric label="보류중 포인트" value={`${pendingPoints.toLocaleString()}P`} />
          <Metric label="이번 달 적립" value={`${monthEarned.toLocaleString()}P`} />
          <Metric label="누적 적립" value={`${totalEarned.toLocaleString()}P`} />
        </div>
        <div className="rewards-policy-strip">
          <span>최소 출금 {minWithdraw.toLocaleString()}P</span>
          <span>출금 수수료 {withdrawFeePercent}%</span>
          <span>월 출금 {withdrawCount}/{withdrawLimit}회</span>
          <span>{canWithdraw ? '이번 달 출금 신청 가능' : '이번 달 출금 조건 미충족'}</span>
        </div>
      </div>

      <div className="grid-3 rewards-metric-grid">
        {businessOverviewItems.map(item => (
          <div key={item.title} className="mini-card rewards-rule-card stack gap-6">
            <strong>{item.title}</strong>
            {item.lines.map((line, index) => <div key={`${item.title}-${index}`} className="muted small-text">{line}</div>)}
          </div>
        ))}
      </div>

      <div className="grid-2 rewards-grid">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>고정 정책</strong><span className="muted small-text">무료 기능 유지</span></div>
          <div className="stack compact-list">
            {rewardPolicyRows.map(item => (
              <div key={item.label} className="mini-card rewards-rule-card">
                <div className="split-row responsive-row"><strong>{item.label}</strong><strong>{item.value}</strong></div>
              </div>
            ))}
          </div>
          <div className="bordered-box small-text">수익 구조 = 페이지뷰/질문 트래픽 증가 → AdSense·영상 광고 노출 증가</div>
          <div className="bordered-box small-text">DM 과금과 키워드 입찰은 사용하지 않습니다.</div>
          <div className="bordered-box small-text">사용자 출금 시에만 {withdrawFeePercent}% 수수료가 적용됩니다.</div>
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>관리/리스크/성장 전략</strong><span className="muted small-text">운영 원칙</span></div>
          <div className="bordered-box small-text">관리자 시스템: 출금 승인/반려, 광고 지면 관리, 부정 활동 감지</div>
          <div className="bordered-box small-text">광고 구조: 공개 질문/피드 트래픽 기반 AdSense·영상 광고 노출</div>
          {riskGuideRows.map((item, index) => <div key={`risk-${index}`} className="bordered-box small-text">{item}</div>)}
          {growthGuideRows.map((item, index) => <div key={`growth-${index}`} className="bordered-box small-text">{item}</div>)}
        </div>
      </div>

      <MonetizationAdBanner placement="rewards_inline" className="rewards-inline-ad" />

      <div className="card stack">
        <div className="split-row responsive-row">
          <div className="stack gap-6">
            <strong>리워드 대시보드</strong>
            <div className="muted small-text">실제 광고 수익을 직접 보여주지 않고, 최근 활동량을 기준으로 안전하게 계산한 예상 리워드 지표입니다.</div>
          </div>
          <Link className="button-link" to="/questions">질문 화면 보기</Link>
        </div>
        <div className="grid-4 rewards-metric-grid">
          <Metric label="오늘 적립" value={`${Number(summary?.today_earned || 0).toLocaleString()}P`} />
          <Metric label="최근 7일 적립" value={`${Number(summary?.week_earned || 0).toLocaleString()}P`} />
          <Metric label="예상 월 리워드" value={`${Number(summary?.estimated?.projected_month_points || 0).toLocaleString()}P`} />
          <Metric label="예상 광고 노출 지수" value={`${Number(summary?.estimated?.estimated_ad_exposure || 0).toLocaleString()}회`} />
        </div>
        <div className="grid-2 rewards-grid">
          <div className="mini-card rewards-rule-card stack">
            <div className="split-row responsive-row"><strong>현재 리워드 상태</strong><strong>{Number(summary?.estimated?.expected_cash_krw || 0).toLocaleString()}원</strong></div>
            <div className="muted small-text">예상 현금 전환 금액은 활동 점수 기반 추정치이며 실제 광고 정산 금액과 1:1로 연결되지 않습니다.</div>
            <div className="muted small-text">질문 수 {Number(summary?.estimated?.received_questions || 0).toLocaleString()}건 · 답변 완료 {Number(summary?.estimated?.answered_questions || 0).toLocaleString()}건 · 최근 공유 {Number(summary?.estimated?.profile_shares_7d || 0).toLocaleString()}회 · 홈/질문 광고 누적 최적화</div>
          </div>
          <div className="mini-card rewards-rule-card stack">
            <div className="split-row responsive-row"><strong>운영 안내</strong><strong>월 1회 출금</strong></div>
            <div className="stack compact-list">
              {(summary?.insights || []).map((item, index) => <div key={`insight-${index}`} className="bordered-box small-text">{item}</div>)}
            </div>
          </div>
        </div>
      </div>


      <div className="grid-2 rewards-grid">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>마이크로 인플루언서 운영 모델</strong><span className="muted small-text">핵심 방향</span></div>
          <div className="stack compact-list">
            {(summary?.creator_model || []).map((item, index) => (
              <div key={`creator-model-${index}`} className="mini-card rewards-rule-card">
                <div className="split-row responsive-row"><strong>{index + 1}. {item.title}</strong><span className="muted small-text">운영 단계</span></div>
                <div className="muted small-text">{item.description}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>다른 서비스와 비교</strong><span className="muted small-text">차별화 포인트</span></div>
          <div className="stack compact-list">
            {(summary?.strategy_comparison || []).map(item => (
              <div key={item.service} className="mini-card rewards-rule-card stack gap-6">
                <div className="split-row responsive-row"><strong>{item.service}</strong><span className="muted small-text">비교 대상</span></div>
                <div className="small-text"><strong>강점:</strong> {item.strength}</div>
                <div className="small-text"><strong>한계:</strong> {item.gap}</div>
                <div className="small-text"><strong>우리 앱 우위:</strong> {item.our_edge}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2 rewards-grid">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>적립 기준</strong><span className="muted small-text">광고 시청/클릭 보상 아님</span></div>
          <div className="stack compact-list">
            {(summary?.rules || []).filter(item => item.code !== 'keyword_boost_spend').map(item => (
              <div key={item.code} className="mini-card rewards-rule-card">
                <div className="split-row responsive-row"><strong>{item.label}</strong><strong>{Number(item.points || 0).toLocaleString()}P</strong></div>
                <div className="muted small-text">{item.description}</div>
                <div className="muted small-text">일 적립 제한 {Number(item.daily_limit || 0)}회</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>활동 실행</strong><span className="muted small-text">즉시 적립 가능한 항목</span></div>
          <label className="small-text">적립 기준으로 사용할 프로필</label>
          <select value={selectedProfileId || ''} onChange={e => { const next = Number(e.target.value) || null; setSelectedProfileId(next); setStoredActiveProfileId(next) }}>
            {profiles.map(item => <option key={item.id} value={item.id}>{item.display_name || item.title}</option>)}
          </select>
          <div className="action-wrap wrap-row">
            <button type="button" onClick={handleShareProfile} disabled={!selectedProfileId || submitting}>프로필 공유하고 적립</button>
            <button type="button" className="ghost" onClick={handleCompletionCheck} disabled={!selectedProfileId || submitting}>프로필 완성 보너스 확인</button>
          </div>
          <div className="stack compact-list">
            {(summary?.notices || []).map((item, index) => <div key={`notice-${index}`} className="bordered-box small-text">{item}</div>)}
          </div>
        </div>
      </div>

      <div className="grid-2 rewards-grid">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>브랜드/기업 인증 마크</strong><span className="muted small-text">운영자 검수형</span></div>
          <div className="muted small-text">브랜드/기업 계정은 프로필과 피드에 인증 마크를 표시할 수 있습니다. 승인 시 피드/질문/공개프로필에서 뱃지가 노출됩니다.</div>
          <div className="bordered-box small-text">현재 선택 프로필: {activeProfile ? `${activeProfile.display_name || activeProfile.title} ${activeProfile.brand_verified ? '· 인증됨' : '· 미인증'}` : '선택 안 됨'}</div>
          <form className="stack" onSubmit={handleBrandVerificationRequest}>
            <div className="grid-2">
              <TextField label="브랜드명" value={brandForm.business_name} onChange={value => setBrandForm(prev => ({ ...prev, business_name: value }))} />
              <TextField label="업종" value={brandForm.business_category} onChange={value => setBrandForm(prev => ({ ...prev, business_category: value }))} />
            </div>
            <TextField label="대표 웹사이트" value={brandForm.website_url} onChange={value => setBrandForm(prev => ({ ...prev, website_url: value }))} />
            <label className="field-label">검수 메모</label>
            <textarea value={brandForm.note} onChange={e => setBrandForm(prev => ({ ...prev, note: e.target.value }))} placeholder="사업자명, 브랜드 설명, 증빙 링크 등을 입력하세요." />
            <button type="submit" disabled={!selectedProfileId || submitting}>브랜드/기업 인증 요청</button>
          </form>
          <div className="stack compact-list">
            {(summary?.brand_verification?.my_requests || []).length ? summary.brand_verification.my_requests.map(item => <div key={`brand-req-${item.id}`} className="bordered-box small-text">{item.business_name || '브랜드'} · {item.status} · {formatDateLabel(item.created_at)}</div>) : <div className="muted small-text">아직 인증 요청 내역이 없습니다.</div>}
          </div>
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>외부 플랫폼 인증 요금 참고</strong><span className="muted small-text">공식 정책 참고용</span></div>
          <div className="stack compact-list">
            {(summary?.brand_verification?.external_examples || []).map(item => (
              <div key={item.platform} className="mini-card rewards-rule-card">
                <div className="split-row responsive-row"><strong>{item.platform}</strong><strong>{item.price_text}</strong></div>
                <div className="muted small-text">서비스별 실제 지역 요금과 세금은 다를 수 있습니다.</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2 rewards-grid">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>직접 광고 집행</strong><span className="muted small-text">홈 피드 자연 노출형</span></div>
          <div className="muted small-text">회원이 직접 광고 문구와 랜딩 URL을 등록하고 포인트를 사용해 홈 피드 중간 스폰서드 카드로 노출할 수 있습니다.</div>
          <form className="stack" onSubmit={handleDirectAdSubmit}>
            <div className="grid-2">
              <TextField label="광고 제목" value={directAdForm.title} onChange={value => setDirectAdForm(prev => ({ ...prev, title: value }))} />
              <TextField label="부제목" value={directAdForm.subtitle} onChange={value => setDirectAdForm(prev => ({ ...prev, subtitle: value }))} />
            </div>
            <label className="field-label">광고 설명</label>
            <textarea value={directAdForm.description} onChange={e => setDirectAdForm(prev => ({ ...prev, description: e.target.value }))} placeholder="광고에서 보여줄 핵심 소개 문구를 입력하세요." />
            <div className="grid-2">
              <TextField label="랜딩 URL" value={directAdForm.target_url} onChange={value => setDirectAdForm(prev => ({ ...prev, target_url: value }))} />
              <TextField label="이미지 URL" value={directAdForm.image_url} onChange={value => setDirectAdForm(prev => ({ ...prev, image_url: value }))} />
            </div>
            <div className="grid-3">
              <label className="stack small-text"><span>광고 지면</span><select value={directAdForm.placement} onChange={e => setDirectAdForm(prev => ({ ...prev, placement: e.target.value }))}>{(summary?.direct_ads?.placements || []).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
              <TextField label="경쟁 카테고리" value={directAdForm.category} onChange={value => setDirectAdForm(prev => ({ ...prev, category: value }))} />
              <TextField label="사용 포인트" value={String(directAdForm.bid_points)} onChange={value => setDirectAdForm(prev => ({ ...prev, bid_points: value.replace(/[^0-9]/g, '') }))} />
            </div>
            <div className="action-wrap wrap-row">
              <button type="submit" disabled={submitting}>직접 광고 요청</button>
              <button type="button" className="ghost" onClick={handleDirectAdCompetitionLookup}>광고 경쟁 보기</button>
            </div>
          </form>
          <div className="stack compact-list">
            {(summary?.direct_ads?.guide || []).map((item, index) => <div key={`direct-ad-guide-${index}`} className="bordered-box small-text">{item}</div>)}
            {(summary?.direct_ads?.my_items || []).length ? summary.direct_ads.my_items.map(item => <div key={`direct-ad-${item.id}`} className="bordered-box small-text">{item.title} · {item.placement === 'home_feed' ? '홈 피드' : '질문/답변'} · {Number(item.bid_points || 0).toLocaleString()}P · {item.status}</div>) : <div className="muted small-text">아직 등록한 직접 광고가 없습니다.</div>}
          </div>
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>직접 광고 경쟁 현황</strong><span className="muted small-text">동일 지면/카테고리 경쟁</span></div>
          {(directAdCompetition?.leaderboard || []).length ? directAdCompetition.leaderboard.map(item => (
            <div key={`direct-ad-competition-${item.rank}-${item.user_id}`} className={`bordered-box small-text${Number(item.user_id) === currentUserId ? ' competition-me' : ''}`}>
              <div className="split-row responsive-row"><strong>{item.rank}위 · {item.nickname}</strong><strong>{Number(item.total_points || 0).toLocaleString()}P</strong></div>
              <div className="muted small-text">카테고리 {item.category || '전체'} · 캠페인 {Number(item.campaign_count || 0).toLocaleString()}개</div>
            </div>
          )) : <div className="muted small-text">광고 지면과 카테고리를 선택한 뒤 경쟁 현황을 조회할 수 있습니다.</div>}
        </div>
      </div>

      <div className="grid-2 rewards-grid">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>현금 전환 신청</strong><span className="muted small-text">월 1회 · 최소 10,000P · 수수료 5%</span></div>
          <div className="muted small-text">광고 보상금이 아니라 서비스 활동 포인트 정산 요청입니다. 관리자 검수 후 순차 지급되며 출금 시 수수료 5%가 적용됩니다.</div>
          <div className="bordered-box small-text">예상 지급액: {minWithdraw.toLocaleString()}P 신청 시 약 {withdrawCashEstimate.toLocaleString()}P 지급</div>
          <form className="stack" onSubmit={handleWithdrawSubmit}>
            <div className="grid-2">
              <TextField label="예금주" value={withdrawForm.account_holder} onChange={value => setWithdrawForm(prev => ({ ...prev, account_holder: value }))} />
              <TextField label="은행명" value={withdrawForm.bank_name} onChange={value => setWithdrawForm(prev => ({ ...prev, bank_name: value }))} />
            </div>
            <TextField label="계좌번호" value={withdrawForm.account_number} onChange={value => setWithdrawForm(prev => ({ ...prev, account_number: value }))} />
            <label className="field-label">관리자 메모</label>
            <textarea value={withdrawForm.note} onChange={e => setWithdrawForm(prev => ({ ...prev, note: e.target.value }))} placeholder="정산 시 참고할 내용을 입력하세요." />
            <button type="submit" disabled={!canWithdraw || submitting}>{submitting ? '처리중' : `${minWithdraw.toLocaleString()}P 출금 신청 (${withdrawFeePercent}% 수수료)`}</button>
          </form>
          {!canWithdraw ? <div className="muted small-text">출금 조건: 출금 가능 포인트 {minWithdraw.toLocaleString()}P 이상, 이번 달 출금 신청 0회</div> : null}
        </div>

        <div className="card stack">
          <div className="split-row responsive-row"><strong>최근 적립 / 출금</strong><span className="muted small-text">최근 50건 / 12건</span></div>
          <div className="stack compact-list rewards-scroll-list">
            {(summary?.ledger || []).length ? summary.ledger.map(item => (
              <div key={`ledger-${item.id}`} className="mini-card rewards-history-card">
                <div className="split-row responsive-row"><strong>{item.label}</strong><strong>{Number(item.points || 0).toLocaleString()}P</strong></div>
                <div className="muted small-text">{item.description}</div>
                <div className="muted small-text">{formatDateLabel(item.created_at)}</div>
              </div>
            )) : <div className="muted">아직 적립 내역이 없습니다.</div>}
            {(summary?.withdrawals || []).length ? summary.withdrawals.map(item => (
              <div key={`withdraw-${item.id}`} className="bordered-box small-text">출금 {Number(item.points_amount || 0).toLocaleString()}P → 실지급 {Number(item.cash_amount || 0).toLocaleString()}P · 수수료 {Number(item.fee_points || 0).toLocaleString()}P · {item.status} · {formatDateLabel(item.created_at)}</div>
            )) : <div className="muted">아직 출금 신청 내역이 없습니다.</div>}
          </div>
        </div>
      </div>

      {loading ? <div className="muted">포인트 데이터를 불러오는 중입니다.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}
    </section>
  )
}


function fmtDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (Number.isNaN(date.getTime())) return null
  return date
}

function buildScheduleMonthCells(monthCursor) {
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
  const start = new Date(firstDay)
  start.setDate(firstDay.getDate() - firstDay.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function SchedulePage() {
  const todayKey = fmtDateValue(new Date())
  const [searchParams, setSearchParams] = useSearchParams()
  const [monthCursor, setMonthCursor] = useState(() => {
    const initial = parseDateValue(searchParams.get('date')) || new Date()
    return new Date(initial.getFullYear(), initial.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState(() => searchParams.get('date') || todayKey)
  const [entries, setEntries] = useState([])
  const [dayNotes, setDayNotes] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dayMemoOpen, setDayMemoOpen] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({ schedule_date: searchParams.get('date') || todayKey, schedule_time: '', customer_name: '', memo: '' })
  const [dayMemo, setDayMemo] = useState('')

  useEffect(() => {
    const requestDate = parseDateValue(searchParams.get('date'))
    if (requestDate) {
      const key = fmtDateValue(requestDate)
      setSelectedDate(key)
      setMonthCursor(new Date(requestDate.getFullYear(), requestDate.getMonth(), 1))
      setScheduleForm(prev => ({ ...prev, schedule_date: key }))
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    async function loadScheduleData() {
      setLoading(true)
      setError('')
      try {
        const firstDate = fmtDateValue(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1))
        const data = await api(`/api/work-schedule?start_date=${encodeURIComponent(firstDate)}&days=42`)
        if (cancelled) return
        setEntries(Array.isArray(data?.items) ? data.items : [])
        setDayNotes(data?.day_notes && typeof data.day_notes === 'object' ? data.day_notes : {})
      } catch (err) {
        if (!cancelled) {
          setError(err.message || '일정 데이터를 불러오지 못했습니다.')
          setEntries([])
          setDayNotes({})
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadScheduleData()
    return () => { cancelled = true }
  }, [monthCursor])

  const entriesByDate = useMemo(() => {
    const mapped = {}
    for (const item of entries) {
      const key = String(item?.schedule_date || '').slice(0, 10)
      if (!key) continue
      if (!mapped[key]) mapped[key] = []
      mapped[key].push(item)
    }
    Object.values(mapped).forEach(list => list.sort((a, b) => String(a?.schedule_time || '').localeCompare(String(b?.schedule_time || ''))))
    return mapped
  }, [entries])

  const selectedEntries = entriesByDate[selectedDate] || []
  const selectedNote = dayNotes[selectedDate]?.day_memo || ''
  const monthCells = useMemo(() => buildScheduleMonthCells(monthCursor), [monthCursor])
  const monthLabel = `${monthCursor.getFullYear()}년 ${monthCursor.getMonth() + 1}월`

  useEffect(() => {
    if (!composerOpen) {
      setScheduleForm(prev => ({ ...prev, schedule_date: selectedDate || todayKey }))
    }
  }, [selectedDate, composerOpen, todayKey])

  useEffect(() => {
    if (!dayMemoOpen) {
      setDayMemo(selectedNote)
    }
  }, [dayMemoOpen, selectedNote])

  function moveMonth(diff) {
    setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + diff, 1))
  }

  function moveToToday() {
    setSelectedDate(todayKey)
    setMonthCursor(new Date())
    setSearchParams({ date: todayKey })
  }

  function handleSelectDate(dateKey) {
    setSelectedDate(dateKey)
    setSearchParams({ date: dateKey })
  }

  async function reloadMonth() {
    const firstDate = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    setMonthCursor(new Date(firstDate))
    const data = await api(`/api/work-schedule?start_date=${encodeURIComponent(fmtDateValue(firstDate))}&days=42`)
    setEntries(Array.isArray(data?.items) ? data.items : [])
    setDayNotes(data?.day_notes && typeof data.day_notes === 'object' ? data.day_notes : {})
  }

  async function handleCreateSchedule(event) {
    event.preventDefault()
    const payload = {
      schedule_date: scheduleForm.schedule_date || selectedDate || todayKey,
      schedule_time: scheduleForm.schedule_time,
      customer_name: scheduleForm.customer_name,
      memo: scheduleForm.memo,
    }
    try {
      await api('/api/work-schedule', { method: 'POST', body: JSON.stringify(payload) })
      setComposerOpen(false)
      setScheduleForm({ schedule_date: payload.schedule_date, schedule_time: '', customer_name: '', memo: '' })
      setSelectedDate(payload.schedule_date)
      setSearchParams({ date: payload.schedule_date })
      if (parseDateValue(payload.schedule_date)) {
        const nextDate = parseDateValue(payload.schedule_date)
        setMonthCursor(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1))
      }
      await reloadMonth()
    } catch (err) {
      window.alert(err.message || '일정을 저장하지 못했습니다.')
    }
  }

  async function handleSaveDayMemo() {
    try {
      await api('/api/work-schedule/day-note', {
        method: 'PUT',
        body: JSON.stringify({ schedule_date: selectedDate, day_memo: dayMemo }),
      })
      setDayNotes(prev => ({ ...prev, [selectedDate]: { ...(prev[selectedDate] || {}), day_memo: dayMemo } }))
      setDayMemoOpen(false)
      setSettingsOpen(false)
    } catch (err) {
      window.alert(err.message || '일정 메모를 저장하지 못했습니다.')
    }
  }

  return (
    <section className="page-stack schedule-basic-page">
      <div className="card stack schedule-basic-card">
        <div className="schedule-basic-toolbar">
          <div className="schedule-basic-toolbar-left">
            <button type="button" className="ghost small schedule-toolbar-button" onClick={moveToToday}>오늘</button>
          </div>
          <div className="schedule-basic-toolbar-center">
            <button type="button" className="ghost icon-button schedule-toolbar-button" onClick={() => moveMonth(-1)} aria-label="이전달">
              <IconGlyph name="back" label="이전달" />
            </button>
            <strong className="schedule-basic-month-label">{monthLabel}</strong>
            <button type="button" className="ghost icon-button schedule-next-button schedule-toolbar-button" onClick={() => moveMonth(1)} aria-label="다음달">
              <IconGlyph name="back" label="다음달" />
            </button>
          </div>
          <div className="schedule-basic-toolbar-right">
            <button type="button" className="ghost icon-button schedule-toolbar-button" onClick={() => { setComposerOpen(true); setSettingsOpen(false) }} aria-label="일정등록" title="일정등록">
              <IconGlyph name="compose" label="일정등록" />
            </button>
            <div className="schedule-basic-settings-wrap">
              <button type="button" className="ghost icon-button schedule-toolbar-button" onClick={() => setSettingsOpen(prev => !prev)} aria-label="설정" title="설정">
                <IconGlyph name="settings" label="설정" />
              </button>
              {settingsOpen ? (
                <div className="schedule-basic-settings-popover">
                  <button type="button" onClick={() => { setDayMemo(selectedNote); setDayMemoOpen(true) }}>날짜 메모</button>
                  <button type="button" onClick={moveToToday}>오늘로 이동</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="schedule-basic-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day}>{day}</div>)}</div>
        <div className="schedule-basic-grid">
          {monthCells.map(date => {
            const key = fmtDateValue(date)
            const isToday = key === todayKey
            const isSelected = key === selectedDate
            const isCurrentMonth = date.getMonth() === monthCursor.getMonth()
            const dayItems = entriesByDate[key] || []
            return (
              <button
                key={key}
                type="button"
                className={`schedule-basic-cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${isCurrentMonth ? '' : ' is-outside'}`}
                onClick={() => handleSelectDate(key)}
              >
                <div className="schedule-basic-cell-head">
                  <span className="schedule-basic-date-number">{date.getDate()}</span>
                  {dayItems.length ? <span className="schedule-basic-count">{dayItems.length}</span> : null}
                </div>
                <div className="schedule-basic-cell-body">
                  {dayItems.slice(0, 2).map(item => (
                    <div key={item.id} className="schedule-basic-entry-chip" title={item.customer_name || '일정'}>
                      <span className="schedule-basic-entry-title">{item.customer_name || '일정'}</span>
                    </div>
                  ))}
                  {!dayItems.length && dayNotes[key]?.day_memo ? <div className="schedule-basic-note-chip">메모</div> : null}
                </div>
              </button>
            )
          })}
        </div>

        {loading ? <div className="muted">일정 불러오는 중...</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
      </div>

      <div className="card stack schedule-detail-card">
        <div className="between schedule-detail-head">
          <div className="stack gap-4">
            <strong>{selectedDate || todayKey}</strong>
          </div>
          <button type="button" className="icon-button schedule-detail-create-button" onClick={() => { setComposerOpen(true); setSettingsOpen(false) }} aria-label="일정만들기" title="일정만들기">
            <IconGlyph name="compose" label="일정만들기" />
          </button>
        </div>
        {selectedNote ? <div className="schedule-detail-note">메모 · {selectedNote}</div> : null}
        <div className="schedule-detail-list">
          {selectedEntries.length ? selectedEntries.map(item => (
            <div key={item.id} className="schedule-detail-item">
              <div className="schedule-detail-time">{item.schedule_time || '시간미정'}</div>
              <div className="schedule-detail-content">
                <strong>{item.customer_name || '일정'}</strong>
                {item.memo ? <div className="muted small-text">{item.memo}</div> : null}
              </div>
            </div>
          )) : <div className="muted">등록된 세부 일정이 없습니다.</div>}
        </div>
      </div>

      {composerOpen ? (
        <div className="modal-backdrop" onClick={() => setComposerOpen(false)}>
          <div className="modal-card schedule-basic-modal" onClick={event => event.stopPropagation()}>
            <div className="between"><strong>일정만들기</strong><button type="button" className="ghost small" onClick={() => setComposerOpen(false)}>닫기</button></div>
            <form className="stack gap-12" onSubmit={handleCreateSchedule}>
              <label className="stack gap-6"><span>날짜</span><input type="date" value={scheduleForm.schedule_date} onChange={event => setScheduleForm(prev => ({ ...prev, schedule_date: event.target.value }))} required /></label>
              <label className="stack gap-6"><span>시간</span><input type="time" value={scheduleForm.schedule_time} onChange={event => setScheduleForm(prev => ({ ...prev, schedule_time: event.target.value }))} /></label>
              <label className="stack gap-6"><span>일정명</span><input value={scheduleForm.customer_name} onChange={event => setScheduleForm(prev => ({ ...prev, customer_name: event.target.value }))} placeholder="일정명 입력" required /></label>
              <label className="stack gap-6"><span>메모</span><textarea value={scheduleForm.memo} onChange={event => setScheduleForm(prev => ({ ...prev, memo: event.target.value }))} placeholder="세부 메모 입력" rows={4} /></label>
              <button type="submit">저장</button>
            </form>
          </div>
        </div>
      ) : null}

      {dayMemoOpen ? (
        <div className="modal-backdrop" onClick={() => setDayMemoOpen(false)}>
          <div className="modal-card schedule-basic-modal" onClick={event => event.stopPropagation()}>
            <div className="between"><strong>{selectedDate} 메모</strong><button type="button" className="ghost small" onClick={() => setDayMemoOpen(false)}>닫기</button></div>
            <div className="stack gap-12">
              <textarea value={dayMemo} onChange={event => setDayMemo(event.target.value)} rows={5} placeholder="해당 날짜 메모를 입력하세요." />
              <button type="button" onClick={handleSaveDayMemo}>저장</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}


const LOCAL_STORAGE_KEYS = {
  vault: 'historyprofile_local_vault_items',
  introManager: 'historyprofile_local_intro_manager_items',
  introHistory: 'historyprofile_local_intro_manager_history',
  shareLinks: 'historyprofile_local_share_links_items',
  shareLinkCategories: 'historyprofile_local_share_link_categories',
  vaultSettings: 'historyprofile_local_vault_settings',
  businessConfig: 'historyprofile_local_business_config',
  templateStore: 'historyprofile_local_template_store_items',
  aiDrafts: 'historyprofile_local_ai_drafts',
  hiringPosts: 'historyprofile_local_hiring_posts',
  gigPosts: 'historyprofile_local_gig_posts',
  brandPages: 'historyprofile_local_brand_pages',
  adSlots: 'historyprofile_local_ad_slots',
  analyticsEvents: 'historyprofile_local_analytics_events',
  monetizationOrders: 'historyprofile_local_monetization_orders',
  leadInbox: 'historyprofile_local_lead_inbox',
  musicPlaylists: 'historyprofile_local_music_playlists',
}


const DEFAULT_VAULT_FOLDERS = ['자료', '이력서', '즐겨찾기', '포트폴리오', '증빙자료', '자기소개서']
const DEFAULT_VAULT_CATEGORIES = ['자료', '이력서', '포트폴리오', '증빙자료', '자기소개서']
const VAULT_GRID_LIMITS = { '3x3': 9, '4x4': 16, '5x5': 25 }

const DEFAULT_SHARE_LINK_CATEGORIES = ['소개', '채용', '영업', '기타']

function normalizeShareLinkCategories(value) {
  const items = Array.isArray(value) ? value : []
  const cleaned = Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)))
  return cleaned.length ? cleaned : [...DEFAULT_SHARE_LINK_CATEGORIES]
}

function copyToClipboard(value) {
  const text = String(value || '')
  if (!text) return
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => null)
    return
  }
  if (typeof window !== 'undefined') window.prompt('복사할 내용을 확인해주세요.', text)
}

function usageToneClass(ratio) {
  const value = Number(ratio || 0)
  if (value > 90) return 'danger'
  if (value > 70) return 'warning'
  if (value > 50) return 'positive'
  return 'neutral'
}


function ensureFolderSlots(grid, folders, slots) {
  const limit = VAULT_GRID_LIMITS[grid] || 9
  const cleanFolders = Array.from(new Set((folders || []).map(item => String(item || '').trim()).filter(Boolean)))
  const base = Array.isArray(slots) ? slots.map(item => String(item || '').trim()) : []
  const next = []
  for (const name of base) {
    if (next.length >= limit) break
    if (!name || next.includes(name) || !cleanFolders.includes(name)) {
      next.push('')
    } else {
      next.push(name)
    }
  }
  for (const folder of cleanFolders) {
    if (next.length >= limit) break
    if (!next.includes(folder)) next.push(folder)
  }
  while (next.length < limit) next.push('')
  return next.slice(0, limit)
}

function normalizeVaultSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  const grid = ['3x3', '4x4', '5x5'].includes(source.grid) ? source.grid : '3x3'
  const headerPosition = ['top', 'bottom'].includes(source.headerPosition) ? source.headerPosition : 'top'
  const folders = Array.isArray(source.folders)
    ? source.folders.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const categories = Array.isArray(source.categories)
    ? source.categories.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const normalizedFolders = folders.length ? Array.from(new Set(folders)) : [...DEFAULT_VAULT_FOLDERS]
  const normalizedCategories = categories.length ? Array.from(new Set(categories)) : [...DEFAULT_VAULT_CATEGORIES]
  return {
    grid,
    headerPosition,
    folders: normalizedFolders,
    categories: normalizedCategories,
    folderSlots: ensureFolderSlots(grid, normalizedFolders, source.folderSlots),
  }
}

function parseLineList(value, fallback = []) {
  const items = String(value || '').split(/\n|,/).map(item => item.trim()).filter(Boolean)
  return items.length ? items : fallback
}

function reorderByMove(list, fromIndex, toIndex) {
  if (fromIndex === toIndex) return [...list]
  const next = [...list]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function moveFolderSlot(slots, fromIndex, toIndex) {
  if (fromIndex === toIndex) return [...slots]
  const next = [...slots]
  const moving = next[fromIndex]
  next[fromIndex] = next[toIndex] || ''
  next[toIndex] = moving || ''
  return next
}

function estimateProfileUploadBytes(profile) {
  const uploads = Array.isArray(profile?.uploads) ? profile.uploads : []
  const direct = uploads.reduce((sum, item) => sum + Number(item?.size_bytes || 0), 0)
  const careerMedia = (profile?.careers || []).reduce((sum, item) => {
    const mediaItems = Array.isArray(item?.media_items) ? item.media_items : []
    return sum + mediaItems.reduce((sub, media) => sub + Number(media?.size_bytes || 0), 0)
  }, 0)
  return direct + careerMedia
}

function buildPlanTier(plan) {
  const usedStorageMb = Number(plan?.used_storage_mb || 0)
  const hasExtraProfiles = Number(plan?.allowed_profile_count || 0) > Number(plan?.free_profile_limit || 0)
  const hasLargeChat = Number(plan?.chat_media_limit_mb || 0) > 100
  if (hasExtraProfiles || hasLargeChat || usedStorageMb > 512) {
    return {
      current: {
        grade: '프로',
        title: '현재플랜(프로 등급)',
        profileLimit: Number(plan?.allowed_profile_count || 5),
        storageGb: Number(plan?.storage_limit_gb || 1),
        dailyVideoMb: Number(plan?.daily_video_limit_mb || 100),
        chatMediaMb: Number(plan?.chat_media_limit_mb || 100),
        visibility: '링크 전용 + 검색 노출',
        moderation: '신고 / 차단 / 검수 / 멀티프로필 확장',
      },
      next: {
        grade: '비즈니스',
        title: '다음플랜(비즈니스 등급)',
        profileLimit: Math.max(Number(plan?.allowed_profile_count || 5) + 5, 10),
        storageGb: Math.max(Number(plan?.storage_limit_gb || 1) + 1, 2),
        dailyVideoMb: Math.max(Number(plan?.daily_video_limit_mb || 100) + 100, 200),
        chatMediaMb: Math.max(Number(plan?.chat_media_limit_mb || 100) + 200, 300),
        visibility: '링크 전용 + 검색 노출 + 공개 링크 세분화',
        moderation: '신고 / 차단 / 검수 / 팀형 관리',
      },
    }
  }
  return {
    current: {
      grade: '무료',
      title: '현재플랜(무료 등급)',
      profileLimit: Number(plan?.allowed_profile_count || 5),
      storageGb: Number(plan?.storage_limit_gb || 1),
      dailyVideoMb: Number(plan?.daily_video_limit_mb || 100),
      chatMediaMb: Number(plan?.chat_media_limit_mb || 100),
      visibility: '링크 전용 공개',
      moderation: '신고 / 차단 / 검수',
    },
    next: {
      grade: '프로',
      title: '다음플랜(프로 등급)',
      profileLimit: Math.max(Number(plan?.allowed_profile_count || 5) + 3, 8),
      storageGb: Math.max(Number(plan?.storage_limit_gb || 1) + 1, 2),
      dailyVideoMb: Math.max(Number(plan?.daily_video_limit_mb || 100), 200),
      chatMediaMb: Math.max(Number(plan?.chat_media_limit_mb || 100) + 100, 200),
      visibility: '링크 전용 + 검색 노출',
      moderation: '신고 / 차단 / 검수 / 멀티프로필 확장',
    },
  }
}

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function readLocalItems(key, fallback = []) {
  if (typeof window === 'undefined') return fallback
  return safeJsonParse(window.localStorage.getItem(key), fallback)
}

function writeLocalItems(key, value) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function makeLocalId(prefix = 'local') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function splitTags(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

function bytesLabel(value) {
  const size = Number(value || 0)
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`
  if (size >= 1024) return `${Math.round(size / 1024)}KB`
  return `${size}B`
}

function useLocalCollection(key, fallback = []) {
  const [items, setItems] = useState(() => readLocalItems(key, fallback))
  useEffect(() => { writeLocalItems(key, items) }, [key, items])
  return [items, setItems]
}


function summarizeAnalyticsEvents(events) {
  const items = Array.isArray(events) ? events : []
  return items.reduce((acc, item) => {
    const type = String(item?.type || '')
    if (type === 'visit') acc.visits += 1
    if (type === 'link_click') acc.linkClicks += 1
    if (type === 'qr_click') acc.qrClicks += 1
    if (type === 'cta_click') acc.ctaClicks += 1
    if (type === 'lead') acc.leads += 1
    return acc
  }, { visits: 0, linkClicks: 0, qrClicks: 0, ctaClicks: 0, leads: 0 })
}

function recordAnalyticsEvent(payload) {
  if (typeof window === 'undefined') return
  const current = readLocalItems(LOCAL_STORAGE_KEYS.analyticsEvents, [])
  const next = [{
    id: makeLocalId('analytics'),
    created_at: new Date().toISOString(),
    ...payload,
  }, ...current].slice(0, 1000)
  writeLocalItems(LOCAL_STORAGE_KEYS.analyticsEvents, next)
}

function recordLeadEvent(payload) {
  if (typeof window === 'undefined') return
  const current = readLocalItems(LOCAL_STORAGE_KEYS.leadInbox, [])
  const next = [{
    id: makeLocalId('lead'),
    created_at: new Date().toISOString(),
    status: '신규',
    ...payload,
  }, ...current].slice(0, 300)
  writeLocalItems(LOCAL_STORAGE_KEYS.leadInbox, next)
}

function buildAnalyticsRowsFromProfiles(profiles, events) {
  const profileItems = Array.isArray(profiles) ? profiles.filter(item => item?.slug) : []
  const eventItems = Array.isArray(events) ? events : []
  return profileItems.map(profile => {
    const related = eventItems.filter(item => Number(item.profileId || 0) === Number(profile.id))
    const summary = summarizeAnalyticsEvents(related)
    return {
      id: profile.id,
      title: profile.display_name || profile.title || profile.slug,
      slug: profile.slug,
      indexable: Boolean(profile.search_engine_indexing),
      visits: summary.visits,
      clicks: summary.linkClicks + summary.qrClicks + summary.ctaClicks,
      leads: summary.leads,
    }
  })
}

function createOrderRecord(type, item) {
  return {
    id: makeLocalId('order'),
    type,
    title: item?.name || item?.title || item?.company || '상품',
    amount: Number(item?.price || 0),
    status: '결제대기',
    created_at: new Date().toISOString(),
    meta: item || {},
  }
}

function defaultMusicPlaylists() {
  return [{
    id: makeLocalId('playlist'),
    name: '업무 집중용 플레이리스트',
    description: '공개 YouTube 재생목록 링크를 붙여넣어 관리자 전용 음악 플레이어로 사용하세요.',
    playlistUrl: '',
    playlistId: '',
    videoUrl: '',
    videoId: '',
    videosText: '',
    sourceLabel: 'YouTube 공개 재생목록',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }]
}

function extractYoutubePlaylistId(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const directMatch = text.match(/(?:list=)([A-Za-z0-9_-]+)/i)
  if (directMatch?.[1]) return directMatch[1]
  if (/^PL[\w-]+$/i.test(text) || /^OLAK5uy_[\w-]+$/i.test(text) || /^RD[\w-]+$/i.test(text) || /^UU[\w-]+$/i.test(text)) return text
  return ''
}

function extractYoutubeVideoId(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const patterns = [
    /(?:v=)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return ''
}

function parseYoutubeVideoList(value) {
  const raw = String(value || '')
  const segments = raw.split(/\n|,|\s+/).map(item => item.trim()).filter(Boolean)
  return Array.from(new Set(segments.map(extractYoutubeVideoId).filter(Boolean))).slice(0, 50)
}

function buildYoutubeEmbedUrl(item) {
  const autoplay = item?.autoplay !== false
  const loop = item?.continuousPlay !== false
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  })
  if (autoplay) params.set('autoplay', '1')
  if (loop) params.set('loop', '1')

  const playlistId = extractYoutubePlaylistId(item?.playlistUrl || item?.playlistId)
  if (playlistId) {
    params.set('list', playlistId)
    return `https://www.youtube-nocookie.com/embed/videoseries?${params.toString()}`
  }

  const explicitVideoIds = parseYoutubeVideoList(item?.videosText)
  const primaryVideoId = extractYoutubeVideoId(item?.videoUrl || item?.videoId || explicitVideoIds[0] || '')
  const playlistVideoIds = explicitVideoIds.filter(id => id !== primaryVideoId)
  if (primaryVideoId && playlistVideoIds.length) {
    params.set('playlist', loop ? [primaryVideoId, ...playlistVideoIds].join(',') : playlistVideoIds.join(','))
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(primaryVideoId)}?${params.toString()}`
  }
  if (primaryVideoId) {
    if (loop) params.set('playlist', primaryVideoId)
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(primaryVideoId)}?${params.toString()}`
  }
  return ''
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}

function serializeForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\u003c').replace(/>/g, '\u003e').replace(/&/g, '\u0026')
}

function MusicPage({ pageTitle = '음악듣기', introLabel = '음악/영상 재생', adminOnly = true }) {
  const [playlists, setPlaylists] = useLocalCollection(LOCAL_STORAGE_KEYS.musicPlaylists, defaultMusicPlaylists())
  const [quickAddUrl, setQuickAddUrl] = useState('')
  const [playingId, setPlayingId] = useState('')
  const [playNonce, setPlayNonce] = useState(0)
  const backgroundPlayerWindowRef = useRef(null)
  const normalizedPlaylists = useMemo(() => {
    const source = Array.isArray(playlists) && playlists.length ? playlists : defaultMusicPlaylists()
    return source.map(item => ({
      ...item,
      autoplay: item?.autoplay !== false,
      continuousPlay: item?.continuousPlay !== false,
      embedUrl: buildYoutubeEmbedUrl(item),
    }))
  }, [playlists])
  const [selectedId, setSelectedId] = useState(() => normalizedPlaylists[0]?.id || '')
  const [form, setForm] = useState(() => {
    const first = normalizedPlaylists[0] || defaultMusicPlaylists()[0]
    return {
      name: first.name || '',
      description: first.description || '',
      playlistUrl: first.playlistUrl || '',
      videoUrl: first.videoUrl || '',
      videosText: first.videosText || '',
      sourceLabel: first.sourceLabel || 'YouTube 공개 재생목록',
      autoplay: first.autoplay !== false,
      continuousPlay: first.continuousPlay !== false,
    }
  })

  useEffect(() => {
    if (!normalizedPlaylists.length) return
    if (!normalizedPlaylists.some(item => item.id === selectedId)) {
      setSelectedId(normalizedPlaylists[0].id)
    }
    if (playingId && !normalizedPlaylists.some(item => item.id === playingId)) {
      setPlayingId('')
    }
  }, [normalizedPlaylists, selectedId, playingId])

  const activePlaylist = normalizedPlaylists.find(item => item.id === selectedId) || normalizedPlaylists[0] || null
  const isActivePlaying = Boolean(activePlaylist?.id && activePlaylist.id === playingId && activePlaylist.embedUrl)
  const activePlayerUrl = isActivePlaying ? activePlaylist.embedUrl : ''

  useEffect(() => {
    if (!activePlaylist) return
    setForm({
      name: activePlaylist.name || '',
      description: activePlaylist.description || '',
      playlistUrl: activePlaylist.playlistUrl || '',
      videoUrl: activePlaylist.videoUrl || '',
      videosText: activePlaylist.videosText || '',
      sourceLabel: activePlaylist.sourceLabel || 'YouTube 공개 재생목록',
      autoplay: activePlaylist.autoplay !== false,
      continuousPlay: activePlaylist.continuousPlay !== false,
    })
  }, [activePlaylist?.id])


  useEffect(() => {
    return () => {
      if (backgroundPlayerWindowRef.current && !backgroundPlayerWindowRef.current.closed) {
        backgroundPlayerWindowRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (!playingId) return
    const playingItem = normalizedPlaylists.find(item => item.id === playingId)
    if (!playingItem?.embedUrl) return
    if (backgroundPlayerWindowRef.current && !backgroundPlayerWindowRef.current.closed) {
      renderBackgroundPlayerWindow(playingItem)
    }
  }, [playingId, playNonce, normalizedPlaylists])

  const previewEmbedUrl = useMemo(() => buildYoutubeEmbedUrl(form), [form])

  function handlePlayPlaylist(id) {
    const target = normalizedPlaylists.find(item => item.id === id)
    if (!target?.embedUrl) {
      window.alert('재생 가능한 YouTube 링크를 먼저 저장해주세요.')
      return
    }
    setSelectedId(id)
    setPlayingId(id)
    setPlayNonce(current => current + 1)
  }

  function renderBackgroundPlayerWindow(target) {
    const popup = backgroundPlayerWindowRef.current
    if (!popup || popup.closed) return false
    const playableItems = normalizedPlaylists.filter(item => item?.embedUrl)
    const targetIndex = Math.max(0, playableItems.findIndex(item => item.id === target?.id))
    const initialData = {
      playlists: playableItems.map(item => ({
        id: item.id,
        name: item.name || '이름 없는 플레이리스트',
        description: item.description || '',
        sourceLabel: item.sourceLabel || 'YouTube 공개 재생목록',
        embedUrl: item.embedUrl,
      })),
      currentIndex: targetIndex,
    }
    const safeTitle = escapeHtml(target?.name || '음악듣기')
    popup.document.open()
    popup.document.write(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} - 백그라운드 재생</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #020617; color: #e2e8f0; font-family: Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
      body { overflow: hidden; }
      .app { display: flex; flex-direction: column; width: 100%; height: 100%; }
      .topbar { padding: 14px 16px 10px; border-bottom: 1px solid rgba(148, 163, 184, 0.24); background: linear-gradient(180deg, rgba(15,23,42,.98), rgba(2,6,23,.98)); }
      .title { font-size: 15px; font-weight: 800; }
      .sub { margin-top: 4px; font-size: 12px; color: #94a3b8; line-height: 1.5; }
      .video-shell { padding: 12px 16px 10px; }
      .video-frame { width: 100%; aspect-ratio: 16 / 9; border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 18px; overflow: hidden; background: #000; }
      iframe { width: 100%; height: 100%; border: 0; display: block; }
      .controls { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; padding: 0 16px 12px; }
      button { appearance: none; border: 0; border-radius: 14px; padding: 11px 10px; background: #1e293b; color: #f8fafc; cursor: pointer; font-weight: 700; }
      button.primary { background: #2563eb; }
      button.danger { background: #334155; }
      button:disabled { opacity: .42; cursor: not-allowed; }
      .playlist-wrap { flex: 1; min-height: 0; padding: 0 16px 16px; }
      .playlist-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
      .playlist-head strong { font-size: 14px; }
      .playlist-note { font-size: 12px; color: #94a3b8; }
      .playlist-list { display: flex; flex-direction: column; gap: 10px; height: calc(100% - 42px); overflow: auto; padding-right: 2px; }
      .playlist-item { width: 100%; text-align: left; background: #0f172a; border: 1px solid rgba(148, 163, 184, 0.18); padding: 12px 14px; border-radius: 16px; }
      .playlist-item.active { border-color: rgba(59,130,246,.9); background: rgba(37,99,235,.16); box-shadow: 0 0 0 1px rgba(59,130,246,.26) inset; }
      .playlist-title { display: block; font-size: 14px; font-weight: 800; color: #f8fafc; }
      .playlist-desc { display: block; margin-top: 6px; font-size: 12px; color: #cbd5e1; line-height: 1.45; }
      .playlist-meta { display: block; margin-top: 8px; font-size: 11px; color: #93c5fd; }
      .status { padding: 0 16px 14px; font-size: 12px; color: #94a3b8; }
      @media (max-width: 540px) {
        .controls { grid-template-columns: repeat(2, minmax(0,1fr)); }
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const initialData = ${serializeForInlineScript(initialData)};
      const app = document.getElementById('app');
      const state = {
        playlists: Array.isArray(initialData.playlists) ? initialData.playlists : [],
        currentIndex: Number.isFinite(initialData.currentIndex) ? initialData.currentIndex : 0,
        isStopped: false,
      };

      function currentItem() {
        return state.playlists[state.currentIndex] || null;
      }

      function frameMarkup() {
        const item = currentItem();
        if (!item || state.isStopped) {
          return '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:24px;color:#94a3b8;font-size:13px;text-align:center;line-height:1.6;">정지 상태입니다.<br>재생 버튼을 누르면 현재 선택한 플레이리스트가 다시 시작됩니다.</div>';
        }
        return '<iframe src="' + item.embedUrl + '" title="' + escapeHtml(item.name || 'YouTube 플레이어') + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
      }

      function render() {
        const item = currentItem();
        const hasPrev = state.currentIndex > 0;
        const hasNext = state.currentIndex < state.playlists.length - 1;
        const playlistItems = state.playlists.map((playlist, index) => {
          const active = index === state.currentIndex;
          return '<button type="button" class="playlist-item' + (active ? ' active' : '') + '" data-index="' + index + '">' +
            '<span class="playlist-title">' + escapeHtml(playlist.name || '이름 없는 플레이리스트') + '</span>' +
            '<span class="playlist-desc">' + escapeHtml(playlist.description || '설명이 없습니다.') + '</span>' +
            '<span class="playlist-meta">' + escapeHtml(playlist.sourceLabel || 'YouTube 공개 재생목록') + '</span>' +
          '</button>';
        }).join('');

        app.innerHTML = '<div class="app">' +
          '<div class="topbar">' +
            '<div class="title">' + escapeHtml(item?.name || (pageTitle + ' 백그라운드 실행')) + '</div>' +
            '<div class="sub">백그라운드 전용 플레이어 · 다른 창이나 앱을 사용해도 이 재생창이 유지되는 동안 계속 들을 수 있도록 구성했습니다.</div>' +
          '</div>' +
          '<div class="video-shell"><div class="video-frame">' + frameMarkup() + '</div></div>' +
          '<div class="controls">' +
            '<button type="button" data-action="prev"' + (hasPrev ? '' : ' disabled') + '>이전곡 재생</button>' +
            '<button type="button" class="primary" data-action="play"' + (item ? '' : ' disabled') + '>재생</button>' +
            '<button type="button" class="danger" data-action="stop"' + (item ? '' : ' disabled') + '>정지</button>' +
            '<button type="button" data-action="next"' + (hasNext ? '' : ' disabled') + '>다음곡 재생</button>' +
          '</div>' +
          '<div class="status">' + escapeHtml(item ? ((state.currentIndex + 1) + ' / ' + state.playlists.length + '번째 재생목록') : '재생 가능한 플레이리스트가 없습니다.') + '</div>' +
          '<div class="playlist-wrap">' +
            '<div class="playlist-head"><strong>저장된 플레이리스트</strong><span class="playlist-note">목록을 누르면 바로 전환됩니다</span></div>' +
            '<div class="playlist-list">' + playlistItems + '</div>' +
          '</div>' +
        '</div>';

        app.querySelectorAll('[data-action]').forEach(button => {
          button.addEventListener('click', event => {
            const action = event.currentTarget.getAttribute('data-action');
            if (action === 'prev' && state.currentIndex > 0) {
              state.currentIndex -= 1;
              state.isStopped = false;
            }
            if (action === 'play') state.isStopped = false;
            if (action === 'stop') state.isStopped = true;
            if (action === 'next' && state.currentIndex < state.playlists.length - 1) {
              state.currentIndex += 1;
              state.isStopped = false;
            }
            render();
          });
        });

        app.querySelectorAll('.playlist-item').forEach(button => {
          button.addEventListener('click', event => {
            const nextIndex = Number(event.currentTarget.getAttribute('data-index'));
            if (Number.isFinite(nextIndex)) {
              state.currentIndex = nextIndex;
              state.isStopped = false;
              render();
            }
          });
        });
      }

      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
      }

      render();
    </script>
  </body>
</html>`)
    popup.document.close()
    popup.focus()
    return true
  }

  function handleBackgroundPlay(id = activePlaylist?.id || '') {
    const target = normalizedPlaylists.find(item => item.id === id)
    if (!target?.embedUrl) {
      window.alert('재생 가능한 YouTube 링크를 먼저 저장해주세요.')
      return
    }
    setSelectedId(target.id)
    setPlayingId(target.id)
    setPlayNonce(current => current + 1)
    const popup = backgroundPlayerWindowRef.current && !backgroundPlayerWindowRef.current.closed
      ? backgroundPlayerWindowRef.current
      : window.open('', 'historyprofileappMediaBackgroundPlayer', 'popup=yes,width=460,height=820,resizable=yes,scrollbars=no')
    if (!popup) {
      window.alert('브라우저가 재생 새창을 차단했습니다. 팝업 허용 후 다시 시도해주세요.')
      return
    }
    backgroundPlayerWindowRef.current = popup
    renderBackgroundPlayerWindow(target)
  }

  function handleStopPlaylist(id = activePlaylist?.id || '') {
    if (!id) return
    if (playingId === id) {
      setPlayingId('')
    }
    if (backgroundPlayerWindowRef.current && !backgroundPlayerWindowRef.current.closed) {
      backgroundPlayerWindowRef.current.close()
      backgroundPlayerWindowRef.current = null
    }
  }

  function handleSavePlaylist() {
    if (!activePlaylist) return
    const nextName = String(form.name || '').trim() || '새 플레이리스트'
    const nextDescription = String(form.description || '').trim()
    const nextSourceLabel = String(form.sourceLabel || '').trim() || 'YouTube 공개 재생목록'
    const nextPlaylistUrl = String(form.playlistUrl || '').trim()
    const nextVideoUrl = String(form.videoUrl || '').trim()
    const nextVideosText = String(form.videosText || '').trim()
    const nextAutoplay = form.autoplay !== false
    const nextContinuousPlay = form.continuousPlay !== false
    const hasPlayableSource = Boolean(extractYoutubePlaylistId(nextPlaylistUrl) || extractYoutubeVideoId(nextVideoUrl) || parseYoutubeVideoList(nextVideosText).length)
    if (!hasPlayableSource) {
      window.alert('공개 YouTube 재생목록 링크 또는 영상 링크를 입력해주세요.')
      return
    }
    setPlaylists(current => current.map(item => item.id === activePlaylist.id ? {
      ...item,
      name: nextName,
      description: nextDescription,
      playlistUrl: nextPlaylistUrl,
      playlistId: extractYoutubePlaylistId(nextPlaylistUrl),
      videoUrl: nextVideoUrl,
      videoId: extractYoutubeVideoId(nextVideoUrl),
      videosText: nextVideosText,
      sourceLabel: nextSourceLabel,
      autoplay: nextAutoplay,
      continuousPlay: nextContinuousPlay,
      updated_at: new Date().toISOString(),
    } : item))
  }

  function createPlaylistItemFromUrl(rawUrl, indexOffset = 0) {
    const url = String(rawUrl || '').trim()
    const playlistId = extractYoutubePlaylistId(url)
    const videoId = extractYoutubeVideoId(url)
    if (!playlistId && !videoId) return null
    const now = new Date().toISOString()
    const playlistNumber = normalizedPlaylists.length + indexOffset + 1
    return {
      id: makeLocalId('playlist'),
      name: playlistId ? `YouTube 재생목록 ${playlistNumber}` : `YouTube 링크 ${playlistNumber}`,
      description: playlistId ? '빠른 추가로 등록한 공개 YouTube 재생목록' : '빠른 추가로 등록한 공개 YouTube 영상',
      playlistUrl: playlistId ? url : '',
      playlistId: playlistId || '',
      videoUrl: videoId ? url : '',
      videoId: videoId || '',
      videosText: '',
      sourceLabel: 'YouTube 빠른 추가',
      autoplay: true,
      continuousPlay: true,
      created_at: now,
      updated_at: now,
    }
  }

  function handleQuickAddPlaylist() {
    const segments = String(quickAddUrl || '').split(/\n|,/).map(item => item.trim()).filter(Boolean)
    if (!segments.length) {
      window.alert('상단 입력칸에 YouTube 링크를 입력해주세요.')
      return
    }
    const items = segments.map((segment, index) => createPlaylistItemFromUrl(segment, index)).filter(Boolean)
    if (!items.length) {
      window.alert('공개 YouTube 재생목록 링크 또는 영상 링크만 등록할 수 있습니다.')
      return
    }
    setPlaylists(current => [...items, ...current])
    setSelectedId(items[0].id)
    setPlayingId(items[0].id)
    setPlayNonce(current => current + 1)
    setQuickAddUrl('')
  }

  function handleAddPlaylist() {
    const item = {
      id: makeLocalId('playlist'),
      name: `플레이리스트 ${normalizedPlaylists.length + 1}`,
      description: '공개 YouTube 재생목록',
      playlistUrl: '',
      playlistId: '',
      videoUrl: '',
      videoId: '',
      videosText: '',
      sourceLabel: 'YouTube 공개 재생목록',
      autoplay: true,
      continuousPlay: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setPlaylists(current => [item, ...current])
    setSelectedId(item.id)
    setForm({
      name: item.name,
      description: item.description,
      playlistUrl: '',
      videoUrl: '',
      videosText: '',
      sourceLabel: item.sourceLabel,
      autoplay: item.autoplay,
      continuousPlay: item.continuousPlay,
    })
  }

  function handleDeletePlaylist(id) {
    if (normalizedPlaylists.length <= 1) {
      window.alert('최소 1개의 플레이리스트는 유지해주세요.')
      return
    }
    setPlaylists(current => current.filter(item => item.id !== id))
    if (selectedId === id) {
      const fallback = normalizedPlaylists.find(item => item.id !== id)
      if (fallback) setSelectedId(fallback.id)
    }
  }

  return (
    <section className="page-stack music-page-stack">
      <div className="card stack music-hero-card">
        <div className="split-row responsive-row">
          <div className="stack gap-6">
            <strong>{pageTitle}</strong>
            <div className="muted small-text">{adminOnly ? '관리자 계정만 사용할 수 있는' : '로그인 사용자가 바로 사용할 수 있는'} YouTube 공식 임베드 플레이어입니다. 공개 재생목록 또는 공개 영상 링크를 붙여넣어 재생목록처럼 시청할 수 있으며, 백그라운드 재생 버튼으로 전용 재생창을 열면 상단 작은 영상, 이전곡/재생/정지/다음곡 버튼, 저장된 플레이리스트 목록을 함께 보면서 다른 창이나 앱을 사용해도 더 안정적으로 계속 볼 수 있습니다.</div>
          </div>
          <div className="music-hero-actions">
            <button type="button" className="ghost" onClick={handleAddPlaylist}>플레이리스트 추가</button>
            <a className="button-link" href="https://www.youtube.com/" target="_blank" rel="noreferrer">YouTube 열기</a>
          </div>
        </div>
        <div className="music-quick-add-row">
          <input
            className="input music-quick-add-input"
            value={quickAddUrl}
            onChange={event => setQuickAddUrl(event.target.value)}
            placeholder="맨 위 입력칸에 YouTube 재생목록/영상 링크를 넣고 저장하면 새 플레이리스트가 바로 추가됩니다. 여러 개는 줄바꿈 또는 쉼표로 입력"
          />
          <button type="button" className="button-link" onClick={handleQuickAddPlaylist}>링크 저장 후 재생</button>
        </div>
        <div className="grid-3 music-metric-grid">
          <Metric label="등록 재생목록" value={normalizedPlaylists.length} />
          <Metric label="활성 소스" value={activePlaylist?.sourceLabel || '미설정'} />
          <Metric label="재생 방식" value={activePlaylist?.playlistUrl ? '공개 재생목록' : activePlaylist?.embedUrl ? '공개 영상 묶음' : '설정 필요'} />
        </div>
      </div>

      <div className="music-layout-grid">
        <div className="card stack music-playlist-list-card">
          <div className="split-row responsive-row">
            <strong>재생목록 목록</strong>
            <div className="muted small-text">{adminOnly ? '관리자 전용' : '로그인 사용자용'}</div>
          </div>
          <div className="stack compact-list music-playlist-list">
            {normalizedPlaylists.map(item => {
              const selected = item.id === activePlaylist?.id
              return (
                <div key={item.id} className={selected ? 'music-playlist-item active' : 'music-playlist-item'}>
                  <button type="button" className="ghost music-playlist-select" onClick={() => setSelectedId(item.id)}>
                    <span className="stack gap-4">
                      <strong>{item.name || '이름 없는 플레이리스트'}</strong>
                      <span className="muted small-text">{item.description || '설명이 없습니다.'}</span>
                    </span>
                    <span className="muted small-text">{item.embedUrl ? '재생 가능' : '설정 필요'}</span>
                  </button>
                  <div className="music-playlist-actions">
                    <button type="button" className="ghost music-control-button" onClick={() => handlePlayPlaylist(item.id)}>재생</button>
                    <button type="button" className="ghost music-control-button" onClick={() => handleBackgroundPlay(item.id)}>백그라운드</button>
                    <button type="button" className="ghost music-control-button" onClick={() => handleBackgroundPlay(item.id)}>앱 실행</button>
                    <button type="button" className="ghost music-control-button" onClick={() => handleStopPlaylist(item.id)}>정지</button>
                    <button type="button" className="ghost music-delete-button" onClick={() => handleDeletePlaylist(item.id)}>삭제</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card stack music-player-card">
          <div className="split-row responsive-row">
            <strong>{activePlaylist?.name || '플레이어'}</strong>
            <div className="music-player-top-actions">
              <button type="button" className="ghost music-control-button" onClick={() => activePlaylist?.id && handlePlayPlaylist(activePlaylist.id)} disabled={!activePlaylist?.embedUrl}>재생</button>
              <button type="button" className="ghost music-control-button" onClick={() => activePlaylist?.id && handleBackgroundPlay(activePlaylist.id)} disabled={!activePlaylist?.embedUrl}>백그라운드</button>
              <button type="button" className="ghost music-control-button" onClick={() => activePlaylist?.id && handleBackgroundPlay(activePlaylist.id)} disabled={!activePlaylist?.embedUrl}>앱 실행</button>
              <button type="button" className="ghost music-control-button" onClick={() => handleStopPlaylist(activePlaylist?.id)} disabled={!isActivePlaying && !(backgroundPlayerWindowRef.current && !backgroundPlayerWindowRef.current.closed)}>정지</button>
              <div className="muted small-text">공개 YouTube 콘텐츠만 사용 · 백그라운드 새창 지원</div>
            </div>
          </div>
          <div className="music-player-frame-wrap">
            {activePlayerUrl ? (
              <iframe
                key={`${activePlaylist.id}-${playNonce}`}
                className="music-player-frame"
                src={activePlayerUrl}
                title={activePlaylist.name || 'YouTube 음악 플레이어'}
                loading="eager"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            ) : (
              <div className="music-player-empty">
                <strong>{activePlaylist?.embedUrl ? '현재 재생이 정지되었습니다.' : '재생 가능한 링크를 입력해주세요.'}</strong>
                <div className="muted small-text">{activePlaylist?.embedUrl ? '재생 버튼을 누르면 선택한 플레이리스트가 다시 시작됩니다.' : '공개 YouTube 재생목록 링크를 넣으면 플레이리스트 형태로 바로 재생됩니다.'}</div>
              </div>
            )}
          </div>
          <div className="music-source-box">
            <div className="music-source-row"><strong>소스명</strong><span>{activePlaylist?.sourceLabel || 'YouTube 공개 재생목록'}</span></div>
            <div className="music-source-row"><strong>플레이리스트 링크</strong><span className="music-source-value">{activePlaylist?.playlistUrl || '-'}</span></div>
            <div className="music-source-row"><strong>대표 영상 링크</strong><span className="music-source-value">{activePlaylist?.videoUrl || '-'}</span></div>
            <div className="music-source-row"><strong>자동재생</strong><span>{activePlaylist?.autoplay !== false ? '사용' : '해제'}</span></div>
            <div className="music-source-row"><strong>연속듣기</strong><span>{activePlaylist?.continuousPlay !== false ? '사용' : '해제'}</span></div>
          </div>
        </div>
      </div>

      <div className="grid-2 music-settings-grid">
        <div className="card stack music-editor-card">
          <div className="split-row responsive-row"><strong>플레이리스트 설정</strong><button type="button" className="ghost" onClick={handleSavePlaylist}>저장</button></div>
          <TextField label="표시 이름" value={form.name} onChange={value => setForm(current => ({ ...current, name: value }))} />
          <TextField label="설명" value={form.description} onChange={value => setForm(current => ({ ...current, description: value }))} multiline rows={3} />
          <TextField label="소스명" value={form.sourceLabel} onChange={value => setForm(current => ({ ...current, sourceLabel: value }))} />
          <TextField label="YouTube 공개 재생목록 링크" value={form.playlistUrl} onChange={value => setForm(current => ({ ...current, playlistUrl: value }))} placeholder="https://www.youtube.com/playlist?list=..." />
          <TextField label="대표 YouTube 영상 링크" value={form.videoUrl} onChange={value => setForm(current => ({ ...current, videoUrl: value }))} placeholder="https://www.youtube.com/watch?v=..." />
          <TextField label="추가 영상 링크/ID 목록" value={form.videosText} onChange={value => setForm(current => ({ ...current, videosText: value }))} multiline rows={4} placeholder="영상 링크 또는 11자리 video ID를 줄바꿈으로 여러 개 입력" />
          <label className="check-row"><input type="checkbox" checked={form.autoplay !== false} onChange={event => setForm(current => ({ ...current, autoplay: event.target.checked }))} />자동재생 사용</label>
          <label className="check-row"><input type="checkbox" checked={form.continuousPlay !== false} onChange={event => setForm(current => ({ ...current, continuousPlay: event.target.checked }))} />연속듣기 반복 재생</label>
          <div className="muted small-text">공개 재생목록 링크가 있으면 그 값을 우선 사용하고, 없으면 대표 영상 + 추가 영상 목록으로 순차 재생합니다.</div>
        </div>

        <div className="card stack music-guide-card">
          <strong>운영 가이드</strong>
          <div className="stack compact-list">
            <div className="mini-card"><strong>권장 방식</strong><div className="muted small-text">공개 YouTube 플레이리스트 링크를 붙여넣는 방식이 가장 간단합니다.</div></div>
            <div className="mini-card"><strong>대체 방식</strong><div className="muted small-text">대표 영상 1개와 추가 영상 링크를 넣으면 간단한 큐처럼 재생됩니다.</div></div>
            <div className="mini-card"><strong>주의</strong><div className="muted small-text">다운로드, 백그라운드 음원 추출, 유료 기능 우회는 넣지 않았습니다.</div></div>
          </div>
          <div className="music-preview-box">
            <strong>미리보기 주소</strong>
            <div className="muted small-text music-preview-url">{previewEmbedUrl || '재생 가능한 주소가 아직 없습니다.'}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MoreBottomSheet({ open, onClose, onSelect, isAdmin }) {
  const sheetRef = useDismissLayer(open, onClose)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStateRef = useRef({ active: false, startY: 0, currentY: 0 })

  useEffect(() => {
    if (!open) {
      dragStateRef.current = { active: false, startY: 0, currentY: 0 }
      setDragOffset(0)
    }
  }, [open])

  if (!open) return null
  const items = [
    { path: '/mvp', label: 'MVP센터', desc: '실제 성공용 우선순위 흐름으로 프로필 · QR · 링크를 먼저 완성', icon: 'star' },
    { path: '/vault', label: '저장함', desc: '이력서 · 포트폴리오 · 증빙자료 태그/폴더/즐겨찾기 관리', icon: 'folder' },
    { path: '/workspace', label: '종합관리', desc: '저장함 · 자기소개서 · 링크 데이터를 한 번에 정리', icon: 'briefcase' },
    { path: '/introductions-manager', label: '자기소개서관리', desc: '회사/직무별 문항 세트 저장 · 비교 · 복원', icon: 'document' },
    { path: '/share-links-manager', label: '링크공유관리', desc: '채용용 · 영업용 · 소개용 공개 링크 생성', icon: 'link' },
    { path: '/video-watch', label: '영상시청', desc: '공개 YouTube 재생목록·영상 링크를 바로 열어 시청', icon: 'music' },
    { path: '/rewards', label: '리워드/정산', desc: '무료 DM·질문 정책, 광고 수익 구조, 출금 신청 현황 확인', icon: 'coin' },
    ...(isAdmin ? [{ path: '/music', label: '음악듣기', desc: '공개 YouTube 재생목록을 관리자 전용으로 재생', icon: 'music' }] : []),
    { path: '/more', label: '기타기능', desc: '업데이트 예정', icon: 'more', disabled: true },
  ]
  function getClientY(event) {
    if (event.touches?.length) return event.touches[0].clientY
    if (event.changedTouches?.length) return event.changedTouches[0].clientY
    return event.clientY
  }

  function handleDragStart(event) {
    const target = event.target
    if (!(target instanceof Element)) return
    const inScrollArea = Boolean(target.closest('.bottom-sheet-list'))
    const scroller = target.closest('.bottom-sheet-list')
    if (inScrollArea && scroller && scroller.scrollTop > 0) return
    dragStateRef.current = { active: true, startY: getClientY(event), currentY: getClientY(event) }
    setDragOffset(0)
  }

  function handleDragMove(event) {
    if (!dragStateRef.current.active) return
    const currentY = getClientY(event)
    const nextOffset = Math.max(0, currentY - dragStateRef.current.startY)
    dragStateRef.current.currentY = currentY
    setDragOffset(nextOffset)
  }

  function handleDragEnd() {
    if (!dragStateRef.current.active) return
    const shouldClose = dragOffset > 120
    dragStateRef.current = { active: false, startY: 0, currentY: 0 }
    setDragOffset(0)
    if (shouldClose) onClose?.()
  }

  return createPortal(
    <div className="bottom-sheet-backdrop" role="presentation" onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onMouseLeave={handleDragEnd} onTouchMove={handleDragMove} onTouchEnd={handleDragEnd} onTouchCancel={handleDragEnd}>
      <div className="bottom-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="더보기" onMouseDown={handleDragStart} onTouchStart={handleDragStart} style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined, transition: dragStateRef.current.active ? 'none' : undefined }}>
        <div className="bottom-sheet-handle" />
        <div className="split-row responsive-row bottom-sheet-head">
          <strong>더보기</strong>
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="bottom-sheet-list">
          {items.map(item => (
            <button key={item.label} type="button" className={item.disabled ? 'bottom-sheet-item ghost disabled' : 'bottom-sheet-item ghost'} onClick={() => !item.disabled && onSelect(item.path)} disabled={item.disabled}>
              <span className="bottom-sheet-item-icon"><IconGlyph name={item.icon} label={item.label} /></span>
              <span className="stack gap-4 bottom-sheet-item-copy">
                <strong>{item.label}</strong>
                <span className="muted small-text">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function StorageVaultPage() {
  const [items, setItems] = useLocalCollection(LOCAL_STORAGE_KEYS.vault, [])
  const [storedSettings, setStoredSettings] = useLocalCollection(LOCAL_STORAGE_KEYS.vaultSettings, normalizeVaultSettings())
  const vaultSettings = normalizeVaultSettings(storedSettings)
  const [uploading, setUploading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [folderFilter, setFolderFilter] = useState('전체')
  const [currentFolder, setCurrentFolder] = useState('')
  const [selectedDownloads, setSelectedDownloads] = useState([])
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsScreen, setSettingsScreen] = useState('')
  const [planInfo, setPlanInfo] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchWord, setSearchWord] = useState('')
  const [searchFilter, setSearchFilter] = useState('전체')
  const [usageOpen, setUsageOpen] = useState(false)
  const [form, setForm] = useState({ category: vaultSettings.categories[0] || '자료', title: '', folder: vaultSettings.folders[0] || '자료', tags: '', favorite: false })
  const [selectedFile, setSelectedFile] = useState(null)
  const [draftCategories, setDraftCategories] = useState(vaultSettings.categories.length ? vaultSettings.categories : [...DEFAULT_VAULT_CATEGORIES])
  const [draftLayout, setDraftLayout] = useState({ grid: vaultSettings.grid, headerPosition: vaultSettings.headerPosition, folderSlots: vaultSettings.folderSlots })
  const [draggingFolderName, setDraggingFolderName] = useState('')
  const [emptySlotAction, setEmptySlotAction] = useState({ index: -1, mode: '' })
  const [newFolderName, setNewFolderName] = useState('')
  const settingsAnchorRef = useRef(null)
  const settingsLayerRef = useDismissLayer(settingsMenuOpen, () => setSettingsMenuOpen(false))
  const folderFileInputRef = useRef(null)
  const dragTouchTimerRef = useRef(null)

  useEffect(() => {
    setDraftCategories(vaultSettings.categories.length ? vaultSettings.categories : [...DEFAULT_VAULT_CATEGORIES])
    setDraftLayout({ grid: vaultSettings.grid, headerPosition: vaultSettings.headerPosition, folderSlots: vaultSettings.folderSlots })
  }, [vaultSettings.grid, vaultSettings.headerPosition, JSON.stringify(vaultSettings.categories), JSON.stringify(vaultSettings.folderSlots)])

  useEffect(() => {
    if (!vaultSettings.categories.includes(form.category) || !vaultSettings.folders.includes(form.folder)) {
      setForm(prev => ({
        ...prev,
        category: vaultSettings.categories.includes(prev.category) ? prev.category : (vaultSettings.categories[0] || '자료'),
        folder: vaultSettings.folders.includes(prev.folder) ? prev.folder : (vaultSettings.folders[0] || '자료'),
      }))
    }
    if (currentFolder && !vaultSettings.folders.includes(currentFolder)) {
      setCurrentFolder('')
      setFolderFilter('전체')
    }
  }, [vaultSettings.categories, vaultSettings.folders, currentFolder])

  useEffect(() => {
    api('/api/plan').then(setPlanInfo).catch(() => null)
    api('/api/profiles').then(data => setProfiles(data.items || [])).catch(() => null)
  }, [])

  useEffect(() => {
    setSelectedDownloads(current => current.filter(id => items.some(item => item.id === id)))
  }, [items])

  useEffect(() => () => {
    if (dragTouchTimerRef.current) window.clearTimeout(dragTouchTimerRef.current)
  }, [])

  function syncPlanInfoStorage(sizeBytes, mode = 'add') {
    setPlanInfo(prev => prev ? {
      ...prev,
      usage: {
        ...(prev.usage || {}),
        total_storage_bytes: Math.max(0, Number(prev.usage?.total_storage_bytes || 0) + (mode === 'remove' ? -Number(sizeBytes || 0) : Number(sizeBytes || 0))),
      },
    } : prev)
  }

  function openSettingsScreen(name) {
    setSettingsMenuOpen(false)
    setSettingsScreen(name)
  }

  function closeSettingsScreen() {
    setSettingsScreen('')
    setDraggingFolderName('')
  }

  function saveCategorySettings() {
    const categories = Array.from(new Set(draftCategories.map(item => String(item || '').trim()).filter(Boolean)))
    if (!categories.length) {
      window.alert('카테고리를 1개 이상 입력해주세요.')
      return
    }
    const next = normalizeVaultSettings({ ...vaultSettings, categories })
    setStoredSettings(next)
    setForm(prev => ({ ...prev, category: next.categories.includes(prev.category) ? prev.category : next.categories[0] }))
    closeSettingsScreen()
  }

  function saveLayoutSettings() {
    const folderNames = Array.from(new Set(draftLayout.folderSlots.map(item => String(item || '').trim()).filter(Boolean)))
    if (!folderNames.length) {
      window.alert('폴더를 1개 이상 배치해주세요.')
      return
    }
    const next = normalizeVaultSettings({
      ...vaultSettings,
      grid: draftLayout.grid,
      headerPosition: draftLayout.headerPosition,
      folders: folderNames,
      folderSlots: draftLayout.folderSlots,
    })
    setStoredSettings(next)
    setForm(prev => ({
      ...prev,
      folder: next.folders.includes(prev.folder) ? prev.folder : next.folders[0],
      category: next.categories.includes(prev.category) ? prev.category : next.categories[0],
    }))
    if (currentFolder && !next.folders.includes(currentFolder)) setCurrentFolder('')
    closeSettingsScreen()
  }

  function updateCategoryRow(index, value) {
    setDraftCategories(current => current.map((item, idx) => idx === index ? value : item))
  }
  function addCategoryRow() { setDraftCategories(current => [...current, '']) }
  function removeCategoryRow(index) { setDraftCategories(current => current.length <= 1 ? current : current.filter((_, idx) => idx !== index)) }

  function changeLayoutGrid(nextGrid) {
    setDraftLayout(current => {
      const nextFolders = current.folderSlots.filter(Boolean)
      return { ...current, grid: nextGrid, folderSlots: ensureFolderSlots(nextGrid, nextFolders, current.folderSlots) }
    })
  }

  function updateLayoutSlot(index, value) {
    const nextValue = String(value || '').trim()
    setDraftLayout(current => {
      const nextSlots = [...current.folderSlots]
      if (nextValue) {
        const duplicateIndex = nextSlots.findIndex((item, idx) => idx !== index && item === nextValue)
        if (duplicateIndex >= 0) nextSlots[duplicateIndex] = ''
      }
      nextSlots[index] = nextValue
      return { ...current, folderSlots: nextSlots }
    })
  }

  function startDragForIndex(index, isTouch = false) {
    const name = draftLayout.folderSlots[index]
    if (!name) return
    if (dragTouchTimerRef.current) window.clearTimeout(dragTouchTimerRef.current)
    if (isTouch) {
      dragTouchTimerRef.current = window.setTimeout(() => setDraggingFolderName(name), 220)
    } else {
      setDraggingFolderName(name)
    }
  }

  function clearDragState() {
    if (dragTouchTimerRef.current) {
      window.clearTimeout(dragTouchTimerRef.current)
      dragTouchTimerRef.current = null
    }
    setDraggingFolderName('')
  }

  function moveDraggedFolder(toIndex) {
    if (!draggingFolderName) return
    setDraftLayout(current => {
      const fromIndex = current.folderSlots.findIndex(item => item === draggingFolderName)
      if (fromIndex < 0 || fromIndex === toIndex) return current
      return { ...current, folderSlots: moveFolderSlot(current.folderSlots, fromIndex, toIndex) }
    })
  }

  function openFolder(name) {
    setCurrentFolder(name)
    setFolderFilter(name)
    setSelectedDownloads([])
    setForm(prev => ({ ...prev, folder: name, category: vaultSettings.categories.includes(name) ? name : prev.category }))
  }

  function closeFolderView() {
    setCurrentFolder('')
    setFolderFilter('전체')
    setSelectedDownloads([])
  }

  function toggleDownloadItem(id) {
    setSelectedDownloads(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function startEmptySlotCreate(index) {
    if (emptySlotAction.index !== index) {
      setEmptySlotAction({ index, mode: 'hint' })
      setNewFolderName('')
      return
    }
    if (emptySlotAction.mode === 'hint') {
      setEmptySlotAction({ index, mode: 'edit' })
      return
    }
  }

  function createFolderFromEmptySlot(index) {
    const name = String(newFolderName || '').trim()
    if (!name) {
      window.alert('폴더명을 입력해주세요.')
      return
    }
    if (vaultSettings.folders.includes(name)) {
      window.alert('이미 있는 폴더명입니다.')
      return
    }
    const nextSlots = [...vaultSettings.folderSlots]
    nextSlots[index] = name
    const next = normalizeVaultSettings({ ...vaultSettings, folders: [...vaultSettings.folders, name], folderSlots: nextSlots })
    setStoredSettings(next)
    setEmptySlotAction({ index: -1, mode: '' })
    setNewFolderName('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim() || !selectedFile) {
      window.alert('제목과 파일을 입력해주세요.')
      return
    }
    setUploading(true)
    try {
      const uploaded = await uploadFile(selectedFile, 'vault')
      const item = {
        id: makeLocalId('vault'),
        category: form.category,
        title: form.title.trim(),
        folder: (currentFolder || form.folder || vaultSettings.folders[0] || '자료').trim(),
        tags: splitTags(form.tags),
        favorite: Boolean(form.favorite),
        file_name: uploaded?.item?.name || selectedFile.name,
        file_url: uploaded?.item?.url || uploaded?.url || '',
        content_type: uploaded?.item?.content_type || selectedFile.type || '',
        size_bytes: uploaded?.item?.size_bytes || uploaded?.size || selectedFile.size || 0,
        created_at: new Date().toISOString(),
      }
      setItems(current => [item, ...current])
      syncPlanInfoStorage(item.size_bytes, 'add')
      setForm({ category: vaultSettings.categories[0] || '자료', title: '', folder: currentFolder || vaultSettings.folders[0] || '자료', tags: '', favorite: false })
      setSelectedFile(null)
      const input = document.getElementById('vault-file-input')
      if (input) input.value = ''
      if (folderFileInputRef.current) folderFileInputRef.current.value = ''
    } catch (err) {
      window.alert(err.message)
    } finally {
      setUploading(false)
    }
  }

  function removeItem(id) {
    const target = items.find(item => item.id === id)
    setItems(current => current.filter(item => item.id !== id))
    if (target) syncPlanInfoStorage(target.size_bytes, 'remove')
    setSelectedDownloads(current => current.filter(item => item !== id))
  }

  function downloadSelectedFiles() {
    const selectedItems = items.filter(item => selectedDownloads.includes(item.id) && item.file_url)
    if (!selectedItems.length) {
      window.alert('다운로드할 파일을 선택해주세요.')
      return
    }
    selectedItems.forEach(item => window.open(item.file_url, '_blank', 'noopener,noreferrer'))
  }

  const planStorageLimitBytes = Number(planInfo?.limits?.storage_limit_bytes || 1024 * 1024 * 1024)
  const usedBytes = items.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0)
  const usedRatio = Math.min(100, Math.round((usedBytes / Math.max(planStorageLimitBytes, 1)) * 100))
  const usedTone = usageToneClass(usedRatio)
  const totalLimitLabel = `${Math.round(planStorageLimitBytes / 1024 / 1024 / 1024)}GB`
  const dailyVideoLimitLabel = `${Math.round(Number(planInfo?.limits?.daily_video_limit_bytes || 100 * 1024 * 1024) / 1024 / 1024)}MB`
  const folderCount = vaultSettings.folders.length
  const visibleItems = items.filter(item => {
    const matchesFilter = filter === 'all' ? true : filter === 'favorite' ? item.favorite : item.category === filter
    const matchesFolder = folderFilter === '전체' ? true : item.folder === folderFilter
    return matchesFilter && matchesFolder
  })
  const currentFolderItems = items.filter(item => item.folder === currentFolder)
  const folderCards = vaultSettings.folderSlots.map((folder, index) => ({
    key: `${folder || 'empty'}-${index}`,
    index,
    name: folder,
    count: folder ? items.filter(item => item.folder === folder).length : 0,
  }))
  const gridClass = vaultSettings.grid === '5x5' ? 'vault-folder-grid five' : vaultSettings.grid === '4x4' ? 'vault-folder-grid four' : 'vault-folder-grid three'
  const previewGridClass = draftLayout.grid === '5x5' ? 'vault-folder-grid five vault-grid-preview' : draftLayout.grid === '4x4' ? 'vault-folder-grid four vault-grid-preview' : 'vault-folder-grid three vault-grid-preview'
  const profileUsage = profiles.map(profile => ({
    id: profile.id,
    name: profile.display_name || profile.title || `프로필 ${profile.id}`,
    usedBytes: estimateProfileUploadBytes(profile),
  }))
  const sharedBytes = Math.max(0, usedBytes - profileUsage.reduce((sum, item) => sum + item.usedBytes, 0))
  const searchResults = (() => {
    const q = searchWord.trim().toLowerCase()
    if (!q) return []
    const folderMatches = vaultSettings.folders
      .filter(name => name.toLowerCase().includes(q))
      .map(name => ({ id: `folder-${name}`, kind: '폴더', title: name, subtitle: `저장함 폴더 · 파일 ${items.filter(item => item.folder === name).length}개`, folder: name }))
    const fileMatches = items
      .filter(item => [item.title, item.file_name, item.folder, item.category, ...(item.tags || [])].join(' ').toLowerCase().includes(q))
      .map(item => ({ id: item.id, kind: '파일', title: item.title, subtitle: `${item.folder} · ${item.file_name || '첨부파일'} · ${bytesLabel(item.size_bytes)}`, item }))
    const merged = [...folderMatches, ...fileMatches]
    if (searchFilter === '폴더') return merged.filter(entry => entry.kind === '폴더')
    if (searchFilter === '파일') return merged.filter(entry => entry.kind === '파일')
    return merged
  })()

  const settingsMenu = (
    <div className="vault-settings-menu stack gap-8" ref={settingsLayerRef}>
      <button type="button" className="dropdown-item ghost" onClick={() => openSettingsScreen('categories')}>카테고리 편집</button>
      <button type="button" className="dropdown-item ghost" onClick={() => openSettingsScreen('layout')}>저장함 구조변경</button>
    </div>
  )

  const headerBlock = (
    <div className="card stack vault-header-card">
      <div className="split-row responsive-row vault-header-top">
        <div className="stack gap-4">
          <strong>저장함</strong>
          <div className="muted small-text">폴더형 레이아웃으로 자료를 정리하고, 계정 전체 저장용량 1GB 범위 안에서 멀티프로필과 함께 관리합니다.</div>
        </div>
        <div className="action-wrap">
          <button type="button" className="icon-button ghost" onClick={() => setSearchOpen(true)} aria-label="저장함 검색" title="저장함 검색">
            <IconGlyph name="search" label="저장함 검색" />
          </button>
          <div className="popup-anchor-group popup-anchor-group-right vault-settings-anchor" ref={settingsAnchorRef}>
            <button type="button" className="icon-button ghost" onClick={() => setSettingsMenuOpen(current => !current)} aria-label="저장함 설정" title="저장함 설정">
              <IconGlyph name="settings" label="저장함 설정" />
            </button>
            {settingsMenuOpen ? settingsMenu : null}
          </div>
        </div>
      </div>

      <div className="vault-summary-grid">
        <div className="vault-progress-card stack gap-8">
          <button type="button" className="ghost vault-summary-toggle" onClick={() => setUsageOpen(false)}>
            <span>계정 저장용량</span>
            <span className="mini-stat">{bytesLabel(usedBytes)} / {totalLimitLabel}</span>
          </button>
          <div className={`vault-progress-track ${usedTone}`}><span style={{ width: `${usedRatio}%` }} /></div>
          <div className="muted small-text">일일 업로드 한도 {dailyVideoLimitLabel}</div>
        </div>
        <div className="vault-progress-card stack gap-8">
          <button type="button" className="ghost vault-summary-toggle" onClick={() => setUsageOpen(current => !current)}>
            <span>멀티프로필 포함 계정용량 현황</span>
            <span className="mini-stat">전체 {bytesLabel(usedBytes)} · {usageOpen ? '접기' : '열기'}</span>
          </button>
          {usageOpen ? (
            <div className="stack compact-list vault-usage-list">
              {profileUsage.map(item => (
                <div key={item.id} className="mini-card split-row responsive-row">
                  <strong>{item.name}</strong>
                  <span className="muted small-text">{bytesLabel(item.usedBytes)}</span>
                </div>
              ))}
              <div className="mini-card split-row responsive-row">
                <strong>공용 저장함 / 미연결 자료</strong>
                <span className="muted small-text">{bytesLabel(sharedBytes)}</span>
              </div>
            </div>
          ) : (
            <div className="muted small-text">멀티프로필별 사용용량은 접힌 상태입니다. 버튼을 누르면 세부 현황이 표시됩니다.</div>
          )}
        </div>
      </div>

      <div className="mini-stats">
        <span className="mini-stat">자료 {items.length}</span>
        <span className="mini-stat">폴더 {folderCount}</span>
        <span className="mini-stat">즐겨찾기 {items.filter(item => item.favorite).length}</span>
      </div>

      <div className={gridClass}>
        {folderCards.map(folder => folder.name ? (
          <button key={folder.key} type="button" className={currentFolder === folder.name ? 'vault-folder-tile active' : 'vault-folder-tile'} onClick={() => openFolder(folder.name)}>
            <span className="vault-folder-icon"><IconGlyph name="folder" label={folder.name} /></span>
            <strong className="vault-folder-name">{folder.name}</strong>
            <span className="vault-folder-count">{folder.count}개</span>
          </button>
        ) : (
          <button key={folder.key} type="button" className={emptySlotAction.index === folder.index ? 'vault-folder-tile empty active empty-action' : 'vault-folder-tile empty'} onClick={() => startEmptySlotCreate(folder.index)}>
            <span className="vault-folder-icon"><IconGlyph name="folder" label="빈칸" /></span>
            {emptySlotAction.index === folder.index && emptySlotAction.mode === 'edit' ? (
              <span className="stack gap-8 full-width" onClick={e => e.stopPropagation()}>
                <strong className="vault-folder-name">추가생성</strong>
                <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="폴더명 입력" />
                <button type="button" className="ghost small-button" onClick={e => { e.stopPropagation(); createFolderFromEmptySlot(folder.index) }}>생성</button>
              </span>
            ) : (
              <>
                <strong className="vault-folder-name">{emptySlotAction.index === folder.index ? '추가생성' : '빈칸'}</strong>
                <span className="vault-folder-count">{emptySlotAction.index === folder.index ? '한 번 더 누르면 이름 입력' : '배치 가능'}</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div className="tab-row responsive-row wrap-row vault-filter-row">
        {['all', 'favorite', ...vaultSettings.categories].map(name => <button key={name} type="button" className={filter === name ? 'tab active' : 'tab'} onClick={() => setFilter(name)}>{name === 'all' ? '전체' : name === 'favorite' ? '즐겨찾기' : name}</button>)}
        <button type="button" className={folderFilter === '전체' ? 'tab active subtle' : 'tab subtle'} onClick={() => { setFolderFilter('전체'); setCurrentFolder('') }}>폴더 전체</button>
      </div>
    </div>
  )

  return (
    <section className="page-stack">
      {vaultSettings.headerPosition === 'top' ? headerBlock : null}

      {currentFolder ? (
        <div className="card stack vault-folder-detail-card">
          <div className="split-row responsive-row">
            <div className="stack gap-4">
              <div className="small-text muted">선택 폴더</div>
              <strong>{currentFolder}</strong>
              <div className="muted small-text">이 폴더 안에서 바로 파일을 첨부하고, 선택한 파일을 다운로드할 수 있습니다.</div>
            </div>
            <div className="action-wrap">
              <button type="button" className="ghost" onClick={() => folderFileInputRef.current?.click()}>파일첨부</button>
              <button type="button" onClick={downloadSelectedFiles}>다운로드</button>
            </div>
          </div>
          <input ref={folderFileInputRef} id="vault-file-input" type="file" onChange={e => { setSelectedFile(e.target.files?.[0] || null); setForm(prev => ({ ...prev, folder: currentFolder })) }} />
          {selectedFile ? <div className="mini-card">선택 파일: <strong>{selectedFile.name}</strong> · {bytesLabel(selectedFile.size)}</div> : null}
          <div className="stack vault-list compact-list">
            {currentFolderItems.length ? currentFolderItems.map(item => (
              <label key={item.id} className="vault-item vault-item-selectable">
                <div className="split-row responsive-row">
                  <span className="stack gap-4">
                    <strong>{item.title}</strong>
                    <span className="muted small-text">{item.file_name || '첨부파일'} · {bytesLabel(item.size_bytes)}</span>
                  </span>
                  <span className="action-wrap">
                    <input type="checkbox" checked={selectedDownloads.includes(item.id)} onChange={() => toggleDownloadItem(item.id)} />
                    <button type="button" className="ghost" onClick={() => removeItem(item.id)}>삭제</button>
                  </span>
                </div>
              </label>
            )) : <div className="muted">이 폴더에는 아직 파일이 없습니다.</div>}
          </div>
          <div className="action-wrap">
            <button type="button" className="ghost" onClick={closeFolderView}>폴더 목록으로</button>
          </div>
        </div>
      ) : null}

      <div className="card stack">
        <form className="stack" onSubmit={handleSubmit}>
          <div className="grid-2">
            <select value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}>
              {vaultSettings.categories.map(name => <option key={name}>{name}</option>)}
            </select>
            <select value={currentFolder || form.folder} onChange={e => setForm(prev => ({ ...prev, folder: e.target.value }))} disabled={Boolean(currentFolder)}>
              {vaultSettings.folders.map(name => <option key={name}>{name}</option>)}
            </select>
          </div>
          <input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="자료 제목" />
          <input value={form.tags} onChange={e => setForm(prev => ({ ...prev, tags: e.target.value }))} placeholder="태그를 쉼표로 구분해 입력" />
          <label className="inline-check"><input type="checkbox" checked={form.favorite} onChange={e => setForm(prev => ({ ...prev, favorite: e.target.checked }))} /><span>즐겨찾기 등록</span></label>
          {!currentFolder ? <input id="vault-file-input" type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)} /> : null}
          <div className="split-row responsive-row">
            <div className="muted small-text">일반 파일과 문서도 업로드할 수 있으며, 멀티프로필을 포함한 로그인 계정 전체 저장용량 1GB를 함께 사용합니다.</div>
            <button type="submit" disabled={uploading}>{uploading ? '업로드 중...' : '저장하기'}</button>
          </div>
        </form>
      </div>

      {vaultSettings.headerPosition === 'bottom' ? headerBlock : null}

      <div className="card stack">
        <div className="stack vault-list">
          {visibleItems.length ? visibleItems.map(item => (
            <article key={item.id} className="vault-item">
              <div className="split-row responsive-row">
                <div className="stack gap-4">
                  <strong>{item.title}</strong>
                  <div className="muted small-text">{item.category} · 폴더 {item.folder} · {bytesLabel(item.size_bytes)}</div>
                  <div className="tag-row">{item.tags.map(tag => <span key={`${item.id}-${tag}`} className="mini-stat">#{tag}</span>)}</div>
                </div>
                <div className="action-wrap">
                  {item.favorite ? <span className="mini-stat favorite">즐겨찾기</span> : null}
                  {item.file_url ? <a className="button-link" href={item.file_url} target="_blank" rel="noreferrer">열기</a> : null}
                  <button type="button" className="ghost" onClick={() => removeItem(item.id)}>삭제</button>
                </div>
              </div>
            </article>
          )) : <div className="muted">표시할 저장 자료가 없습니다.</div>}
        </div>
      </div>

      {searchOpen ? (
        <ModalFrame title="저장함 검색" onClose={() => setSearchOpen(false)} className="full-screen-modal">
          <div className="stack gap-12">
            <div className="split-row responsive-row">
              <div className="stack gap-4 full-width">
                <input value={searchWord} onChange={e => setSearchWord(e.target.value)} placeholder="폴더명 또는 파일명을 입력" />
                <div className="muted small-text">저장함 안에 있는 폴더 및 파일을 검색합니다.</div>
              </div>
              <div className="stack gap-6 vault-search-filter-box">
                <strong className="small-text">필터</strong>
                <label className="inline-check"><input type="radio" name="vault-search-filter" checked={searchFilter === '전체'} onChange={() => setSearchFilter('전체')} /><span>전체</span></label>
                <label className="inline-check"><input type="radio" name="vault-search-filter" checked={searchFilter === '폴더'} onChange={() => setSearchFilter('폴더')} /><span>폴더</span></label>
                <label className="inline-check"><input type="radio" name="vault-search-filter" checked={searchFilter === '파일'} onChange={() => setSearchFilter('파일')} /><span>파일</span></label>
              </div>
            </div>
            <div className="stack compact-list">
              {searchWord.trim() ? searchResults.length ? searchResults.map(result => (
                <button key={result.id} type="button" className="ghost vault-search-result" onClick={() => {
                  if (result.kind === '폴더') openFolder(result.title)
                  if (result.kind === '파일') {
                    setFolderFilter(result.item.folder)
                    setCurrentFolder('')
                  }
                  setSearchOpen(false)
                }}>
                  <div className="split-row responsive-row">
                    <strong>{result.title}</strong>
                    <span className="mini-stat">{result.kind}</span>
                  </div>
                  <div className="muted small-text">{result.subtitle}</div>
                </button>
              )) : <div className="muted">검색 결과가 없습니다.</div> : <div className="muted">검색어를 입력하면 폴더와 파일을 함께 찾을 수 있습니다.</div>}
            </div>
          </div>
        </ModalFrame>
      ) : null}

      {settingsScreen === 'categories' ? (
        <ModalFrame title="카테고리 편집" onClose={closeSettingsScreen} className="full-screen-modal">
          <div className="stack">
            <div className="muted small-text">추가 버튼을 눌러 카테고리 칸을 늘리고, 각 칸을 눌러 이름을 수정할 수 있습니다.</div>
            <div className="stack compact-list">
              {draftCategories.map((item, index) => (
                <div key={`category-${index}`} className="vault-setting-row">
                  <input value={item} onChange={e => updateCategoryRow(index, e.target.value)} placeholder={`카테고리 ${index + 1}`} />
                  <button type="button" className="ghost" onClick={() => removeCategoryRow(index)}>삭제</button>
                </div>
              ))}
            </div>
            <div className="action-wrap">
              <button type="button" className="ghost" onClick={addCategoryRow}>추가</button>
              <button type="button" onClick={saveCategorySettings}>저장</button>
            </div>
          </div>
        </ModalFrame>
      ) : null}

      {settingsScreen === 'layout' ? (
        <ModalFrame title="저장함 구조변경" onClose={closeSettingsScreen} className="full-screen-modal">
          <div className="stack">
            <div className="grid-2">
              <div className="stack">
                <label>상단 폴더 아이콘 구조</label>
                <select value={draftLayout.grid} onChange={e => changeLayoutGrid(e.target.value)}>
                  <option value="3x3">3x3</option>
                  <option value="4x4">4x4</option>
                  <option value="5x5">5x5</option>
                </select>
              </div>
              <div className="stack">
                <label>상단/하단 배치</label>
                <select value={draftLayout.headerPosition} onChange={e => setDraftLayout(prev => ({ ...prev, headerPosition: e.target.value }))}>
                  <option value="top">상단 먼저</option>
                  <option value="bottom">업로드 입력창 아래</option>
                </select>
              </div>
            </div>
            <div className="stack gap-8">
              <strong>미리보기</strong>
              <div className={previewGridClass}>
                {draftLayout.folderSlots.map((folder, index) => (
                  <div
                    key={`slot-${index}`}
                    className={draggingFolderName === folder && folder ? 'vault-folder-tile vault-preview-tile dragging' : 'vault-folder-tile vault-preview-tile'}
                    draggable={Boolean(folder)}
                    onDragStart={() => setDraggingFolderName(folder || '')}
                    onDragOver={e => { if (draggingFolderName) e.preventDefault() }}
                    onDrop={e => { e.preventDefault(); moveDraggedFolder(index); clearDragState() }}
                    onDragEnd={clearDragState}
                    onPointerDown={e => startDragForIndex(index, e.pointerType === 'touch')}
                    onPointerEnter={() => { if (draggingFolderName) moveDraggedFolder(index) }}
                    onPointerUp={clearDragState}
                    onPointerCancel={clearDragState}
                  >
                    <span className="vault-folder-icon"><IconGlyph name="folder" label={folder || '빈칸'} /></span>
                    <strong className="vault-folder-name">{folder || '빈칸'}</strong>
                    <span className="muted small-text">{folder ? '끌어서 이동' : '배치 가능'}</span>
                  </div>
                ))}
              </div>
              <div className="muted small-text">PC에서는 마우스로 끌어 이동하고, 모바일에서는 폴더를 길게 눌러 잡은 뒤 원하는 위치로 옮긴 후 손을 떼면 순서가 바뀝니다.</div>
            </div>
            <div className="stack compact-list">
              <strong>텍스트 위치 지정</strong>
              <div className="vault-slot-list">
                {draftLayout.folderSlots.map((folder, index) => (
                  <div key={`slot-input-${index}`} className="vault-setting-row">
                    <span className="mini-stat">{index + 1}</span>
                    <input value={folder} onChange={e => updateLayoutSlot(index, e.target.value)} placeholder={`슬롯 ${index + 1}`} />
                  </div>
                ))}
              </div>
            </div>
            <div className="action-wrap">
              <button type="button" className="ghost" onClick={closeSettingsScreen}>닫기</button>
              <button type="button" onClick={saveLayoutSettings}>저장</button>
            </div>
          </div>
        </ModalFrame>
      ) : null}
    </section>
  )
}


function IntroductionsManagerPage() {
  const [items, setItems] = useLocalCollection(LOCAL_STORAGE_KEYS.introManager, [])
  const [history, setHistory] = useLocalCollection(LOCAL_STORAGE_KEYS.introHistory, [])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState({ company: '', job: '', question: '', answer: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sortBy, setSortBy] = useState('최신등록')
  const settingsAnchorRef = useRef(null)
  const settingsLayerRef = useDismissLayer(settingsOpen, () => setSettingsOpen(false))

  useEffect(() => {
    const selected = items.find(item => item.id === selectedId)
    if (selected) setForm({ company: selected.company, job: selected.job, question: selected.question, answer: selected.answer })
  }, [selectedId])

  function saveSet(e) {
    e.preventDefault()
    if (!form.company.trim() || !form.job.trim() || !form.question.trim()) { window.alert('회사, 직무, 문항을 입력해주세요.'); return }
    const existing = items.find(item => item.id === selectedId)
    const createdAt = existing?.created_at || new Date().toISOString()
    const payload = {
      id: selectedId || makeLocalId('intro'),
      ...form,
      alias: existing?.alias || '',
      favorite: Boolean(existing?.favorite),
      created_at: createdAt,
      updated_at: new Date().toISOString(),
    }
    setItems(current => {
      const next = current.some(item => item.id === payload.id) ? current.map(item => item.id === payload.id ? payload : item) : [payload, ...current]
      return next
    })
    setHistory(current => [{ ...payload, history_id: makeLocalId('history') }, ...current].slice(0, 30))
    setSelectedId(payload.id)
  }

  function toggleFavorite(itemId) {
    setItems(current => current.map(item => item.id === itemId ? { ...item, favorite: !item.favorite } : item))
  }

  function editAlias() {
    if (!selectedId) {
      window.alert('별칭을 입력할 파일을 먼저 선택해주세요.')
      return
    }
    const currentItem = items.find(item => item.id === selectedId)
    const alias = window.prompt('파일별 별칭을 입력해주세요.', currentItem?.alias || '')
    if (alias === null) return
    setItems(current => current.map(item => item.id === selectedId ? { ...item, alias: alias.trim() } : item))
    setSettingsOpen(false)
  }

  const selected = items.find(item => item.id === selectedId)
  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === '즐겨찾기') return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0)
    if (sortBy === '등록일') return new Date(a.created_at || a.updated_at || 0) - new Date(b.created_at || b.updated_at || 0)
    if (sortBy === '파일명') return `${a.company} ${a.job} ${a.question}`.localeCompare(`${b.company} ${b.job} ${b.question}`, 'ko')
    if (sortBy === '별칭') return String(a.alias || '').localeCompare(String(b.alias || ''), 'ko')
    if (sortBy === '폴더') return String(a.job || '').localeCompare(String(b.job || ''), 'ko')
    return new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0)
  })

  const settingsMenu = (
    <div className="vault-settings-menu stack gap-8" ref={settingsLayerRef}>
      <button type="button" className="dropdown-item ghost" onClick={editAlias}>파일별 별칭입력</button>
    </div>
  )

  return (
    <section className="page-stack">
      <div className="card stack">
        <div className="split-row responsive-row intro-manager-head">
          <div className="stack gap-4">
            <strong>자기소개서관리</strong>
            <div className="muted small-text">등록한 자기소개서 파일을 목록으로 관리하고, 즐겨찾기/별칭/정렬 기준으로 빠르게 찾을 수 있습니다.</div>
          </div>
          <div className="action-wrap intro-manager-toolbar">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="intro-sort-select" aria-label="정렬 기준">
              <option>즐겨찾기</option><option>등록일</option><option>파일명</option><option>별칭</option><option>최신등록</option><option>폴더</option>
            </select>
            <div className="popup-anchor-group popup-anchor-group-right vault-settings-anchor" ref={settingsAnchorRef}>
              <button type="button" className="icon-button ghost" onClick={() => setSettingsOpen(current => !current)} aria-label="자기소개서관리 설정" title="자기소개서관리 설정">
                <IconGlyph name="settings" label="자기소개서관리 설정" />
              </button>
              {settingsOpen ? settingsMenu : null}
            </div>
          </div>
        </div>
        <div className="stack compact-list intro-file-table">
          {sortedItems.length ? sortedItems.map(item => (
            <button key={item.id} type="button" className={selectedId === item.id ? 'ghost intro-file-row active' : 'ghost intro-file-row'} onClick={() => setSelectedId(item.id)}>
              <span className={item.favorite ? 'intro-favorite active' : 'intro-favorite'} onClick={e => { e.stopPropagation(); toggleFavorite(item.id) }}>{item.favorite ? '★' : '☆'}</span>
              <span className="intro-date">[{formatShortDate(item.created_at || item.updated_at)}]</span>
              <span className="intro-filename">[{item.company}{item.job ? ` ${item.job}` : ''} 자기소개서]</span>
              <span className="intro-alias">[{item.alias || '-'}]</span>
            </button>
          )) : <div className="muted">등록된 자기소개서 파일이 없습니다.</div>}
        </div>
      </div>

      <div className="card stack">
        <div className="muted small-text">회사/직무별 자기소개서 문항 세트를 저장하고, 다른 버전과 비교하거나 이전 버전으로 복원할 수 있습니다.</div>
        <form className="stack" onSubmit={saveSet}>
          <div className="grid-2">
            <input value={form.company} onChange={e => setForm(prev => ({ ...prev, company: e.target.value }))} placeholder="회사명" />
            <input value={form.job} onChange={e => setForm(prev => ({ ...prev, job: e.target.value }))} placeholder="직무명" />
          </div>
          <input value={form.question} onChange={e => setForm(prev => ({ ...prev, question: e.target.value }))} placeholder="문항" />
          <textarea value={form.answer} onChange={e => setForm(prev => ({ ...prev, answer: e.target.value }))} placeholder="답변" rows={8} />
          <div className="action-wrap">
            <button type="submit">저장</button>
            <button type="button" className="ghost" onClick={() => { setSelectedId(''); setForm({ company: '', job: '', question: '', answer: '' }) }}>새로 작성</button>
          </div>
        </form>
      </div>

      <div className="grid-2">
        <div className="card stack">
          <strong>문항 세트 목록</strong>
          <div className="stack compact-list">
            {sortedItems.length ? sortedItems.map(item => (
              <button key={item.id} type="button" className={selectedId === item.id ? 'ghost intro-list-item active' : 'ghost intro-list-item'} onClick={() => setSelectedId(item.id)}>
                <strong>{item.company} · {item.job}</strong>
                <span className="muted small-text">{item.question}</span>
              </button>
            )) : <div className="muted">저장된 세트가 없습니다.</div>}
          </div>
        </div>
        <div className="card stack">
          <strong>비교 / 복원</strong>
          {selected ? <div className="stack gap-8"><div className="muted small-text">선택 문항 최신본</div><div className="pre-wrap bordered-box">{selected.answer || '답변이 없습니다.'}</div></div> : <div className="muted">문항을 선택하면 최신본을 볼 수 있습니다.</div>}
          <div className="stack compact-list">
            {history.filter(item => !selected || (item.company === selected.company && item.job === selected.job && item.question === selected.question)).slice(0, 5).map(item => (
              <article key={item.history_id} className="mini-card stack">
                <strong>{item.company} · {item.job}</strong>
                <div className="muted small-text">{formatDateLabel(item.updated_at)}</div>
                <div className="pre-wrap small-text">{item.answer || '답변 없음'}</div>
                <button type="button" className="ghost" onClick={() => { setSelectedId(item.id); setForm({ company: item.company, job: item.job, question: item.question, answer: item.answer }) }}>이 버전 복원</button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}


function ShareLinksManagerPage() {
  const [profiles, setProfiles] = useState([])
  const [items, setItems] = useLocalCollection(LOCAL_STORAGE_KEYS.shareLinks, [])
  const [categoryStore, setCategoryStore] = useLocalCollection(LOCAL_STORAGE_KEYS.shareLinkCategories, [...DEFAULT_SHARE_LINK_CATEGORIES])
  const categories = normalizeShareLinkCategories(categoryStore)
  const [form, setForm] = useState({ title: '', type: '선택', url: '', visibility: '링크 전용' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mode, setMode] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [draftCategories, setDraftCategories] = useState(categories)
  const settingsAnchorRef = useRef(null)
  const settingsLayerRef = useDismissLayer(settingsOpen, () => setSettingsOpen(false))

  useEffect(() => { api('/api/profiles').then(data => setProfiles(data.items || [])).catch(() => null) }, [])
  useEffect(() => { setDraftCategories(categories) }, [JSON.stringify(categories)])
  const activeId = getStoredActiveProfileId()
  const profile = profiles.find(item => Number(item.id) === Number(activeId)) || profiles[0] || null

  function resetForm() {
    setForm({ title: '', type: '선택', url: '', visibility: '링크 전용' })
    setSelectedId('')
    setMode('')
  }

  function openMode(nextMode) {
    setSettingsOpen(false)
    setMode(nextMode)
    if (nextMode === 'categories') setDraftCategories(categories)
    if (nextMode === 'add') resetForm()
    if ((nextMode === 'edit' || nextMode === 'delete') && !selectedId && items[0]) setSelectedId(items[0].id)
  }

  function saveLink(e) {
    e.preventDefault()
    if (!form.title.trim() || !String(form.url || '').trim()) {
      window.alert('링크별칭과 링크주소를 입력해주세요.')
      return
    }
    const entry = {
      id: selectedId || makeLocalId('share'),
      title: form.title.trim(),
      type: form.type === '선택' ? '선택요망' : form.type,
      visibility: form.visibility,
      url: form.url.trim(),
      profile_slug: profile?.slug || '',
      profile_name: profile?.display_name || profile?.title || '',
      created_at: selectedId ? (items.find(item => item.id === selectedId)?.created_at || new Date().toISOString()) : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setItems(current => current.some(item => item.id === entry.id) ? current.map(item => item.id === entry.id ? entry : item) : [entry, ...current])
    resetForm()
  }

  function editSelected() {
    const selected = items.find(item => item.id === selectedId)
    if (!selected) { window.alert('편집할 목록을 선택해주세요.'); return }
    setForm({ title: selected.title || '', type: categories.includes(selected.type) ? selected.type : '선택', url: selected.url || '', visibility: selected.visibility || '링크 전용' })
    setMode('edit')
  }

  function deleteSelected() {
    if (!selectedId) { window.alert('삭제할 목록을 선택해주세요.'); return }
    setItems(current => current.filter(item => item.id !== selectedId))
    resetForm()
  }

  function saveCategories() {
    const next = Array.from(new Set(draftCategories.map(item => String(item || '').trim()).filter(Boolean)))
    if (!next.length) { window.alert('구분 카테고리를 1개 이상 입력해주세요.'); return }
    setCategoryStore(next)
    setMode('')
  }

  const settingsMenu = (
    <div className="vault-settings-menu stack gap-8" ref={settingsLayerRef}>
      <button type="button" className="dropdown-item ghost" onClick={() => openMode('add')}>목록추가</button>
      <button type="button" className="dropdown-item ghost" onClick={() => openMode('edit')}>목록편집</button>
      <button type="button" className="dropdown-item ghost" onClick={() => openMode('delete')}>목록삭제</button>
      <button type="button" className="dropdown-item ghost" onClick={() => openMode('categories')}>구분설정</button>
    </div>
  )

  return (
    <section className="page-stack">
      <div className="card stack">
        <div className="split-row responsive-row">
          <div className="stack gap-4">
            <strong>저장링크관리목록</strong>
            <div className="muted small-text">링크구분, 링크별칭, 링크주소를 한 화면에서 관리하고 필요한 링크를 바로 복사할 수 있습니다.</div>
          </div>
          <div className="popup-anchor-group popup-anchor-group-right vault-settings-anchor" ref={settingsAnchorRef}>
            <button type="button" className="icon-button ghost" onClick={() => setSettingsOpen(current => !current)} aria-label="링크공유관리 설정" title="링크공유관리 설정">
              <IconGlyph name="settings" label="링크공유관리 설정" />
            </button>
            {settingsOpen ? settingsMenu : null}
          </div>
        </div>

        <div className="stack compact-list link-table">
          <div className="link-table-head">
            <span>링크구분</span>
            <span>링크별칭</span>
            <span>링크주소복사</span>
          </div>
          {items.length ? items.map(item => (
            <button key={item.id} type="button" className={selectedId === item.id ? 'ghost link-table-row active' : 'ghost link-table-row'} onClick={() => setSelectedId(item.id)}>
              <span className="link-type-chip">{item.type || '선택요망'}</span>
              <span className="link-title-text">{item.title || '-'}</span>
              <span className="action-wrap justify-end">
                <button type="button" className="ghost small-button" onClick={e => { e.stopPropagation(); copyToClipboard(item.url) }}>링크주소복사</button>
              </span>
            </button>
          )) : <div className="muted">등록된 링크가 없습니다.</div>}
        </div>
      </div>

      {mode === 'add' || mode === 'edit' ? (
        <div className="card stack">
          <strong>{mode === 'add' ? '목록추가' : '목록편집'}</strong>
          <form className="stack" onSubmit={saveLink}>
            <div className="grid-2">
              <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}>
                <option>선택</option>
                {categories.map(item => <option key={item}>{item}</option>)}
              </select>
              <input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="링크별칭" />
            </div>
            <input value={form.url} onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))} placeholder="링크주소" />
            <select value={form.visibility} onChange={e => setForm(prev => ({ ...prev, visibility: e.target.value }))}><option>링크 전용</option><option>검색 노출</option><option>비공개</option></select>
            <div className="muted small-text">현재 선택 프로필: {profile ? (profile.display_name || profile.title) : '프로필 없음'}</div>
            <div className="action-wrap">
              {mode === 'edit' ? <button type="button" className="ghost" onClick={editSelected}>선택 목록 불러오기</button> : null}
              <button type="submit">저장</button>
              <button type="button" className="ghost" onClick={resetForm}>닫기</button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === 'delete' ? (
        <div className="card stack">
          <strong>목록삭제</strong>
          <div className="muted small-text">삭제할 링크 목록을 선택한 뒤 아래 버튼을 눌러 삭제합니다.</div>
          <div className="action-wrap">
            <button type="button" className="ghost" onClick={() => setMode('')}>닫기</button>
            <button type="button" onClick={deleteSelected}>선택 목록 삭제</button>
          </div>
        </div>
      ) : null}

      {mode === 'categories' ? (
        <div className="card stack">
          <strong>구분설정</strong>
          <div className="muted small-text">기본 구분은 소개, 채용, 영업, 기타이며 필요에 따라 추가/수정/삭제할 수 있습니다.</div>
          <div className="stack compact-list">
            {draftCategories.map((item, index) => (
              <div key={`share-category-${index}`} className="vault-setting-row">
                <input value={item} onChange={e => setDraftCategories(current => current.map((entry, idx) => idx === index ? e.target.value : entry))} placeholder={`구분 ${index + 1}`} />
                <button type="button" className="ghost" onClick={() => setDraftCategories(current => current.length <= 1 ? current : current.filter((_, idx) => idx !== index))}>삭제</button>
              </div>
            ))}
          </div>
          <div className="action-wrap">
            <button type="button" className="ghost" onClick={() => setDraftCategories(current => [...current, ''])}>목록추가</button>
            <button type="button" onClick={saveCategories}>저장</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}



function MvpSuccessPage() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const activeProfileId = getStoredActiveProfileId()
  const links = readLocalItems(LOCAL_STORAGE_KEYS.shareLinks, [])
  const introItems = readLocalItems(LOCAL_STORAGE_KEYS.introManager, [])
  const vaultItems = readLocalItems(LOCAL_STORAGE_KEYS.vault, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        const data = await api('/api/profiles')
        if (!alive) return
        setProfiles(data.items || [])
        setError('')
      } catch (err) {
        if (!alive) return
        setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const selected = profiles.find(item => Number(item.id) === Number(activeProfileId)) || profiles[0] || null
  const selectedLinkCount = selected ? links.filter(item => Number(item.profile_id || 0) === Number(selected.id)).length : links.length
  const selectedVaultCount = vaultItems.length
  const selectedAnalytics = selected ? getProfileLocalAnalyticsSummary(selected) : { visits: 0, linkClicks: 0, qrClicks: 0, ctaClicks: 0, leads: 0 }
  const publicUrl = selected?.slug ? getPublicProfileUrl(selected.slug) : ''
  const readiness = [
    Boolean(selected?.display_name || selected?.title),
    Boolean(selected?.slug),
    selectedLinkCount > 0,
    Boolean(selected?.qrs?.length),
    Boolean(selected?.introductions?.length || introItems.length),
    Boolean(selected?.careers?.length),
    selectedVaultCount > 0,
  ].filter(Boolean).length
  const readinessPercent = Math.round((readiness / 7) * 100)

  const steps = [
    {
      stage: '1단계',
      title: '정리 MVP',
      subtitle: '프로필 허브 + QR + 링크',
      desc: '광고와 실제 전환에 직결되는 가장 중요한 최소 기능입니다.',
      rows: [
        { label: '통합 허브', value: selected ? '준비됨' : '프로필 생성 필요', to: '/profile?tab=hub' },
        { label: '프로필', value: selected?.display_name || selected?.title || '미등록', to: '/profile?tab=profile' },
        { label: '공개 URL', value: selected?.slug ? `/${selected.slug}` : '슬러그 미등록', to: '/profile?tab=profile' },
        { label: 'QR 공유', value: `${selected?.qrs?.length || 0}개`, to: '/profile?tab=qr' },
        { label: '링크 자산', value: `${selected?.links?.length || selectedLinkCount || 0}개`, to: '/profile?tab=link' },
      ],
    },
    {
      stage: '2단계',
      title: '신뢰 자산 MVP',
      subtitle: '소개서 + 경력 + 자료 저장',
      desc: '상대방이 이 사람을 믿고 연락할 수 있게 만드는 증빙 레이어입니다.',
      rows: [
        { label: '소개서', value: `${selected?.introductions?.length || introItems.length || 0}개`, to: '/profile?tab=intro' },
        { label: '경력', value: `${selected?.careers?.length || 0}개`, to: '/profile?tab=career' },
        { label: '자료/저장소', value: `${selectedVaultCount}개`, to: '/vault' },
        { label: '공개 프로필', value: publicUrl ? '열기 가능' : 'URL 준비 필요', to: publicUrl || '/profile?tab=profile', external: Boolean(publicUrl) },
      ],
    },
    {
      stage: '3단계',
      title: '성장 MVP',
      subtitle: '분석 + 채팅 + 커뮤니티',
      desc: '정리된 프로필이 실제로 연결과 재방문을 만드는지 확인하는 단계입니다.',
      rows: [
        { label: '방문', value: `${selectedAnalytics.visits || 0}`, to: '/workspace' },
        { label: '링크 클릭', value: `${selectedAnalytics.linkClicks || 0}`, to: '/workspace' },
        { label: 'QR 클릭', value: `${selectedAnalytics.qrClicks || 0}`, to: '/workspace' },
        { label: '채팅', value: '연결 채널', to: '/chats' },
        { label: '커뮤니티', value: '재방문 채널', to: '/community' },
      ],
    },
  ]

  return (
    <section className="page-stack">
      <div className="card stack mvp-hero-card">
        <div className="split-row responsive-row">
          <div className="stack gap-8">
            <strong>MVP 성공 구조</strong>
            <div className="muted small-text">정리 → 공유 → 연결 → 소통 → 재방문 흐름에 맞춰 지금 앱에 이미 있는 기능을 실제 사업형 우선순위로 다시 묶었습니다.</div>
          </div>
          <div className="chip-row wrap-row">
            <span className="chip accent-chip">준비도 {readinessPercent}%</span>
            <span className="chip light-chip">프로필 {profiles.length}개</span>
          </div>
        </div>
        <div className="grid-4">
          <Metric label="공개 URL" value={selected?.slug ? '완료' : '미완료'} />
          <Metric label="링크" value={selected?.links?.length || selectedLinkCount || 0} />
          <Metric label="QR" value={selected?.qrs?.length || 0} />
          <Metric label="자료" value={selectedVaultCount} />
        </div>
        {loading ? <div className="muted">프로필을 불러오는 중...</div> : null}
        {error ? <div className="error card">{error}</div> : null}
      </div>

      <div className="mvp-stage-grid">
        {steps.map(step => (
          <section key={step.stage} className="card stack mvp-stage-card">
            <div className="stack gap-6">
              <span className="chip light-chip">{step.stage}</span>
              <h3>{step.title}</h3>
              <div className="muted small-text">{step.subtitle}</div>
              <div className="muted small-text">{step.desc}</div>
            </div>
            <div className="stack compact-list">
              {step.rows.map(row => (
                <div key={`${step.stage}-${row.label}`} className="mvp-row-card">
                  <div className="mvp-row-copy">
                    <strong>{row.label}</strong>
                    <span className="muted small-text">{row.value}</span>
                  </div>
                  {row.external ? (
                    <a className="button-link" href={row.to} target="_blank" rel="noreferrer">열기</a>
                  ) : (
                    <Link className="button-link" to={row.to}>이동</Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="card stack">
        <div className="split-row responsive-row">
          <div>
            <strong>운영 판단</strong>
            <div className="muted small-text">저장소·커뮤니티·채팅을 먼저 키우는 구조가 아니라, 먼저 상대방이 보고 바로 이해되는 프로필/공유 흐름을 완성하는 설계입니다.</div>
          </div>
          <Link className="button-link" to="/workspace">운영 수치 보기</Link>
        </div>
        <div className="grid-3">
          <div className="mini-card stack gap-8"><strong>핵심 1</strong><div className="muted small-text">프로필 허브 완성도</div></div>
          <div className="mini-card stack gap-8"><strong>핵심 2</strong><div className="muted small-text">QR/링크 공유 전환</div></div>
          <div className="mini-card stack gap-8"><strong>핵심 3</strong><div className="muted small-text">소개서/경력/자료 신뢰도</div></div>
        </div>
      </section>
    </section>
  )
}

function WorkspacePage() {
  const vault = readLocalItems(LOCAL_STORAGE_KEYS.vault, [])
  const intro = readLocalItems(LOCAL_STORAGE_KEYS.introManager, [])
  const links = readLocalItems(LOCAL_STORAGE_KEYS.shareLinks, [])
  const templateStore = readLocalItems(LOCAL_STORAGE_KEYS.templateStore, buildDefaultTemplateStoreItems())
  const analyticsEvents = readLocalItems(LOCAL_STORAGE_KEYS.analyticsEvents, [])
  const leadInbox = readLocalItems(LOCAL_STORAGE_KEYS.leadInbox, [])
  const businessConfig = readLocalItems(LOCAL_STORAGE_KEYS.businessConfig, buildDefaultBusinessConfig())
  const recentVault = vault.slice(0, 5)
  const analyticsSummary = summarizeAnalyticsEvents(analyticsEvents)
  const estimatedRevenue = templateStore.reduce((sum, item) => sum + Number(item.sales || 0) * Number(item.price || 0), 0)

  return (
    <section className="page-stack">
      <div className="card stack">
        <div className="split-row responsive-row">
          <div className="stack gap-6">
            <strong>종합관리</strong>
            <div className="muted small-text">설명 메모를 없애고, 실제 수익화 운영 기능이 연결된 관리자 화면으로 정리했습니다.</div>
          </div>
          <div className="chip-row">
            <span className="chip">플랜 {businessConfigLabel(businessConfig.plan)}</span>
            <span className="chip">리드 {leadInbox.length}</span>
          </div>
        </div>
        <div className="grid-4">
          <Metric label="저장 자료" value={vault.length} />
          <Metric label="공개 방문" value={analyticsSummary.visits} />
          <Metric label="문의 전환" value={analyticsSummary.leads} />
          <Metric label="예상 매출" value={`₩${formatMoney(estimatedRevenue)}`} />
        </div>
        <div className="action-wrap wrap-row">
          <Link className="button-link" to="/profile">프로필/공개URL 관리</Link>
          <Link className="button-link" to="/business-card">명함/폼상점 관리</Link>
          <Link className="button-link" to="/introductions-manager">AI 자기소개서 결과 관리</Link>
          <Link className="button-link" to="/share-links-manager">공유링크 관리</Link>
        </div>
      </div>
      <div className="grid-2">
        <div className="card stack">
          <div className="split-row responsive-row"><strong>최근 저장 자료</strong><Link className="button-link" to="/vault">저장함 이동</Link></div>
          <div className="stack compact-list">
            {recentVault.length ? recentVault.map(item => <div key={item.id} className="mini-card"><strong>{item.title}</strong><div className="muted small-text">{item.category} · {item.folder}</div></div>) : <div className="muted">저장 자료가 없습니다.</div>}
          </div>
        </div>
        <div className="card stack">
          <div className="split-row responsive-row"><strong>운영 리드함</strong><Link className="button-link" to="/profile?tab=link">링크 자산 관리</Link></div>
          <div className="stack compact-list">
            {leadInbox.length ? leadInbox.slice(0, 5).map(item => <div key={item.id} className="mini-card"><strong>{item.profileTitle || item.title || '공개 프로필 리드'}</strong><div className="muted small-text">{item.source || '공개 프로필'} · {formatDateLabel(item.created_at)}</div></div>) : <div className="muted">아직 수집된 리드가 없습니다.</div>}
          </div>
        </div>
      </div>
      <BusinessMonetizationSection vault={vault} intro={intro} links={links} />
    </section>
  )
}


function formatMoney(value) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('ko-KR').format(amount)
}

function buildDefaultBusinessConfig() {
  return {
    plan: 'free',
    templateSellerMode: true,
    seoAutoMode: true,
    analyticsPro: false,
    cloudTier: 'starter',
    recruitingEnabled: true,
    freelancingEnabled: true,
    brandKitEnabled: true,
    adSlotsEnabled: false,
    aiCredits: 40,
  }
}

function businessConfigLabel(plan) {
  return {
    free: '무료',
    pro: '프로',
    business: '비즈니스',
  }[plan] || '무료'
}

function buildDefaultTemplateStoreItems() {
  return [
    { id: makeLocalId('tpl'), name: '시그니처 프로필 카드', category: '명함폼', type: 'one-time', price: 4900, status: '판매중', sales: 7, summary: '링크형 공개 프로필과 같이 판매하는 프리미엄 템플릿' },
    { id: makeLocalId('tpl'), name: '포트폴리오형 패키지', category: '포트폴리오', type: 'bundle', price: 12900, status: '판매중', sales: 3, summary: '명함 + 소개페이지 + QR 구성' },
    { id: makeLocalId('tpl'), name: '상담/영업용 브랜딩 세트', category: '브랜드', type: 'bundle', price: 7900, status: '초안', sales: 0, summary: '상담업, 영업직, 프리랜서용 전환형 세트' },
  ]
}

function buildDefaultAiDrafts() {
  return []
}

function buildDefaultHiringPosts() {
  return [
    { id: makeLocalId('job'), company: '프토리 스튜디오', title: '프로필 디자이너', employmentType: '계약직', budget: '월 250만원', status: '모집중', source: '기업 채용관' },
    { id: makeLocalId('job'), company: '브랜드링크 파트너스', title: 'SEO 공개 URL 운영 매니저', employmentType: '파트타임', budget: '월 120만원', status: '모집중', source: '기업 채용관' },
  ]
}

function buildDefaultGigPosts() {
  return [
    { id: makeLocalId('gig'), title: '링크형 포트폴리오 페이지 제작', category: '디자인', budget: '15만원~30만원', status: '거래가능', feeRate: '12%', description: '공개 프로필과 맞춤 URL을 함께 제작합니다.' },
    { id: makeLocalId('gig'), title: '자기소개서 AI 초안 + 수동 첨삭', category: '문서', budget: '건당 3만원', status: '거래가능', feeRate: '10%', description: 'AI 생성 후 실제 제출용 문장으로 다듬어 드립니다.' },
  ]
}

function buildDefaultBrandPages() {
  return [
    { id: makeLocalId('brand'), name: '브랜드 소개 페이지', slug: 'brand-profile', theme: '네이비', sections: ['대표 소개', '서비스', '문의 링크'], status: '운영중' },
  ]
}

function buildDefaultAdSlots() {
  return [
    { id: makeLocalId('ad'), name: '프로필 상단 추천배너', placement: '공개 프로필 상단', price: 39000, status: '준비중', exposure: '주 1회 5천회' },
    { id: makeLocalId('ad'), name: '명함만들기 업셀 슬롯', placement: '명함만들기 하단', price: 59000, status: '판매중', exposure: '주 1회 1만회' },
  ]
}

function buildAiSuggestionSeed(prompt, profiles, links) {
  const keyword = String(prompt || '').trim() || '프로필'
  const names = (profiles || []).slice(0, 2).map(item => item.display_name || item.title).filter(Boolean)
  const firstName = names[0] || '대표 프로필'
  const linkCount = Array.isArray(links) ? links.length : 0
  return [
    `${firstName}의 강점을 중심으로 ${keyword} 메시지를 재정리했습니다.`,
    `핵심 소개: 신뢰를 주는 이력, 링크 ${linkCount}개, 공유 가능한 명함/URL/QR 자산을 한 번에 전달합니다.`,
    '추천 문장: 개인 브랜딩부터 영업, 채용, 협업 제안까지 한 페이지에서 확인할 수 있도록 구성했습니다.',
    '수익화 제안: 공개 URL 상단에 CTA를 두고, 유료 템플릿·AI 첨삭·브랜드 페이지로 전환 흐름을 연결하세요.',
  ].join('\n')
}

function BusinessMonetizationSection({ vault, intro, links }) {
  const [profiles, setProfiles] = useState([])
  const [planInfo, setPlanInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [businessConfig, setBusinessConfig] = useState(() => ({ ...buildDefaultBusinessConfig(), ...readLocalItems(LOCAL_STORAGE_KEYS.businessConfig, {}) }))
  const [templateStore, setTemplateStore] = useLocalCollection(LOCAL_STORAGE_KEYS.templateStore, buildDefaultTemplateStoreItems())
  const [aiDrafts, setAiDrafts] = useLocalCollection(LOCAL_STORAGE_KEYS.aiDrafts, buildDefaultAiDrafts())
  const [hiringPosts, setHiringPosts] = useLocalCollection(LOCAL_STORAGE_KEYS.hiringPosts, buildDefaultHiringPosts())
  const [gigPosts, setGigPosts] = useLocalCollection(LOCAL_STORAGE_KEYS.gigPosts, buildDefaultGigPosts())
  const [brandPages, setBrandPages] = useLocalCollection(LOCAL_STORAGE_KEYS.brandPages, buildDefaultBrandPages())
  const [adSlots, setAdSlots] = useLocalCollection(LOCAL_STORAGE_KEYS.adSlots, buildDefaultAdSlots())
  const [orderHistory, setOrderHistory] = useLocalCollection(LOCAL_STORAGE_KEYS.monetizationOrders, [])
  const [leadInbox, setLeadInbox] = useLocalCollection(LOCAL_STORAGE_KEYS.leadInbox, [])
  const [analyticsEvents] = useLocalCollection(LOCAL_STORAGE_KEYS.analyticsEvents, [])
  const [activeTab, setActiveTab] = useState('overview')
  const [aiPrompt, setAiPrompt] = useState('영업용 자기소개 한 줄')
  const [jobForm, setJobForm] = useState({ company: '', title: '', employmentType: '정규직', budget: '' })
  const [gigForm, setGigForm] = useState({ title: '', category: '기타', budget: '' })
  const [brandForm, setBrandForm] = useState({ name: '', slug: '', theme: '네이비' })
  const [templateForm, setTemplateForm] = useState({ name: '', category: '명함폼', price: '' })
  const [adForm, setAdForm] = useState({ name: '', placement: '', price: '' })

  useEffect(() => {
    writeLocalItems(LOCAL_STORAGE_KEYS.businessConfig, businessConfig)
  }, [businessConfig])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [profileData, planData] = await Promise.all([
          api('/api/profiles').catch(() => ({ items: [] })),
          api('/api/plan').catch(() => ({ plan: null, usage: null })),
        ])
        if (!mounted) return
        setProfiles(profileData.items || [])
        setPlanInfo(planData)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const publicProfiles = profiles.filter(item => item.slug)
  const publicProfileCount = publicProfiles.length
  const indexedProfileCount = publicProfiles.filter(item => item.search_engine_indexing).length
  const totalTemplateSales = templateStore.reduce((sum, item) => sum + Number(item.sales || 0), 0)
  const estimatedTemplateRevenue = templateStore.reduce((sum, item) => sum + Number(item.sales || 0) * Number(item.price || 0), 0)
  const sharedLinkCount = Array.isArray(links) ? links.length : 0
  const introCount = Array.isArray(intro) ? intro.length : 0
  const usedStorageMb = Number(planInfo?.plan?.used_storage_mb || 0)
  const seoUrls = publicProfiles.slice(0, 5).map(item => ({
    id: item.id,
    title: item.display_name || item.title,
    slug: item.slug,
    headline: item.headline || item.bio || '공개 프로필 소개 문구를 입력해보세요.',
    indexable: Boolean(item.search_engine_indexing),
  }))

  const analyticsRows = useMemo(() => buildAnalyticsRowsFromProfiles(profiles, analyticsEvents), [profiles, analyticsEvents])
  const analyticsSummary = summarizeAnalyticsEvents(analyticsEvents)

  const operationTabs = [
    ['overview', '요약'],
    ['subscription', '구독'],
    ['templates', '폼상점'],
    ['seo', 'SEO/공개URL'],
    ['ai', 'AI'],
    ['hiring', '채용'],
    ['analytics', '분석'],
    ['cloud', '저장함'],
    ['gig', '거래'],
    ['brand', '브랜드'],
    ['ads', '광고'],
    ['orders', '주문/리드'],
  ]

  function updatePlan(nextPlan) {
    setBusinessConfig(current => ({ ...current, plan: nextPlan, analyticsPro: nextPlan !== 'free', adSlotsEnabled: nextPlan === 'business' }))
  }

  function generateAiDraft() {
    const prompt = aiPrompt.trim()
    if (!prompt) return
    const content = buildAiSuggestionSeed(prompt, profiles, links)
    const next = {
      id: makeLocalId('aidraft'),
      title: prompt,
      content,
      created_at: new Date().toISOString(),
      credit_cost: 1,
    }
    setAiDrafts(current => [next, ...current].slice(0, 20))
    setBusinessConfig(current => ({ ...current, aiCredits: Math.max(0, Number(current.aiCredits || 0) - 1) }))
    setAiPrompt('')
  }

  function addTemplateItem() {
    if (!templateForm.name.trim()) return
    setTemplateStore(current => [{
      id: makeLocalId('tpl'),
      name: templateForm.name.trim(),
      category: templateForm.category,
      type: 'one-time',
      price: Number(templateForm.price || 0),
      status: '초안',
      sales: 0,
      summary: '직접 추가한 판매용 템플릿',
    }, ...current])
    setTemplateForm({ name: '', category: '명함폼', price: '' })
  }

  function addHiringPost() {
    if (!jobForm.company.trim() || !jobForm.title.trim()) return
    setHiringPosts(current => [{ id: makeLocalId('job'), ...jobForm, status: '모집중', source: '기업 채용관' }, ...current])
    setJobForm({ company: '', title: '', employmentType: '정규직', budget: '' })
  }

  function addGigPost() {
    if (!gigForm.title.trim()) return
    setGigPosts(current => [{ id: makeLocalId('gig'), ...gigForm, status: '거래가능', feeRate: businessConfig.plan === 'business' ? '8%' : '12%', description: '앱 내 거래 보드에서 등록한 프로젝트' }, ...current])
    setGigForm({ title: '', category: '기타', budget: '' })
  }

  function addBrandPage() {
    if (!brandForm.name.trim() || !brandForm.slug.trim()) return
    setBrandPages(current => [{ id: makeLocalId('brand'), name: brandForm.name.trim(), slug: brandForm.slug.trim(), theme: brandForm.theme, sections: ['대표 소개', '서비스', '문의 링크'], status: '초안' }, ...current])
    setBrandForm({ name: '', slug: '', theme: '네이비' })
  }

  function addAdSlot() {
    if (!adForm.name.trim() || !adForm.placement.trim()) return
    setAdSlots(current => [{ id: makeLocalId('ad'), name: adForm.name.trim(), placement: adForm.placement.trim(), price: Number(adForm.price || 0), status: '준비중', exposure: '주 1회 3천회' }, ...current])
    setAdForm({ name: '', placement: '', price: '' })
  }

  function createOrder(type, item) {
    const order = createOrderRecord(type, item)
    setOrderHistory(current => [order, ...current].slice(0, 100))
    return order
  }

  function simulateTemplatePurchase(item) {
    createOrder('template', item)
    setTemplateStore(current => current.map(entry => entry.id === item.id ? { ...entry, sales: Number(entry.sales || 0) + 1 } : entry))
  }

  function convertLeadToContact(item) {
    setLeadInbox(current => [{
      id: makeLocalId('lead'),
      created_at: new Date().toISOString(),
      status: '신규',
      source: item?.name || item?.title || '운영센터',
      profileTitle: item?.name || item?.title || '전환 리드',
    }, ...current].slice(0, 200))
  }

  return (
    <div className="stack business-monetization">
      <div className="card stack">
        <div className="split-row responsive-row">
          <div className="stack gap-6">
            <strong>사업화 / 수익화 운영센터</strong>
            <div className="muted small-text">실제 구독, 템플릿, AI, 채용, 거래, 광고, 리드 데이터를 운영하는 작업 화면입니다.</div>
          </div>
          <div className="chip-row">
            <span className="chip">현재 플랜 {businessConfigLabel(businessConfig.plan)}</span>
            <span className="chip">AI 크레딧 {businessConfig.aiCredits}</span>
            <span className="chip">주문 {orderHistory.length}</span>
          </div>
        </div>
        <div className="grid-4">
          <Metric label="공개 URL" value={publicProfileCount} />
          <Metric label="검색 노출" value={indexedProfileCount} />
          <Metric label="템플릿 판매" value={totalTemplateSales} />
          <Metric label="문의 전환" value={analyticsSummary.leads} />
        </div>
        <div className="business-tab-row">
          {operationTabs.map(([key, label]) => (
            <button key={key} type="button" className={`business-tab-chip ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid-2 business-monetization-grid">
        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'subscription' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>1. 프리미엄 구독</strong><span className="muted small-text">B2C 구독형</span></div>
          <div className="business-plan-grid">
            {[
              { key: 'free', title: '무료', price: '₩0', desc: '기본 프로필/링크/명함 제작' },
              { key: 'pro', title: '프로', price: '월 ₩9,900', desc: 'SEO 공개 URL, Analytics, PDF, 추가 저장공간' },
              { key: 'business', title: '비즈니스', price: '월 ₩29,000', desc: '브랜드 페이지, 광고 슬롯, 팀/채용 운영' },
            ].map(item => (
              <button key={item.key} type="button" className={`business-plan-card ${businessConfig.plan === item.key ? 'active' : ''}`} onClick={() => updatePlan(item.key)}>
                <strong>{item.title}</strong>
                <div>{item.price}</div>
                <div className="muted small-text">{item.desc}</div>
              </button>
            ))}
          </div>
          <div className="muted small-text">플랜 변경 즉시 아래 기능 한도와 판매 구성을 바꿔볼 수 있습니다.</div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'templates' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>2. 폼상점 / 템플릿 판매</strong><Link className="button-link" to="/business-card">명함만들기 이동</Link></div>
          <div className="grid-2">
            <TextField label="템플릿명" value={templateForm.name} onChange={value => setTemplateForm(current => ({ ...current, name: value }))} />
            <div className="stack"><label>카테고리</label><select value={templateForm.category} onChange={e => setTemplateForm(current => ({ ...current, category: e.target.value }))}><option value="명함폼">명함폼</option><option value="포트폴리오">포트폴리오</option><option value="브랜드">브랜드</option></select></div>
            <TextField label="가격" value={templateForm.price} onChange={value => setTemplateForm(current => ({ ...current, price: value }))} />
            <div className="stack justify-end"><button type="button" onClick={addTemplateItem}>판매템플릿 추가</button></div>
          </div>
          <div className="stack compact-list">
            {templateStore.map(item => <div key={item.id} className="mini-card"><strong>{item.name}</strong><div className="muted small-text">{item.category} · {item.status} · {item.sales}건 판매 · ₩{formatMoney(item.price)}</div><div className="muted small-text">{item.summary}</div><div className="action-wrap wrap-row"><button type="button" className="ghost small-button" onClick={() => simulateTemplatePurchase(item)}>판매 처리</button><button type="button" className="ghost small-button" onClick={() => createOrder('template', item)}>주문 생성</button></div></div>)}
          </div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'seo' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>3. 포트폴리오 공개 URL / SEO</strong><Link className="button-link" to="/share-links-manager">링크공유관리</Link></div>
          <div className="muted small-text">공개 URL은 프로필·경력·링크·QR을 한 번에 노출하는 실제 랜딩 페이지로 사용됩니다.</div>
          <div className="stack compact-list">
            {loading ? <div className="muted">프로필 불러오는 중...</div> : seoUrls.length ? seoUrls.map(item => <div key={item.id} className="mini-card"><div className="split-row responsive-row"><strong>{item.title}</strong><button type="button" className="ghost small-button" onClick={() => copyToClipboard(`${window.location.origin}/p/${item.slug}`)}>URL 복사</button></div><div className="muted small-text">/{item.slug} · {item.indexable ? '검색 노출 ON' : '검색 노출 OFF'}</div><div className="muted small-text">{item.headline}</div></div>) : <div className="muted">공개 URL이 연결된 프로필이 없습니다.</div>}
          </div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'ai' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>4. AI 자기소개서 / 프로필 생성</strong><span className="muted small-text">사용량 과금형</span></div>
          <TextField label="생성 요청" value={aiPrompt} onChange={setAiPrompt} />
          <div className="action-wrap"><button type="button" onClick={generateAiDraft} disabled={!businessConfig.aiCredits}>AI 초안 만들기</button><Link className="button-link" to="/introductions-manager">자기소개서관리</Link></div>
          <div className="stack compact-list">
            {aiDrafts.length ? aiDrafts.map(item => <div key={item.id} className="mini-card"><strong>{item.title}</strong><div className="pre-wrap small-text">{item.content}</div><div className="muted small-text">{formatDateLabel(item.created_at)} · {item.credit_cost}크레딧</div></div>) : <div className="muted">생성된 AI 초안이 없습니다.</div>}
          </div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'hiring' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>5. 기업 채용 연동</strong><span className="muted small-text">B2B 구독형</span></div>
          <div className="grid-2">
            <TextField label="회사명" value={jobForm.company} onChange={value => setJobForm(current => ({ ...current, company: value }))} />
            <TextField label="포지션" value={jobForm.title} onChange={value => setJobForm(current => ({ ...current, title: value }))} />
            <div className="stack"><label>고용형태</label><select value={jobForm.employmentType} onChange={e => setJobForm(current => ({ ...current, employmentType: e.target.value }))}><option value="정규직">정규직</option><option value="계약직">계약직</option><option value="파트타임">파트타임</option></select></div>
            <TextField label="예산/연봉" value={jobForm.budget} onChange={value => setJobForm(current => ({ ...current, budget: value }))} />
          </div>
          <button type="button" onClick={addHiringPost}>채용공고 추가</button>
          <div className="stack compact-list">{hiringPosts.map(item => <div key={item.id} className="mini-card"><strong>{item.company} · {item.title}</strong><div className="muted small-text">{item.employmentType} · {item.budget || '조건 협의'} · {item.status}</div></div>)}</div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'analytics' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>6. QR / 링크 Analytics</strong><Link className="button-link" to="/qr-generator">QR생성</Link></div>
          <div className="muted small-text">공개 프로필 방문, 링크 클릭, QR 클릭, CTA 클릭을 묶어서 실제 전환 데이터를 확인할 수 있습니다.</div>
          <div className="stack compact-list">{analyticsRows.length ? analyticsRows.map(item => <div key={item.id} className="mini-card"><strong>{item.title}</strong><div className="muted small-text">방문 {item.visits} · 클릭 {item.clicks} · 문의전환 {item.leads}</div><div className="muted small-text">{item.indexable ? 'SEO 노출형' : '링크 전용'} 공개 URL</div></div>) : <div className="muted">분석할 공개 URL이 없습니다.</div>}</div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'cloud' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>7. 클라우드 저장함 유료화</strong><Link className="button-link" to="/vault">저장함 이동</Link></div>
          <div className="grid-4">
            <Metric label="저장 파일" value={vault.length} />
            <Metric label="자기소개" value={introCount} />
            <Metric label="링크 자산" value={sharedLinkCount} />
            <Metric label="사용량" value={`${usedStorageMb}MB`} />
          </div>
          <div className="muted small-text">저장함은 요금제에 따라 보관량, 버전관리, 팀 사용 흐름으로 확장할 수 있게 설계했습니다.</div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'gig' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>8. 외주 / 프리랜서 거래</strong><span className="muted small-text">중개 수수료형</span></div>
          <div className="grid-2">
            <TextField label="프로젝트명" value={gigForm.title} onChange={value => setGigForm(current => ({ ...current, title: value }))} />
            <div className="stack"><label>카테고리</label><select value={gigForm.category} onChange={e => setGigForm(current => ({ ...current, category: e.target.value }))}><option value="기타">기타</option><option value="디자인">디자인</option><option value="개발">개발</option><option value="문서">문서</option></select></div>
            <TextField label="예산" value={gigForm.budget} onChange={value => setGigForm(current => ({ ...current, budget: value }))} />
            <div className="stack justify-end"><button type="button" onClick={addGigPost}>거래 글 추가</button></div>
          </div>
          <div className="stack compact-list">{gigPosts.map(item => <div key={item.id} className="mini-card"><strong>{item.title}</strong><div className="muted small-text">{item.category} · {item.budget || '예산 협의'} · 수수료 {item.feeRate}</div><div className="muted small-text">{item.description}</div></div>)}</div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'brand' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>9. 브랜드 페이지 제작</strong><span className="muted small-text">기업용 미니 홈페이지</span></div>
          <div className="grid-2">
            <TextField label="페이지명" value={brandForm.name} onChange={value => setBrandForm(current => ({ ...current, name: value }))} />
            <TextField label="슬러그" value={brandForm.slug} onChange={value => setBrandForm(current => ({ ...current, slug: value }))} />
            <div className="stack"><label>테마</label><select value={brandForm.theme} onChange={e => setBrandForm(current => ({ ...current, theme: e.target.value }))}><option value="네이비">네이비</option><option value="블루">블루</option><option value="그린">그린</option><option value="핑크">핑크</option></select></div>
            <div className="stack justify-end"><button type="button" onClick={addBrandPage}>브랜드 페이지 추가</button></div>
          </div>
          <div className="stack compact-list">{brandPages.map(item => <div key={item.id} className="mini-card"><strong>{item.name}</strong><div className="muted small-text">/{item.slug} · {item.theme} · {item.status}</div><div className="muted small-text">{item.sections.join(' · ')}</div><div className="action-wrap wrap-row"><button type="button" className="ghost small-button" onClick={() => createOrder('brand', item)}>제작 문의</button><button type="button" className="ghost small-button" onClick={() => convertLeadToContact(item)}>리드 저장</button></div></div>)}</div>
        </div>

        <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'ads' ? 'is-hidden' : ''}`}>
          <div className="split-row responsive-row"><strong>10. 광고 / 홍보 슬롯</strong><span className="muted small-text">노출형 상품</span></div>
          <div className="grid-2">
            <TextField label="상품명" value={adForm.name} onChange={value => setAdForm(current => ({ ...current, name: value }))} />
            <TextField label="노출위치" value={adForm.placement} onChange={value => setAdForm(current => ({ ...current, placement: value }))} />
            <TextField label="판매가" value={adForm.price} onChange={value => setAdForm(current => ({ ...current, price: value }))} />
            <div className="stack justify-end"><button type="button" onClick={addAdSlot}>광고 상품 추가</button></div>
          </div>
          <div className="stack compact-list">{adSlots.map(item => <div key={item.id} className="mini-card"><strong>{item.name}</strong><div className="muted small-text">{item.placement} · {item.status} · ₩{formatMoney(item.price)}</div><div className="muted small-text">예상 노출 {item.exposure}</div><div className="action-wrap wrap-row"><button type="button" className="ghost small-button" onClick={() => createOrder('ad', item)}>광고 문의</button></div></div>)}</div>
        </div>
      </div>

      <div className={`card stack ${activeTab !== 'overview' && activeTab !== 'orders' ? 'is-hidden' : ''}`}>
        <div className="split-row responsive-row"><strong>11. 주문 / 리드 관리</strong><span className="muted small-text">문의/전환 관리</span></div>
        <div className="grid-2">
          <Metric label="주문 생성" value={orderHistory.length} />
          <Metric label="리드 수집" value={leadInbox.length} />
        </div>
        <div className="stack compact-list">
          {orderHistory.length ? orderHistory.slice(0, 6).map(item => <div key={item.id} className="mini-card"><strong>{item.title}</strong><div className="muted small-text">{item.type} · {item.status} · {formatDateLabel(item.created_at)}</div><div className="muted small-text">₩{formatMoney(item.amount)}</div></div>) : <div className="muted">생성된 주문이 없습니다.</div>}
          {leadInbox.length ? leadInbox.slice(0, 6).map(item => <div key={item.id} className="mini-card"><strong>{item.profileTitle || item.title || '리드'}</strong><div className="muted small-text">{item.source || '공개 프로필'} · {item.status}</div></div>) : <div className="muted">수집된 리드가 없습니다.</div>}
        </div>
      </div>
    </div>
  )
}

function SearchScreen({ searchWord, setSearchWord, onSearch, onClose, result }) {
  return createPortal(
    <div className="search-screen-backdrop">
      <section className="search-screen" aria-label="검색 화면">
        <div className="search-screen-top">
          <BackIconButton onClick={onClose} className="search-back-button" />
        </div>
        <div className="search-screen-body stack">
          <div className="search-screen-form inline-form">
            <input
              value={searchWord}
              onChange={e => setSearchWord(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSearch() }}
              placeholder="이름 / 직업 / 업종 / 프로필 / 경력 검색"
              autoFocus
            />
            <button type="button" onClick={onSearch}>검색</button>
          </div>
          <div className="search-screen-results bordered-box">
            <div className="dropdown-title search-screen-title">검색 목록</div>
            <SearchResultView result={result} />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}


function SearchResultView({ result }) {
  return (
    <div className="search-grid">
      <SearchSection title="사람" items={result.people} render={item => <div><strong>{item.nickname}</strong><div className="muted small-text">{item.email}</div></div>} />
      <SearchSection title="프로필" items={result.profiles} render={item => (
        <div>
          <div><strong>{item.title}</strong></div>
          <div className="small-text">{item.current_work || '직무 미입력'} · {item.industry_category || '업종 미입력'}</div>
          <div className="muted small-text">/{item.slug}</div>
          <Link className="inline-link" to={`/p/${item.slug}`}>공개 프로필 보기</Link>
        </div>
      )} />
      <SearchSection title="경력" items={result.careers} render={item => `${item.title} · ${item.one_line}`} />
      <SearchSection title="관련 업종" items={(result.categories || []).map((name, index) => ({ id: `${name}-${index}`, label: name }))} render={item => item.label} />
    </div>
  )
}

function SearchSection({ title, items, render }) {
  return (
    <div className="mini-card">
      <strong>{title}</strong>
      <div className="list compact-list">
        {items?.length ? items.map(item => <div key={`${title}-${item.id}`}>{render(item)}</div>) : <div className="muted">검색 결과 없음</div>}
      </div>
    </div>
  )
}



function formatShortDate(value) {
  if (!value) return '--.--.--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${String(date.getFullYear()).slice(-2)}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function formatDateLabel(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function statusLabel(value) {
  return { pending: '새질문', answered: '피드', rejected: '거절질문' }[value] || value
}

function formatCompactCount(value) {
  const count = Number(value || 0)
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1).replace(/\.0$/, '')}만`
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '')}천`
  return String(count)
}

function QuestionBoard({ profile, ownerNickname, isOwner, onRefresh, canAsk = true, initialAskOpen = false, variant = 'default', headerExtras = null }) {
  const navigate = useNavigate()
  const viewer = getStoredUser()
  const viewerId = Number(viewer?.id || 0)
  const defaultNickname = String(viewer?.nickname || '').trim() || '익명'
  const isAskedStyle = variant === 'asked'
  const [tab, setTab] = useState('feed')
  const [askOpen, setAskOpen] = useState(Boolean(initialAskOpen))
  const [question, setQuestion] = useState('')
  const [nickname, setNickname] = useState(defaultNickname)
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [answers, setAnswers] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})
  const [commentLists, setCommentLists] = useState({})
  const turnstile = useTurnstileConfig()
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaVersion, setCaptchaVersion] = useState(0)

  const feedItems = useMemo(() => (profile?.questions || []).filter(item => item.status === 'answered' && !item.is_hidden), [profile])
  const newItems = useMemo(() => (profile?.questions || []).filter(item => item.status === 'pending' && !item.is_hidden), [profile])
  const rejectedItems = useMemo(() => (profile?.questions || []).filter(item => item.status === 'rejected' && !item.is_hidden), [profile])

  useEffect(() => {
    setAskOpen(Boolean(initialAskOpen) && !isOwner && canAsk)
  }, [initialAskOpen, isOwner, canAsk, profile?.id])

  useEffect(() => {
    if (!askOpen) return
    const nextDefault = String(getStoredUser()?.nickname || '').trim() || '익명'
    setIsAnonymous(false)
    setNickname(nextDefault)
  }, [askOpen, profile?.id])

  const lockedTab = !isOwner && tab !== 'feed'
  const visibleItems = lockedTab ? [] : tab === 'feed' ? feedItems : tab === 'new' ? newItems : rejectedItems

  async function askQuestion() {
    if (!profile?.id || !question.trim()) return
    await api(`/api/profiles/${profile.id}/questions`, { method: 'POST', body: JSON.stringify({ question_text: question, nickname: isAnonymous ? '익명' : nickname, captcha_token: captchaToken }) })
    setQuestion('')
    setAskOpen(false)
    setIsAnonymous(false)
    setNickname(String(getStoredUser()?.nickname || '').trim() || '익명')
    setCaptchaVersion(prev => prev + 1)
    setCaptchaToken('')
    await onRefresh?.()
  }

  async function answerQuestion(item) {
    const answerText = (answers[item.id] || '').trim()
    if (!answerText) return
    await api(`/api/questions/${item.id}/answer`, { method: 'POST', body: JSON.stringify({ answer_text: answerText, status: 'answered' }) })
    setAnswers(prev => ({ ...prev, [item.id]: '' }))
    await onRefresh?.()
    setTab('feed')
  }

  async function rejectQuestion(item) {
    await api(`/api/questions/${item.id}/reject`, { method: 'POST' })
    await onRefresh?.()
    setTab('rejected')
  }

  async function deleteQuestion(item) {
    if (!window.confirm('이 질문을 삭제하시겠습니까?')) return
    await api(`/api/questions/${item.id}`, { method: 'DELETE' })
    await onRefresh?.()
  }

  async function loadComments(item) {
    const data = await api(`/api/questions/${item.id}/comments`)
    setCommentLists(prev => ({ ...prev, [item.id]: data.items || [] }))
  }

  async function addComment(item) {
    const commentText = (commentDrafts[item.id] || '').trim()
    if (!commentText) return
    await api(`/api/questions/${item.id}/comments`, { method: 'POST', body: JSON.stringify({ comment_text: commentText, nickname: '익명', captcha_token: captchaToken }) })
    setCommentDrafts(prev => ({ ...prev, [item.id]: '' }))
    await loadComments(item)
    await onRefresh?.()
  }

  async function engage(item, action) {
    const data = await api(`/api/questions/${item.id}/engage?action=${action}`, { method: 'POST' })
    if (action === 'share') {
      const shareUrl = `${window.location.origin}/p/${profile.slug}`
      try { await navigator.clipboard.writeText(shareUrl) } catch {}
      window.alert('공유용 주소를 복사했습니다.')
    }
    await onRefresh?.(data.item)
  }

  const tabDefs = isAskedStyle
    ? [
        { key: 'feed', label: '내피드', count: feedItems.length },
        { key: 'new', label: '새질문', count: newItems.length },
        { key: 'rejected', label: '거절질문', count: rejectedItems.length },
      ]
    : [
        { key: 'feed', label: `피드 ${feedItems.length}` },
        { key: 'new', label: isOwner ? `새질문 ${newItems.length}` : '새질문' },
        { key: 'rejected', label: isOwner ? `거절질문 ${rejectedItems.length}` : '거절질문' },
      ]

  return (
    <section className={isAskedStyle ? 'asked-board' : 'card stack question-board'}>
      {headerExtras}
      <div className={isAskedStyle ? 'asked-tabs' : 'split-row question-board-head'}>
        <div className={isAskedStyle ? 'asked-tabs-inner' : 'tab-row question-tabs-row'}>
          {tabDefs.map(item => (
            <button
              key={item.key}
              type="button"
              className={isAskedStyle ? `asked-tab ${tab === item.key ? 'active' : ''}` : (tab === item.key ? 'tab active' : 'tab')}
              onClick={() => setTab(item.key)}
            >
              <span>{item.label}</span>
              {isAskedStyle ? <span className="asked-tab-count">{formatCompactCount(item.count)}</span> : null}
            </button>
          ))}
        </div>
        {!isAskedStyle && !isOwner && canAsk ? <button type="button" onClick={() => setAskOpen(v => !v)}>질문하기</button> : null}
      </div>
      {!isOwner && askOpen ? (
        <div className={isAskedStyle ? 'asked-ask-card' : 'bordered-box stack question-ask-box'}>
          <div className={isAskedStyle ? 'asked-ask-head' : undefined}>
            {isAskedStyle ? <strong>질문 남기기</strong> : null}
            {isAskedStyle ? <span className="muted small-text">상대에게 익명 또는 닉네임으로 질문을 보낼 수 있습니다.</span> : null}
          </div>
          <div className={`inline-form responsive-row question-nickname-row${isAskedStyle ? ' asked-nickname-row' : ''}`}>
            <TextField label="닉네임" value={nickname} onChange={setNickname} />
            <label className="question-anon-toggle">
              <input type="checkbox" checked={isAnonymous} onChange={event => {
                const checked = event.target.checked
                setIsAnonymous(checked)
                setNickname(checked ? '익명' : (String(getStoredUser()?.nickname || '').trim() || '익명'))
              }} />
              <span>익명전환</span>
            </label>
          </div>
          <label>질문 내용</label>
          <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="상대에게 남길 질문을 입력하세요." />
          <TurnstileWidget enabled={turnstile.turnstile_enabled} siteKey={turnstile.turnstile_site_key} onToken={setCaptchaToken} refreshKey={`question-board-${captchaVersion}`} />
          <div className={isAskedStyle ? 'asked-ask-actions' : 'action-wrap'}>
            <button type="button" onClick={askQuestion} disabled={turnstile.turnstile_enabled && !captchaToken}>질문 등록</button>
            <button type="button" className="ghost" onClick={() => setAskOpen(false)}>닫기</button>
          </div>
        </div>
      ) : null}
      <div className={isAskedStyle ? 'asked-feed-list' : 'list question-feed-list'}>
        {lockedTab ? <div className={isAskedStyle ? 'asked-locked-card' : 'bordered-box muted'}>이 항목은 프로필 소유자만 확인할 수 있습니다.</div> : null}
        {!lockedTab && visibleItems.length ? (
          <>
            <MonetizationAdBanner placement="question_top" className={isAskedStyle ? 'asked-inline-ad asked-inline-ad-top' : 'question-inline-ad question-inline-ad-top'} compact />
            {visibleItems.map((item, index) => {
              const comments = commentLists[item.id] || []
              const canDeleteOwnQuestion = !isOwner && viewerId > 0 && Number(item.asker_user_id || 0) === viewerId
              return (
                <React.Fragment key={item.id}>
                  <article className={isAskedStyle ? 'asked-feed-card' : 'question-feed-card'}>
              <div className={isAskedStyle ? 'asked-feed-top' : 'question-feed-top'}>
                <div className="asked-feed-copy">
                  <div className="question-user-line"><strong>{item.display_nickname || item.nickname}</strong><span className="muted small-text">질문일 {formatDateLabel(item.created_at)}</span></div>
                  <div className={isAskedStyle ? 'asked-question-body' : 'question-body'}>{item.question_text}</div>
                </div>
                <div className="question-top-actions">
                  {canDeleteOwnQuestion ? (
                    <button type="button" className="question-delete-icon" onClick={() => deleteQuestion(item)} title="삭제" aria-label="삭제">
                      <IconGlyph name="trash" label="삭제" />
                    </button>
                  ) : null}
                  {!isAskedStyle ? <span className="chip">{statusLabel(item.status)}</span> : null}
                </div>
              </div>
              {item.status === 'answered' ? (
                <div className={isAskedStyle ? 'asked-answer-box' : 'answer-box question-answer-box'}>
                  <div className="question-user-line"><strong>{ownerNickname || '답변자'}</strong><span className="muted small-text">답변일 {formatDateLabel(item.answered_at)}</span></div>
                  <div className="pre-wrap">{item.answer_text}</div>
                </div>
              ) : null}
              {item.status === 'pending' && isOwner ? (
                <div className={isAskedStyle ? 'asked-owner-box' : 'stack bordered-box'}>
                  <label>답변 작성</label>
                  <textarea value={answers[item.id] || ''} onChange={e => setAnswers(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="답변을 입력하면 피드로 이동합니다." />
                  <div className="action-wrap">
                    <button type="button" onClick={() => answerQuestion(item)}>답변</button>
                    <button type="button" className="ghost" onClick={() => rejectQuestion(item)}>거절</button>
                    <button type="button" className="ghost" onClick={() => deleteQuestion(item)}>삭제</button>
                  </div>
                </div>
              ) : null}
              <div className={isAskedStyle ? 'asked-action-row' : 'question-footer-actions'}>
                <button type="button" className={isAskedStyle ? 'asked-action-button' : 'ghost'} onClick={() => loadComments(item)}>
                  <span className="asked-action-label">댓글</span>
                  <span className="asked-action-count">{formatCompactCount(item.comments_count || 0)}</span>
                </button>
                <button type="button" className={isAskedStyle ? 'asked-action-button' : 'ghost'} onClick={() => engage(item, 'like')}>
                  <span className="asked-action-label">좋아요</span>
                  <span className="asked-action-count">{formatCompactCount(item.liked_count || 0)}</span>
                </button>
                <button type="button" className={isAskedStyle ? 'asked-action-button' : 'ghost'} onClick={() => engage(item, 'bookmark')}>
                  <span className="asked-action-label">보관</span>
                  <span className="asked-action-count">{formatCompactCount(item.bookmarked_count || 0)}</span>
                </button>
                <button type="button" className={isAskedStyle ? 'asked-action-button' : 'ghost'} onClick={() => engage(item, 'share')}>
                  <span className="asked-action-label">공유</span>
                  <span className="asked-action-count">{formatCompactCount(item.shared_count || 0)}</span>
                </button>
              </div>
              {commentLists[item.id] ? (
                <div className={isAskedStyle ? 'asked-comments-box' : 'stack question-comments-box'}>
                  <div className="list compact-list">
                    {comments.length ? comments.map(comment => <div key={comment.id} className={isAskedStyle ? 'asked-comment-card' : 'bordered-box'}><strong>{comment.display_nickname}</strong><div className="muted small-text">{formatDateLabel(comment.created_at)}</div><div>{comment.comment_text}</div></div>) : <div className="muted">아직 댓글이 없습니다.</div>}
                  </div>
                  <div className={isAskedStyle ? 'asked-comment-form' : 'inline-form responsive-row'}>
                    <input value={commentDrafts[item.id] || ''} onChange={e => setCommentDrafts(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="댓글 입력" />
                    <button type="button" onClick={() => addComment(item)}>댓글 등록</button>
                  </div>
                </div>
              ) : null}
                  </article>
                  {(index + 1) % 3 === 0 ? (
                    <MonetizationAdBanner placement="question_feed_inline" className={isAskedStyle ? 'asked-inline-ad' : 'question-inline-ad'} compact />
                  ) : null}
                </React.Fragment>
              )
            })}
          </>
        ) : <div className={isAskedStyle ? 'asked-empty-card' : 'bordered-box muted'}>표시할 항목이 없습니다.</div>}
      </div>
    </section>
  )
}

function AskedQuestionProfileHeader({ data, askOpen, onToggleAsk, onToggleFollow, followLoading, onStartDm, onBlock }) {
  const profile = data?.profile
  const owner = data?.owner
  const stats = profile?.stats || {}
  const isFollowing = Boolean(data?.viewer?.is_following)
  const profileName = profile?.display_name || profile?.title || owner?.nickname || '프로필 주인'
  const profileIdLabel = owner?.account_unique_id || owner?.email?.split('@')?.[0] || 'profile'
  const avatarUrl = profile?.profile_image_url || owner?.photo_url || ''
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleShare() {
    const shareUrl = `${window.location.origin}/questions/${profile?.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profileName} 질문`, url: shareUrl })
        return
      }
    } catch {}
    try { await navigator.clipboard.writeText(shareUrl) } catch {}
    window.alert('질문 화면 주소를 복사했습니다.')
  }

  return (
    <div className="asked-profile-shell">
      <div className="asked-topbar-row">
        <div className="asked-topbar-avatar">
          {avatarUrl ? <img src={avatarUrl} alt={profileName} /> : <span>{profileName.slice(0, 1)}</span>}
        </div>
        <div className="asked-topbar-stats">
          <div className="asked-stat-item"><strong>{formatCompactCount(stats.feed_post_count || stats.answered_count || 0)}</strong><span>작성글</span></div>
          <div className="asked-stat-item"><strong>{formatCompactCount(stats.answered_count || 0)}</strong><span>답변완료</span></div>
          <div className="asked-stat-item"><strong>{formatCompactCount(stats.follower_count || 0)}</strong><span>팔로워</span></div>
          <div className="asked-stat-item"><strong>{formatCompactCount(stats.following_count || 0)}</strong><span>팔로잉</span></div>
        </div>
      </div>
      <div className="asked-profile-copy">
        <div className="asked-display-name-row">
          <div className="asked-display-name">{profileName}</div>
          <div className="asked-inline-icon-actions">
            <button type="button" className="ghost icon-button" onClick={onStartDm} aria-label="DM 보내기" title="DM 보내기"><IconGlyph name="chatMini" label="DM 보내기" /></button>
            <button type="button" className={isFollowing ? 'ghost icon-button active' : 'ghost icon-button'} onClick={onToggleFollow} disabled={followLoading} aria-label={isFollowing ? '친구추가 완료' : '친구추가'} title={isFollowing ? '친구추가 완료' : '친구추가'}><IconGlyph name="userAdd" label="친구추가" /></button>
            <div className="friend-more-wrap">
              <button type="button" className="ghost icon-button friend-more-button" onClick={() => setMenuOpen(current => !current)} aria-label="설정" title="설정"><IconGlyph name="more" label="설정" /></button>
              {menuOpen ? (
                <div className="friend-row-menu floating-popup">
                  <button type="button" className="ghost friend-row-menu-item" onClick={async () => { setMenuOpen(false); await onBlock?.() }}>차단하기</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="asked-account-id">@{profileIdLabel}</div>
        <div className="asked-bio-line">{profile?.headline || profile?.bio || '한 줄 소개가 아직 없습니다.'}</div>
      </div>
      <div className="asked-cta-row">
        <button type="button" className={isFollowing ? 'ghost asked-follow-button active' : 'ghost asked-follow-button'} onClick={onToggleFollow} disabled={followLoading}>{followLoading ? '처리중' : (isFollowing ? '팔로잉' : '팔로우')}</button>
        <button type="button" className="asked-question-button" onClick={onToggleAsk}>{askOpen ? '질문닫기' : '질문하기'}</button>
        <button type="button" className="ghost asked-share-button" onClick={handleShare}>공유</button>
      </div>
      <MonetizationAdBanner />
    </div>
  )
}

function QuestionProfilePage() {
  const { profileId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [followLoading, setFollowLoading] = useState(false)
  const [askRequested, setAskRequested] = useState(Boolean(location.state?.openAsk))

  async function load() {
    try {
      const next = await api(`/api/profiles/${profileId}/view`)
      setData(next)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [profileId])

  async function toggleFollow() {
    if (!data?.profile?.id || data?.is_owner) return
    setFollowLoading(true)
    try {
      const isFollowing = Boolean(data?.viewer?.is_following)
      const result = await api(`/api/profiles/${data.profile.id}/follow`, { method: isFollowing ? 'DELETE' : 'POST' })
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          viewer: { ...(prev.viewer || {}), is_following: Boolean(result.is_following) },
          profile: {
            ...prev.profile,
            stats: {
              ...(prev.profile?.stats || {}),
              follower_count: Number(result.follower_count || 0),
              following_count: Number(result.following_count || prev.profile?.stats?.following_count || 0),
            },
          },
        }
      })
    } finally {
      setFollowLoading(false)
    }
  }

  function startDm() {
    const ownerId = Number(data?.owner?.id || 0)
    if (!ownerId || Boolean(data?.is_owner)) return
    openDirectMessageRoom(navigate, ownerId)
  }

  async function blockUser() {
    const ownerId = Number(data?.owner?.id || 0)
    if (!ownerId || Boolean(data?.is_owner)) return
    const targetName = data?.owner?.nickname || data?.profile?.display_name || data?.profile?.title || '해당 사용자'
    if (!window.confirm(`${targetName}님을 차단하시겠습니까?`)) return
    try {
      await api(`/api/blocks/${ownerId}`, { method: 'POST' })
      window.alert('차단이 완료되었습니다.')
      navigate('/chats')
    } catch (err) {
      window.alert(err.message || '차단 처리에 실패했습니다.')
    }
  }

  if (error) return <div className="card error">{error}</div>
  if (!data?.profile) return <div className="card">불러오는 중...</div>

  const profileName = data.owner?.nickname || data.profile.display_name || data.profile.title || '프로필 주인'
  const isAskedStyle = !Boolean(data.is_owner)

  return (
    <div className={`stack page-stack question-profile-page${isAskedStyle ? ' asked-question-page' : ''}`}>
      <section className={isAskedStyle ? 'asked-page-head' : 'card stack question-profile-header-card'}>
        <div className={isAskedStyle ? 'asked-nav-row' : 'question-profile-header-row'}>
          <BackIconButton onClick={() => navigate(-1)} />
          {isAskedStyle ? <div className="asked-page-title">질문</div> : (
            <button type="button" className="question-profile-summary">
              <span className="feed-avatar question-profile-avatar">
                {data.profile?.profile_image_url || data.owner?.photo_url ? <img src={data.profile?.profile_image_url || data.owner?.photo_url} alt={profileName} /> : <span>{profileName.slice(0, 1)}</span>}
              </span>
              <span className="question-profile-summary-copy">
                <strong>{profileName}</strong><VerifiedBadge profile={data.profile} compact />
                <span>{askRequested && !Boolean(data.is_owner) ? '질문을 남길 수 있는 화면입니다.' : '질문과 피드를 확인할 수 있습니다.'}</span>
              </span>
            </button>
          )}
        </div>
      </section>
      <QuestionBoard
        profile={data.profile}
        ownerNickname={profileName}
        isOwner={Boolean(data.is_owner)}
        onRefresh={load}
        canAsk
        initialAskOpen={askRequested && !Boolean(data.is_owner)}
        variant={isAskedStyle ? 'asked' : 'default'}
        headerExtras={isAskedStyle ? <AskedQuestionProfileHeader data={data} askOpen={askRequested} onToggleAsk={() => setAskRequested(prev => !prev)} onToggleFollow={toggleFollow} followLoading={followLoading} onStartDm={startDm} onBlock={blockUser} /> : null}
      />
    </div>
  )
}

function FeedProfileCard({ item, onOpenProfile }) {
  const navigate = useNavigate()
  const profile = item?.profile
  const owner = item?.owner
  if (!profile) return null
  return (
    <article className="profile-showcase profile-showcase-expanded feed-profile-card" style={{ borderColor: profile.theme_color }}>
      <div className="cover profile-cover" style={{ backgroundImage: profile.cover_image_url ? `url(${profile.cover_image_url})` : undefined }}>
        <div className="feed-card-actions">
          <button type="button" className="ghost" onClick={() => onOpenProfile?.(profile)}>프로필</button>
          <button type="button" onClick={() => navigate(`/questions/${profile.id}`)}>질문</button>
        </div>
      </div>
      <div className="profile-meta profile-meta-overlap">
        <div className="avatar large-avatar profile-avatar-overlap">{profile.profile_image_url ? <img src={profile.profile_image_url} alt={profile.title} /> : <span>{(profile.display_name || profile.title || 'P').slice(0, 1)}</span>}</div>
        <div className="profile-head-copy">
          <h3>{profile.display_name || profile.title} <VerifiedBadge profile={profile} compact /></h3>
          <div className="muted">{profile.headline || '소개를 준비 중입니다.'}</div>
          <div className="muted small-text">{owner?.nickname || ''}{profile.gender ? ` · ${profile.gender}` : ''}{profile.birth_year ? ` · ${profile.birth_year}년생` : ''}</div>
          <div className="muted small-text">{profile.gender || '성별 미입력'}{profile.birth_year ? ` · ${profile.birth_year}년생` : ''}</div>
          <div className="muted small-text">현재 하는 일: {profile.current_work || '미입력'}</div>
          <div className="muted small-text">업종: {profile.industry_category || '미입력'} · 지역: {profile.location || '미입력'}</div>
        </div>
      </div>
    </article>
  )
}

function formatFeedTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function FeedComposerModal({ open, mode = 'feed', onClose, onCreated }) {
  const navigate = useNavigate()
  const isStory = mode === 'story'
  const [form, setForm] = useState({ title: '', content: '' })
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('')
      return undefined
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  useEffect(() => {
    if (open) return
    setForm({ title: '', content: '' })
    setImageFile(null)
    setImagePreview('')
    setSubmitting(false)
    setError('')
  }, [open, mode])

  if (!open) return null

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    try {
      setSubmitting(true)
      setError('')
      let imageUrl = ''
      if (imageFile) {
        const uploaded = await uploadFile(imageFile, isStory ? 'story' : 'feed', null)
        imageUrl = uploaded?.item?.url || uploaded?.url || ''
      }
      const endpoint = isStory ? '/api/feed/stories' : '/api/feed/posts'
      const created = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          content: form.content,
          image_url: imageUrl,
        }),
      })
      setForm({ title: '', content: '' })
      setImageFile(null)
      onCreated?.(created.item, mode)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card feed-compose-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-head">
          <h3>{isStory ? '숏토리 생성' : '피드 생성'}</h3>
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
        </div>
        <form className="stack" onSubmit={handleSubmit}>
          <TextField label="제목">
            <input
              value={form.title}
              onChange={event => setForm(current => ({ ...current, title: event.target.value.slice(0, 120) }))}
              placeholder={isStory ? '숏토리 제목을 입력하세요' : '피드 제목을 입력하세요'}
            />
          </TextField>
          <TextField label="내용">
            <textarea
              value={form.content}
              onChange={event => setForm(current => ({ ...current, content: event.target.value.slice(0, isStory ? 2000 : 5000) }))}
              placeholder={isStory ? '지금 바로 보여주고 싶은 짧은 소식을 작성하세요' : '오늘 공유하고 싶은 내용을 작성하세요'}
              rows={isStory ? 6 : 8}
            />
          </TextField>
          <TextField label="사진 첨부">
            <input type="file" accept="image/*" onChange={event => setImageFile(event.target.files?.[0] || null)} />
          </TextField>
          {imagePreview ? <div className="feed-compose-preview"><img src={imagePreview} alt="미리보기" /></div> : null}
          {error ? <div className="error card">{error}</div> : null}
          <div className="split-row responsive-row">
            <div className="muted small-text">{isStory ? '24시간 동안 숏토리가 노출됩니다.' : '사진은 선택사항입니다. 제목 또는 내용 중 하나는 반드시 입력되어야 합니다.'}</div>
            <button type="submit" disabled={submitting}>{submitting ? '등록 중...' : isStory ? '숏토리 올리기' : '피드 올리기'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function FeedEntryPickerModal({ open, onClose, onSelect }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card entry-picker-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-head entry-picker-head">
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="entry-picker-grid">
          <button type="button" className="entry-picker-option" onClick={() => onSelect?.('feed')}>
            <strong>피드작성</strong>
          </button>
          <button type="button" className="entry-picker-option" onClick={() => onSelect?.('story')}>
            <strong>스토리작성</strong>
          </button>
        </div>
      </section>
    </div>
  )
}

function FeedPostCard({ item, onOpenProfile, onFriendRequest }) {
  const navigate = useNavigate()
  const owner = item?.owner || {}
  const profile = item?.profile || {}
  const displayName = profile.display_name || owner.nickname || owner.name || '사용자'
  const avatar = profile.profile_image_url || owner.photo_url || ''
  const friendStatus = item?.viewer?.friend_request_status || 'none'
  const friendLabel = friendStatus === 'friends' ? '친구' : friendStatus === 'requested' ? '요청됨' : friendStatus === 'incoming' ? '수락대기' : '친구요청'
  const disableFriend = ['self', 'friends', 'requested', 'incoming'].includes(friendStatus)

  function openProfile() {
    if (profile?.slug) {
      navigate(`/p/${profile.slug}`)
      return
    }
    onOpenProfile?.(profile)
  }

  function openQuestions() {
    navigate(`/questions/${profile.id}`, { state: { openAsk: true, source: 'feed' } })
  }

  function startDm() {
    const targetUserId = owner?.id || item?.user_id || profile?.user_id
    openDirectMessageRoom(navigate, targetUserId)
  }

  return (
    <article className="feed-post-card">
      <div className="feed-post-top">
        <button type="button" className="feed-author-button" onClick={openProfile}>
          <span className="feed-avatar">
            {avatar ? <img src={avatar} alt={displayName} /> : <span>{displayName.slice(0, 1)}</span>}
          </span>
          <span className="feed-author-copy">
            <strong>{displayName}</strong><VerifiedBadge profile={profile} compact />
            <span className="muted">{owner.nickname && owner.nickname !== displayName ? owner.nickname : profile.current_work || profile.headline || 'historyprofile 사용자'}</span>
          </span>
        </button>
        <div className="feed-post-top-actions">
          <button type="button" className="ghost feed-friend-button" onClick={startDm} title="DM 보내기">
            <IconGlyph name="chatMini" label="DM 보내기" />
          </button>
          <button type="button" className="ghost feed-friend-button" onClick={() => onFriendRequest?.(item)} disabled={disableFriend} title={friendLabel}>
            <IconGlyph name="userAdd" label="친구요청" />
          </button>
        </div>
      </div>

      <div className="feed-post-body">
        <div className="feed-post-date muted small-text">{formatFeedTimestamp(item.created_at)}</div>
        {item.display_title ? <h2>{item.display_title}</h2> : null}
        {item.content ? <p>{item.content}</p> : null}
        {item.image_url ? (
          <div className="feed-post-image-wrap">
            <img className="feed-post-image" src={item.image_url} alt={item.display_title || displayName} />
          </div>
        ) : null}
      </div>

      <div className="feed-post-footer">
        <div className="feed-post-stats">
          <span>좋아요 {item?.stats?.likes || 0}</span>
          <span>댓글 {item?.stats?.comments || 0}</span>
          <span>저장 {item?.stats?.bookmarks || 0}</span>
        </div>
        <div className="feed-post-actions">
          <button type="button" onClick={openQuestions}>질문</button>
        </div>
      </div>
    </article>
  )
}

function DirectAdCard({ item, compact = false }) {
  async function handleClick() {
    try { await api(`/api/direct-ads/${item.id}/click`, { method: 'POST' }) } catch {}
    if (item?.target_url) window.open(item.target_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <article className={`direct-ad-card${compact ? ' compact' : ''}`.trim()}>
      <div className="split-row responsive-row">
        <div className="stack gap-6">
          <div className="small-text muted">스폰서드 · 직접 광고</div>
          <strong>{item?.title || '광고 캠페인'}</strong>
          {item?.subtitle ? <div className="muted small-text">{item.subtitle}</div> : null}
        </div>
        <div className="stack gap-6 align-end">
          {item?.brand_verified ? <span className="verified-badge compact">{item?.verification_badge_text || '브랜드 인증'}</span> : null}
          <span className="small-text muted">{item?.display_name || item?.nickname || '광고주'}</span>
        </div>
      </div>
      {item?.image_url ? <div className="direct-ad-image-wrap"><img className="direct-ad-image" src={item.image_url} alt={item?.title || '광고 이미지'} /></div> : null}
      {item?.description ? <p className="direct-ad-copy">{item.description}</p> : null}
      <div className="split-row responsive-row">
        <div className="muted small-text">{item?.category ? `카테고리 ${item.category}` : '홈 피드 노출'} · 경쟁 포인트 {Number(item?.bid_points || 0).toLocaleString()}P</div>
        <button type="button" onClick={handleClick}>광고 보기</button>
      </div>
    </article>
  )
}


function StoryViewerModal({ item, open, onClose }) {
  const navigate = useNavigate()
  if (!open || !item?.profile) return null
  const profile = item.profile
  const owner = item.owner || {}
  const story = item || {}
  const name = profile.display_name || owner.nickname || profile.title || '사용자'
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card story-viewer-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-head">
          <div className="story-viewer-head">
            <span className="feed-avatar story-viewer-avatar">{profile.profile_image_url ? <img src={profile.profile_image_url} alt={name} /> : <span>{name.slice(0, 1)}</span>}</span>
            <div>
              <strong>{name}</strong>
              <div className="muted small-text">{formatFeedTimestamp(story.created_at)}</div>
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="story-viewer-body stack">
          {story.image_url ? <div className="story-media"><img src={story.image_url} alt={story.title || name} /></div> : null}
          <div className="story-copy-block">
            {story.title ? <h3>{story.title}</h3> : null}
            <div className="pre-wrap">{story.content || '스토리 내용이 없습니다.'}</div>
          </div>
          <div className="story-viewer-actions">
            <button type="button" className="ghost" onClick={() => navigate(`/questions/${profile.id}`, { state: { openAsk: true, source: 'story' } })}>질문</button>
            <button type="button" onClick={() => navigate(`/p/${profile.slug}`)}>프로필 보기</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function HomePage({ user }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [stories, setStories] = useState([])
  const [selectedStory, setSelectedStory] = useState(null)
  const [composerMode, setComposerMode] = useState('feed')
  const [error, setError] = useState('')
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [storyBarVisible, setStoryBarVisible] = useState(true)
  const [directAds, setDirectAds] = useState([])
  const loadMoreRef = useRef(null)
  const lastScrollTopRef = useRef(0)
  const composeParam = new URLSearchParams(location.search).get('compose')
  const composeOpen = composeParam === '1' || composeParam === 'feed' || composeParam === 'story'
  const pickerOpen = composeParam === '1'
  const composerOpen = composeParam === 'feed' || composeParam === 'story'

  useEffect(() => {
    if (composeParam === 'story') setComposerMode('story')
    else if (composeParam === 'feed') setComposerMode('feed')
  }, [composeParam])

  const loadFeed = React.useCallback(async (reset = false) => {
    if (loading) return
    try {
      setLoading(true)
      const offset = reset ? 0 : nextOffset
      const data = await api(`/api/feed/posts?limit=10&offset=${offset}`)
      const fetched = data.items || []
      setItems(current => reset ? fetched : [...current, ...fetched])
      setNextOffset(Number(data.next_offset || (offset + fetched.length)))
      setHasMore(Boolean(data.has_more) || fetched.length >= 10)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loading, nextOffset])

  const loadStories = React.useCallback(async () => {
    try {
      const data = await api('/api/feed/stories?limit=20')
      const ownStory = data.my_story ? [data.my_story] : []
      setStories([...ownStory, ...(data.items || [])])
    } catch {
      setStories([])
    }
  }, [])

  const loadDirectAds = React.useCallback(async () => {
    try {
      const data = await api('/api/direct-ads/placements?placement=home_feed&limit=3')
      setDirectAds(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setDirectAds([])
    }
  }, [])

  useEffect(() => {
    loadFeed(true)
    loadStories()
    loadDirectAds()
  }, [])

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return undefined
    const observer = new IntersectionObserver(entries => {
      const first = entries[0]
      if (first?.isIntersecting && !loading) {
        loadFeed(false)
      }
    }, { rootMargin: '800px 0px 800px 0px' })
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [hasMore, loading, loadFeed, items.length])

  useEffect(() => {
    function handleScroll() {
      const current = window.scrollY || window.pageYOffset || 0
      setStoryBarVisible(current <= 8)
      lastScrollTopRef.current = current
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  async function handleFriendRequest(item) {
    try {
      await api(`/api/friends/requests/${item.owner.id}`, { method: 'POST' })
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, viewer: { ...(entry.viewer || {}), friend_request_status: 'requested' } } : entry))
      window.alert('친구요청을 보냈습니다.')
    } catch (err) {
      window.alert(err.message)
    }
  }

  function handleCreated(item, mode) {
    if (!item) return
    if (mode === 'story') {
      setSelectedStory(item)
      loadStories()
      return
    }
    setItems(current => [item, ...current])
    setSelectedProfile(item.profile || null)
    loadStories()
  }

  function openCreatePicker() {
    navigate('/?compose=1')
  }

  function closeComposer() {
    navigate('/', { replace: true })
  }

  function handleSelectCompose(nextMode) {
    setComposerMode(nextMode)
    navigate(`/?compose=${nextMode}`, { replace: true })
  }

  return (
    <div className="stack page-stack feed-home-page">
      <FeedEntryPickerModal open={pickerOpen} onClose={closeComposer} onSelect={handleSelectCompose} />
      <FeedComposerModal open={composerOpen} mode={composerMode} onClose={closeComposer} onCreated={handleCreated} />
      <StoryViewerModal item={selectedStory} open={Boolean(selectedStory)} onClose={() => setSelectedStory(null)} />
      <section className={`card stack home-story-card ${storyBarVisible ? 'visible' : 'hidden'}`}>
        <div className="story-strip" role="list" aria-label="스토리 목록">
          <button type="button" className="story-chip story-chip-compose" onClick={openCreatePicker} role="listitem">
            <span className="story-chip-ring">
              <span className="story-chip-avatar story-chip-avatar-compose">
                <IconGlyph name="compose" label="피드추가" />
              </span>
            </span>
            <span className="story-chip-name">피드추가</span>
          </button>
          {stories.length ? stories.map((item, index) => {
            const profile = item.profile || {}
            const owner = item.owner || {}
            const label = item.viewer?.is_own_story ? '내 숏토리' : profile.display_name || owner.nickname || profile.title || '숏토리'
            return (
              <button key={`story-${item.id}-${index}`} type="button" className={`story-chip ${index < 5 ? 'story-chip-priority' : ''}`} onClick={() => setSelectedStory(item)} role="listitem">
                <span className="story-chip-ring">
                  <span className="story-chip-avatar">{profile.profile_image_url ? <img src={profile.profile_image_url} alt={label} /> : <span>{label.slice(0, 1)}</span>}</span>
                </span>
                <span className="story-chip-name">{label}</span>
              </button>
            )
          }) : <div className="muted small-text">표시할 숏토리가 없습니다.</div>}
        </div>
      </section>

      {selectedProfile ? (
        <section className="card stack">
          <div className="split-row"><h3>프로필 미리보기</h3><button type="button" className="ghost" onClick={() => setSelectedProfile(null)}>닫기</button></div>
          <ProfileOverviewCard profile={selectedProfile} expanded />
        </section>
      ) : null}

      {error ? <div className="card error">{error}</div> : null}


      <div className="feed-post-list">
        {items.length ? items.map((item, index) => (
          <React.Fragment key={`feed-post-wrap-${item.id}-${item.created_at}`}>
            <FeedPostCard item={item} onOpenProfile={setSelectedProfile} onFriendRequest={handleFriendRequest} />
            {(index + 1) % 5 === 0 ? <MonetizationAdBanner placement="home_feed_inline" className="feed-inline-ad" compact /> : null}
            {directAds.length && (index + 1) % 4 === 0 ? <DirectAdCard item={directAds[index % directAds.length]} compact /> : null}
          </React.Fragment>
        )) : (
          <div className="card">현재 표시할 피드가 없습니다. 먼저 피드를 작성해보세요.</div>
        )}
      </div>

      <div ref={loadMoreRef} className="feed-loading-zone">
        {loading ? <div className="card">피드를 불러오는 중...</div> : hasMore ? <div className="muted small-text">스크롤을 내려 다음 피드를 불러옵니다.</div> : <div className="muted small-text">마지막 피드까지 모두 확인했습니다.</div>}
      </div>
    </div>
  )
}

function FriendsPage() {
  const navigate = useNavigate()
  const currentUser = getStoredUser() || {}
  const [friends, setFriends] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [profiles, setProfiles] = useState([])
  const [tab, setTab] = useState('list')
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)

  async function load() {
    const [friendsData, requestData, profileData] = await Promise.all([api('/api/friends'), api('/api/friends/requests'), api('/api/profiles')])
    setFriends(friendsData.items || [])
    setRequests({ incoming: requestData.incoming || [], outgoing: requestData.outgoing || [] })
    setProfiles(profileData.items || [])
  }

  useEffect(() => { load() }, [])

  const activeProfile = useMemo(() => {
    const activeId = getStoredActiveProfileId()
    return profiles.find(item => Number(item.id) === Number(activeId)) || profiles[0] || null
  }, [profiles])

  async function respondRequest(requestId, action) {
    await api(`/api/friends/requests/${requestId}/respond`, { method: 'POST', body: JSON.stringify({ action }) })
    await load()
  }

  async function blockFriend(item) {
    if (!window.confirm(`${item.nickname || item.name || '이 사용자'}를 차단하시겠습니까?`)) return
    await api(`/api/blocks/${item.id}`, { method: 'POST' })
    setOpenMenuId(null)
    await load()
  }

  function openFriendProfile(item) {
    setSelectedFriend(item)
    setOpenMenuId(null)
  }

  const requestBadge = formatBadgeCount(requests.incoming.length, 999)
  const myDisplayName = activeProfile?.display_name || activeProfile?.title || currentUser.nickname || currentUser.name || '내 프로필'
  const myIntro = activeProfile?.headline || activeProfile?.bio || currentUser.one_liner || '한 줄 소개를 작성해보세요.'
  const myAvatar = activeProfile?.profile_image_url || currentUser.photo_url || ''

  return (
    <div className="stack page-stack friends-page kakao-friends-page">
      <section className="card stack friends-kakao-card">
        <div className="friends-section-label">내 프로필</div>
        <article className="friend-kakao-row friend-kakao-row-me friend-kakao-row-me-emphasis">
          <button type="button" className="friend-kakao-main friend-kakao-main-static" onClick={() => navigate('/profile')}>
            <span className="friend-kakao-avatar">{myAvatar ? <img src={myAvatar} alt={myDisplayName} /> : <span>{myDisplayName.slice(0, 1)}</span>}</span>
            <span className="friend-kakao-copy">
              <strong>{myDisplayName}</strong>
              <span className="muted small-text">{myIntro}</span>
            </span>
            <span className="friend-kakao-tag">프로필 편집</span>
          </button>
        </article>

        <div className="friends-section-meta split-row responsive-row">
          <div className="muted small-text">친구 {friends.length}명 · 받은 요청 {requests.incoming.length}건</div>
          <button type="button" className="ghost small-action-button" onClick={() => navigate('/profile')}>내 프로필 관리</button>
        </div>

        <div className="tab-row friends-tab-row kakao-friends-tabs">
          <button type="button" className={tab === 'list' ? 'tab active badge-tab-button' : 'tab badge-tab-button'} onClick={() => setTab('list')}>
            <span>목록</span>
          </button>
          <button type="button" className={tab === 'requests' ? 'tab active badge-tab-button' : 'tab badge-tab-button'} onClick={() => setTab('requests')}>
            <span>요청</span>
            {requestBadge ? <span className="count-badge tab-badge">{requestBadge}</span> : null}
          </button>
        </div>

        {tab === 'list' ? (
          <>
            <div className="friends-section-label">친구 목록</div>
            <div className="friends-kakao-list">
            {friends.length ? friends.map(item => {
              const displayName = item.nickname || item.name || '사용자'
              const intro = item.one_liner || item.email || '한 줄 소개가 없습니다.'
              return (
                <article key={item.id} className="friend-kakao-row">
                  <button type="button" className="friend-kakao-main" onClick={() => openFriendProfile(item)}>
                    <span className="friend-kakao-avatar">{item.photo_url ? <img src={item.photo_url} alt={displayName} /> : <span>{displayName.slice(0, 1)}</span>}</span>
                    <span className="friend-kakao-copy">
                      <strong>{displayName}</strong><VerifiedBadge profile={profile} compact />
                      <span className="muted small-text">{intro}</span>
                    </span>
                  </button>
                  <div className="friend-kakao-actions">
                    <button type="button" className="ghost icon-button friend-chat-icon-button" onClick={() => navigate('/chats')} aria-label="채팅" title="채팅">
                      <IconGlyph name="chatMini" label="채팅" />
                    </button>
                    <div className="friend-more-wrap">
                      <button type="button" className="ghost icon-button friend-more-button" onClick={() => setOpenMenuId(current => current === item.id ? null : item.id)} aria-label="더보기" title="더보기">
                        <IconGlyph name="more" label="더보기" />
                      </button>
                      {openMenuId === item.id ? (
                        <div className="friend-row-menu floating-popup">
                          <button type="button" className="ghost friend-row-menu-item" onClick={() => blockFriend(item)}>친구차단</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            }) : <div className="muted">친구 목록이 없습니다.</div>}
            </div>
          </>
        ) : (
          <div className="friends-request-board stack">
            {requests.incoming.length ? requests.incoming.map(item => (
              <article key={`incoming-${item.id}`} className="friend-kakao-row friend-request-row">
                <button type="button" className="friend-kakao-main" onClick={() => openFriendProfile(item)}>
                  <span className="friend-kakao-avatar">{item.photo_url ? <img src={item.photo_url} alt={item.nickname || item.name || '사용자'} /> : <span>{(item.nickname || item.name || '사').slice(0, 1)}</span>}</span>
                  <span className="friend-kakao-copy">
                    <strong>{item.nickname || item.name || '사용자'}</strong>
                    <span className="muted small-text">나에게 새 친구요청을 보냈습니다.</span>
                  </span>
                </button>
                <div className="action-wrap compact-friend-request-actions">
                  <button type="button" onClick={() => respondRequest(item.id, 'accept')}>수락</button>
                  <button type="button" className="ghost" onClick={() => respondRequest(item.id, 'reject')}>거절</button>
                </div>
              </article>
            )) : <div className="muted">받은 친구 요청이 없습니다.</div>}
          </div>
        )}
      </section>

      {selectedFriend ? (
        <ModalFrame title={selectedFriend.nickname || selectedFriend.name || '친구 프로필'} onClose={() => setSelectedFriend(null)} className="friend-profile-modal">
          <section className="profile-showcase profile-showcase-expanded friend-profile-modal-card">
            <div className="profile-meta profile-meta-overlap friend-profile-header">
              <div className="avatar large-avatar profile-avatar-overlap">{selectedFriend.photo_url ? <img src={selectedFriend.photo_url} alt={selectedFriend.nickname || selectedFriend.name || '친구'} /> : <span>{(selectedFriend.nickname || selectedFriend.name || '사').slice(0, 1)}</span>}</div>
              <div className="profile-head-copy">
                <h3>{selectedFriend.nickname || selectedFriend.name || '사용자'}</h3>
                <div className="muted">{selectedFriend.one_liner || '한 줄 소개가 없습니다.'}</div>
                <div className="muted small-text">{selectedFriend.email || '이메일 정보 없음'}</div>
                {selectedFriend.primary_profile_slug ? <div className="muted small-text">공개 프로필: /p/{selectedFriend.primary_profile_slug}</div> : null}
              </div>
            </div>
            <div className="split-row responsive-row friend-profile-modal-actions">
              <button type="button" onClick={() => navigate('/chats')}>채팅하기</button>
              <button type="button" className="ghost" onClick={() => setSelectedFriend(null)}>닫기</button>
            </div>
          </section>
        </ModalFrame>
      ) : null}
    </div>
  )
}

function ChatsPage() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [rooms, setRooms] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [chatError, setChatError] = useState('')
  const [activeCategory, setActiveCategory] = useState('전체')
  const [customCategories, setCustomCategories] = useState(getStoredChatCategories)
  const [roomCategories, setRoomCategories] = useState(getStoredChatRoomCategories)
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [myProfiles, setMyProfiles] = useState([])
  const [chatUploading, setChatUploading] = useState(false)
  const wsRef = useRef(null)
  const boardRef = useRef(null)
  const filePickerRef = useRef(null)
  const requestedUserId = Number(searchParams.get('user') || location.state?.userId || 0)

  async function loadRooms(keepSelectedUserId = null) {
    const data = await api('/api/chats')
    const items = data.items || []
    setRooms(items)
    const preferredUserId = Number(keepSelectedUserId || selected?.user_id || 0)
    if (preferredUserId) {
      const matched = items.find(item => Number(item.user_id) === preferredUserId)
      if (matched) {
        setSelected(matched)
        return
      }
    }
    setSelected(items[0] || null)
  }

  async function loadMessages(otherUserId) {
    const data = await api(`/api/chats/direct/${otherUserId}/messages`)
    setMessages(data.items || [])
    setStoredChatLastViewedAt(new Date().toISOString())
  }

  useEffect(() => {
    setStoredChatLastViewedAt(new Date().toISOString())
    loadRooms(requestedUserId || null).catch(err => setChatError(err.message || '채팅 목록을 불러오지 못했습니다.'))
  }, [])

  useEffect(() => {
    setStoredChatCategories(customCategories)
  }, [customCategories])

  useEffect(() => {
    setStoredChatRoomCategories(roomCategories)
  }, [roomCategories])

  useEffect(() => {
    if (!requestedUserId || !rooms.length) return
    const matched = rooms.find(item => Number(item.user_id) === Number(requestedUserId))
    if (matched && Number(selected?.user_id) !== Number(matched.user_id)) {
      setSelected(matched)
    }
  }, [requestedUserId, rooms, selected?.user_id])


  useEffect(() => {
    api('/api/profiles')
      .then(data => setMyProfiles(Array.isArray(data) ? data : []))
      .catch(() => setMyProfiles([]))
  }, [])

  useEffect(() => {
    if (!selected) return
    loadMessages(selected.user_id).catch(err => setChatError(err.message || '메시지를 불러오지 못했습니다.'))
    if (wsRef.current) wsRef.current.close()
    const base = getApiBase() || window.location.origin
    const wsBase = base.replace(/^http/, 'ws')
    const ws = new WebSocket(`${wsBase}/ws/chats/${selected.user_id}?token=${encodeURIComponent(getToken())}`)
    wsRef.current = ws
    ws.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.type === 'message') {
        setMessages(prev => [...prev, data.item])
        loadRooms(selected.user_id).catch(() => null)
      }
    }
    ws.onerror = async () => {
      try {
        await loadMessages(selected.user_id)
      } catch (err) {
        setChatError(err.message || '메시지를 다시 불러오지 못했습니다.')
      }
    }
    return () => ws.close()
  }, [selected?.user_id])

  useEffect(() => {
    if (!boardRef.current) return
    boardRef.current.scrollTop = boardRef.current.scrollHeight
  }, [messages])

  async function sendMessageText(text) {
    const normalized = String(text || '').trim()
    if (!selected || !normalized) return
    setChatError('')
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(normalized)
      } else {
        await api(`/api/chats/direct/${selected.user_id}/messages`, { method: 'POST', body: JSON.stringify({ message: normalized }) })
        await loadMessages(selected.user_id)
      }
      await loadRooms(selected.user_id)
    } catch (err) {
      setChatError(err.message || '메시지 전송에 실패했습니다.')
      throw err
    }
  }

  async function send() {
    if (!selected || !message.trim()) return
    await sendMessageText(message)
    setMessage('')
  }

  function handleAddCategory() {
    const next = window.prompt('새 채팅 카테고리 이름을 입력하세요.', '')
    const value = String(next || '').trim()
    if (!value) return
    if (['전체', '안읽음'].includes(value)) {
      window.alert('기본 카테고리 이름은 사용할 수 없습니다.')
      return
    }
    if (customCategories.includes(value)) {
      setActiveCategory(value)
      return
    }
    setCustomCategories(prev => [...prev, value])
    setActiveCategory(value)
  }

  function assignCategory(room) {
    const current = roomCategories[String(room.user_id)] || ''
    const optionText = customCategories.length
      ? customCategories.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '생성된 카테고리가 없습니다.'
    const input = window.prompt(`카테고리 번호를 입력하세요.
0. 분류 해제
${optionText}`, current ? String(customCategories.indexOf(current) + 1) : '')
    if (input === null) return
    const trimmed = String(input).trim()
    if (!trimmed || trimmed === '0') {
      setRoomCategories(prev => {
        const next = { ...prev }
        delete next[String(room.user_id)]
        return next
      })
      return
    }
    const index = Number(trimmed) - 1
    if (!Number.isInteger(index) || index < 0 || index >= customCategories.length) {
      window.alert('올바른 번호를 입력하세요.')
      return
    }
    const selectedCategory = customCategories[index]
    setRoomCategories(prev => ({ ...prev, [String(room.user_id)]: selectedCategory }))
    setActiveCategory(selectedCategory)
  }

  const filteredRooms = rooms.filter(room => {
    if (activeCategory === '전체') return true
    const roomCategory = roomCategories[String(room.user_id)] || ''
    const unreadCount = Number(room.unread_count || 0)
    if (activeCategory === '안읽음') return unreadCount > 0
    return roomCategory === activeCategory
  })

  useEffect(() => {
    if (!filteredRooms.length) {
      setSelected(null)
      return
    }
    if (!selected || !filteredRooms.some(item => Number(item.user_id) === Number(selected.user_id))) {
      setSelected(filteredRooms[0])
    }
  }, [activeCategory, rooms.length, selected?.user_id, JSON.stringify(filteredRooms.map(item => item.user_id))])

  const activeProfileId = getStoredActiveProfileId()
  const selectedProfile = useMemo(() => {
    if (!myProfiles.length) return null
    return myProfiles.find(item => Number(item.id) === Number(activeProfileId)) || myProfiles[0] || null
  }, [myProfiles, activeProfileId])

  async function sendBusinessCardPhoto() {
    if (!selectedProfile?.cover_image_url) {
      window.alert('선택된 멀티프로필에 명함 이미지가 없습니다. 프로필에서 명함 이미지를 먼저 등록해주세요.')
      return
    }
    const publicUrl = selectedProfile?.slug ? getPublicProfileUrl(selectedProfile.slug) : ''
    const lines = ['[명함사진]']
    lines.push(selectedProfile.cover_image_url)
    if (publicUrl) lines.push(`프로필: ${publicUrl}`)
    await sendMessageText(lines.join('\n'))
    setAttachmentMenuOpen(false)
  }

  async function sendProfileLink() {
    if (!selectedProfile?.slug) {
      window.alert('선택된 멀티프로필의 공개 slug가 없습니다. 프로필에서 공개 주소를 먼저 등록해주세요.')
      return
    }
    const publicUrl = getPublicProfileUrl(selectedProfile.slug)
    const title = selectedProfile.display_name || selectedProfile.title || '프로필'
    await sendMessageText(`[프로필링크] ${title}\n${publicUrl}`)
    setAttachmentMenuOpen(false)
  }

  async function sendIntroduction() {
    const introductions = Array.isArray(selectedProfile?.introductions) ? selectedProfile.introductions : []
    if (!introductions.length) {
      window.alert('선택된 멀티프로필에 자기소개서가 없습니다.')
      return
    }
    const intro = introductions[0]
    const title = [intro.company, intro.job].filter(Boolean).join(' / ') || intro.title || '자기소개서'
    const content = String(intro.content || '').trim()
    if (!content) {
      window.alert('전송할 자기소개서 내용이 없습니다.')
      return
    }
    await sendMessageText(`[자기소개서] ${title}\n${content}`)
    setAttachmentMenuOpen(false)
  }

  async function sendSelectedLink() {
    const links = Array.isArray(selectedProfile?.links) ? selectedProfile.links.filter(item => item?.url || item?.original_url || item?.full_short_url) : []
    if (!links.length) {
      window.alert('선택된 멀티프로필에 링크가 없습니다.')
      return
    }
    const optionText = links.map((item, index) => `${index + 1}. ${item.title || item.label || item.url || item.original_url}`).join('\n')
    const input = window.prompt(`전송할 링크 번호를 입력하세요.
${optionText}`, '1')
    if (input === null) return
    const index = Number(String(input).trim()) - 1
    if (!Number.isInteger(index) || index < 0 || index >= links.length) {
      window.alert('올바른 번호를 입력하세요.')
      return
    }
    const item = links[index]
    const url = item.full_short_url || item.url || item.original_url || ''
    if (!url) {
      window.alert('선택한 링크의 URL이 없습니다.')
      return
    }
    await sendMessageText(`[링크선택] ${item.title || item.label || '링크'}\n${url}`)
    setAttachmentMenuOpen(false)
  }

  async function handlePickedFile(file) {
    if (!selected || !file) return
    setChatUploading(true)
    setChatError('')
    try {
      const contentType = String(file.type || '').toLowerCase()
      if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
        const formData = new FormData()
        formData.append('file', file)
        await api(`/api/chats/direct/${selected.user_id}/attachments`, {
          method: 'POST',
          body: formData,
        })
        await loadMessages(selected.user_id)
        await loadRooms(selected.user_id)
      } else {
        const uploaded = await uploadFile(file, 'vault', selectedProfile?.id || null)
        const uploadedUrl = uploaded?.item?.url || uploaded?.url || ''
        await sendMessageText(`[파일선택] ${file.name}${uploadedUrl ? `\n${uploadedUrl}` : ''}`)
      }
      setAttachmentMenuOpen(false)
    } catch (err) {
      setChatError(err.message || '파일 전송에 실패했습니다.')
    } finally {
      setChatUploading(false)
      if (filePickerRef.current) filePickerRef.current.value = ''
    }
  }

  const chatAttachmentActions = [
    { key: 'business-card', label: '명함사진', icon: '🪪', onClick: sendBusinessCardPhoto },
    { key: 'profile-link', label: '프로필링크', icon: '👤', onClick: sendProfileLink },
    { key: 'introduction', label: '자기소개서', icon: '📝', onClick: sendIntroduction },
    { key: 'link-select', label: '링크선택', icon: '🔗', onClick: sendSelectedLink },
    { key: 'file-select', label: '파일선택', icon: '📁', onClick: () => filePickerRef.current?.click() },
  ]

  return (
    <div className="chat-page-stack">
      <section className="card stack chat-category-card">
        <div className="chat-category-scroll" role="tablist" aria-label="채팅 카테고리">
          {['전체', '안읽음', ...customCategories].map(category => (
            <button
              key={category}
              type="button"
              className={activeCategory === category ? 'chat-category-chip active' : 'chat-category-chip ghost'}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
          <button type="button" className="chat-category-add-button ghost" onClick={handleAddCategory} aria-label="카테고리 추가" title="카테고리 추가">
            <IconGlyph name="compose" label="카테고리 추가" />
          </button>
        </div>
      </section>

      <div className="chat-layout-modern">
        <section className="card stack chat-list-card">
          <div className="chat-list-header-row">
            <h3>채팅</h3>
            <span className="muted small-text">{filteredRooms.length}개</span>
          </div>
          <div className="chat-list-modern">
            {filteredRooms.length ? filteredRooms.map(room => {
              const previewLines = getRoomPreviewLines(room)
              const isActive = Number(selected?.user_id) === Number(room.user_id)
              const roomCategory = roomCategories[String(room.user_id)] || ''
              const unreadCount = Number(room.unread_count || 0)
              return (
                <button key={room.user_id} type="button" className={isActive ? 'chat-list-item active' : 'chat-list-item'} onClick={() => setSelected(room)}>
                  <div className="chat-list-avatar-wrap">
                    <div className="avatar chat-list-avatar">{room.photo_url ? <img src={room.photo_url} alt={room.nickname || '프로필'} /> : <span>{String(room.nickname || room.name || '채').slice(0, 1)}</span>}</div>
                  </div>
                  <div className="chat-list-main">
                    <div className="chat-list-row chat-list-row-top">
                      <strong className="chat-list-name">{room.nickname || room.name || '채팅방'}</strong>
                      <span className="chat-list-time">{formatChatListTime(room.updated_at || room.last_message_at || room.created_at)}</span>
                    </div>
                    <div className="chat-list-row"><span className="chat-list-preview">{previewLines[0]}</span></div>
                    <div className="chat-list-row"><span className="chat-list-preview muted">{previewLines[1]}</span></div>
                    <div className="chat-list-meta-row">
                      {roomCategory ? <span className="chip">{roomCategory}</span> : <span className="muted small-text">미분류</span>}
                      <span className="chat-list-actions-inline">
                        {unreadCount > 0 ? <span className="count-badge">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
                        <span
                          role="button"
                          tabIndex={0}
                          className="chat-assign-link"
                          onClick={event => { event.stopPropagation(); assignCategory(room) }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              assignCategory(room)
                            }
                          }}
                        >
                          분류설정
                        </span>
                      </span>
                    </div>
                  </div>
                </button>
              )
            }) : <div className="muted">표시할 채팅이 없습니다.</div>}
          </div>
        </section>

        <section className="card stack chat-thread-card">
          <h3>{selected ? `${selected.nickname || selected.name || '채팅방'} 대화` : '대화상대 선택'}</h3>
          <div className="message-board" ref={boardRef}>
            {messages.length ? messages.map(item => (
              <div key={item.id} className={`message-item ${item.sender_id === selected?.user_id ? 'incoming' : 'outgoing'}`}>
                {item.has_attachment ? (String(item.message_type || '').startsWith('video') ? <video src={item.attachment_url} poster={item.attachment_preview_url || undefined} controls playsInline preload="metadata" /> : <img src={item.attachment_preview_url || item.attachment_url} alt={item.attachment_name || '첨부'} loading="eager" />) : null}
                <div>{item.message}</div>
                <div className="muted small-text">{formatDateLabel(item.created_at)}</div>
                {item.has_attachment ? <div className="muted small-text">첨부 {item.attachment_size_mb}MB</div> : null}
              </div>
            )) : <div className="muted">선택한 채팅의 메시지가 없습니다.</div>}
          </div>
          {chatError ? <div className="alert error">{chatError}</div> : null}
          <div className="inline-form chat-input-row chat-input-row-modern">
            <button
              type="button"
              className={attachmentMenuOpen ? 'chat-plus-button active' : 'chat-plus-button'}
              onClick={() => setAttachmentMenuOpen(current => !current)}
              aria-label="보내기 기능 열기"
              title="보내기 기능"
            >
              +
            </button>
            <input value={message} onChange={e => setMessage(e.target.value)} placeholder="메시지 입력" onKeyDown={e => { if (e.key === 'Enter') send() }} />
            <button type="button" onClick={send} disabled={chatUploading}>{chatUploading ? '전송중...' : '전송'}</button>
          </div>
          <input
            ref={filePickerRef}
            type="file"
            className="chat-hidden-file-input"
            onChange={e => handlePickedFile(e.target.files?.[0] || null)}
          />
          {attachmentMenuOpen ? (
            <div className="chat-attachment-sheet" role="dialog" aria-modal="true" aria-label="보내기 메뉴">
              <button type="button" className="chat-attachment-sheet-backdrop" onClick={() => setAttachmentMenuOpen(false)} aria-label="보내기 메뉴 닫기" />
              <div className="chat-attachment-sheet-panel card stack">
                <div className="chat-attachment-sheet-head">
                  <strong>보내기</strong>
                  <button type="button" className="ghost small-button" onClick={() => setAttachmentMenuOpen(false)}>닫기</button>
                </div>
                <div className="muted small-text">선택한 멀티프로필의 명함, 프로필 링크, 자기소개서, 링크, 파일을 빠르게 보낼 수 있습니다.</div>
                <div className="chat-attachment-grid">
                  {chatAttachmentActions.map(item => (
                    <button key={item.key} type="button" className="chat-attachment-action" onClick={item.onClick} disabled={chatUploading}>
                      <span className="chat-attachment-action-icon" aria-hidden="true">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

const COMMUNITY_CATEGORY_OPTIONS = {
  전체: ['전체'],
  일반: ['전체', '자유', '소개', '공지'],
  연애: ['전체', '소개팅', '썸', '연애고민'],
  고민: ['전체', '상담', '인간관계', '진로'],
  취미: ['전체', '운동', '여행', '게임'],
  동네: ['전체', '맛집', '모임', '생활정보'],
  일상: ['전체', '사진', '하루기록', '잡담'],
}

function CommunityComposerPage() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [attachmentFile, setAttachmentFile] = useState(null)
  const [form, setForm] = useState({ primary_category: '일반', secondary_category: '자유', title: '', content: '' })

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    try {
      setSubmitting(true)
      setError('')
      let attachment_url = ''
      if (attachmentFile) {
        const uploaded = await uploadFile(attachmentFile, 'community', null)
        attachment_url = uploaded?.item?.url || uploaded?.url || ''
      }
      await api('/api/community/posts', {
        method: 'POST',
        body: JSON.stringify({ ...form, attachment_url }),
      })
      navigate('/community', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const secondaryOptions = COMMUNITY_CATEGORY_OPTIONS[form.primary_category] || ['자유']

  return (
    <div className="stack page-stack community-compose-page">
      <section className="card stack community-compose-page-card">
        <div className="split-row responsive-row">
          <div className="inline-form">
            <BackIconButton onClick={() => navigate('/community')} />
            <h3>대화 작성</h3>
          </div>
        </div>
        <form className="stack community-compose-form" onSubmit={handleSubmit}>
          <div className="community-compose-top-grid">
            <TextField label="카테고리">
              <select value={form.primary_category} onChange={e => setForm(current => ({ ...current, primary_category: e.target.value, secondary_category: (COMMUNITY_CATEGORY_OPTIONS[e.target.value] || ['자유'])[1] || '자유' }))}>
                {Object.keys(COMMUNITY_CATEGORY_OPTIONS).filter(item => item !== '전체').map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </TextField>
            <TextField label="제목">
              <input value={form.title} onChange={e => setForm(current => ({ ...current, title: e.target.value.slice(0, 120) }))} placeholder="제목을 입력하세요" />
            </TextField>
          </div>
          <TextField label="세부카테고리">
            <select value={form.secondary_category} onChange={e => setForm(current => ({ ...current, secondary_category: e.target.value }))}>
              {secondaryOptions.filter(item => item !== '전체').map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </TextField>
          <TextField label="내용">
            <textarea rows={10} value={form.content} onChange={e => setForm(current => ({ ...current, content: e.target.value.slice(0, 4000) }))} placeholder="내용을 입력하세요" className="community-compose-content" />
          </TextField>
          <TextField label="파일첨부">
            <input type="file" accept="image/*" onChange={e => setAttachmentFile(e.target.files?.[0] || null)} />
          </TextField>
          {error ? <div className="card error">{error}</div> : null}
          <div className="split-row responsive-row">
            <div className="muted small-text">한 화면에서 카테고리, 제목, 내용, 파일첨부를 모두 등록할 수 있습니다.</div>
            <button type="submit" disabled={submitting}>{submitting ? '등록 중...' : '등록'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CommunityPage({ user }) {
  const navigate = useNavigate()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [primaryCategory, setPrimaryCategory] = useState('전체')
  const [secondaryCategory, setSecondaryCategory] = useState('전체')
  const [draftPrimaryCategory, setDraftPrimaryCategory] = useState('전체')
  const [draftSecondaryCategory, setDraftSecondaryCategory] = useState('전체')

  async function load(nextPrimary = primaryCategory, nextSecondary = secondaryCategory) {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('primary_category', nextPrimary)
      params.set('secondary_category', nextSecondary)
      const data = await api(`/api/community/posts?${params.toString()}`)
      setPosts(data.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load('전체', '전체') }, [])

  function handleSearch() {
    setPrimaryCategory(draftPrimaryCategory)
    setSecondaryCategory(draftSecondaryCategory)
    load(draftPrimaryCategory, draftSecondaryCategory)
  }

  return (
    <div className="stack page-stack community-page">
      <section className="card stack community-head-card">
        <div className="community-toolbar-row">
          <select value={draftPrimaryCategory} onChange={e => {
            const nextPrimary = e.target.value
            setDraftPrimaryCategory(nextPrimary)
            setDraftSecondaryCategory('전체')
          }}>
            {Object.keys(COMMUNITY_CATEGORY_OPTIONS).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={draftSecondaryCategory} onChange={e => setDraftSecondaryCategory(e.target.value)}>
            {(COMMUNITY_CATEGORY_OPTIONS[draftPrimaryCategory] || ['전체']).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <button type="button" className="community-search-button" onClick={handleSearch} aria-label="검색" title="검색">
            <IconGlyph name="search" label="검색" />
          </button>
          <button type="button" className="community-write-button" onClick={() => navigate('/community/new')}>작성</button>
        </div>
      </section>
      {error ? <div className="card error">{error}</div> : null}
      <section className="stack community-post-list community-board-list">
        {loading ? <div className="card">불러오는 중...</div> : posts.length ? posts.map(post => (
          <CommunityPostCard key={`community-${post.id}-${post.created_at}`} item={post} />
        )) : <div className="card">표시할 대화 글이 없습니다.</div>}
      </section>
    </div>
  )
}

function CommunityPostCard({ item }) {
  const displayName = item.author?.nickname || item.author?.name || '사용자'
  return (
    <article className="community-list-card">
      <div className="community-list-main">
        <div className="community-list-badges">
          <span className="chip">{item.primary_category || item.category || '일반'}</span>
          <span className="chip muted-chip">{item.secondary_category || '자유'}</span>
        </div>
        <strong className="community-list-title">{item.title}</strong>
        <div className="community-list-summary">{item.summary || item.content}</div>
      </div>
      <div className="community-list-meta muted small-text">{displayName} · {formatFeedTimestamp(item.created_at)}</div>
    </article>
  )
}

function QuestionsPage() {
  const [profiles, setProfiles] = useState([])
  const [selectedId, setSelectedId] = useState(() => getStoredActiveProfileId())
  const selected = useMemo(() => profiles.find(item => item.id === selectedId) || null, [profiles, selectedId])

  async function loadProfiles(preferredId = selectedId) {
    const data = await api('/api/profiles')
    const items = data.items || []
    setProfiles(items)
    const resolvedId = items.some(item => item.id === preferredId) ? preferredId : items[0]?.id || null
    setSelectedId(resolvedId)
    setStoredActiveProfileId(resolvedId)
  }

  useEffect(() => { loadProfiles() }, [])
  useEffect(() => { setStoredActiveProfileId(selectedId) }, [selectedId])

  useEffect(() => {
    function handleActiveProfileChange(event) {
      const nextId = Number(event?.detail?.profileId || getStoredActiveProfileId()) || null
      loadProfiles(nextId)
    }
    window.addEventListener('historyprofile:active-profile-change', handleActiveProfileChange)
    return () => window.removeEventListener('historyprofile:active-profile-change', handleActiveProfileChange)
  }, [selectedId])

  async function refreshSelected() {
    const data = await api('/api/profiles')
    setProfiles(data.items || [])
  }

  return (
    <div className="stack page-stack questions-page">
      {selected ? <QuestionBoard profile={selected} ownerNickname={getStoredUser()?.nickname || '나'} isOwner onRefresh={refreshSelected} canAsk={false} /> : <div className="card">질문을 관리할 프로필이 없습니다.</div>}
    </div>
  )
}

function ProfilePage() {
  const [profiles, setProfiles] = useState([])
  const [selectedId, setSelectedId] = useState(() => getStoredActiveProfileId())
  const [tab, setTab] = useState('hub')
  const [busy, setBusy] = useState(false)
  const [profileForm, setProfileForm] = useState(emptyProfile())
  const [careerForm, setCareerForm] = useState(emptyCareer())
  const [introForm, setIntroForm] = useState({ title: '', category: 'freeform', content: '', is_public: false })
  const [linkForm, setLinkForm] = useState({ title: '', original_url: '', short_code: '', link_type: 'external', is_public: true })
  const [qrForm, setQrForm] = useState({ title: '', target_url: '', is_public: true })
  const [plan, setPlan] = useState(null)
  const [usage, setUsage] = useState(null)
  const [multiProfileModalOpen, setMultiProfileModalOpen] = useState(false)
  const [multiProfileBusy, setMultiProfileBusy] = useState(false)
  const [multiProfileForm, setMultiProfileForm] = useState({ display_name: '', gender: '', age_or_birth_year: '' })
  const location = useLocation()

  const selected = useMemo(() => profiles.find(item => item.id === selectedId) || null, [profiles, selectedId])

  async function load(preferredId = selectedId) {
    const [profileData, planData] = await Promise.all([api('/api/profiles'), api('/api/plan')])
    const items = profileData.items || []
    setProfiles(items)
    setPlan(planData.plan)
    setUsage(planData.usage)
    const resolvedId = items.some(item => item.id === preferredId) ? preferredId : items[0]?.id || null
    setSelectedId(resolvedId)
    setStoredActiveProfileId(resolvedId)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    function handleActiveProfileChange(event) {
      const nextId = Number(event?.detail?.profileId || getStoredActiveProfileId()) || null
      load(nextId)
    }
    window.addEventListener('historyprofile:active-profile-change', handleActiveProfileChange)
    return () => window.removeEventListener('historyprofile:active-profile-change', handleActiveProfileChange)
  }, [selectedId])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const requestedTab = params.get('tab')
    if (requestedTab) setTab(requestedTab)
  }, [location.search])
  useEffect(() => {
    if (selected) setProfileForm(mapProfileToForm(selected))
  }, [selected])

  async function saveProfile() {
    setBusy(true)
    try {
      if (selected) {
        await api(`/api/profiles/${selected.id}`, { method: 'PATCH', body: JSON.stringify(profileForm) })
      } else {
        await api('/api/profiles', { method: 'POST', body: JSON.stringify(profileForm) })
      }
      await load()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function addCareer() {
    if (!selected) return
    await api(`/api/profiles/${selected.id}/careers`, { method: 'POST', body: JSON.stringify(careerForm) })
    setCareerForm(emptyCareer())
    await load()
    setTab('career')
  }

  async function addIntro() {
    if (!selected) return
    await api(`/api/profiles/${selected.id}/introductions`, { method: 'POST', body: JSON.stringify(introForm) })
    setIntroForm({ title: '', category: 'freeform', content: '', is_public: false })
    await load()
    setTab('intro')
  }

  async function addLink() {
    if (!selected) return
    await api(`/api/profiles/${selected.id}/links`, { method: 'POST', body: JSON.stringify(linkForm) })
    setLinkForm({ title: '', original_url: '', short_code: '', link_type: 'external', is_public: true })
    await load()
    setTab('link')
  }

  async function addQr() {
    if (!selected) return
    await api(`/api/profiles/${selected.id}/qrs`, { method: 'POST', body: JSON.stringify(qrForm) })
    setQrForm({ title: '', target_url: '', is_public: true })
    await load()
    setTab('qr')
  }

  function openMultiProfileModal() {
    setMultiProfileForm({ display_name: '', gender: '', age_or_birth_year: '' })
    setMultiProfileModalOpen(true)
  }

  async function createNewProfile() {
    const displayName = multiProfileForm.display_name.trim()
    if (!displayName) {
      window.alert('닉네임을 입력해주세요.')
      return
    }
    const birthYear = normalizeBirthYearInput(multiProfileForm.age_or_birth_year)
    setMultiProfileBusy(true)
    try {
      const payload = {
        ...emptyProfile(),
        title: displayName,
        display_name: displayName,
        gender: multiProfileForm.gender,
        birth_year: birthYear,
      }
      const data = await api('/api/profiles', { method: 'POST', body: JSON.stringify(payload) })
      const createdId = data?.item?.id || null
      await load(createdId)
      setSelectedId(createdId)
      setStoredActiveProfileId(createdId)
      setProfileForm(mapProfileToForm(data?.item || payload))
      setTab('hub')
      setMultiProfileModalOpen(false)
    } catch (err) {
      window.alert(err.message)
    } finally {
      setMultiProfileBusy(false)
    }
  }

  async function deleteSelectedProfile() {
    if (!selected) return
    if (!window.confirm('선택한 멀티프로필을 삭제하시겠습니까?')) return
    setMultiProfileBusy(true)
    try {
      await api(`/api/profiles/${selected.id}`, { method: 'DELETE' })
      await load()
      setMultiProfileModalOpen(false)
    } catch (err) {
      window.alert(err.message)
    } finally {
      setMultiProfileBusy(false)
    }
  }

  async function uploadMedia(targetSetter, category = 'profile', accept = 'image/*,video/*') {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const uploaded = await uploadFile(file, category, selected?.id || null)
        targetSetter(uploaded.url, uploaded)
        await load()
      } catch (err) {
        window.alert(err.message)
      }
    }
    input.click()
  }

  function addCareerMedia(url, uploaded) {
    const item = { url, media_kind: uploaded?.content_type?.startsWith('video/') ? 'video' : 'image', content_type: uploaded?.content_type || '' }
    setCareerForm(prev => ({
      ...prev,
      image_url: prev.image_url || (item.media_kind === 'image' ? url : prev.image_url),
      media_items: [...prev.media_items, item],
      gallery_json: item.media_kind === 'image' ? [...prev.gallery_json, url] : prev.gallery_json,
    }))
  }

  return (
    <div className="stack page-stack">
      <section className="card stack">
        <MultiProfileSelector profiles={profiles} selectedId={selectedId} setSelectedId={setSelectedId} onOpenModal={openMultiProfileModal} onDeleteSelected={deleteSelectedProfile} deleteDisabled={!selected || multiProfileBusy} />
        {multiProfileModalOpen ? (
          <ModalFrame title="멀티프로필 관리" onClose={() => !multiProfileBusy && setMultiProfileModalOpen(false)} className="full-screen-modal">
            <div className="stack">
              <div className="bordered-box stack">
                <strong>생성된 멀티프로필</strong>
                <div className="list compact-list">
                  {profiles.length ? profiles.map(item => (
                    <button key={item.id} type="button" className={item.id === selectedId ? 'list-row active-row' : 'list-row'} onClick={() => { setSelectedId(item.id); setStoredActiveProfileId(item.id) }}>
                      <span>{item.display_name || item.title}</span>
                      <span className="muted small-text">{item.gender || '성별 미입력'}{item.birth_year ? ` · ${item.birth_year}` : ''}</span>
                    </button>
                  )) : <div className="muted">생성된 멀티프로필이 없습니다.</div>}
                </div>
              </div>
              <div className="bordered-box stack">
                <strong>새 멀티프로필 생성</strong>
                <TextField label="닉네임" value={multiProfileForm.display_name} onChange={v => setMultiProfileForm(prev => ({ ...prev, display_name: v }))} />
                <div className="stack">
                  <label>성별</label>
                  <select value={multiProfileForm.gender} onChange={e => setMultiProfileForm(prev => ({ ...prev, gender: e.target.value }))}>
                    <option value="">선택안함</option>
                    <option value="남성">남성</option>
                    <option value="여성">여성</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <TextField label="나이 또는 생년(4자리)" value={multiProfileForm.age_or_birth_year} onChange={v => setMultiProfileForm(prev => ({ ...prev, age_or_birth_year: v.replace(/[^0-9]/g, '').slice(0, 4) }))} />
                <div className="dropdown-inline-actions">
                  <button type="button" disabled={multiProfileBusy} onClick={createNewProfile}>{multiProfileBusy ? '생성 중...' : '생성하기'}</button>
                </div>
              </div>
            </div>
          </ModalFrame>
        ) : null}
        {plan ? (
          <div className="plan-box stack gap-8">
            <div className="split-row responsive-row">
              <div className="muted">무료 기본 프로필 {plan.free_profile_limit}개 / 현재 허용 {plan.allowed_profile_count}개</div>
              <div className="action-wrap">
                <button type="button" className="ghost small-action-button" onClick={() => window.dispatchEvent(new CustomEvent('historyprofile:open-account-storage'))}>내계정용량</button>
                <button type="button" className="ghost small-action-button" onClick={() => window.dispatchEvent(new CustomEvent('historyprofile:open-plan-compare'))}>현재플랜({buildPlanTier(plan).current.grade} 등급)</button>
              </div>
            </div>
            <div>추가 슬롯 권장가: 1개당 월 {Number(plan.recommended_extra_profile_price_krw).toLocaleString()}원, 3개 번들 월 {Number(plan.recommended_extra_profile_bundle_price_krw).toLocaleString()}원</div>
          </div>
        ) : null}
        <div className="bordered-box stack gap-10 profile-mvp-priority-card">
          <div className="split-row responsive-row">
            <div>
              <strong>실전 MVP 우선순위</strong>
              <div className="muted small-text">성공 확률이 높은 순서대로 정리 → 공유 → 연결 → 신뢰 자산 → 분석 흐름을 배치했습니다.</div>
            </div>
            <Link className="button-link" to="/mvp">MVP센터 열기</Link>
          </div>
          <div className="mvp-priority-strip">
            <button type="button" className={tab === 'hub' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('hub')}><span>1</span><strong>통합 허브</strong></button>
            <button type="button" className={tab === 'profile' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('profile')}><span>2</span><strong>프로필</strong></button>
            <button type="button" className={tab === 'qr' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('qr')}><span>3</span><strong>QR 공유</strong></button>
            <button type="button" className={tab === 'link' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('link')}><span>4</span><strong>링크</strong></button>
            <button type="button" className={tab === 'intro' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('intro')}><span>5</span><strong>소개서</strong></button>
            <button type="button" className={tab === 'career' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('career')}><span>6</span><strong>경력</strong></button>
            <button type="button" className={tab === 'media' ? 'mvp-priority-chip active' : 'mvp-priority-chip'} onClick={() => setTab('media')}><span>7</span><strong>자료</strong></button>
          </div>
          <div className="tab-row wrap-row">
            {['hub', 'profile', 'qr', 'link', 'intro', 'career', 'media'].map(name => <button key={name} type="button" className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)}>{tabLabel(name)}</button>)}
          </div>
        </div>
      </section>

      {selected && plan ? <ProfileOverviewCard profile={selected} expanded /> : null}
      {selected && plan ? <ProfileBrandingHubCard profile={selected} /> : null}
      {selected && plan ? <ProfileManagementSummary profile={selected} plan={plan} usage={usage} profiles={profiles} /> : null}

      {selected && tab === 'hub' && (
        <section className="card stack">
          <div className="split-row responsive-row">
            <div className="stack gap-6">
              <h3>통합 프로필 페이지</h3>
              <div className="muted small-text">프로필 · 자기소개서 · 링크 · QR · 경력을 한 흐름으로 점검하고 공개 프로필 전환까지 연결하는 관리 탭입니다.</div>
            </div>
            <div className="chip-row">
              <span className="chip">정리</span>
              <span className="chip">연결</span>
              <span className="chip">소통</span>
            </div>
          </div>
          <div className="grid-3 profile-hub-summary-grid">
            <div className="mini-card stack gap-8">
              <strong>프로필 소개</strong>
              <div className="muted small-text">{selected.headline || '한 줄 소개를 먼저 입력해 주세요.'}</div>
              <div className="muted small-text">{selected.bio || '자기소개가 아직 없습니다.'}</div>
              <div className="muted small-text">현재 하는 일: {selected.current_work || '미입력'} · 지역: {selected.location || '미입력'}</div>
            </div>
            <div className="mini-card stack gap-8">
              <strong>공개 요소 현황</strong>
              <div className="grid-2 metric-grid-tight">
                <Metric label="자소서" value={selected.introductions.length} />
                <Metric label="링크" value={selected.links.length} />
                <Metric label="QR" value={selected.qrs.length} />
                <Metric label="질문" value={selected.questions.length} />
              </div>
              <div className="muted small-text">공개 방식: {visibilityLabel(selected.visibility_mode)} · 질문 허용: {questionPermissionLabel(selected.question_permission)}</div>
            </div>
            <div className="mini-card stack gap-8">
              <strong>빠른 실행</strong>
              <div className="action-wrap wrap-row">
                <button type="button" className="ghost" onClick={() => setTab('profile')}>기본정보 수정</button>
                <button type="button" className="ghost" onClick={() => setTab('intro')}>자소서 추가</button>
                <button type="button" className="ghost" onClick={() => setTab('link')}>링크 추가</button>
                <button type="button" className="ghost" onClick={() => setTab('qr')}>QR 추가</button>
              </div>
              <div className="action-wrap wrap-row">
                <a className="button-link" href={getPublicProfileUrl(selected.slug)} target="_blank" rel="noreferrer">공개 페이지 열기</a>
                <button type="button" className="ghost" onClick={() => copyText(getPublicProfileUrl(selected.slug), '공개 프로필 주소를 복사했습니다.')}>주소 복사</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {selected && tab === 'profile' && (
        <section className="card stack">
          <h3>프로필 기본 정보</h3>
        <div className="grid-2">
          <TextField label="이름 / 닉네임" value={profileForm.display_name} onChange={v => setProfileForm({ ...profileForm, display_name: v, title: v })} />
          <TextField label="프로필 제목" value={profileForm.title} onChange={v => setProfileForm({ ...profileForm, title: v, display_name: profileForm.display_name || v })} />
          <TextField label="공개 slug" value={profileForm.slug} onChange={v => setProfileForm({ ...profileForm, slug: v })} />
          <div className="stack">
            <label>성별</label>
            <select value={profileForm.gender} onChange={e => setProfileForm({ ...profileForm, gender: e.target.value })}>
              <option value="">선택안함</option>
              <option value="남성">남성</option>
              <option value="여성">여성</option>
              <option value="기타">기타</option>
            </select>
          </div>
          <TextField label="생년" value={profileForm.birth_year} onChange={v => setProfileForm({ ...profileForm, birth_year: v.replace(/[^0-9]/g, '').slice(0, 4) })} />
          <TextField label="한줄 소개" value={profileForm.headline} onChange={v => setProfileForm({ ...profileForm, headline: v })} />
          <TextField label="지역" value={profileForm.location} onChange={v => setProfileForm({ ...profileForm, location: v })} />
          <TextField label="현재 하는 일" value={profileForm.current_work} onChange={v => setProfileForm({ ...profileForm, current_work: v })} />
          <div className="stack">
            <label>업종 카테고리</label>
            <select value={profileForm.industry_category} onChange={e => setProfileForm({ ...profileForm, industry_category: e.target.value })}>
              {INDUSTRY_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="stack">
            <label>프로필 이미지 URL</label>
            <div className="inline-form"><input value={profileForm.profile_image_url} onChange={e => setProfileForm({ ...profileForm, profile_image_url: e.target.value })} /><button type="button" onClick={() => uploadMedia(url => setProfileForm(prev => ({ ...prev, profile_image_url: url })), 'profile', 'image/*')}>업로드</button></div>
          </div>
          <div className="stack">
            <label>명함 이미지 URL</label>
            <div className="inline-form"><input placeholder="공개 프로필 상단에 노출될 명함 이미지 URL" value={profileForm.cover_image_url} onChange={e => setProfileForm({ ...profileForm, cover_image_url: e.target.value })} /><button type="button" onClick={() => uploadMedia(url => setProfileForm(prev => ({ ...prev, cover_image_url: url })), 'business-card-cover', 'image/*')}>업로드</button></div>
            <div className="muted small-text">상대방 공개 프로필 최상단에는 명함 이미지 1장만 노출됩니다. 등록하지 않으면 흰 배경 안내 문구가 표시됩니다.</div>
          </div>
          <div className="stack full-span">
            <label>소개</label>
            <textarea value={profileForm.bio} onChange={e => setProfileForm({ ...profileForm, bio: e.target.value })} />
          </div>
          <div className="stack">
            <label>공개 방식</label>
            <select value={profileForm.visibility_mode} onChange={e => setProfileForm({ ...profileForm, visibility_mode: e.target.value })}>
              <option value="private">비공개</option>
              <option value="link_only">링크 전용 공개</option>
              <option value="search">검색엔진 노출 공개</option>
            </select>
          </div>
          <div className="stack">
            <label>피드프로필공개</label>
            <button type="button" className={profileForm.feed_profile_public ? 'tab active' : 'tab'} onClick={() => { const next = !profileForm.feed_profile_public; const ok = window.confirm(next ? '계정을 피드에 공개하시겠습니까?' : '계정을 피드에서 비공개처리 하겠습니까?'); if (!ok) return; setProfileForm({ ...profileForm, feed_profile_public: next, visibility_mode: next && profileForm.visibility_mode === 'private' ? 'link_only' : profileForm.visibility_mode }) }}>{profileForm.feed_profile_public ? '온' : '오프'}</button>
          </div>
          <div className="stack">
            <label>질문 허용 방식</label>
            <select value={profileForm.question_permission} onChange={e => setProfileForm({ ...profileForm, question_permission: e.target.value })}>
              <option value="none">질문 받지 않음</option>
              <option value="members">로그인 사용자만 허용</option>
              <option value="any">비회원 포함 누구나 허용</option>
            </select>
          </div>
        </div>
        <button disabled={busy} type="button" onClick={saveProfile}>{busy ? '저장 중...' : '프로필 저장'}</button>
        </section>
      )}

      {selected && tab === 'career' && (
        <section className="card stack">
          <h3>증빙 기반 경력 / 필모그래픽</h3>
          <div className="muted small-text">경력 텍스트에 사진, 영상, 리뷰를 함께 붙여 신뢰를 증명하는 구조로 운영합니다.</div>
          <div className="grid-2">
            <TextField label="제목" value={careerForm.title} onChange={v => setCareerForm({ ...careerForm, title: v })} />
            <TextField label="기간" value={careerForm.period} onChange={v => setCareerForm({ ...careerForm, period: v })} />
            <TextField label="한줄 설명" value={careerForm.one_line} onChange={v => setCareerForm({ ...careerForm, one_line: v })} />
            <TextField label="역할" value={careerForm.role_name} onChange={v => setCareerForm({ ...careerForm, role_name: v })} />
            <div className="stack full-span">
              <label>대표 이미지 URL</label>
              <div className="inline-form"><input value={careerForm.image_url} onChange={e => setCareerForm({ ...careerForm, image_url: e.target.value })} /><button type="button" onClick={() => uploadMedia((url, uploaded) => addCareerMedia(url, uploaded), 'career', 'image/*,video/*')}>사진/영상 업로드</button></div>
            </div>
          </div>
          <label>경험 상세</label>
          <textarea value={careerForm.description} onChange={e => setCareerForm({ ...careerForm, description: e.target.value })} />
          <label>후기 / 리뷰</label>
          <textarea value={careerForm.review_text} onChange={e => setCareerForm({ ...careerForm, review_text: e.target.value })} />
          {careerForm.media_items.length ? <MediaPreviewList items={careerForm.media_items} /> : null}
          <button type="button" onClick={addCareer}>경력 추가</button>
          <div className="list">{selected.careers.map(item => <CareerCard key={item.id} item={item} showDetail />)}</div>
        </section>
      )}

      {selected && tab === 'intro' && (
        <section className="card stack">
          <h3>자기소개서</h3>
          <TextField label="문서 제목" value={introForm.title} onChange={v => setIntroForm({ ...introForm, title: v })} />
          <label>자기소개서 내용</label>
          <textarea value={introForm.content} onChange={e => setIntroForm({ ...introForm, content: e.target.value })} />
          <label><input type="checkbox" checked={introForm.is_public} onChange={e => setIntroForm({ ...introForm, is_public: e.target.checked })} /> 공개</label>
          <button type="button" onClick={addIntro}>자기소개서 추가</button>
          <div className="list">{selected.introductions.map(item => <div key={item.id} className="bordered-box"><strong>{item.title}</strong><div className="pre-wrap">{item.content}</div></div>)}</div>
        </section>
      )}

      {selected && tab === 'link' && (
        <section className="card stack">
          <h3>URLs / 단축 링크</h3>
          <div className="grid-2">
            <TextField label="링크 제목" value={linkForm.title} onChange={v => setLinkForm({ ...linkForm, title: v })} />
            <TextField label="원본 URL" value={linkForm.original_url} onChange={v => setLinkForm({ ...linkForm, original_url: v })} />
            <TextField label="커스텀 short code(선택)" value={linkForm.short_code} onChange={v => setLinkForm({ ...linkForm, short_code: v })} />
          </div>
          <button type="button" onClick={addLink}>링크 추가</button>
          <SocialLinkList items={selected.links} editable />
        </section>
      )}

      {selected && tab === 'qr' && (
        <section className="card stack">
          <h3>QR 코드</h3>
          <div className="grid-2">
            <TextField label="QR 이름" value={qrForm.title} onChange={v => setQrForm({ ...qrForm, title: v })} />
            <TextField label="연결 URL" value={qrForm.target_url} onChange={v => setQrForm({ ...qrForm, target_url: v })} />
          </div>
          <button type="button" onClick={addQr}>QR 추가</button>
          <div className="qr-grid">{selected.qrs.map(item => <div key={item.id} className="qr-card"><img src={item.image_url} alt={item.title} /><strong>{item.title}</strong><div className="muted small-text">{item.target_url}</div></div>)}</div>
        </section>
      )}

      {selected && tab === 'media' && (
        <section className="card stack">
          <h3>저장소 / 증빙 자료</h3>
          <div className="muted">단순 파일 보관이 아니라 경력, 계약, 후기, 포트폴리오를 증명하는 근거 자료 저장소로 운영합니다. 영상은 계정당 하루 총 50MB, 전체 저장은 1GB까지입니다.</div>
          <button type="button" onClick={() => uploadMedia(() => {}, 'portfolio', 'image/*,video/*,application/pdf')}>사진·영상·PDF 업로드</button>
          {selected.uploads?.length ? <MediaPreviewList items={selected.uploads.map(item => ({ ...item, url: item.url }))} /> : <div className="muted">업로드 내역이 없습니다.</div>}
        </section>
      )}
    </div>
  )
}


function MultiProfileManagerModal({ open, profiles, busy = false, onClose, onSelect, onAdd, onUnlock }) {
  if (!open) return null
  const addLocked = profiles.length >= 3
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card stack multi-profile-manager-modal" role="dialog" aria-modal="true" aria-label="계정변경(멀티)">
        <div className="multi-profile-manager-head">
          <BackIconButton onClick={onClose} />
          <strong>계정변경(멀티)</strong>
          <span className="multi-profile-manager-head-spacer" aria-hidden="true"></span>
        </div>
        <div className="stack multi-profile-manager-list">
          {profiles.length ? profiles.map(item => (
            <button key={item.id} type="button" className="list-row split-row multi-profile-manager-item" onClick={() => onSelect?.(item.id)}>
              <strong>{item.display_name || item.title || '프로필'}</strong>
              <span className="muted small-text">{item.headline || item.bio || item.current_work || '멀티프로필설명'}</span>
            </button>
          )) : <div className="bordered-box muted">등록된 멀티 프로필이 없습니다.</div>}
        </div>
        <div className="split-row responsive-row multi-profile-manager-actions">
          <button type="button" disabled={addLocked || busy} className={addLocked ? 'locked-button' : ''} onClick={onAdd}>{busy ? '추가 중...' : '멀티 프로필 추가'}</button>
          <button type="button" className="ghost" onClick={onUnlock}>추가개방</button>
        </div>
        {addLocked ? <div className="muted small-text">멀티프로필 3개 이상 등록 시 5,000원 비용 결제가 필요합니다.</div> : null}
      </div>
    </div>
  )
}

function MultiProfileSelector({ profiles, selectedId, setSelectedId, onOpenModal, onDeleteSelected, deleteDisabled = false }) {
  const [popupOpen, setPopupOpen] = useState(false)
  const popupRef = useDismissLayer(popupOpen, () => setPopupOpen(false))
  const buttonRef = useRef(null)

  return (
    <div className="inline-form responsive-row multi-profile-toolbar">
      <select value={selectedId || ''} onChange={e => { const nextId = Number(e.target.value) || null; setSelectedId(nextId); setStoredActiveProfileId(nextId) }}>
        {profiles.map(item => <option key={item.id} value={item.id}>{item.display_name || item.title}</option>)}
      </select>
      <div className="stack multi-profile-actions" ref={popupRef}>
        <button ref={buttonRef} type="button" className="ghost" onClick={() => setPopupOpen(v => !v)}>멀티프로필</button>
        <AnchoredPopup anchorRef={buttonRef} open={popupOpen} align="left" className="multi-profile-popup stack">
          <div className="muted small-text">선택한 프로필에 대한 작업을 실행합니다.</div>
          <button type="button" onClick={() => { setPopupOpen(false); onOpenModal() }}>생성</button>
          <button type="button" className="ghost" disabled={deleteDisabled} onClick={() => { setPopupOpen(false); onDeleteSelected?.() }}>삭제</button>
        </AnchoredPopup>
      </div>
    </div>
  )
}

function ModalFrame({ title, children, onClose, className = '' }) {
  const modalRef = useDismissLayer(true, onClose)
  return (
    <div className="modal-backdrop" role="presentation">
      <div className={`modal-card stack ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title} ref={modalRef}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ProfileOverviewCard({ profile, expanded = false }) {
  return (
    <section className={`profile-showcase ${expanded ? 'profile-showcase-expanded' : ''}`} style={{ borderColor: profile.theme_color }}>
      <div className="cover profile-cover" style={{ backgroundImage: profile.cover_image_url ? `url(${profile.cover_image_url})` : undefined }} />
      <div className="profile-meta profile-meta-overlap">
        <div className="avatar large-avatar profile-avatar-overlap">{profile.profile_image_url ? <img src={profile.profile_image_url} alt={profile.title} /> : <span>{profile.title?.slice(0, 1) || 'P'}</span>}</div>
        <div className="profile-head-copy">
          <h3>{profile.display_name || profile.title} <VerifiedBadge profile={profile} compact /></h3>
          <div className="muted">{profile.headline}</div>
          <div className="muted small-text">{profile.gender || '성별 미입력'}{profile.birth_year ? ` · ${profile.birth_year}년생` : ''}</div>
          <div className="muted small-text">현재 하는 일: {profile.current_work || '미입력'}</div>
          <div className="muted small-text">업종: {profile.industry_category || '미입력'} · 지역: {profile.location || '미입력'}</div>
          <div className="muted small-text">공개 주소: /p/{profile.slug}</div>
          <div className="muted small-text">공개 방식: {visibilityLabel(profile.visibility_mode)} · 질문: {questionPermissionLabel(profile.question_permission)}</div>
          {profile.bio ? <div className="muted small-text">소개: {profile.bio}</div> : null}
        </div>
      </div>
      <div className="grid-4 profile-metric-grid">
        <Metric label="경력" value={profile.careers.length} />
        <Metric label="자기소개서" value={profile.introductions.length} />
        <Metric label="링크" value={profile.links.length} />
        <Metric label="질문" value={profile.questions.length} />
      </div>
    </section>
  )
}


function ProfileBrandingHubCard({ profile }) {
  const growth = buildProfileGrowthChecklist(profile)
  const analytics = getProfileLocalAnalyticsSummary(profile)
  const publicUrl = getPublicProfileUrl(profile?.slug)
  const summaryRows = [
    { label: '정리', value: `${profile?.introductions?.length || 0}개 소개서 · ${profile?.careers?.length || 0}개 경력` },
    { label: '연결', value: `${profile?.links?.length || 0}개 링크 · ${profile?.qrs?.length || 0}개 QR` },
    { label: '소통', value: `${profile?.questions?.length || 0}개 질문 · 공개 ${visibilityLabel(profile?.visibility_mode)}` },
  ]

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile?.display_name || profile?.title || '프토리'} 프로필`, url: publicUrl })
        await claimProfileShareReward(profile?.id)
        return
      }
    } catch {}
    await copyText(publicUrl, '공개 프로필 주소를 복사했습니다.')
    await claimProfileShareReward(profile?.id)
  }

  return (
    <section className="card stack brand-hub-card">
      <div className="split-row responsive-row brand-hub-head">
        <div className="stack gap-6">
          <strong>브랜딩 허브</strong>
          <div className="muted small-text">광고 2안 기준으로 “정리 → 연결 → 소통” 흐름을 바로 점검하는 실행 보드입니다.</div>
        </div>
        <div className="chip-row">
          <span className="chip">완성도 {growth.percent}%</span>
          <span className="chip">공개 /p/{profile?.slug}</span>
        </div>
      </div>
      <div className="grid-3 profile-growth-grid">
        <div className="mini-card stack gap-8">
          <strong>MVP 체크리스트</strong>
          <div className="stack compact-list">
            {growth.items.map(item => <div key={item.key} className={`growth-check-item ${item.done ? 'done' : ''}`}><strong>{item.done ? '완료' : '필수'}</strong><div><div>{item.label}</div><div className="muted small-text">{item.description}</div></div></div>)}
          </div>
        </div>
        <div className="mini-card stack gap-8">
          <strong>공개 프로필 카드</strong>
          <div className="public-profile-mini-card" style={{ borderColor: profile?.theme_color || '#3b82f6' }}>
            <div className="public-profile-mini-top" style={{ backgroundImage: profile?.cover_image_url ? `url(${profile.cover_image_url})` : undefined }} />
            <div className="public-profile-mini-body stack gap-6">
              <div className="avatar profile-mini-avatar">{profile?.profile_image_url ? <img src={profile.profile_image_url} alt={profile.display_name || profile.title} /> : <span>{(profile?.display_name || profile?.title || 'P').slice(0, 1)}</span>}</div>
              <div>
                <strong>{profile?.display_name || profile?.title}</strong>
                <div className="muted small-text">{profile?.headline || '한 줄 소개를 입력해보세요.'}</div>
              </div>
              <div className="chip-row">
                {summaryRows.map(item => <span key={item.label} className="chip light-chip">{item.label}</span>)}
              </div>
            </div>
          </div>
          <div className="action-wrap wrap-row">
            <button type="button" className="ghost" onClick={() => copyText(publicUrl, '공개 프로필 주소를 복사했습니다.')}>주소 복사</button>
            <button type="button" className="ghost" onClick={handleShare}>공유</button>
            <a className="button-link" href={publicUrl} target="_blank" rel="noreferrer">공개 페이지 열기</a>
          </div>
        </div>
        <div className="mini-card stack gap-8">
          <strong>현재 퍼널 현황</strong>
          <div className="grid-2 metric-grid-tight">
            <Metric label="방문" value={analytics.visits} />
            <Metric label="링크 클릭" value={analytics.linkClicks} />
            <Metric label="QR 클릭" value={analytics.qrClicks} />
            <Metric label="문의 전환" value={analytics.leads} />
          </div>
          <div className="stack compact-list">
            {summaryRows.map(item => <div key={item.label} className="growth-summary-row"><strong>{item.label}</strong><span className="muted small-text">{item.value}</span></div>)}
          </div>
          <div className="muted small-text">핵심 한 줄: QR + 프로필 + 링크가 먼저 완성되면 공개 전환 흐름의 뼈대가 만들어집니다.</div>
        </div>
      </div>
    </section>
  )
}

function PublicProfileHeroCard({ profile, owner, analytics, onCopyUrl, onShareUrl }) {
  const navigate = useNavigate()
  const viewer = getStoredUser()
  const isOwner = Boolean(viewer?.id && Number(viewer.id) === Number(owner?.id))
  const publicUrl = getPublicProfileUrl(profile?.slug)
  const profileName = profile?.display_name || profile?.title || owner?.nickname || '프로필'
  const profileIdLabel = owner?.login_id || owner?.email || `@${profile?.slug || ''}`
  const businessCardImageUrl = (profile?.cover_image_url || '').trim()
  const hasBusinessCardImage = Boolean(businessCardImageUrl)
  const [cardPreviewOpen, setCardPreviewOpen] = useState(false)
  const [detailView, setDetailView] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const profileMetaRows = [
    profile?.current_work ? { label: '현재 활동', value: profile.current_work } : null,
    profile?.industry_category ? { label: '분야', value: profile.industry_category } : null,
    profile?.location ? { label: '활동 지역', value: profile.location } : null,
  ].filter(Boolean)
  const proofCount = (Array.isArray(profile?.uploads) ? profile.uploads.length : 0) + (Array.isArray(profile?.careers) ? profile.careers.reduce((sum, item) => sum + ((item?.media_items || []).length), 0) : 0)
  const quickButtons = [
    { label: '경력', value: profile?.careers?.length || 0, view: 'career' },
    { label: '링크', value: profile?.links?.length || 0, view: 'links' },
    { label: 'QR', value: profile?.qrs?.length || 0, view: 'qr' },
    { label: '소개서', value: profile?.introductions?.length || 0, view: 'intro' },
    { label: '증빙', value: proofCount, view: 'proof' },
  ]
  const salesHighlights = [
    { label: '방문', value: `${analytics.visits || 0}회` },
    { label: '링크클릭', value: `${analytics.linkClicks || 0}회` },
    { label: '문의전환', value: `${analytics.leads || analytics.ctaClicks || 0}회` },
    { label: 'QR클릭', value: `${analytics.qrClicks || 0}회` },
  ]

  function startDm() {
    if (!owner?.id || isOwner) return
    openDirectMessageRoom(navigate, owner.id)
  }

  function sendFriendRequest() {
    if (!owner?.id || isOwner) return
    api(`/api/friends/requests/${owner.id}`, { method: 'POST' })
      .then(() => window.alert('친구요청을 보냈습니다.'))
      .catch(err => window.alert(err.message || '친구요청에 실패했습니다.'))
  }

  async function blockProfileOwner() {
    if (!owner?.id || isOwner) return
    if (!window.confirm(`${profileName}님을 차단하시겠습니까?`)) return
    try {
      await api(`/api/blocks/${owner.id}`, { method: 'POST' })
      window.alert('차단이 완료되었습니다.')
      navigate('/chats')
    } catch (err) {
      window.alert(err.message || '차단 처리에 실패했습니다.')
    }
  }

  const detailConfig = {
    career: {
      title: '경력 목록',
      description: '등록된 경력과 역할, 기간, 한 줄 요약을 확인할 수 있습니다.',
      empty: '등록된 경력이 없습니다.',
      items: Array.isArray(profile?.careers) ? profile.careers : [],
      render: item => (
        <article key={item.id} className="public-detail-item stack gap-6">
          <strong>{item.title}</strong>
          <div className="muted small-text">{[item.period, item.role_name].filter(Boolean).join(' · ') || '세부 기간 미입력'}</div>
          <div>{item.one_line || item.description || '설명이 아직 없습니다.'}</div>
        </article>
      ),
    },
    links: {
      title: '링크 목록',
      description: '공개된 링크 자산을 목록 형태로 확인할 수 있습니다.',
      empty: '등록된 링크가 없습니다.',
      items: Array.isArray(profile?.links) ? profile.links : [],
      render: item => (
        <article key={item.id} className="public-detail-item stack gap-6">
          <strong>{item.title || item.display_host || '링크'}</strong>
          <div className="muted small-text">{item.link_type_label || item.link_type || '외부 링크'}</div>
          <a href={item.original_url || item.full_short_url} target="_blank" rel="noreferrer" className="button-link public-detail-link">{item.original_url || item.full_short_url}</a>
        </article>
      ),
    },
    qr: {
      title: 'QR 목록',
      description: '프로필 유입을 만드는 QR 자산을 확인할 수 있습니다.',
      empty: '등록된 QR이 없습니다.',
      items: Array.isArray(profile?.qrs) ? profile.qrs : [],
      render: item => (
        <article key={item.id} className="public-detail-item stack gap-8 public-detail-qr-item">
          {item.image_url ? <img src={item.image_url} alt={item.title} className="public-detail-qr-image" /> : null}
          <strong>{item.title}</strong>
        </article>
      ),
    },
    intro: {
      title: '소개서 목록',
      description: '공개 프로필에 연결된 소개서와 제안 문구를 볼 수 있습니다.',
      empty: '등록된 소개서가 없습니다.',
      items: Array.isArray(profile?.introductions) ? profile.introductions : [],
      render: item => (
        <article key={item.id} className="public-detail-item stack gap-6">
          <strong>{item.title || '소개서'}</strong>
          {item.category ? <div className="muted small-text">{item.category}</div> : null}
          <div className="pre-wrap public-detail-text-preview">{item.content || '내용이 없습니다.'}</div>
        </article>
      ),
    },
    proof: {
      title: '증빙자료 목록',
      description: '업로드된 자료와 경력에 연결된 증빙자료를 함께 확인할 수 있습니다.',
      empty: '등록된 증빙자료가 없습니다.',
      items: [
        ...(Array.isArray(profile?.uploads) ? profile.uploads.map(item => ({ ...item, _source: 'upload' })) : []),
        ...(Array.isArray(profile?.careers) ? profile.careers.flatMap(career => (career?.media_items || []).map((media, index) => ({ ...media, id: media.id || `${career.id}-${index}`, _source: 'career', _careerTitle: career.title }))) : []),
      ],
      render: item => (
        <article key={item.id} className="public-detail-item stack gap-6">
          <strong>{item.name || item.title || item.original_name || '증빙자료'}</strong>
          <div className="muted small-text">{[item._careerTitle, item.category, item.media_kind, item.created_at ? formatDateLabel(item.created_at) : ''].filter(Boolean).join(' · ')}</div>
          {(item.preview_url || item.url) ? <a href={item.url || item.preview_url} target="_blank" rel="noreferrer" className="button-link public-detail-link">자료 열기</a> : <div className="muted small-text">열 수 있는 URL이 없습니다.</div>}
        </article>
      ),
    },
  }

  const activeDetail = detailView ? detailConfig[detailView] : null

  return (
    <>
      <section className="public-hero-card public-mobile-snap-section" style={{ '--public-accent': profile?.theme_color || '#facc15' }}>
        <button
          type="button"
          className={`public-hero-cover public-hero-business-card-stage ${hasBusinessCardImage ? 'has-card is-clickable' : 'empty-card'}`}
          onClick={() => hasBusinessCardImage ? setCardPreviewOpen(true) : undefined}
          disabled={!hasBusinessCardImage}
          aria-label={hasBusinessCardImage ? `${profileName} 명함 원본 보기` : '명함 미등록'}
        >
          {hasBusinessCardImage ? (
            <img className="public-hero-business-card-image" src={businessCardImageUrl} alt={`${profileName} 명함`} />
          ) : (
            <div className="public-hero-business-card-empty">명함을 등록하지 않았습니다.</div>
          )}
        </button>
        <div className="public-hero-body stack">
          <div className="public-hero-main public-hero-main-identity">
            <div className="avatar public-hero-avatar">{profile?.profile_image_url ? <img src={profile.profile_image_url} alt={profileName} /> : <span>{profileName.slice(0, 1)}</span>}</div>
            <div className="stack gap-6 public-hero-copy">
              <div className="public-hero-title-row">
                <h1>{profileName}</h1>
                {!isOwner ? (
                  <div className="public-hero-inline-actions">
                    <button type="button" className="ghost icon-button" onClick={startDm} aria-label="DM 보내기" title="DM 보내기"><IconGlyph name="chatMini" label="DM 보내기" /></button>
                    <button type="button" className="ghost icon-button" onClick={sendFriendRequest} aria-label="친구추가" title="친구추가"><IconGlyph name="userAdd" label="친구추가" /></button>
                    <div className="friend-more-wrap">
                      <button type="button" className="ghost icon-button friend-more-button" onClick={() => setMenuOpen(current => !current)} aria-label="설정" title="설정"><IconGlyph name="more" label="설정" /></button>
                      {menuOpen ? (
                        <div className="friend-row-menu floating-popup">
                          <button type="button" className="ghost friend-row-menu-item" onClick={async () => { setMenuOpen(false); await blockProfileOwner() }}>차단하기</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="public-hero-idline">{profileIdLabel}</div>
              <div className="public-hero-headline">{profile?.headline || '한 줄 소개가 아직 등록되지 않았습니다.'}</div>
              <div className="muted public-hero-bio">{profile?.bio || '프로필 소개가 아직 등록되지 않았습니다.'}</div>
              {profileMetaRows.length ? (
                <div className="stack compact-list public-hero-meta-list">
                  {profileMetaRows.map(item => (
                    <div key={item.label} className="growth-summary-row public-hero-meta-row"><strong>{item.label}</strong><span className="muted small-text">{item.value}</span></div>
                  ))}
                </div>
              ) : null}
              <div className="public-sales-highlight-row" aria-label="핵심 성과 요약">
                {salesHighlights.map(item => (
                  <div key={item.label} className="public-sales-highlight-pill">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="public-hero-side stack gap-12">
            <div className="public-mobile-hero-button-grid public-mobile-hero-button-grid-five" aria-label="프로필 요약 바로가기">
              {quickButtons.map(item => (
                <button key={item.label} type="button" className="public-mobile-stat-button" onClick={() => setDetailView(item.view)}>
                  <span className="public-mobile-stat-label">{item.label}</span>
                  <strong>{item.value}</strong>
                </button>
              ))}
            </div>
            <div className="action-wrap wrap-row public-hero-actions">
              <button type="button" className="ghost" onClick={onCopyUrl}>프로필 링크 복사</button>
              <button type="button" onClick={onShareUrl}>공유</button>
              <a className="button-link" href={publicUrl} target="_blank" rel="noreferrer">새 탭 열기</a>
            </div>
          </div>
        </div>
      </section>
      {activeDetail ? (
        <div className="public-detail-overlay" role="dialog" aria-modal="true">
          <div className="public-detail-overlay-backdrop" onClick={() => setDetailView('')} />
          <div className="public-detail-overlay-card card stack">
            <div className="split-row responsive-row public-detail-overlay-head">
              <div>
                <strong>{activeDetail.title}</strong>
                <div className="muted small-text">{activeDetail.description}</div>
              </div>
              <button type="button" className="ghost small-button" onClick={() => setDetailView('')}>닫기</button>
            </div>
            <div className="public-detail-overlay-body stack compact-list">
              {activeDetail.items.length ? activeDetail.items.map(activeDetail.render) : <div className="muted">{activeDetail.empty}</div>}
            </div>
          </div>
        </div>
      ) : null}
      {cardPreviewOpen ? (
        <div className="business-card-preview-lightbox public-business-card-lightbox" role="dialog" aria-modal="true">
          <div className="business-card-preview-lightbox-backdrop" onClick={() => setCardPreviewOpen(false)} />
          <div className="business-card-preview-lightbox-card card stack">
            <div className="business-card-preview-lightbox-head">
              <div>
                <strong>{profileName} 명함 원본</strong>
                <div className="muted small-text">원본 크기로 확대해서 볼 수 있습니다.</div>
              </div>
              <button type="button" className="ghost small-button" onClick={() => setCardPreviewOpen(false)}>닫기</button>
            </div>
            <div className="business-card-preview-lightbox-stage public-business-card-lightbox-stage">
              <img className="public-business-card-lightbox-image" src={businessCardImageUrl} alt={`${profileName} 명함 원본`} />
            </div>
            <div className="business-card-preview-lightbox-actions">
              <a className="button-link" href={businessCardImageUrl} target="_blank" rel="noreferrer">원본 열기</a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function CareerCard({ item, showDetail = false }) {
  const [open, setOpen] = useState(false)
  const mediaItems = item.media_items || []
  return (
    <div className="bordered-box stack">
      <button type="button" className="career-head" onClick={() => setOpen(v => !v)}>
        <div>
          <strong>{item.title}</strong>
          <div className="muted small-text">{item.period} · {item.role_name}</div>
        </div>
        <span>{open ? '닫기' : '상세'}</span>
      </button>
      <div>{item.one_line}</div>
      {(showDetail || open) && (
        <>
          {item.image_url ? <img className="career-image" src={item.image_url} alt={item.title} /> : null}
          <div className="pre-wrap">{item.description}</div>
          {item.review_text ? <div className="answer-box">후기: {item.review_text}</div> : null}
          {mediaItems.length ? <MediaPreviewList items={mediaItems} /> : null}
        </>
      )}
    </div>
  )
}


function PublicProfileEvidenceCard({ item }) {
  const previewUrl = item?.preview_url || item?.url || ''
  const title = item?.name || '기록 자료'
  const category = item?.category || '기록'
  const mediaKind = item?.media_kind || 'file'
  const createdAt = item?.created_at ? formatDateLabel(item.created_at) : ''
  const sizeLabel = item?.size_mb ? `${item.size_mb}MB` : ''
  const metaParts = [category, mediaKind, createdAt, sizeLabel].filter(Boolean)

  function openItem() {
    const target = item?.url || item?.preview_url || ''
    if (!target) return
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  return (
    <article className="public-evidence-card stack gap-10">
      {previewUrl ? (
        <button type="button" className="public-evidence-preview" onClick={openItem}>
          {mediaKind === 'video' ? <video src={previewUrl} muted playsInline preload="metadata" /> : <img src={previewUrl} alt={title} />}
        </button>
      ) : (
        <div className="public-evidence-preview public-evidence-placeholder"><span>{category}</span></div>
      )}
      <div className="stack gap-6 public-evidence-copy">
        <strong>{title}</strong>
        {metaParts.length ? <div className="muted small-text">{metaParts.join(' · ')}</div> : null}
        <div className="action-wrap wrap-row public-evidence-actions">
          <button type="button" className="ghost small-button" onClick={openItem}>자료 보기</button>
        </div>
      </div>
    </article>
  )
}

function PublicProfileQuestionDigest({ items = [] }) {
  const answeredItems = items.filter(item => item?.status === 'answered').slice(0, 3)
  if (!answeredItems.length) return <div className="muted">공개된 기록형 Q&A가 없습니다.</div>
  return (
    <div className="stack compact-list">
      {answeredItems.map(item => (
        <article key={item.id} className="public-qa-item stack gap-8">
          <div className="public-qa-question">Q. {item.question_text}</div>
          <div className="public-qa-answer">A. {item.answer_text || '답변 준비 중입니다.'}</div>
          <div className="muted small-text">{item.display_nickname || '익명'} · {formatDateLabel(item.answered_at || item.created_at)}</div>
        </article>
      ))}
    </div>
  )
}

function PublicProfileUnifiedLayout({ profile, owner, analytics, onCopyUrl, onShareUrl, onReport, onLinkClick, onQrClick, onCtaClick, publicCtas = [] }) {
  const profileName = profile?.display_name || profile?.title || owner?.nickname || '프로필'
  const storyHighlights = [profile?.headline, profile?.bio, profile?.current_work ? `현재 ${profile.current_work}` : '', profile?.location ? `${profile.location} 기반` : ''].filter(Boolean)
  const primaryIntroduction = profile?.introductions?.[0] || null
  const uploadItems = Array.isArray(profile?.uploads) ? profile.uploads : []
  const mediaFromCareers = Array.isArray(profile?.careers) ? profile.careers.flatMap(career => (career?.media_items || []).map((media, index) => ({ ...media, id: media.id || `${career.id}-media-${index}`, _careerTitle: career.title || '경력' }))) : []
  const proofMediaItems = [...mediaFromCareers, ...uploadItems]
  const qualificationItems = proofMediaItems.filter(item => /자격|면허|인증|certificate|license/i.test(String(item?.category || item?.name || item?.title || '')))
  const evidenceItems = proofMediaItems.filter(item => !qualificationItems.includes(item))
  const careerGalleryItems = Array.isArray(profile?.careers) ? profile.careers.map((career, index) => ({
    id: career.id || `career-${index}`,
    title: career.title || '경력',
    subtitle: [career.period, career.role_name].filter(Boolean).join(' · '),
    preview_url: career.image_url || career.media_items?.[0]?.preview_url || career.media_items?.[0]?.url || '',
    media_kind: career.media_items?.[0]?.media_kind || (career.image_url ? 'image' : 'text'),
  })) : []
  const feedHighlightItems = uploadItems.slice(0, 6)
  const compactLinks = Array.isArray(profile?.links) ? profile.links.slice(0, 5) : []
  const compactQrs = Array.isArray(profile?.qrs) ? profile.qrs.slice(0, 3) : []
  const answeredQuestions = Array.isArray(profile?.questions) ? profile.questions.filter(item => item?.status === 'answered') : []
  const totalProofCount = uploadItems.length + (Array.isArray(profile?.careers) ? profile.careers.reduce((sum, item) => sum + ((item?.media_items || []).length), 0) : 0)
  const totalProofSizeMb = uploadItems.reduce((sum, item) => sum + Number(item?.size_mb || 0), 0)
  const conversionBlueprint = [
    { label: '증빙 경력', value: `${profile?.careers?.length || 0}건`, helper: '경력 수 + 상세 설명' },
    { label: '저장된 근거', value: `${totalProofCount}건`, helper: '사진·영상·문서·링크' },
    { label: '링크/QR 유입', value: `${(profile?.links?.length || 0) + (profile?.qrs?.length || 0)}개`, helper: '공유 진입점' },
    { label: '연결 신호', value: `${analytics?.leads || 0}건`, helper: '문의·CTA 반응' },
  ]
  const proofFlow = [
    { title: '이력', desc: '하나의 경력마다 미션, 역할, 기간을 정리합니다.' },
    { title: '증빙', desc: '사진, 영상, PDF, 링크 리뷰를 붙여 신뢰를 만듭니다.' },
    { title: '결과', desc: '후기·성과·수치를 보여줘 상담·의뢰로 연결합니다.' },
  ]
  const salesInfoRows = [
    { label: '핵심 가치', value: profile?.headline || '한 줄 가치 제안을 등록해보세요.' },
    { label: '현재 집중 분야', value: profile?.current_work || '현재 하는 일 미입력' },
    { label: '활동 지역', value: profile?.location || '지역 미입력' },
    { label: '업종/분야', value: profile?.industry_category || '업종 미입력' },
  ]
  const identitySteps = [
    { title: '프로필', desc: '누구인지 한 화면에서 이해' },
    { title: '경력', desc: '무엇을 해왔는지 증빙으로 확인' },
    { title: '소통', desc: '채팅·질문으로 바로 연결' },
  ]

  function renderHorizontalEvidenceRow(title, items, options = {}) {
    const emptyLabel = options.emptyLabel || '등록된 이미지가 없습니다.'
    const countLabel = `${items.length}개`
    return (
      <div className="public-horizontal-proof-row stack gap-10">
        <div className="split-row responsive-row public-horizontal-proof-head">
          <strong>{title}</strong>
          <span className="muted small-text">{countLabel}</span>
        </div>
        {items.length ? (
          <div className="public-horizontal-proof-scroller" role="list" aria-label={`${title} 이미지 목록`}>
            {items.map(item => {
              const previewUrl = item?.preview_url || item?.url || ''
              const itemTitle = item?.title || item?.name || item?.original_name || title
              const itemSub = item?.subtitle || item?._careerTitle || item?.category || item?.media_kind || ''
              const href = item?.url || item?.preview_url || ''
              return (
                <article key={item.id || `${title}-${itemTitle}`} className="public-horizontal-proof-item" role="listitem">
                  <div className="public-horizontal-proof-thumb">
                    {previewUrl ? (
                      item?.media_kind === 'video' ? <video src={previewUrl} muted playsInline preload="metadata" /> : <img src={previewUrl} alt={itemTitle} />
                    ) : (
                      <div className="public-horizontal-proof-fallback">{itemTitle.slice(0, 2)}</div>
                    )}
                  </div>
                  <div className="public-horizontal-proof-caption">
                    <strong>{itemTitle}</strong>
                    {itemSub ? <span>{itemSub}</span> : null}
                  </div>
                  {href ? <a className="button-link public-horizontal-proof-link" href={href} target="_blank" rel="noreferrer">열기</a> : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="public-horizontal-proof-empty">{emptyLabel}</div>
        )}
      </div>
    )
  }

  return (
    <div className="public-mobile-pages-stack">
      <section className="public-unified-shell public-mobile-snap-section public-mobile-page public-mobile-page-sales">
        <div className="public-unified-main stack gap-16">
          <section className="card stack public-focus-card public-sales-page-card">
            <div className="split-row responsive-row">
              <div>
                <h3>영업용 프로필</h3>
                
              </div>
              <div className="action-wrap wrap-row public-secondary-actions">
                <button type="button" className="ghost small-button" onClick={onCopyUrl}>주소 복사</button>
                <button type="button" className="ghost small-button" onClick={onShareUrl}>공유</button>
                <button type="button" className="ghost small-button" onClick={onReport}>신고</button>
              </div>
            </div>
            <div className="public-identity-panel public-sales-identity-panel">
              <div className="public-identity-copy stack gap-10">
                <div className="chip-row wrap-row">
                  <span className="chip accent-chip">{profileName}</span>
                  {profile?.industry_category ? <span className="chip light-chip">{profile.industry_category}</span> : null}
                  {profile?.current_work ? <span className="chip light-chip">{profile.current_work}</span> : null}
                </div>
                <div className="public-story-summary">{storyHighlights[0] || '소개 문구가 아직 등록되지 않았습니다.'}</div>
                <div className="stack compact-list public-story-points public-sales-info-rows">
                  {salesInfoRows.map(item => (
                    <div key={item.label} className="growth-summary-row"><strong>{item.label}</strong><span className="muted small-text">{item.value}</span></div>
                  ))}
                </div>
                <div className="public-proof-flow-grid">
                  {proofFlow.map(item => (
                    <article key={item.title} className="public-proof-flow-card">
                      <strong>{item.title}</strong>
                      <p>{item.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
              <div className="public-identity-stats public-sales-metric-grid">
                {conversionBlueprint.map(item => (
                  <div key={item.label} className="public-sales-metric-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.helper}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="public-career-section" className="public-mobile-snap-section public-mobile-page public-mobile-page-proof">
        <div className="card stack public-story-career-card public-proof-career-card public-proof-gallery-card">
          <div className="split-row responsive-row">
            <div>
              <h3>경력 / 증빙 프로필</h3>
              <div className="muted small-text">핵심 경력, 증빙 자료, 자격 이미지를 한 줄 흐름으로 빠르게 확인할 수 있습니다.</div>
            </div>
            <span className="chip light-chip">경력 {profile?.careers?.length || 0}개 · 증빙 {totalProofCount}개</span>
          </div>
          <div className="public-career-proof-summary-grid">
            <div className="public-sales-metric-card">
              <span>대표 경력</span>
              <strong>{profile?.careers?.[0]?.title || '등록 대기'}</strong>
              <small>{profile?.careers?.[0]?.one_line || '대표 경력 한 줄 소개를 등록해보세요.'}</small>
            </div>
            <div className="public-sales-metric-card">
              <span>누적 증빙</span>
              <strong>{totalProofCount}건</strong>
              <small>사진, 영상, 문서, 리뷰 링크를 함께 제시</small>
            </div>
          </div>
          {renderHorizontalEvidenceRow('이력', careerGalleryItems, { emptyLabel: '등록된 경력 이미지가 없습니다.' })}
          {renderHorizontalEvidenceRow('증빙', evidenceItems, { emptyLabel: '등록된 증빙 자료가 없습니다.' })}
          {renderHorizontalEvidenceRow('자격', qualificationItems, { emptyLabel: '등록된 자격 이미지가 없습니다.' })}
          {profile?.careers?.length ? (
            <div className="stack compact-list public-career-timeline public-career-timeline-compact">
              {profile.careers.slice(0, 3).map(item => <CareerCard key={item.id} item={item} />)}
            </div>
          ) : null}
        </div>
      </section>

      <section className="public-mobile-snap-section public-mobile-page public-mobile-page-assets">
        <div className="grid-2 public-content-split public-business-proof-split">
          <div id="public-intro-section" className="card stack public-intro-card">
            <div className="split-row responsive-row">
              <h3>소개서 및 제안 문구</h3>
              <span className="muted small-text">영업 문구</span>
            </div>
            {primaryIntroduction ? (
              <article className="bordered-box stack gap-10 public-intro-feature public-sales-script-card">
                <strong>{primaryIntroduction.title}</strong>
                {primaryIntroduction.category ? <div className="muted small-text">{primaryIntroduction.category}</div> : null}
                <div className="pre-wrap public-intro-content">{primaryIntroduction.content}</div>
                {profile.introductions.length > 1 ? <div className="muted small-text">추가 소개서 {profile.introductions.length - 1}개</div> : null}
              </article>
            ) : <div className="muted">공개된 자기소개서가 없습니다.</div>}
          </div>
          <div className="card stack public-feed-card public-proof-feed-card">
            <div className="split-row responsive-row">
              <div>
                <h3>저장소 = 경력 근거 데이터</h3>
                <div className="muted small-text">업로드한 자료를 단순 보관이 아니라 포트폴리오/증빙 피드로 활용합니다.</div>
              </div>
              <span className="chip light-chip">{totalProofCount}개 근거</span>
            </div>
            <div className="public-proof-storage-summary">
              <div className="growth-summary-row"><strong>파일 자료</strong><span className="muted small-text">{uploadItems.length}개 업로드</span></div>
              <div className="growth-summary-row"><strong>저장 용량</strong><span className="muted small-text">약 {Math.round(totalProofSizeMb * 10) / 10}MB</span></div>
              <div className="growth-summary-row"><strong>Q&A 신뢰</strong><span className="muted small-text">답변 완료 {answeredQuestions.length}건</span></div>
            </div>
            {feedHighlightItems.length ? (
              <div className="public-evidence-grid">
                {feedHighlightItems.map(item => <PublicProfileEvidenceCard key={item.id} item={item} />)}
              </div>
            ) : <div className="muted">등록된 근거자료가 없습니다.</div>}
          </div>
        </div>
      </section>

      <section className="public-mobile-snap-section public-mobile-page public-mobile-page-connect">
        <div className="public-unified-side stack gap-16 public-unified-side-mobile-fill">
          <section id="public-links-section" className="card stack public-side-card compact-side-card">
            <div className="split-row responsive-row">
              <h3>링크 자산</h3>
              <span className="muted small-text">빠른 이동</span>
            </div>
            {compactLinks.length ? (
              <div className="stack compact-list public-link-stack">
                {compactLinks.map(item => (
                  <a key={item.id} className="social-link-chip compact-link-chip" href={item.original_url || item.full_short_url} target="_blank" rel="noreferrer" onClick={() => onLinkClick(item)}>
                    <span className="link-type-chip">{item.link_type_label || item.link_type || '링크'}</span>
                    <span className="link-title-text">{item.title || item.display_host || item.original_url}</span>
                  </a>
                ))}
              </div>
            ) : <div className="muted">공개 링크가 없습니다.</div>}
          </section>

          <section id="public-qr-section" className="card stack public-side-card compact-side-card">
            <div className="split-row responsive-row">
              <h3>QR 공유 진입점</h3>
              <span className="muted small-text">프로필 유입</span>
            </div>
            {compactQrs.length ? (
              <div className="public-compact-qr-grid">
                {compactQrs.map(item => (
                  <button type="button" key={item.id} className="qr-card ghost public-compact-qr-card" onClick={() => onQrClick(item)}>
                    <img src={item.image_url} alt={item.title} />
                    <strong>{item.title}</strong>
                  </button>
                ))}
              </div>
            ) : <div className="muted">등록된 QR이 없습니다.</div>}
          </section>
        </div>
      </section>

      <section id="public-conversion-section" className="public-mobile-snap-section public-mobile-page public-mobile-page-identity">
        <div className="stack gap-16 public-identity-last-page">
          <section className="card stack public-side-card compact-side-card">
            <div className="split-row responsive-row">
              <h3>컨텍스트 기반 Q&A</h3>
              <span className="muted small-text">소통 요약</span>
            </div>
            <PublicProfileQuestionDigest items={profile?.questions || []} />
          </section>

          <section className="card stack public-side-card compact-side-card public-contact-sales-card">
            <div className="split-row responsive-row">
              <h3>연락 및 전환</h3>
              <span className="muted small-text">바로 연결</span>
            </div>
            <div className="grid-2 metric-grid-tight public-side-metrics">
              <Metric label="링크" value={analytics?.linkClicks || 0} />
              <Metric label="QR" value={analytics?.qrClicks || 0} />
              <Metric label="문의" value={analytics?.leads || 0} />
              <Metric label="CTA" value={analytics?.ctaClicks || 0} />
            </div>
            <div className="action-wrap wrap-row public-mini-cta-wrap public-context-cta-grid">
              {publicCtas.map(item => <button key={item.label} type="button" className="ghost small-button" onClick={() => onCtaClick(item)}>{item.label}</button>)}
            </div>
            <div className="muted small-text">근거 자료나 포트폴리오를 보고 바로 대화로 이어지는 흐름을 의도한 CTA입니다.</div>
          </section>

          <section className="card stack public-side-card compact-side-card public-identity-guide-card">
            <div className="split-row responsive-row">
              <h3>프토리 아이덴티티</h3>
              <span className="muted small-text">정리 → 연결 → 소통</span>
            </div>
            <div className="public-identity-guide-grid">
              {identitySteps.map(item => (
                <article key={item.title} className="public-identity-guide-item">
                  <strong>{item.title}</strong>
                  <p>{item.desc}</p>
                </article>
              ))}
            </div>
            <div className="muted small-text">이 앱은 프로필, 경력, 자료 저장, 채팅, 질문을 각각 따로 두지 않고 하나의 사람 중심 흐름으로 연결합니다.</div>
          </section>
        </div>
      </section>
    </div>
  )
}

function PublicMobileBottomNav() {
  return (
    <nav className="bottom-nav public-mobile-bottom-nav" aria-label="공개 프로필 하단 메뉴">
      {NAV_ITEMS.map(item => {
        const className = 'nav-item nav-item-with-badge'
        return (
          <Link key={item.path} to={item.path} className={className}>
            <span className="nav-item-label"><span className="nav-item-icon"><IconGlyph name={NAV_META[item.path]?.icon || 'home'} label={item.label} /></span><span className="nav-item-text">{item.label}</span></span>
          </Link>
        )
      })}
    </nav>
  )
}

function PublicProfilePage() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/api/profile-public/${slug}`).then(setData).catch(err => setError(err.message))
  }, [slug])

  useEffect(() => {
    if (!data?.profile) return
    recordAnalyticsEvent({ type: 'visit', profileId: data.profile.id, profileSlug: data.profile.slug, profileTitle: data.profile.title, source: 'public_profile' })
  }, [data?.profile?.id])

  useEffect(() => {
    if (!data?.profile) return
    const seo = data.seo || {}
    document.title = seo.title || `${data.profile.title} | 프토리`

    function upsertMeta(selector, attrs) {
      let el = document.head.querySelector(selector)
      if (!el) {
        el = document.createElement('meta')
        document.head.appendChild(el)
      }
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
      return el
    }

    let robots = document.querySelector('meta[name="robots"]')
    if (!robots) {
      robots = document.createElement('meta')
      robots.setAttribute('name', 'robots')
      document.head.appendChild(robots)
    }
    robots.setAttribute('content', data.profile.search_engine_indexing ? 'index,follow' : 'noindex,nofollow')

    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    canonical.setAttribute('href', seo.canonical_url || window.location.href)

    upsertMeta('meta[name="description"]', { name: 'description', content: seo.description || data.profile.bio || '공개 프로필' })
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: seo.title || document.title })
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: seo.description || data.profile.bio || '' })
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: seo.canonical_url || window.location.href })
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'profile' })
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title || document.title })
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description || data.profile.bio || '' })
    if (seo.og_image_url) {
      upsertMeta('meta[property="og:image"]', { property: 'og:image', content: seo.og_image_url })
      upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: seo.og_image_url })
    }

    let ld = document.getElementById('profile-jsonld')
    if (!ld) {
      ld = document.createElement('script')
      ld.id = 'profile-jsonld'
      ld.type = 'application/ld+json'
      document.head.appendChild(ld)
    }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: data.owner?.nickname || data.profile.title,
      description: seo.description || data.profile.bio || '',
      url: seo.canonical_url || window.location.href,
      image: seo.og_image_url || data.profile.profile_image_url || '',
    })
  }, [data])


  async function reportProfile() {
    const reason = window.prompt('신고 사유를 입력하세요', '부적절한 공개 프로필')
    if (!reason) return
    await api('/api/reports', { method: 'POST', body: JSON.stringify({ target_type: 'profile', target_id: data.profile.id, reason, captcha_token: '' }) })
    window.alert('신고가 접수되었습니다.')
  }

  if (error) return <div className="auth-shell"><div className="card error">{error}</div></div>
  if (!data) return <div className="auth-shell"><div className="card">불러오는 중...</div></div>

  const { profile, owner } = data
  const canAsk = profile.question_permission !== 'none'
  const brandPages = readLocalItems(LOCAL_STORAGE_KEYS.brandPages, buildDefaultBrandPages()).filter(item => item.status !== '중지')
  const adSlots = readLocalItems(LOCAL_STORAGE_KEYS.adSlots, buildDefaultAdSlots()).filter(item => item.status === '판매중')
  const analytics = getProfileLocalAnalyticsSummary(profile)
  const publicUrl = getPublicProfileUrl(profile.slug)
  const publicCtas = [
    { label: '경력 문의', type: 'cta_click', source: 'career_context' },
    { label: '포트폴리오 요청', type: 'cta_click', source: 'portfolio_context' },
    { label: '채팅 상담', type: 'cta_click', source: 'chat_context' },
    { label: '커뮤니티 질문', type: 'cta_click', source: 'community_context' },
  ]

  async function handleCopyUrl() {
    await copyText(publicUrl, '공개 프로필 주소를 복사했습니다.')
  }

  async function handleShareUrl() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.display_name || profile.title} 공개 프로필`, url: publicUrl })
        return
      }
    } catch {}
    await handleCopyUrl()
  }

  function handlePublicLinkClick(item) {
    recordAnalyticsEvent({ type: 'link_click', profileId: profile.id, profileSlug: profile.slug, linkId: item.id, linkTitle: item.title, source: item.original_url || item.full_short_url || '' })
  }

  function handleQrClick(item) {
    recordAnalyticsEvent({ type: 'qr_click', profileId: profile.id, profileSlug: profile.slug, qrId: item.id, qrTitle: item.title, source: item.redirect_url || item.target_url || '' })
  }

  function handlePublicCtaClick(cta) {
    recordAnalyticsEvent({ type: cta.type, profileId: profile.id, profileSlug: profile.slug, source: cta.source, title: cta.label })
    recordLeadEvent({ profileId: profile.id, profileSlug: profile.slug, profileTitle: profile.title, source: cta.label })
    window.alert(`${cta.label} 리드가 수집되었습니다.`)
  }

  return (
    <div className="public-shell">
      <div className="public-container public-container-expanded public-page-scroll-shell">
        <PublicProfileHeroCard profile={profile} owner={owner} analytics={analytics} onCopyUrl={handleCopyUrl} onShareUrl={handleShareUrl} />
        <PublicProfileUnifiedLayout
          profile={profile}
          owner={owner}
          analytics={analytics}
          onCopyUrl={handleCopyUrl}
          onShareUrl={handleShareUrl}
          onReport={reportProfile}
          onLinkClick={handlePublicLinkClick}
          onQrClick={handleQrClick}
          onCtaClick={handlePublicCtaClick}
          publicCtas={publicCtas}
        />
        {brandPages.length || adSlots.length ? (
          <section className="grid-2 public-summary-grid public-mini-business-grid">
            {brandPages.length ? <div className="card stack public-mini-business-card"><div className="split-row responsive-row"><h3>브랜드 페이지</h3><span className="muted small-text">보조 영역</span></div><div className="stack compact-list">{brandPages.slice(0, 2).map(item => <div key={item.id} className="mini-card"><strong>{item.name}</strong><div className="muted small-text">/{item.slug} · {item.theme}</div></div>)}</div></div> : null}
            {adSlots.length ? <div className="card stack public-mini-business-card"><div className="split-row responsive-row"><h3>광고 슬롯</h3><span className="muted small-text">보조 영역</span></div><div className="stack compact-list">{adSlots.slice(0, 2).map(item => <div key={item.id} className="mini-card"><strong>{item.name}</strong><div className="muted small-text">{item.placement} · ₩{formatMoney(item.price)}</div></div>)}</div></div> : null}
          </section>
        ) : null}
        <QuestionBoard profile={profile} ownerNickname={owner.nickname} isOwner={Boolean(getStoredUser()?.id && Number(getStoredUser()?.id) === Number(owner?.id))} canAsk={canAsk} onRefresh={async () => setData(await api(`/api/profile-public/${slug}`))} />
      </div>
      <PublicMobileBottomNav />
    </div>
  )
}


function PlanComparisonModal({ open, onClose, plan }) {
  if (!open || !plan) return null
  const tier = buildPlanTier(plan)
  const rows = [
    ['프로필 수', `${tier.current.profileLimit}개`, `${tier.next.profileLimit}개`],
    ['저장용량', `${tier.current.storageGb}GB`, `${tier.next.storageGb}GB`],
    ['일일 영상 업로드', `${tier.current.dailyVideoMb}MB`, `${tier.next.dailyVideoMb}MB`],
    ['채팅 미디어 한도', `${tier.current.chatMediaMb}MB`, `${tier.next.chatMediaMb}MB`],
    ['공개 범위', tier.current.visibility, tier.next.visibility],
    ['운영/검수', tier.current.moderation, tier.next.moderation],
  ]
  return (
    <ModalFrame title={tier.current.title} onClose={onClose} className="full-screen-modal">
      <div className="stack">
        <div className="split-row responsive-row plan-compare-head">
          <strong>{tier.current.title}</strong>
          <strong>{tier.next.title}</strong>
        </div>
        <div className="plan-compare-table">
          {rows.map(([label, current, next]) => (
            <div key={label} className="plan-compare-row">
              <div className="muted small-text">{label}</div>
              <div>{current}</div>
              <div>{next}</div>
            </div>
          ))}
        </div>
      </div>
    </ModalFrame>
  )
}

function AccountStorageModal({ open, onClose, plan, usage, profiles }) {
  if (!open || !plan) return null
  const profileItems = (profiles || []).map(profile => ({
    id: profile.id,
    name: profile.display_name || profile.title,
    usedBytes: estimateProfileUploadBytes(profile),
  }))
  const totalBytes = Number(usage?.total_storage_bytes || 0)
  const profileTotal = profileItems.reduce((sum, item) => sum + item.usedBytes, 0)
  const sharedBytes = Math.max(totalBytes - profileTotal, 0)
  return (
    <ModalFrame title="내계정용량" onClose={onClose} className="full-screen-modal">
      <div className="stack">
        <div className="bordered-box stack">
          <strong>전체 사용량</strong>
          <div className="muted">총 {bytesLabel(totalBytes)} / {plan.storage_limit_gb}GB</div>
          <div className="muted">오늘 영상 사용 {bytesLabel(Number(usage?.daily_video_bytes || 0))} / {bytesLabel(Number(plan.daily_video_limit_bytes || 0))}</div>
        </div>
        <div className="stack compact-list">
          {profileItems.map(item => (
            <div key={item.id} className="mini-card split-row responsive-row">
              <strong>{item.name}</strong>
              <span className="muted small-text">{bytesLabel(item.usedBytes)}</span>
            </div>
          ))}
          <div className="mini-card split-row responsive-row">
            <strong>공용 저장함 / 공유 데이터</strong>
            <span className="muted small-text">{bytesLabel(sharedBytes)}</span>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function ProfileManagementSummary({ profile, plan, usage, profiles }) {
  const [storageOpen, setStorageOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)

  useEffect(() => {
    function openStorage() { setStorageOpen(true) }
    function openPlan() { setPlanOpen(true) }
    window.addEventListener('historyprofile:open-account-storage', openStorage)
    window.addEventListener('historyprofile:open-plan-compare', openPlan)
    return () => {
      window.removeEventListener('historyprofile:open-account-storage', openStorage)
      window.removeEventListener('historyprofile:open-plan-compare', openPlan)
    }
  }, [])

  const tier = buildPlanTier(plan)
  return (
    <>
      <section className="grid-2">
        <div className="card stack">
          <div className="action-wrap wrap-row">
            <button type="button" className="ghost" onClick={() => setStorageOpen(true)}>내계정용량</button>
            <button type="button" className="ghost" onClick={() => setPlanOpen(true)}>{tier.current.title}</button>
          </div>
          <div className="muted">총 저장용량 {plan.used_storage_mb}MB / {plan.storage_limit_gb}GB</div>
          <div className="muted">일일 영상 업로드 제한 {plan.daily_video_limit_mb}MB</div>
          <div className="muted">채팅 미디어 한도 {plan.chat_media_used_mb}MB / {plan.chat_media_limit_mb}MB</div>
          <div className="muted">계정 상태 {plan.account_status} · 경고 {plan.warning_count}회 · 휴대폰 인증 {plan.phone_verified ? '완료' : '미완료'}</div>
          <div className="chip-row">
            <span className="chip">링크 전용 공개</span>
            <span className="chip">검색엔진 노출 가능</span>
            <span className="chip">질문 허용 방식 선택</span>
            <span className="chip">신고 / 차단 / 검수</span>
          </div>
        </div>
        <div className="card stack">
          <h3>대표 한줄 경력</h3>
          {profile.careers?.length ? profile.careers.map(item => <CareerCard key={item.id} item={item} />) : <div className="muted">등록된 경력이 없습니다.</div>}
          <div className="muted small-text">저장용량 사용량: {usage ? Math.round((usage.total_storage_bytes || 0) / 1024 / 1024 * 100) / 100 : 0}MB · 오늘 영상 사용량: {usage ? Math.round((usage.daily_video_bytes || 0) / 1024 / 1024 * 100) / 100 : 0}MB</div>
        </div>
      </section>
      <AccountStorageModal open={storageOpen} onClose={() => setStorageOpen(false)} plan={plan} usage={usage} profiles={profiles} />
      <PlanComparisonModal open={planOpen} onClose={() => setPlanOpen(false)} plan={plan} />
    </>
  )
}

function buildShareLinkEntryFromShortUrl(item) {
  const link = item && typeof item === 'object' ? item : {}
  return {
    id: makeLocalId('share'),
    title: (link.title || '단축 URL').trim(),
    type: '기타',
    visibility: '링크 전용',
    url: link.full_short_url || link.short_url || link.original_url || '',
    profile_slug: link.profile_slug || '',
    profile_name: link.profile_name || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function UrlShortenerPage() {
  const [profiles, setProfiles] = useState([])
  const [savedLinks, setSavedLinks] = useLocalCollection(LOCAL_STORAGE_KEYS.shareLinks, [])
  const [selectedId, setSelectedId] = useState(() => getStoredActiveProfileId())
  const [title, setTitle] = useState('')
  const [originalUrl, setOriginalUrl] = useState('')
  const [shortCode, setShortCode] = useState('')
  const [items, setItems] = useState([])
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load(preferredId = selectedId) {
    const data = await api('/api/profiles')
    const nextItems = data.items || []
    const resolvedId = nextItems.some(item => item.id === preferredId) ? preferredId : nextItems[0]?.id || null
    setProfiles(nextItems)
    setSelectedId(resolvedId)
    setStoredActiveProfileId(resolvedId)
    setItems((nextItems.find(item => item.id === resolvedId) || nextItems[0] || {}).links || [])
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const selected = profiles.find(item => item.id === selectedId)
    setItems(selected?.links || [])
  }, [profiles, selectedId])

  async function submit() {
    if (!selectedId || !originalUrl.trim()) return
    setBusy(true)
    try {
      const payload = { title: title.trim() || '단축 링크', original_url: originalUrl.trim(), short_code: shortCode.trim(), link_type: 'external', is_public: true }
      const data = await api(`/api/profiles/${selectedId}/links`, { method: 'POST', body: JSON.stringify(payload) })
      setCreated(data.item)
      setTitle('')
      setOriginalUrl('')
      setShortCode('')
      await load()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyShort(url) {
    await navigator.clipboard.writeText(url)
    window.alert('단축 URL이 복사되었습니다.')
  }

  function saveToShareLinks(item) {
    const nextEntry = buildShareLinkEntryFromShortUrl(item)
    if (!nextEntry.url) {
      window.alert('보관할 URL이 없습니다.')
      return
    }
    const exists = savedLinks.some(saved => String(saved.url || '').trim() === nextEntry.url)
    if (exists) {
      window.alert('이미 링크공유관리 보관함에 저장된 URL입니다.')
      return
    }
    setSavedLinks(current => [nextEntry, ...current])
    window.alert('링크공유관리로 보관했습니다.')
  }

  return (
    <div className="stack page-stack">
      <section className="card stack">
        <h3>URL단축</h3>
        <div className="muted small-text">생성한 단축 URL은 계속 사용할 수 있으며, 1년 이상 접속 기록이 없으면 정리됩니다.</div>
        <div className="grid-2">
          <div className="stack">
            <label>연결할 프로필</label>
            <select value={selectedId || ''} onChange={e => setSelectedId(Number(e.target.value) || null)}>
              {profiles.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <TextField label="링크 제목" value={title} onChange={setTitle} />
          <TextField label="긴 URL" value={originalUrl} onChange={setOriginalUrl} />
          <TextField label="원하는 short code(선택)" value={shortCode} onChange={setShortCode} />
        </div>
        <button type="button" disabled={busy} onClick={submit}>{busy ? '단축 중...' : '단축하기'}</button>
        {created ? <button type="button" className="ghost" onClick={() => copyShort(created.full_short_url)}>생성된 URL 복사: {created.full_short_url}</button> : null}
      </section>
      <section className="card stack">
        <h3>생성된 단축 URL</h3>
        <div className="stack url-shortener-list">
          {items.length ? items.map(item => (
            <article key={item.id} className="url-shortener-item-card">
              <div className="url-shortener-item-head">
                <strong>{item.title || '단축 링크'}</strong>
                <button type="button" className="ghost small-button" onClick={() => saveToShareLinks(item)}>내 링크공유함 보관</button>
              </div>
              <button type="button" className="ghost url-shortener-copy-button" onClick={() => copyShort(item.full_short_url)}>
                <div className="url-shortener-copy-main">
                  <div className="muted small-text">{item.full_short_url}</div>
                  <div className="muted small-text">클릭 {item.click_count || 0}회 · 마지막 접속 {formatLastAccess(item.last_accessed_at)}</div>
                </div>
                <span className="chip">복사</span>
              </button>
            </article>
          )) : <div className="muted">생성된 단축 URL이 없습니다.</div>}
        </div>
      </section>
    </div>
  )
}



function BusinessCardBuilderPage() {
  const BUSINESS_CARD_STORAGE_KEY = 'historyprofile_saved_business_cards'
  const BUSINESS_CARD_SHOP_UNLOCK_KEY = 'historyprofile_business_card_shop_unlocks'
  const [template, setTemplate] = useState('clean')
  const [templateSearch, setTemplateSearch] = useState('')
  const [cardSize, setCardSize] = useState('standard_90x50')
  const [savedCards, setSavedCards] = useState([])
  const [selectedSavedCard, setSelectedSavedCard] = useState('')
  const [shopOpen, setShopOpen] = useState(false)
  const [shopPreviewId, setShopPreviewId] = useState('')
  const [unlockedShopForms, setUnlockedShopForms] = useState([])
  const [backgroundMode, setBackgroundMode] = useState('solid')
  const [backgroundColor, setBackgroundColor] = useState('#ffffff')
  const [patternPreset, setPatternPreset] = useState('dots')
  const [uploadedPhoto, setUploadedPhoto] = useState('')
  const [uploadedPattern, setUploadedPattern] = useState('')
  const [gradientPreset, setGradientPreset] = useState('sunset')
  const [gradientAngle, setGradientAngle] = useState(135)
  const [reflectionBaseColor, setReflectionBaseColor] = useState('#f8fafc')
  const [reflectionAngle, setReflectionAngle] = useState(28)
  const [reflectionOpacity, setReflectionOpacity] = useState(0.38)
  const [form, setForm] = useState({
    name: '',
    jobTitle: '',
    company: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    tagline: '',
  })

  const sizeOptions = [
    { value: 'standard_90x50', label: '90 × 50mm', widthMm: 90, heightMm: 50 },
    { value: 'standard_91x55', label: '91 × 55mm', widthMm: 91, heightMm: 55 },
    { value: 'us_89x51', label: '89 × 51mm', widthMm: 89, heightMm: 51 },
    { value: 'euro_85x55', label: '85 × 55mm', widthMm: 85, heightMm: 55 },
    { value: 'mini_86x48', label: '86 × 48mm', widthMm: 86, heightMm: 48 },
    { value: 'slim_90x45', label: '90 × 45mm', widthMm: 90, heightMm: 45 },
    { value: 'wide_95x55', label: '95 × 55mm', widthMm: 95, heightMm: 55 },
    { value: 'square_55x55', label: '55 × 55mm', widthMm: 55, heightMm: 55 },
    { value: 'square_60x60', label: '60 × 60mm', widthMm: 60, heightMm: 60 },
    { value: 'long_120x50', label: '120 × 50mm', widthMm: 120, heightMm: 50 },
  ]

  const colorOptions = [
    { value: '#ffffff', label: '화이트' },
    { value: '#f8fafc', label: '라이트 그레이' },
    { value: '#fee2e2', label: '로즈 핑크' },
    { value: '#dbeafe', label: '스카이 블루' },
    { value: '#dcfce7', label: '민트 그린' },
    { value: '#ede9fe', label: '라벤더' },
    { value: '#fef3c7', label: '크림 옐로우' },
    { value: '#e0f2fe', label: '아이스 블루' },
    { value: '#f5f3ff', label: '실버 바이올렛' },
    { value: '#111827', label: '딥 블랙' },
  ]

  const patternOptions = [
    { value: 'dots', label: '도트 패턴', css: 'radial-gradient(circle at 1px 1px, rgba(15,23,42,.16) 1px, transparent 0)', size: '18px 18px', base: '#ffffff' },
    { value: 'grid', label: '그리드 패턴', css: 'linear-gradient(rgba(15,23,42,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,.08) 1px, transparent 1px)', size: '18px 18px', base: '#ffffff' },
    { value: 'diagonal', label: '사선 패턴', css: 'repeating-linear-gradient(135deg, rgba(37,99,235,.10) 0 10px, rgba(255,255,255,.0) 10px 20px)', size: 'auto', base: '#eff6ff' },
    { value: 'waves', label: '웨이브 패턴', css: 'radial-gradient(circle at 0 0, rgba(14,165,233,.12) 0 24px, transparent 25px), radial-gradient(circle at 30px 30px, rgba(59,130,246,.10) 0 20px, transparent 21px)', size: '60px 60px', base: '#f8fafc' },
    { value: 'noise', label: '노이즈 점묘', css: 'radial-gradient(circle at 20% 20%, rgba(15,23,42,.08) 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(59,130,246,.08) 0 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, rgba(16,185,129,.08) 0 1px, transparent 1.5px)', size: '22px 22px', base: '#ffffff' },
    { value: 'paper', label: '페이퍼 결', css: 'linear-gradient(0deg, rgba(255,255,255,.84), rgba(255,255,255,.84)), repeating-linear-gradient(0deg, rgba(148,163,184,.12) 0 2px, rgba(255,255,255,0) 2px 6px)', size: 'auto', base: '#f8fafc' },
  ]

  const gradientOptions = [
    { value: 'sunset', label: '선셋', colors: ['#f97316', '#ec4899', '#7c3aed'] },
    { value: 'ocean', label: '오션', colors: ['#0ea5e9', '#2563eb', '#1e293b'] },
    { value: 'forest', label: '포레스트', colors: ['#10b981', '#22c55e', '#14532d'] },
    { value: 'violet', label: '바이올렛', colors: ['#8b5cf6', '#6366f1', '#c026d3'] },
    { value: 'pearl', label: '펄', colors: ['#f8fafc', '#dbeafe', '#ddd6fe'] },
    { value: 'gold', label: '골드', colors: ['#f59e0b', '#fde68a', '#78350f'] },
  ]

  const reflectionPresets = [
    { value: '#f8fafc', label: '실버 글로스' },
    { value: '#eff6ff', label: '블루 글로스' },
    { value: '#fdf2f8', label: '핑크 글로스' },
    { value: '#ecfeff', label: '민트 글로스' },
    { value: '#111827', label: '다크 글로스' },
  ]

  const templatePalettes = [
    { background: 'linear-gradient(135deg,#ffffff 0%,#f7fbff 100%)', color: '#111827', accent: 'linear-gradient(180deg,#38bdf8,#2563eb)' },
    { background: 'linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)', color: '#1e3a8a', accent: 'linear-gradient(180deg,#2563eb,#1d4ed8)' },
    { background: 'linear-gradient(135deg,#fdf2f8 0%,#fae8ff 100%)', color: '#701a75', accent: 'linear-gradient(180deg,#ec4899,#a855f7)' },
    { background: 'linear-gradient(135deg,#ecfeff 0%,#cffafe 100%)', color: '#155e75', accent: 'linear-gradient(180deg,#06b6d4,#0891b2)' },
    { background: 'linear-gradient(135deg,#fefce8 0%,#fef3c7 100%)', color: '#854d0e', accent: 'linear-gradient(180deg,#f59e0b,#ca8a04)' },
    { background: 'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)', color: '#166534', accent: 'linear-gradient(180deg,#22c55e,#16a34a)' },
    { background: 'linear-gradient(135deg,#111827 0%,#1f2937 100%)', color: '#f8fafc', accent: 'linear-gradient(180deg,#f59e0b,#fbbf24)' },
    { background: 'linear-gradient(135deg,#faf5ff 0%,#ede9fe 100%)', color: '#5b21b6', accent: 'linear-gradient(180deg,#8b5cf6,#6366f1)' },
  ]

  const templateAdjectives = ['시그니처', '에디션', '포커스', '에어', '라인', '포인트', '클래식', '엣지', '플로우', '무드', '프리즘', '아치', '레이어', '심플', '브랜드', '프레임', '오피스', '프로', '스튜디오', '플랜']

  function buildGeneratedTemplates(categoryKey, labelPrefix, descriptionPrefix) {
    return Array.from({ length: 20 }, (_, index) => ({
      value: `${categoryKey}_${String(index + 1).padStart(2, '0')}`,
      label: `${labelPrefix} ${String(index + 1).padStart(2, '0')} · ${templateAdjectives[index]}`,
      description: `${descriptionPrefix} 정렬 기반 ${templateAdjectives[index]} 명함`,
      premium: false,
      group: labelPrefix,
    }))
  }

  const baseTemplates = [
    { value: 'clean', label: '클린 베이직', description: '가장 무난한 세로형 명함', premium: false, group: '기본' },
    { value: 'modern', label: '모던 포인트', description: '강조색이 있는 가로형 명함', premium: false, group: '기본' },
    { value: 'minimal', label: '미니멀 라인', description: '정보만 간결하게 배치한 명함', premium: false, group: '기본' },
    { value: 'executive', label: '이그제큐티브', description: '고급스러운 블랙 골드 톤', premium: true, group: '기본' },
    { value: 'soft', label: '소프트 브랜딩', description: '부드러운 라운드 감성형', premium: false, group: '기본' },
    { value: 'portfolio', label: '포트폴리오형', description: '웹/포트폴리오 강조형', premium: false, group: '기본' },
    { value: 'bold', label: '볼드 아이덴티티', description: '강한 제목과 컬러 블록형', premium: true, group: '기본' },
    { value: 'mono', label: '모노 클래식', description: '흑백 대비 중심의 클래식형', premium: false, group: '기본' },
  ]

  const templateOptions = useMemo(() => ([
    ...baseTemplates,
    ...buildGeneratedTemplates('left', '좌측', '좌측'),
    ...buildGeneratedTemplates('right', '우측', '우측'),
    ...buildGeneratedTemplates('center', '중앙', '중앙'),
    ...buildGeneratedTemplates('top', '상단', '상단'),
    ...buildGeneratedTemplates('bottom', '하단', '하단'),
  ]), [])

  const filteredTemplateOptions = useMemo(() => {
    const keyword = templateSearch.trim().toLowerCase()
    if (!keyword) return templateOptions
    return templateOptions.filter(item =>
      [item.label, item.description, item.value, item.group].filter(Boolean).some(value => String(value).toLowerCase().includes(keyword))
    )
  }, [templateOptions, templateSearch])

  const shopForms = [
    { id: 'executive', name: '이그제큐티브', price: '₩3,900', desc: '법률·금융·컨설팅 업종용 고급형. 골드 포인트와 진한 배경으로 신뢰감을 강조합니다.', detail: '고급 업종용 인상 강화 / 저장·원본파일 잠금 해제 / 향후 결제 연동용 버튼 제공', lockNote: '저장·인쇄·정보복사·원본파일은 결제 후 사용 가능' },
    { id: 'bold', name: '볼드 아이덴티티', price: '₩2,900', desc: '퍼스널 브랜딩 강조형. 강한 대비와 색 블록으로 시선을 확보합니다.', detail: 'SNS·퍼스널브랜딩 최적 / 적용은 가능 / 출력·원본 파일 잠금', lockNote: '저장·인쇄·정보복사·원본파일은 결제 후 사용 가능' },
    { id: 'portfolio', name: '포트폴리오형', price: '₩1,900', desc: '디자이너·개발자·강사용. 사이트/링크 안내를 강조하는 명함입니다.', detail: '포트폴리오 링크 강조 / 설명 상세보기 / 결제 버튼 진입 제공', lockNote: '저장·인쇄·정보복사·원본파일은 결제 후 사용 가능' },
    { id: 'soft', name: '소프트 브랜딩', price: '₩1,900', desc: '뷰티·상담·라이프스타일 업종용. 부드러운 곡선과 라이트 톤 중심.', detail: '감성형 비즈니스용 / 미리보기·적용 가능 / 결제 후 내보내기 가능', lockNote: '저장·인쇄·정보복사·원본파일은 결제 후 사용 가능' },
  ]

  const shopPreviewSeed = {
    name: '홍길동',
    jobTitle: '대표',
    company: '프토리',
    phone: '010-1234-5678',
    email: 'hello@historyprofile.com',
    website: 'www.historyprofile.com',
    address: '서울시 강남구 테헤란로 00',
    tagline: '이력·프로필·링크를 한 장으로 정리하는 명함 샘플입니다.',
  }

  const currentTemplate = templateOptions.find(item => item.value === template) || templateOptions[0]
  const currentSize = sizeOptions.find(item => item.value === cardSize) || sizeOptions[0]
  const currentShopForm = shopForms.find(item => item.id === template) || null
  const activeShopPreview = shopForms.find(item => item.id === shopPreviewId) || null

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(BUSINESS_CARD_STORAGE_KEY) || '[]')
      if (Array.isArray(parsed)) setSavedCards(parsed)
    } catch {
      setSavedCards([])
    }
    try {
      const parsedUnlocks = JSON.parse(localStorage.getItem(BUSINESS_CARD_SHOP_UNLOCK_KEY) || '[]')
      if (Array.isArray(parsedUnlocks)) setUnlockedShopForms(parsedUnlocks)
    } catch {
      setUnlockedShopForms([])
    }
  }, [])

  function isShopPaidTemplate(templateValue) {
    return shopForms.some(item => item.id === templateValue)
  }

  function isTemplateUnlocked(templateValue) {
    return !isShopPaidTemplate(templateValue) || unlockedShopForms.includes(templateValue)
  }

  function openShopForTemplate(templateValue = template) {
    setShopPreviewId(templateValue)
    setShopOpen(true)
  }

  function ensureTemplateUnlocked(actionLabel, templateValue = template) {
    if (isTemplateUnlocked(templateValue)) return true
    const targetForm = shopForms.find(item => item.id === templateValue)
    if (targetForm) {
      openShopForTemplate(templateValue)
      window.alert(`${targetForm.name} 폼은 ${actionLabel} 전에 결제가 필요합니다. 폼상점 상세 화면으로 이동합니다.`)
      return false
    }
    return true
  }

  useEffect(() => {
    const hasContent = Object.values(form).some(value => String(value || '').trim()) || uploadedPhoto || uploadedPattern
    if (!hasContent || !isTemplateUnlocked(template)) return
    const timer = window.setTimeout(() => {
      persistCurrentCard({ silent: true, title: form.name?.trim() || form.company?.trim() || '최근 작업' })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [template, cardSize, form, backgroundMode, backgroundColor, patternPreset, uploadedPhoto, uploadedPattern, gradientPreset, gradientAngle, reflectionBaseColor, reflectionAngle, reflectionOpacity, unlockedShopForms])

  function persistCurrentCard({ silent = false, title } = {}) {
    const hasContent = Object.values(form).some(value => String(value || '').trim()) || uploadedPhoto || uploadedPattern
    if (!hasContent) {
      if (!silent) window.alert('저장할 명함 정보가 없습니다.')
      return null
    }
    if (!ensureTemplateUnlocked('저장', template)) return null
    const snapshot = {
      id: `card-${Date.now()}`,
      title: title || form.name?.trim() || form.company?.trim() || '최근 작업',
      template,
      cardSize,
      form,
      backgroundMode,
      backgroundColor,
      patternPreset,
      uploadedPhoto,
      uploadedPattern,
      gradientPreset,
      gradientAngle,
      reflectionBaseColor,
      reflectionAngle,
      reflectionOpacity,
      updatedAt: new Date().toISOString(),
    }
    let savedSnapshot = snapshot
    setSavedCards(current => {
      const comparable = JSON.stringify({
        template, cardSize, form, backgroundMode, backgroundColor, patternPreset, uploadedPhoto, uploadedPattern,
        gradientPreset, gradientAngle, reflectionBaseColor, reflectionAngle, reflectionOpacity
      })
      const next = [snapshot, ...current.filter(item => JSON.stringify({
        template: item.template,
        cardSize: item.cardSize,
        form: item.form,
        backgroundMode: item.backgroundMode,
        backgroundColor: item.backgroundColor,
        patternPreset: item.patternPreset,
        uploadedPhoto: item.uploadedPhoto,
        uploadedPattern: item.uploadedPattern,
        gradientPreset: item.gradientPreset,
        gradientAngle: item.gradientAngle,
        reflectionBaseColor: item.reflectionBaseColor,
        reflectionAngle: item.reflectionAngle,
        reflectionOpacity: item.reflectionOpacity,
      }) !== comparable)].slice(0, 20)
      localStorage.setItem(BUSINESS_CARD_STORAGE_KEY, JSON.stringify(next))
      savedSnapshot = next[0]
      return next
    })
    setSelectedSavedCard(snapshot.id)
    if (!silent) window.alert('명함이 저장되었습니다.')
    return savedSnapshot
  }

  function updateField(key, value) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function loadSavedCard(cardId) {
    setSelectedSavedCard(cardId)
    const target = savedCards.find(item => item.id === cardId)
    if (!target) return
    setTemplate(target.template || 'clean')
    setCardSize(target.cardSize || 'standard_90x50')
    setBackgroundMode(target.backgroundMode || 'solid')
    setBackgroundColor(target.backgroundColor || '#ffffff')
    setPatternPreset(target.patternPreset || 'dots')
    setUploadedPhoto(target.uploadedPhoto || '')
    setUploadedPattern(target.uploadedPattern || '')
    setGradientPreset(target.gradientPreset || 'sunset')
    setGradientAngle(Number(target.gradientAngle ?? 135))
    setReflectionBaseColor(target.reflectionBaseColor || '#f8fafc')
    setReflectionAngle(Number(target.reflectionAngle ?? 28))
    setReflectionOpacity(Number(target.reflectionOpacity ?? 0.38))
    setForm({
      name: target.form?.name || '',
      jobTitle: target.form?.jobTitle || '',
      company: target.form?.company || '',
      phone: target.form?.phone || '',
      email: target.form?.email || '',
      website: target.form?.website || '',
      address: target.form?.address || '',
      tagline: target.form?.tagline || '',
    })
  }

  function readLocalImage(file, onDone) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onDone(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  async function copySummary() {
    if (!ensureTemplateUnlocked('정보 복사', template)) return
    const lines = [
      form.name || '이름',
      [form.jobTitle, form.company].filter(Boolean).join(' · '),
      form.phone,
      form.email,
      form.website,
      form.address,
      form.tagline,
    ].filter(Boolean)
    await navigator.clipboard.writeText(lines.join('\n'))
    window.alert('명함 정보가 복사되었습니다.')
  }

  function printCard() {
    if (!ensureTemplateUnlocked('인쇄', template)) return
    window.print()
  }

  function saveCard() {
    if (!ensureTemplateUnlocked('저장', template)) return
    persistCurrentCard({ title: form.name?.trim() || form.company?.trim() || '내 명함' })
  }

  function startPayment(item) {
    window.alert(`${item.name} 결제 버튼입니다. 현재 결제 연동 전 단계이므로 상세 안내만 제공됩니다.`)
  }

  function showPaymentGuide(item) {
    openShopForTemplate(item.id)
  }

  function openShopPreview(templateValue) {
    setShopPreviewId(templateValue)
  }

  function closeShopPreview() {
    setShopPreviewId('')
  }

  function applyShopForm(templateValue) {
    setTemplate(templateValue)
    setShopPreviewId(templateValue)
    setShopOpen(false)
    window.alert('선택한 명함폼이 만들기 화면에 적용되었습니다.')
  }

  function getTemplateFamily(templateValue) {
    if (String(templateValue).startsWith('left_')) return 'left'
    if (String(templateValue).startsWith('right_')) return 'right'
    if (String(templateValue).startsWith('center_')) return 'center'
    if (String(templateValue).startsWith('top_')) return 'top'
    if (String(templateValue).startsWith('bottom_')) return 'bottom'
    return 'base'
  }

  function getTemplateIndex(templateValue) {
    const matched = String(templateValue).match(/_(\d{2})$/)
    return matched ? Math.max(0, Number(matched[1]) - 1) : 0
  }

  function getTemplateBaseBackground(templateValue) {
    const family = getTemplateFamily(templateValue)
    if (family === 'base') {
      switch (templateValue) {
        case 'modern':
          return { background: 'linear-gradient(135deg,#111827 0%,#1d4ed8 100%)', color: '#ffffff', accent: 'linear-gradient(180deg,#60a5fa,#bfdbfe)' }
        case 'minimal':
          return { background: 'linear-gradient(180deg,#fafafa 0%,#f1f5f9 100%)', color: '#0f172a', accent: 'linear-gradient(180deg,#475569,#94a3b8)' }
        case 'executive':
          return { background: 'linear-gradient(135deg,#111827 0%,#3f3f46 100%)', color: '#f8fafc', accent: 'linear-gradient(180deg,#f59e0b,#fde68a)' }
        case 'soft':
          return { background: 'linear-gradient(135deg,#fdf2f8 0%,#eff6ff 100%)', color: '#0f172a', accent: 'linear-gradient(180deg,#f472b6,#c084fc)' }
        case 'portfolio':
          return { background: 'linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)', color: '#1e3a8a', accent: 'linear-gradient(180deg,#2563eb,#38bdf8)' }
        case 'bold':
          return { background: 'linear-gradient(135deg,#7c3aed 0%,#ec4899 100%)', color: '#ffffff', accent: 'linear-gradient(180deg,#fdf2f8,#ffffff)' }
        case 'mono':
          return { background: 'linear-gradient(180deg,#ffffff 0%,#e5e7eb 100%)', color: '#111827', accent: 'linear-gradient(180deg,#111827,#6b7280)' }
        case 'clean':
        default:
          return { background: 'linear-gradient(180deg,#ffffff 0%,#f7fbff 100%)', color: '#111827', accent: 'linear-gradient(180deg,#38bdf8,#2563eb)' }
      }
    }
    const palette = templatePalettes[getTemplateIndex(templateValue) % templatePalettes.length]
    return palette
  }

  function getTemplateLayout(templateValue) {
    const family = getTemplateFamily(templateValue)
    const idx = getTemplateIndex(templateValue)
    const base = getTemplateBaseBackground(templateValue)
    const rounded = [28, 32, 24, 20][idx % 4]
    const dividerWidth = ['34%', '46%', '58%', '72%'][idx % 4]
    const overlayOpacity = [0.08, 0.12, 0.16, 0.2][idx % 4]
    const badgeTone = base.color === '#ffffff' || base.color === '#f8fafc' ? 'dark' : 'light'
    const variants = {
      left: { textAlign: 'left', badgeAlign: 'flex-start', mainAlign: 'stretch', footAlign: 'flex-start', dividerMargin: '18px auto 18px 0', infoAlign: 'start', contentJustify: 'space-between', accentInset: '10px auto 10px 10px', accentSize: '10px 86%' },
      right: { textAlign: 'right', badgeAlign: 'flex-end', mainAlign: 'stretch', footAlign: 'flex-end', dividerMargin: '18px 0 18px auto', infoAlign: 'end', contentJustify: 'space-between', accentInset: '10px 10px 10px auto', accentSize: '10px 86%' },
      center: { textAlign: 'center', badgeAlign: 'center', mainAlign: 'center', footAlign: 'center', dividerMargin: '18px auto', infoAlign: 'center', contentJustify: 'center', accentInset: 'auto 12% 12px 12%', accentSize: '76% 8px' },
      top: { textAlign: idx % 2 ? 'left' : 'center', badgeAlign: idx % 2 ? 'flex-start' : 'center', mainAlign: idx % 2 ? 'stretch' : 'center', footAlign: idx % 2 ? 'flex-start' : 'center', dividerMargin: idx % 2 ? '16px auto 18px 0' : '16px auto', infoAlign: idx % 2 ? 'start' : 'center', contentJustify: 'flex-start', accentInset: '10px 12px auto 12px', accentSize: '84% 8px' },
      bottom: { textAlign: idx % 2 ? 'right' : 'center', badgeAlign: idx % 2 ? 'flex-end' : 'center', mainAlign: idx % 2 ? 'stretch' : 'center', footAlign: idx % 2 ? 'flex-end' : 'center', dividerMargin: idx % 2 ? '16px 0 18px auto' : '16px auto', infoAlign: idx % 2 ? 'end' : 'center', contentJustify: 'flex-end', accentInset: 'auto 12px 10px 12px', accentSize: '84% 8px' },
      base: { textAlign: 'left', badgeAlign: 'flex-start', mainAlign: 'stretch', footAlign: 'flex-start', dividerMargin: '18px auto 18px 0', infoAlign: 'start', contentJustify: 'space-between', accentInset: '10px auto 10px 10px', accentSize: '10px 86%' },
    }
    const selected = variants[family] || variants.base
    return {
      ...selected,
      rounded,
      dividerWidth,
      overlayOpacity,
      badgeTone,
      accent: base.accent,
      family,
      overlayDirection: `${45 + (idx % 6) * 18}deg`,
    }
  }

  function getPreviewAppearance({
    templateValue,
    mode = 'template',
    solidColor = backgroundColor,
    photoUrl = uploadedPhoto,
    patternUrl = uploadedPattern,
    patternValue = patternPreset,
    gradientValue = gradientPreset,
    gradientRotate = gradientAngle,
    reflectionColor = reflectionBaseColor,
    reflectionRotate = reflectionAngle,
    reflectionAlpha = reflectionOpacity,
  } = {}) {
    if (mode === 'photo' && photoUrl) {
      return {
        reactStyle: { backgroundImage: `url(${photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', color: '#ffffff' },
        htmlBackgroundCss: `background-image:url('${String(photoUrl).replace(/'/g, "%27")}');background-size:cover;background-position:center;`,
        color: '#ffffff',
      }
    }
    if (mode === 'pattern') {
      if (patternUrl) {
        return {
          reactStyle: { backgroundImage: `url(${patternUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', color: '#111827' },
          htmlBackgroundCss: `background-image:url('${String(patternUrl).replace(/'/g, "%27")}');background-size:cover;background-position:center;`,
          color: '#111827',
        }
      }
      const patternItem = patternOptions.find(item => item.value === patternValue) || patternOptions[0]
      return {
        reactStyle: { backgroundColor: patternItem.base, backgroundImage: patternItem.css, backgroundSize: patternItem.size, color: '#111827' },
        htmlBackgroundCss: `background-color:${patternItem.base};background-image:${patternItem.css};background-size:${patternItem.size};`,
        color: '#111827',
      }
    }
    if (mode === 'gradient') {
      const gradientItem = gradientOptions.find(item => item.value === gradientValue) || gradientOptions[0]
      const css = `linear-gradient(${gradientRotate}deg, ${gradientItem.colors.join(', ')})`
      const lightText = ['ocean', 'forest', 'violet', 'sunset'].includes(gradientItem.value)
      return {
        reactStyle: { background: css, color: lightText ? '#ffffff' : '#111827' },
        htmlBackgroundCss: `background:${css};`,
        color: lightText ? '#ffffff' : '#111827',
      }
    }
    if (mode === 'reflection') {
      const darkBase = reflectionColor === '#111827'
      const css = `linear-gradient(${reflectionRotate}deg, rgba(255,255,255,${reflectionAlpha}) 0%, rgba(255,255,255,0) 32%, rgba(255,255,255,${Math.max(0.12, reflectionAlpha * 0.45)}) 58%, rgba(255,255,255,0) 100%), linear-gradient(135deg, ${reflectionColor} 0%, ${reflectionColor} 100%)`
      return {
        reactStyle: { background: css, color: darkBase ? '#f8fafc' : '#111827' },
        htmlBackgroundCss: `background:${css};`,
        color: darkBase ? '#f8fafc' : '#111827',
      }
    }
    if (mode === 'solid') {
      return {
        reactStyle: { background: solidColor, color: solidColor === '#111827' ? '#ffffff' : '#111827' },
        htmlBackgroundCss: `background:${solidColor};`,
        color: solidColor === '#111827' ? '#ffffff' : '#111827',
      }
    }
    const base = getTemplateBaseBackground(templateValue)
    return {
      reactStyle: { background: base.background, color: base.color },
      htmlBackgroundCss: `background:${base.background};`,
      color: base.color,
    }
  }

  function escapeXml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function downloadOriginalFile({
    templateValue = template,
    sizeValue = cardSize,
    previewData = form,
    appearanceMode = backgroundMode,
    solidColor = backgroundColor,
    photoUrl = uploadedPhoto,
    patternUrl = uploadedPattern,
    patternValue = patternPreset,
    gradientValue = gradientPreset,
    gradientRotate = gradientAngle,
    reflectionColor = reflectionBaseColor,
    reflectionRotate = reflectionAngle,
    reflectionAlpha = reflectionOpacity,
  } = {}) {
    if (!ensureTemplateUnlocked('원본 파일 받기', templateValue)) return
    const size = sizeOptions.find(item => item.value === sizeValue) || sizeOptions[0]
    const appearance = getPreviewAppearance({ templateValue, mode: appearanceMode, solidColor, photoUrl, patternUrl, patternValue, gradientValue, gradientRotate, reflectionColor, reflectionRotate, reflectionAlpha })
    const width = 1080
    const height = Math.round(width * (size.heightMm / size.widthMm))
    const isLightText = appearance.color === '#ffffff' || appearance.color === '#f8fafc'
    const badgeStyle = isLightText
      ? 'background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;'
      : 'background:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.55);color:#111827;'
    const fullName = previewData.name || '홍길동'
    const roleLine = [previewData.jobTitle || '직함', previewData.company || '회사명'].filter(Boolean).join(' · ')
    const infoItems = [previewData.phone || '010-0000-0000', previewData.email || 'name@example.com', previewData.website || 'www.example.com', previewData.address || '서울시 강남구 테헤란로 00']
    const tagline = previewData.tagline || '한 줄 소개를 입력하면 이 영역에 반영됩니다.'
    const html = `
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;padding:38px;display:flex;flex-direction:column;justify-content:space-between;border-radius:42px;box-sizing:border-box;overflow:hidden;${appearance.htmlBackgroundCss}color:${appearance.color};font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
        <div style="display:inline-flex;align-self:flex-start;padding:12px 18px;border-radius:999px;font-size:30px;font-weight:800;${badgeStyle}">${escapeXml((templateOptions.find(item => item.value === templateValue)?.label || templateValue) + ' · ' + size.label)}</div>
        <div>
          <div style="font-size:88px;font-weight:900;letter-spacing:-0.04em;line-height:1.05;word-break:keep-all;overflow-wrap:anywhere;">${escapeXml(fullName)}</div>
          <div style="margin-top:18px;font-size:34px;opacity:.82;overflow-wrap:anywhere;">${escapeXml(roleLine)}</div>
          <div style="height:2px;background:currentColor;opacity:.14;margin:28px 0 24px;"></div>
          <div style="display:grid;gap:12px;font-size:28px;line-height:1.55;overflow-wrap:anywhere;">
            ${infoItems.map(item => `<div>${escapeXml(item)}</div>`).join('')}
          </div>
        </div>
        <div style="font-size:24px;line-height:1.65;opacity:.88;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeXml(tagline)}</div>
      </div>
    `
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject x="0" y="0" width="${width}" height="${height}">${html}</foreignObject>
      </svg>
    `
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `${(previewData.name || templateValue || 'business-card').replace(/\s+/g, '-').toLowerCase()}-${templateValue}.svg`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1200)
  }

  function BusinessCardPreviewCanvas({
    templateValue,
    sizeValue,
    previewData,
    appearanceMode = 'template',
    solidColor = backgroundColor,
    photoUrl = uploadedPhoto,
    patternUrl = uploadedPattern,
    patternValue = patternPreset,
    gradientValue = gradientPreset,
    gradientRotate = gradientAngle,
    reflectionColor = reflectionBaseColor,
    reflectionRotate = reflectionAngle,
    reflectionAlpha = reflectionOpacity,
    className = '',
    badgeSuffix = '',
    hideBadge = false
  }) {
    const previewSize = sizeOptions.find(item => item.value === sizeValue) || sizeOptions[0]
    const appearance = getPreviewAppearance({ templateValue, mode: appearanceMode, solidColor, photoUrl, patternUrl, patternValue, gradientValue, gradientRotate, reflectionColor, reflectionRotate, reflectionAlpha })
    const layout = getTemplateLayout(templateValue)
    const label = templateOptions.find(item => item.value === templateValue)?.label || templateValue
    return (
      <div
        className={`business-card-preview business-card-preview-${templateValue} business-card-preview-family-${layout.family} ${className}`.trim()}
        style={{
          '--card-width-mm': previewSize.widthMm,
          '--card-height-mm': previewSize.heightMm,
          '--card-ratio': `${previewSize.widthMm} / ${previewSize.heightMm}`,
          '--bc-text-align': layout.textAlign,
          '--bc-badge-align': layout.badgeAlign,
          '--bc-main-align': layout.mainAlign,
          '--bc-foot-align': layout.footAlign,
          '--bc-divider-margin': layout.dividerMargin,
          '--bc-divider-width': layout.dividerWidth,
          '--bc-info-align': layout.infoAlign,
          '--bc-content-justify': layout.contentJustify,
          '--bc-accent-inset': layout.accentInset,
          '--bc-accent-size': layout.accentSize,
          '--bc-radius': `${layout.rounded}px`,
          '--bc-overlay-opacity': layout.overlayOpacity,
          '--bc-overlay-direction': layout.overlayDirection,
          ...appearance.reactStyle,
        }}
      >
        <div className="business-card-preview-overlay" />
        <div className="business-card-preview-accent" style={{ background: layout.accent }} />
        {hideBadge ? null : (
          <div className={`business-card-preview-badge business-card-preview-badge-${layout.badgeTone}`}>
            {label}{badgeSuffix ? ` · ${badgeSuffix}` : ''}
          </div>
        )}
        <div className="business-card-preview-main">
          <div className="business-card-name">{previewData.name || '홍길동'}</div>
          <div className="business-card-role">{[previewData.jobTitle || '직함', previewData.company || '회사명'].filter(Boolean).join(' · ')}</div>
          <div className="business-card-divider" />
          <div className="business-card-info-list">
            {[previewData.phone || '010-0000-0000', previewData.email || 'name@example.com', previewData.website || 'www.example.com', previewData.address || '서울시 강남구 테헤란로 00'].map(item => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </div>
        <div className="business-card-preview-foot">
          <div className="business-card-tagline">{previewData.tagline || '한 줄 소개를 입력하면 이 영역에 반영됩니다.'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="stack page-stack business-card-builder-page">
      <section className="card stack business-card-builder-card">
        <div className="business-card-layout">
          <div className="business-card-preview-panel">
            <div className="business-card-preview-stage">
              <BusinessCardPreviewCanvas
                templateValue={template}
                sizeValue={cardSize}
                previewData={form}
                appearanceMode={backgroundMode}
                solidColor={backgroundColor}
                photoUrl={uploadedPhoto}
                patternUrl={uploadedPattern}
                patternValue={patternPreset}
                gradientValue={gradientPreset}
                gradientRotate={gradientAngle}
                reflectionColor={reflectionBaseColor}
                reflectionRotate={reflectionAngle}
                reflectionAlpha={reflectionOpacity}
                badgeSuffix={currentSize.label}
              />
            </div>
          </div>

          <div className="stack business-card-form-panel">
            <div className="business-card-form-scroll">
              <div className="business-card-section-head">
                <div>
                  <h3>세부 설정</h3>
                </div>
              </div>

              <div className="business-card-control-grid business-card-control-grid-top business-card-control-grid-top-4">
                <div className="stack business-card-field business-card-field-load">
                  <label>불러오기</label>
                  <select value={selectedSavedCard} onChange={e => loadSavedCard(e.target.value)}>
                    <option value="">저장된 명함 선택</option>
                    {savedCards.map(item => (
                      <option key={item.id} value={item.id}>
                        {(item.title || '최근 작업')} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="stack business-card-field business-card-field-with-shop">
                  <div className="business-card-field-label-row">
                    <label>명함폼 <button type="button" className="business-card-shop-link" onClick={() => setShopOpen(true)}>(폼상점)</button></label>
                  </div>
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={e => setTemplateSearch(e.target.value)}
                    placeholder="명함폼 검색"
                    className="business-card-template-search"
                  />
                  <select value={template} onChange={e => setTemplate(e.target.value)}>
                    {(filteredTemplateOptions.length ? filteredTemplateOptions : templateOptions).map(item => (
                      <option key={item.value} value={item.value}>
                        {item.label}{isShopPaidTemplate(item.value) ? ' · 유료폼' : item.premium ? ' · 프리미엄' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="muted small-text business-card-template-meta">{currentTemplate.group || '기본'} · {currentTemplate.description}</div>
                </div>
                <div className="stack business-card-field">
                  <label>명함크기</label>
                  <select value={cardSize} onChange={e => setCardSize(e.target.value)}>
                    {sizeOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="business-card-control-grid business-card-control-grid-main">
                <div className="stack business-card-field">
                  <label>명함배경</label>
                  <select value={backgroundMode} onChange={e => setBackgroundMode(e.target.value)}>
                    <option value="solid">단색</option>
                    <option value="photo">사진</option>
                    <option value="pattern">패턴</option>
                    <option value="gradient">그라데이션</option>
                    <option value="reflection">반사</option>
                  </select>
                </div>

                {backgroundMode === 'solid' ? (
                  <div className="stack business-card-field business-card-background-option business-card-background-option-wide">
                    <label>단색선택</label>
                    <select value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)}>
                      {colorOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </div>
                ) : null}

                {backgroundMode === 'photo' ? (
                  <div className="stack business-card-field business-card-background-option business-card-background-option-wide">
                    <label>사진첨부</label>
                    <input type="file" accept="image/*" onChange={e => readLocalImage(e.target.files?.[0], setUploadedPhoto)} />
                  </div>
                ) : null}

                {backgroundMode === 'pattern' ? (
                  <>
                    <div className="stack business-card-field business-card-background-option">
                      <label>기본패턴</label>
                      <select value={patternPreset} onChange={e => setPatternPreset(e.target.value)}>
                        {patternOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </div>
                    <div className="stack business-card-field business-card-background-option">
                      <label>패턴첨부</label>
                      <input type="file" accept="image/*" onChange={e => readLocalImage(e.target.files?.[0], setUploadedPattern)} />
                    </div>
                  </>
                ) : null}

                {backgroundMode === 'gradient' ? (
                  <>
                    <div className="stack business-card-field business-card-background-option">
                      <label>그라데이션 종류</label>
                      <select value={gradientPreset} onChange={e => setGradientPreset(e.target.value)}>
                        {gradientOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </div>
                    <div className="stack business-card-field business-card-background-option">
                      <label>각도 {gradientAngle}°</label>
                      <input type="range" min="0" max="360" value={gradientAngle} onChange={e => setGradientAngle(Number(e.target.value))} />
                    </div>
                  </>
                ) : null}

                {backgroundMode === 'reflection' ? (
                  <>
                    <div className="stack business-card-field business-card-background-option">
                      <label>반사톤</label>
                      <select value={reflectionBaseColor} onChange={e => setReflectionBaseColor(e.target.value)}>
                        {reflectionPresets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </div>
                    <div className="stack business-card-field business-card-background-option">
                      <label>반사각 {reflectionAngle}°</label>
                      <input type="range" min="-90" max="90" value={reflectionAngle} onChange={e => setReflectionAngle(Number(e.target.value))} />
                    </div>
                    <div className="stack business-card-field business-card-background-option business-card-background-option-wide">
                      <label>반사강도 {Math.round(reflectionOpacity * 100)}%</label>
                      <input type="range" min="0.12" max="0.72" step="0.02" value={reflectionOpacity} onChange={e => setReflectionOpacity(Number(e.target.value))} />
                    </div>
                  </>
                ) : null}

                <TextField label="이름" value={form.name} onChange={value => updateField('name', value)} />
                <TextField label="직함" value={form.jobTitle} onChange={value => updateField('jobTitle', value)} />
                <TextField label="회사명" value={form.company} onChange={value => updateField('company', value)} />
                <TextField label="연락처" value={form.phone} onChange={value => updateField('phone', value)} />
                <TextField label="이메일" value={form.email} onChange={value => updateField('email', value)} />
                <TextField label="웹사이트" value={form.website} onChange={value => updateField('website', value)} />
                <div className="business-card-field business-card-field-span-full">
                  <TextField label="주소" value={form.address} onChange={value => updateField('address', value)} />
                </div>
                <div className="stack business-card-field business-card-field-span-full">
                  <label>한줄 소개</label>
                  <textarea value={form.tagline} onChange={e => updateField('tagline', e.target.value)} placeholder="예: 고객의 이력을 한 장의 프로필로 정리합니다." rows={4} />
                </div>
              </div>

              <div className="business-card-head-actions business-card-bottom-actions">
                <button type="button" className="ghost" onClick={copySummary}>정보복사</button>
                <button type="button" className="ghost business-card-bottom-original-button" onClick={() => downloadOriginalFile()}>원본파일받기</button>
                <button type="button" className="business-card-action-desktop" onClick={printCard}>인쇄하기</button>
                <button type="button" className="business-card-action-mobile" onClick={saveCard}>저장</button>
              </div>

              {currentShopForm && !isTemplateUnlocked(template) ? (
                <div className="business-card-locked-guide">
                  <strong>{currentShopForm.name}</strong>
                  <div className="muted small-text">{currentShopForm.lockNote}</div>
                  <button type="button" className="ghost" onClick={() => openShopForTemplate(template)}>폼상점에서 보기</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {shopOpen ? (
        <div className="business-card-shop-modal" role="dialog" aria-modal="true">
          <div className="business-card-shop-backdrop" onClick={() => { setShopOpen(false); closeShopPreview() }} />
          <div className="business-card-shop-sheet card stack">
            <div className="business-card-shop-head">
              <div className="stack gap-6">
                <strong>폼상점</strong>
                <div className="muted small-text">유료형 폼은 만들기 화면에 적용은 가능하지만 저장·인쇄·정보복사·원본파일 받기는 결제 후 열리도록 잠금 처리됩니다.</div>
              </div>
              <button type="button" className="ghost" onClick={() => { setShopOpen(false); closeShopPreview() }}>닫기</button>
            </div>
            <div className="business-card-shop-grid">
              {shopForms.map(item => (
                <article key={item.id} className={`business-card-shop-item ${template === item.id ? 'business-card-shop-item-active' : ''}`}>
                  <div className="business-card-shop-item-copy">
                    <strong>{item.name}</strong>
                    <div className="muted small-text">{item.desc}</div>
                    <div className="business-card-shop-item-note">{item.detail}</div>
                    <div className="business-card-shop-item-note business-card-shop-item-note-strong">{item.lockNote}</div>
                  </div>
                  <button type="button" className="business-card-shop-thumb-button" onClick={() => openShopPreview(item.id)} aria-label={`${item.name} 미리보기 확대`}>
                    <BusinessCardPreviewCanvas templateValue={item.id} sizeValue="standard_90x50" previewData={shopPreviewSeed} appearanceMode="template" className="business-card-preview-thumb" hideBadge />
                    <span className="business-card-shop-thumb-zoom">확대</span>
                  </button>
                  <div className="business-card-shop-item-foot">
                    <div className="business-card-shop-cta">
                      <span className="chip business-card-shop-price">{item.price}</span>
                      <div className="business-card-shop-cta-buttons business-card-shop-cta-buttons-3">
                        <button type="button" className="ghost" onClick={() => openShopPreview(item.id)}>상세보기</button>
                        <button type="button" className="ghost" onClick={() => startPayment(item)}>결제하기</button>
                        <button type="button" onClick={() => applyShopForm(item.id)}>{template === item.id ? '적용중' : '적용하기'}</button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {activeShopPreview ? (
            <div className="business-card-preview-lightbox" role="dialog" aria-modal="true">
              <div className="business-card-preview-lightbox-backdrop" onClick={closeShopPreview} />
              <div className="business-card-preview-lightbox-card card stack">
                <div className="business-card-preview-lightbox-head">
                  <div>
                    <strong>{activeShopPreview.name}</strong>
                    <div className="muted small-text">{activeShopPreview.desc}</div>
                  </div>
                  <button type="button" className="ghost" onClick={closeShopPreview}>닫기</button>
                </div>
                <div className="business-card-preview-lightbox-stage">
                  <BusinessCardPreviewCanvas templateValue={activeShopPreview.id} sizeValue="standard_90x50" previewData={shopPreviewSeed} appearanceMode="template" className="business-card-preview-large" badgeSuffix="90 × 50mm" />
                </div>
                <div className="business-card-shop-detail-box">
                  <div className="muted small-text">{activeShopPreview.detail}</div>
                  <div className="muted small-text">{activeShopPreview.lockNote}</div>
                </div>
                <div className="business-card-preview-lightbox-actions">
                  <button type="button" className="ghost" onClick={() => startPayment(activeShopPreview)}>결제하기</button>
                  <button type="button" className="ghost" onClick={() => showPaymentGuide(activeShopPreview)}>폼상점 위치 보기</button>
                  <button type="button" onClick={() => applyShopForm(activeShopPreview.id)}>적용하기</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function QrGeneratorPage() {
  const [profiles, setProfiles] = useState([])
  const [selectedId, setSelectedId] = useState(() => getStoredActiveProfileId())
  const [title, setTitle] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [items, setItems] = useState([])
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load(preferredId = selectedId) {
    const data = await api('/api/profiles')
    const nextItems = data.items || []
    const resolvedId = nextItems.some(item => item.id === preferredId) ? preferredId : nextItems[0]?.id || null
    setProfiles(nextItems)
    setSelectedId(resolvedId)
    setStoredActiveProfileId(resolvedId)
    setItems((nextItems.find(item => item.id === resolvedId) || nextItems[0] || {}).qrs || [])
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const selected = profiles.find(item => item.id === selectedId)
    setItems(selected?.qrs || [])
  }, [profiles, selectedId])

  async function submit() {
    if (!selectedId || !title.trim() || !targetUrl.trim()) return
    setBusy(true)
    try {
      const data = await api(`/api/profiles/${selectedId}/qrs`, { method: 'POST', body: JSON.stringify({ title: title.trim(), target_url: targetUrl.trim(), is_public: true }) })
      setCreated(data.item)
      setTitle('')
      setTargetUrl('')
      await load()
    } catch (err) {
      window.alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyText(value, label='복사') {
    await navigator.clipboard.writeText(value)
    window.alert(`${label}가 복사되었습니다.`)
  }

  return (
    <div className="stack page-stack">
      <section className="card stack">
        <h3>QR생성</h3>
        <div className="muted small-text">생성한 QR은 계속 사용할 수 있으며, 1년 이상 스캔 기록이 없으면 정리됩니다.</div>
        <div className="grid-2">
          <div className="stack">
            <label>연결할 프로필</label>
            <select value={selectedId || ''} onChange={e => setSelectedId(Number(e.target.value) || null)}>
              {profiles.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <TextField label="생성할 QR이름" value={title} onChange={setTitle} />
          <TextField label="연결할 URL" value={targetUrl} onChange={setTargetUrl} />
        </div>
        <button type="button" disabled={busy} onClick={submit}>{busy ? '생성 중...' : 'QR생성'}</button>
        {created ? (
          <div className="qr-card">
            <img src={created.image_url} alt={created.title} />
            <strong>{created.title}</strong>
            <button type="button" className="ghost" onClick={() => copyText(created.redirect_url || created.target_url, 'QR 연결 주소')}>{created.redirect_url || created.target_url}</button>
          </div>
        ) : null}
      </section>
      <section className="card stack">
        <h3>생성된 QR 목록</h3>
        <div className="qr-grid">
          {items.length ? items.map(item => (
            <div key={item.id} className="qr-card">
              <img src={item.image_url} alt={item.title} />
              <strong>{item.title}</strong>
              <div className="muted small-text">스캔 {item.scan_count || 0}회</div>
              <div className="muted small-text">마지막 접속 {formatLastAccess(item.last_accessed_at)}</div>
              <button type="button" className="ghost" onClick={() => copyText(item.redirect_url || item.target_url, 'QR 연결 주소')}>연결 주소 복사</button>
            </div>
          )) : <div className="muted">생성된 QR이 없습니다.</div>}
        </div>
      </section>
    </div>
  )
}

function formatLastAccess(value) {
  if (!value) return '없음'
  const dt = new Date(value)
  return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleDateString('ko-KR')
}

function MediaPreviewList({ items }) {
  return (
    <div className="media-grid">
      {items.map((item, index) => {
        const url = item.url || item
        const kind = item.media_kind || (String(item.content_type || '').startsWith('video/') ? 'video' : 'image')
        const previewUrl = item.preview_url || ''
        return (
          <div key={`${url}-${index}`} className="media-card">
            {kind === 'video'
              ? <video src={url} poster={previewUrl || undefined} controls playsInline preload="metadata" />
              : <img src={previewUrl || url} alt="업로드 미디어" loading="eager" />}
            <div className="muted small-text">{kind === 'video' ? '영상' : '사진'}{previewUrl ? ' · 미리보기 적용' : ''}</div>
          </div>
        )
      })}
    </div>
  )
}

function socialIconFor(key) {
  return {
    instagram: '📸', facebook: '📘', youtube: '▶️', x: '𝕏', tiktok: '🎵', linkedin: '💼', github: '💻', notion: '📝',
    blog: '✍️', brunch: '✍️', store: '🛍️', cafe: '☕', threads: '🧵', chat: '💬', link: '🔗', external: '🔗'
  }[key] || '🔗'
}

function SocialLinkList({ items, editable = false, onItemClick }) {
  if (!items?.length) return <div className="muted">등록된 링크가 없습니다.</div>
  return (
    <div className="social-link-list"> 
      {items.map(item => (
        <a key={item.id} className="social-link-chip" href={item.original_url} target="_blank" rel="noreferrer" onClick={() => onItemClick?.(item)}>
          <span className="social-icon">{socialIconFor(item.social_icon || item.link_type)}</span>
          <span className="social-title">{item.title || item.social_label || '링크'}</span>
          <span className="social-sub">{item.social_label || '외부 링크'}</span>
          {editable ? <span className="social-meta">{item.click_count || 0}회 · {item.full_short_url}</span> : null}
        </a>
      ))}
    </div>
  )
}

function tabLabel(name) {
  return { hub: '허브', profile: '기본', career: '경력', intro: '자소서', link: 'URLs', qr: 'QR', media: '미디어' }[name] || name
}

function visibilityLabel(value) {
  return { private: '비공개', link_only: '링크 전용', search: '검색 노출' }[value] || value
}

function questionPermissionLabel(value) {
  return { none: '질문 안 받음', members: '로그인 사용자만', any: '누구나 가능' }[value] || value
}

function getPublicProfileUrl(slug) {
  if (typeof window === 'undefined') return `/p/${slug || ''}`
  return `${window.location.origin}/p/${slug || ''}`
}

async function copyText(value, successMessage = '복사했습니다.') {
  try {
    await navigator.clipboard.writeText(String(value || ''))
    window.alert(successMessage)
    return true
  } catch {
    window.alert('복사에 실패했습니다.')
    return false
  }
}

function getProfileLocalAnalyticsSummary(profile) {
  const slug = String(profile?.slug || '')
  const profileId = Number(profile?.id || 0)
  const events = readLocalItems(LOCAL_STORAGE_KEYS.analyticsEvents, [])
  return events.reduce((acc, item) => {
    const sameSlug = slug && String(item.profileSlug || '') === slug
    const sameId = profileId > 0 && Number(item.profileId || 0) === profileId
    if (!sameSlug && !sameId) return acc
    const type = String(item.type || '')
    if (type === 'visit') acc.visits += 1
    if (type === 'link_click') acc.linkClicks += 1
    if (type === 'qr_click') acc.qrClicks += 1
    if (type === 'cta_click') acc.ctaClicks += 1
    if (type === 'lead') acc.leads += 1
    return acc
  }, { visits: 0, linkClicks: 0, qrClicks: 0, ctaClicks: 0, leads: 0 })
}

function buildProfileGrowthChecklist(profile) {
  const items = [
    {
      key: 'headline',
      label: '프로필 기본 정보',
      done: Boolean((profile?.display_name || profile?.title || '').trim() && (profile?.headline || '').trim()),
      description: '닉네임, 한 줄 소개를 먼저 채워서 공개 페이지 첫 인상을 만듭니다.',
    },
    {
      key: 'intro',
      label: '자기소개서',
      done: Boolean(profile?.introductions?.length),
      description: '광고 2안의 “프로필, 소개서, 링크, QR까지” 흐름 중 소개 영역입니다.',
    },
    {
      key: 'link',
      label: '링크 허브',
      done: Boolean(profile?.links?.length),
      description: '블로그, 포트폴리오, 사업 링크를 연결해 실제 전환 통로를 만듭니다.',
    },
    {
      key: 'qr',
      label: 'QR 공유',
      done: Boolean(profile?.qrs?.length),
      description: '오프라인 소개, 명함, 채팅 공유에서 바로 스캔할 수 있게 연결합니다.',
    },
    {
      key: 'career',
      label: '경력/스토리',
      done: Boolean(profile?.careers?.length),
      description: '이력과 후기, 증빙 이미지를 추가해 신뢰도를 올립니다.',
    },
  ]
  const completed = items.filter(item => item.done).length
  return { items, completed, total: items.length, percent: items.length ? Math.round(completed / items.length * 100) : 0 }
}

function emptyProfile() {
  return { title: '', slug: '', display_name: '', gender: '', birth_year: '', feed_profile_public: false, profile_image_url: '', cover_image_url: '', headline: '', bio: '', location: '', current_work: '', industry_category: '기타', theme_color: '#3b82f6', visibility_mode: 'link_only', question_permission: 'any' }
}

function emptyCareer() {
  return { title: '', one_line: '', period: '', role_name: '', description: '', review_text: '', image_url: '', gallery_json: [], media_items: [], is_public: true, sort_order: 1 }
}

function mapProfileToForm(profile) {
  return {
    title: profile.title || '',
    slug: profile.slug || '',
    display_name: profile.display_name || profile.title || '',
    gender: profile.gender || '',
    birth_year: profile.birth_year || '',
    feed_profile_public: Boolean(profile.feed_profile_public),
    profile_image_url: profile.profile_image_url || '',
    cover_image_url: profile.cover_image_url || '',
    headline: profile.headline || '',
    bio: profile.bio || '',
    location: profile.location || '',
    current_work: profile.current_work || '',
    industry_category: profile.industry_category || '기타',
    theme_color: profile.theme_color || '#3b82f6',
    visibility_mode: profile.visibility_mode || 'link_only',
    question_permission: profile.question_permission || 'any',
  }
}

export default App