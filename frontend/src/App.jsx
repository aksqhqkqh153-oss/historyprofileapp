import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, clearSession, getApiBase, getStoredUser, getToken, uploadFile } from './api'
import { NAV_ITEMS, MENU_ITEMS, INDUSTRY_OPTIONS } from './constants'
import AuthPage from './pages/AuthPage'
import AdminPage from './pages/AdminPage'
import { TextField, Metric } from './components/ui'
import TurnstileWidget from './components/TurnstileWidget'
import { useTurnstileConfig } from './hooks/useTurnstileConfig'

function pageTitle(pathname) {
  if (pathname.startsWith('/chats')) return '채팅'
  if (pathname.startsWith('/friends')) return '친구'
  if (pathname.startsWith('/questions')) return '질문'
  if (pathname.startsWith('/community')) return '대화'
  if (pathname.startsWith('/profile')) return '프로필'
  if (pathname.startsWith('/admin')) return '관리자'
  if (pathname.startsWith('/url-shortener')) return 'URLs단축'
  if (pathname.startsWith('/qr-generator')) return 'QR생성'
  if (pathname.startsWith('/p/')) return '공개 프로필'
  return '홈'
}

function useAuth() {
  const [user, setUser] = useState(getStoredUser())
  return { user, setUser }
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
  }
  return <span className="icon-symbol" aria-label={label}>{icons[name] || icons.home}</span>
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
  '/questions': { icon: 'questions' },
  '/community': { icon: 'conversation' },
  '/profile': { icon: 'profile' },
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


function AnchoredPopup({ anchorRef, open, align = 'left', className = '', children }) {
  const [style, setStyle] = useState({})

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current || typeof window === 'undefined') return undefined

    function updatePosition() {
      const rect = anchorRef.current.getBoundingClientRect()
      const gap = 8
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const popupWidth = Math.min(420, viewportWidth - 16)
      const baseLeft = align === 'right' ? rect.right - popupWidth : rect.left
      const nextLeft = Math.max(8, Math.min(baseLeft, viewportWidth - popupWidth - 8))
      const nextTop = Math.min(rect.bottom + gap, viewportHeight - 80)
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
  }, [align, anchorRef, open])

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
  const counts = useNotificationCounts(user, location.pathname)
  const [multiProfiles, setMultiProfiles] = useState([])
  const [multiProfileManagerOpen, setMultiProfileManagerOpen] = useState(false)
  const [multiProfileManagerBusy, setMultiProfileManagerBusy] = useState(false)

  useEffect(() => {
    setActivePopup('')
  }, [location.pathname])

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
    navigate(path)
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
          <div className="topbar-left popup-anchor-group">
            <button ref={menuButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button" onClick={() => togglePopup('menu')} aria-expanded={activePopup === 'menu'} aria-label="메뉴">
              <IconGlyph name="menu" label="메뉴" />
            </button>
            <AnchoredPopup anchorRef={menuButtonRef} open={activePopup === 'menu'} className="menu-popup dropdown-popup">
              <div className="dropdown-title">메뉴</div>
              <div className="dropdown-list">
                {MENU_ITEMS.map(item => <Link key={item.path} className="dropdown-item dropdown-item-with-icon" to={item.path}><IconGlyph name={item.path === '/url-shortener' ? 'link' : 'qr'} label={item.label} /><span>{item.label}</span></Link>)}
                {isAdmin ? <Link className="dropdown-item dropdown-item-with-icon" to="/admin"><IconGlyph name="admin" label="관리자" /><span>관리자 페이지</span></Link> : null}
              </div>
            </AnchoredPopup>
          </div>
          <div className="page-heading"><span className="page-heading-mark">H</span><span>{pageTitle(location.pathname)}</span></div>
          <div className="topbar-right popup-anchor-group popup-anchor-group-right">
            <button ref={searchButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button" onClick={() => setActivePopup('search')} aria-expanded={activePopup === 'search'} aria-label="검색">
              <IconGlyph name="search" label="검색" />
            </button>
            <button ref={alertButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button badge-button" onClick={() => togglePopup('alerts')} aria-expanded={activePopup === 'alerts'} aria-label="알림">
              <IconGlyph name="bell" label="알림" />
              {totalNotificationLabel ? <span className="icon-badge topbar-badge">{totalNotificationLabel}</span> : null}
            </button>
            <AnchoredPopup anchorRef={alertButtonRef} open={activePopup === 'alerts'} align="right" className="settings-popup dropdown-popup stack settings-panel">
              <div className="dropdown-title">알림</div>
              <div className="dropdown-list">
                <button type="button" className="dropdown-item ghost dropdown-item-between" onClick={() => closePopupAndNavigate('/chats')}>
                  <span>채팅</span>
                  <strong>{formatBadgeCount(counts.chats, 100) || '0'}</strong>
                </button>
                <button type="button" className="dropdown-item ghost dropdown-item-between" onClick={() => closePopupAndNavigate('/friends')}>
                  <span>친구요청</span>
                  <strong>{formatBadgeCount(counts.friends, 999) || '0'}</strong>
                </button>
                <button type="button" className="dropdown-item ghost dropdown-item-between" onClick={() => closePopupAndNavigate('/questions')}>
                  <span>질문</span>
                  <strong>{formatBadgeCount(counts.questions, 999) || '0'}</strong>
                </button>
              </div>
            </AnchoredPopup>
            <button ref={settingsButtonRef} type="button" className="icon-button ghost topbar-trigger topbar-icon-button" onClick={() => togglePopup('settings')} aria-expanded={activePopup === 'settings'} aria-label="설정">
              <IconGlyph name="settings" label="설정" />
            </button>
            <AnchoredPopup anchorRef={settingsButtonRef} open={activePopup === 'settings'} align="right" className="settings-popup dropdown-popup stack settings-panel">
              <div className="dropdown-title">설정</div>
              <div className="dropdown-user-box">
                <strong>{user.nickname}</strong>
                <div className="muted small-text">{user.email}</div>
              </div>
              <div className="dropdown-list">
                <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={() => closePopupAndNavigate('/profile')}><IconGlyph name="profile" label="프로필" /><span>내 프로필 관리</span></button>
                <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={openMultiProfileManager}><IconGlyph name="userAdd" label="계정변경(멀티)" /><span>계정변경(멀티)</span></button>
                {isAdmin ? <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={() => closePopupAndNavigate('/admin')}><IconGlyph name="admin" label="관리자" /><span>관리자 페이지</span></button> : null}
                <button type="button" className="dropdown-item ghost dropdown-item-with-icon" onClick={logout}><IconGlyph name="logout" label="로그아웃" /><span>로그아웃</span></button>
              </div>
            </AnchoredPopup>
          </div>
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
          <Route path="/url-shortener" element={<UrlShortenerPage />} />
          <Route path="/qr-generator" element={<QrGeneratorPage />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        {NAV_ITEMS.map(item => {
          const badgeValue = item.path === '/chats'
            ? formatBadgeCount(counts.chats, 100)
            : item.path === '/questions'
              ? formatBadgeCount(counts.questions, 999)
              : item.path === '/friends'
                ? formatBadgeCount(counts.friends, 999)
                : ''
          return (
            <Link key={item.path} to={item.path} className={location.pathname === item.path ? 'nav-item active nav-item-with-badge' : 'nav-item nav-item-with-badge'}>
              <span className="nav-item-label"><span className="nav-item-icon"><IconGlyph name={NAV_META[item.path]?.icon || 'home'} label={item.label} /></span><span className="nav-item-text">{item.label}</span></span>
              {badgeValue ? <span className="nav-badge">{badgeValue}</span> : null}
            </Link>
          )
        })}
      </nav>
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


function formatDateLabel(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function statusLabel(value) {
  return { pending: '새질문', answered: '피드', rejected: '거절질문' }[value] || value
}

function QuestionBoard({ profile, ownerNickname, isOwner, onRefresh, canAsk = true, initialAskOpen = false }) {
  const navigate = useNavigate()
  const viewer = getStoredUser()
  const viewerId = Number(viewer?.id || 0)
  const defaultNickname = String(viewer?.nickname || '').trim() || '익명'
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

  const tabDefs = [
    { key: 'feed', label: `피드 ${feedItems.length}` },
    { key: 'new', label: isOwner ? `새질문 ${newItems.length}` : '새질문' },
    { key: 'rejected', label: isOwner ? `거절질문 ${rejectedItems.length}` : '거절질문' },
  ]

  return (
    <section className="card stack question-board">
      <div className="split-row question-board-head">
        <div className="tab-row question-tabs-row">
          {tabDefs.map(item => <button key={item.key} type="button" className={tab === item.key ? 'tab active' : 'tab'} onClick={() => setTab(item.key)}>{item.label}</button>)}
        </div>
        {!isOwner && canAsk ? <button type="button" onClick={() => setAskOpen(v => !v)}>질문하기</button> : null}
      </div>
      {!isOwner && askOpen ? (
        <div className="bordered-box stack question-ask-box">
          <div className="inline-form responsive-row question-nickname-row">
            <TextField label="닉네임" value={nickname} onChange={setNickname} />
            <label className="question-anon-toggle">
              <input type="checkbox" checked={isAnonymous} onChange={event => {
                const checked = event.target.checked
                setIsAnonymous(checked)
                setNickname(checked ? '익명' : (String(getStoredUser()?.nickname || '').trim() || '익명'))
              }} />
              <span>ㅁ 익명전환</span>
            </label>
          </div>
          <label>질문 내용</label>
          <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="상대에게 남길 질문을 입력하세요." />
          <TurnstileWidget enabled={turnstile.turnstile_enabled} siteKey={turnstile.turnstile_site_key} onToken={setCaptchaToken} refreshKey={`question-board-${captchaVersion}`} />
          <div className="action-wrap">
            <button type="button" onClick={askQuestion} disabled={turnstile.turnstile_enabled && !captchaToken}>질문 등록</button>
            <button type="button" className="ghost" onClick={() => setAskOpen(false)}>닫기</button>
          </div>
        </div>
      ) : null}
      <div className="list question-feed-list">
        {lockedTab ? <div className="bordered-box muted">이 항목은 프로필 소유자만 확인할 수 있습니다.</div> : null}
        {!lockedTab && visibleItems.length ? visibleItems.map(item => {
          const comments = commentLists[item.id] || []
          const canDeleteOwnQuestion = !isOwner && viewerId > 0 && Number(item.asker_user_id || 0) === viewerId
          return (
            <article key={item.id} className="question-feed-card">
              <div className="question-feed-top">
                <div>
                  <div className="question-user-line"><strong>{item.display_nickname || item.nickname}</strong><span className="muted small-text">질문일 {formatDateLabel(item.created_at)}</span></div>
                  <div className="question-body">{item.question_text}</div>
                </div>
                <div className="question-top-actions">
                  {canDeleteOwnQuestion ? (
                    <button type="button" className="question-delete-icon" onClick={() => deleteQuestion(item)} title="삭제" aria-label="삭제">
                      <IconGlyph name="trash" label="삭제" />
                    </button>
                  ) : null}
                  <span className="chip">{statusLabel(item.status)}</span>
                </div>
              </div>
              {item.status === 'answered' ? (
                <div className="answer-box question-answer-box">
                  <div className="question-user-line"><strong>{ownerNickname || '답변자'}</strong><span className="muted small-text">답변일 {formatDateLabel(item.answered_at)}</span></div>
                  <div className="pre-wrap">{item.answer_text}</div>
                </div>
              ) : null}
              {item.status === 'pending' && isOwner ? (
                <div className="stack bordered-box">
                  <label>답변 작성</label>
                  <textarea value={answers[item.id] || ''} onChange={e => setAnswers(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="답변을 입력하면 피드로 이동합니다." />
                  <div className="action-wrap">
                    <button type="button" onClick={() => answerQuestion(item)}>답변</button>
                    <button type="button" className="ghost" onClick={() => rejectQuestion(item)}>거절</button>
                    <button type="button" className="ghost" onClick={() => deleteQuestion(item)}>삭제</button>
                  </div>
                </div>
              ) : null}
              <div className="question-footer-actions">
                <button type="button" className="ghost" onClick={() => loadComments(item)}>댓글 {item.comments_count || 0}</button>
                <button type="button" className="ghost" onClick={() => engage(item, 'like')}>좋아요 {item.liked_count || 0}</button>
                <button type="button" className="ghost" onClick={() => engage(item, 'bookmark')}>보관 {item.bookmarked_count || 0}</button>
                <button type="button" className="ghost" onClick={() => engage(item, 'share')}>공유 {item.shared_count || 0}</button>
              </div>
              {commentLists[item.id] ? (
                <div className="stack question-comments-box">
                  <div className="list compact-list">
                    {comments.length ? comments.map(comment => <div key={comment.id} className="bordered-box"><strong>{comment.display_nickname}</strong><div className="muted small-text">{formatDateLabel(comment.created_at)}</div><div>{comment.comment_text}</div></div>) : <div className="muted">아직 댓글이 없습니다.</div>}
                  </div>
                  <div className="inline-form responsive-row">
                    <input value={commentDrafts[item.id] || ''} onChange={e => setCommentDrafts(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="댓글 입력" />
                    <button type="button" onClick={() => addComment(item)}>댓글 등록</button>
                  </div>
                </div>
              ) : null}
            </article>
          )
        }) : <div className="bordered-box muted">표시할 항목이 없습니다.</div>}
      </div>
    </section>
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
          <h3>{profile.display_name || profile.title}</h3>
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

function QuestionProfilePage() {
  const { profileId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const openAskRequested = Boolean(location.state?.openAsk)

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

  if (error) return <div className="card error">{error}</div>
  if (!data?.profile) return <div className="card">불러오는 중...</div>

  const profileName = data.owner?.nickname || data.profile.display_name || data.profile.title || '프로필 주인'
  const profileAvatar = data.profile?.profile_image_url || data.owner?.photo_url || ''

  return (
    <div className="stack page-stack question-profile-page">
      <section className="card stack question-profile-header-card">
        <div className="question-profile-header-row">
          <BackIconButton onClick={() => navigate(-1)} />
          <button type="button" className="question-profile-summary" onClick={() => setProfileOpen(v => !v)}>
            <span className="feed-avatar question-profile-avatar">
              {profileAvatar ? <img src={profileAvatar} alt={profileName} /> : <span>{profileName.slice(0, 1)}</span>}
            </span>
            <span className="question-profile-summary-copy">
              <strong>{profileName}</strong>
              <span>{openAskRequested && !Boolean(data.is_owner) ? '질문을 남길 수 있는 화면입니다.' : '질문과 피드를 확인할 수 있습니다.'}</span>
            </span>
          </button>
        </div>
        {profileOpen ? <ProfileOverviewCard profile={data.profile} expanded /> : null}
      </section>
      <QuestionBoard profile={data.profile} ownerNickname={profileName} isOwner={Boolean(data.is_owner)} onRefresh={load} canAsk initialAskOpen={openAskRequested && !Boolean(data.is_owner)} />
    </div>
  )
}

function formatFeedTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function FeedComposerModal({ open, onClose, onCreated }) {
  const navigate = useNavigate()
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

  if (!open) return null

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    try {
      setSubmitting(true)
      setError('')
      let imageUrl = ''
      if (imageFile) {
        const uploaded = await uploadFile(imageFile, 'feed', null)
        imageUrl = uploaded?.item?.url || uploaded?.url || ''
      }
      const created = await api('/api/feed/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          content: form.content,
          image_url: imageUrl,
        }),
      })
      setForm({ title: '', content: '' })
      setImageFile(null)
      onCreated?.(created.item)
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
          <h3>피드 생성</h3>
          <button type="button" className="ghost" onClick={onClose}>닫기</button>
        </div>
        <form className="stack" onSubmit={handleSubmit}>
          <TextField label="제목">
            <input
              value={form.title}
              onChange={event => setForm(current => ({ ...current, title: event.target.value.slice(0, 120) }))}
              placeholder="피드 제목을 입력하세요"
            />
          </TextField>
          <TextField label="내용">
            <textarea
              value={form.content}
              onChange={event => setForm(current => ({ ...current, content: event.target.value.slice(0, 5000) }))}
              placeholder="오늘 공유하고 싶은 내용을 작성하세요"
              rows={8}
            />
          </TextField>
          <TextField label="사진 첨부">
            <input type="file" accept="image/*" onChange={event => setImageFile(event.target.files?.[0] || null)} />
          </TextField>
          {imagePreview ? <div className="feed-compose-preview"><img src={imagePreview} alt="미리보기" /></div> : null}
          {error ? <div className="error card">{error}</div> : null}
          <div className="split-row responsive-row">
            <div className="muted small-text">사진은 선택사항입니다. 제목 또는 내용 중 하나는 반드시 입력되어야 합니다.</div>
            <button type="submit" disabled={submitting}>{submitting ? '등록 중...' : '피드 올리기'}</button>
          </div>
        </form>
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

  return (
    <article className="feed-post-card">
      <div className="feed-post-top">
        <button type="button" className="feed-author-button" onClick={openProfile}>
          <span className="feed-avatar">
            {avatar ? <img src={avatar} alt={displayName} /> : <span>{displayName.slice(0, 1)}</span>}
          </span>
          <span className="feed-author-copy">
            <strong>{displayName}</strong>
            <span className="muted">{owner.nickname && owner.nickname !== displayName ? owner.nickname : profile.current_work || profile.headline || 'historyprofile 사용자'}</span>
          </span>
        </button>
        <div className="feed-post-top-actions">
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

function StoryViewerModal({ item, open, onClose }) {
  const navigate = useNavigate()
  if (!open || !item?.profile) return null
  const profile = item.profile
  const owner = item.owner || {}
  const story = item.story || {}
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
            <div className="pre-wrap">{story.content || story.summary || '스토리 내용이 없습니다.'}</div>
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
  const [error, setError] = useState('')
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const loadMoreRef = useRef(null)
  const composeOpen = new URLSearchParams(location.search).get('compose') === '1'

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
      setStories(data.items || [])
    } catch {
      setStories([])
    }
  }, [])

  useEffect(() => {
    loadFeed(true)
    loadStories()
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

  async function handleFriendRequest(item) {
    try {
      await api(`/api/friends/requests/${item.owner.id}`, { method: 'POST' })
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, viewer: { ...(entry.viewer || {}), friend_request_status: 'requested' } } : entry))
      window.alert('친구요청을 보냈습니다.')
    } catch (err) {
      window.alert(err.message)
    }
  }

  function handleCreated(item) {
    if (!item) return
    setItems(current => [item, ...current])
    setSelectedProfile(item.profile || null)
    loadStories()
  }

  function closeComposer() {
    navigate('/', { replace: true })
  }

  return (
    <div className="stack page-stack feed-home-page">
      <FeedComposerModal open={composeOpen} onClose={closeComposer} onCreated={handleCreated} />
      <StoryViewerModal item={selectedStory} open={Boolean(selectedStory)} onClose={() => setSelectedStory(null)} />
      <section className="card stack home-story-card">
        <div className="story-strip" role="list" aria-label="스토리 목록">
          {stories.length ? stories.map((item, index) => {
            const profile = item.profile || {}
            const owner = item.owner || {}
            const label = profile.display_name || owner.nickname || profile.title || '스토리'
            return (
              <button key={`story-${item.id}-${index}`} type="button" className={`story-chip ${index < 5 ? 'story-chip-priority' : ''}`} onClick={() => setSelectedStory(item)} role="listitem">
                <span className="story-chip-ring">
                  <span className="story-chip-avatar">{profile.profile_image_url ? <img src={profile.profile_image_url} alt={label} /> : <span>{label.slice(0, 1)}</span>}</span>
                </span>
                <span className="story-chip-name">{label}</span>
              </button>
            )
          }) : <div className="muted small-text">표시할 스토리가 없습니다.</div>}
        </div>
      </section>

      {selectedProfile ? (
        <section className="card stack">
          <div className="split-row"><h3>프로필 미리보기</h3><button type="button" className="ghost" onClick={() => setSelectedProfile(null)}>닫기</button></div>
          <ProfileOverviewCard profile={selectedProfile} expanded />
        </section>
      ) : null}

      {error ? <div className="card error">{error}</div> : null}

      <section className="card stack latest-feed-card">
        <div className="split-row responsive-row latest-feed-head">
          <h3>최신 피드</h3>
          <button type="button" className="feed-compose-trigger" onClick={() => navigate('/?compose=1')}>
            <IconGlyph name="compose" label="피드추가" />
            <span>피드추가</span>
          </button>
        </div>
      </section>

      <div className="feed-post-list">
        {items.length ? items.map(item => (
          <FeedPostCard key={`feed-post-${item.id}-${item.created_at}`} item={item} onOpenProfile={setSelectedProfile} onFriendRequest={handleFriendRequest} />
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
        <article className="friend-kakao-row friend-kakao-row-me">
          <button type="button" className="friend-kakao-main friend-kakao-main-static">
            <span className="friend-kakao-avatar">{myAvatar ? <img src={myAvatar} alt={myDisplayName} /> : <span>{myDisplayName.slice(0, 1)}</span>}</span>
            <span className="friend-kakao-copy">
              <strong>{myDisplayName}</strong>
              <span className="muted small-text">{myIntro}</span>
            </span>
          </button>
        </article>

        <div className="tab-row friends-tab-row kakao-friends-tabs">
          <button type="button" className={tab === 'list' ? 'tab active badge-tab-button' : 'tab badge-tab-button'} onClick={() => setTab('list')}>
            <span>목록</span>
          </button>
          <button type="button" className={tab === 'requests' ? 'tab active badge-tab-button' : 'tab badge-tab-button'} onClick={() => setTab('requests')}>
            <span>요청</span>
            {requestBadge ? <span className="tab-badge">{requestBadge}</span> : null}
          </button>
        </div>

        {tab === 'list' ? (
          <div className="friends-kakao-list">
            {friends.length ? friends.map(item => {
              const displayName = item.nickname || item.name || '사용자'
              const intro = item.one_liner || item.email || '한 줄 소개가 없습니다.'
              return (
                <article key={item.id} className="friend-kakao-row">
                  <button type="button" className="friend-kakao-main" onClick={() => openFriendProfile(item)}>
                    <span className="friend-kakao-avatar">{item.photo_url ? <img src={item.photo_url} alt={displayName} /> : <span>{displayName.slice(0, 1)}</span>}</span>
                    <span className="friend-kakao-copy">
                      <strong>{displayName}</strong>
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
  const [rooms, setRooms] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [chatError, setChatError] = useState('')
  const wsRef = useRef(null)
  const boardRef = useRef(null)

  async function loadRooms() {
    const data = await api('/api/chats')
    setRooms(data.items || [])
    if (!selected && data.items?.[0]) setSelected(data.items[0])
  }

  async function loadMessages(otherUserId) {
    const data = await api(`/api/chats/direct/${otherUserId}/messages`)
    setMessages(data.items || [])
    setStoredChatLastViewedAt(new Date().toISOString())
  }

  useEffect(() => { setStoredChatLastViewedAt(new Date().toISOString()); loadRooms() }, [])

  useEffect(() => {
    if (!selected) return
    loadMessages(selected.user_id)
    if (wsRef.current) wsRef.current.close()
    const base = getApiBase() || window.location.origin
    const wsBase = base.replace(/^http/, 'ws')
    const ws = new WebSocket(`${wsBase}/ws/chats/${selected.user_id}?token=${encodeURIComponent(getToken())}`)
    wsRef.current = ws
    ws.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.type === 'message') {
        setMessages(prev => [...prev, data.item])
        loadRooms()
      }
    }
    ws.onerror = async () => {
      await loadMessages(selected.user_id)
    }
    return () => ws.close()
  }, [selected?.user_id])

  useEffect(() => {
    if (!boardRef.current) return
    boardRef.current.scrollTop = boardRef.current.scrollHeight
  }, [messages])

  async function send() {
    if (!selected || !message.trim()) return
    setChatError('')
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(message)
    } else {
      await api(`/api/chats/direct/${selected.user_id}/messages`, { method: 'POST', body: JSON.stringify({ message }) })
      await loadMessages(selected.user_id)
    }
    setMessage('')
    loadRooms()
  }


  return (
    <div className="chat-layout">
      <section className="card stack">
        <h3>실시간 채팅 목록</h3>
        <div className="list">
          {rooms.map(room => (
            <button key={room.user_id} type="button" className={selected?.user_id === room.user_id ? 'list-row active-row' : 'list-row'} onClick={() => setSelected(room)}>
              <div>
                <strong>{room.nickname}</strong>
                <div className="muted small-text">{room.last_message || '대화 시작'}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h3>{selected ? '대화' : '대화상대 선택'}</h3>
        <div className="message-board" ref={boardRef}>
          {messages.map(item => (
            <div key={item.id} className={`message-item ${item.sender_id === selected?.user_id ? 'incoming' : 'outgoing'}`}>
              {item.has_attachment ? (String(item.message_type || '').startsWith('video') ? <video src={item.attachment_url} poster={item.attachment_preview_url || undefined} controls playsInline preload="metadata" /> : <img src={item.attachment_preview_url || item.attachment_url} alt={item.attachment_name || '첨부'} loading="lazy" />) : null}
              <div>{item.message}</div>
              {item.has_attachment ? <div className="muted small-text">첨부 {item.attachment_size_mb}MB</div> : null}
            </div>
          ))}
        </div>
        {chatError ? <div className="alert error">{chatError}</div> : null}
        <div className="inline-form">
          <input value={message} onChange={e => setMessage(e.target.value)} placeholder="메시지 입력" onKeyDown={e => { if (e.key === 'Enter') send() }} />
          <button type="button" onClick={send}>전송</button>
        </div>
      </section>
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
        <div className="split-row responsive-row community-title-row community-title-row-right">
          <button type="button" onClick={() => navigate('/community/new')}>작성</button>
        </div>
        <div className="community-filter-row">
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
  const [tab, setTab] = useState('profile')
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
      setTab('profile')
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
          <div className="plan-box">
            <div>무료 기본 프로필 {plan.free_profile_limit}개 / 현재 허용 {plan.allowed_profile_count}개</div>
            <div>추가 슬롯 권장가: 1개당 월 {Number(plan.recommended_extra_profile_price_krw).toLocaleString()}원, 3개 번들 월 {Number(plan.recommended_extra_profile_bundle_price_krw).toLocaleString()}원</div>
            <div>저장용량: {plan.used_storage_mb}MB / {plan.storage_limit_gb}GB · 오늘 영상 사용: {usage ? Math.round((usage.daily_video_bytes || 0) / 1024 / 1024 * 100) / 100 : 0}MB / {plan.daily_video_limit_mb}MB</div>
          </div>
        ) : null}
        <div className="tab-row wrap-row">
          {['profile', 'career', 'intro', 'link', 'qr', 'media'].map(name => <button key={name} type="button" className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)}>{tabLabel(name)}</button>)}
        </div>
      </section>

      {selected && plan ? <ProfileOverviewCard profile={selected} expanded /> : null}
      {selected && plan ? <ProfileManagementSummary profile={selected} plan={plan} usage={usage} /> : null}

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
            <label>커버 이미지 URL</label>
            <div className="inline-form"><input value={profileForm.cover_image_url} onChange={e => setProfileForm({ ...profileForm, cover_image_url: e.target.value })} /><button type="button" onClick={() => uploadMedia(url => setProfileForm(prev => ({ ...prev, cover_image_url: url })), 'cover', 'image/*')}>업로드</button></div>
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

      {selected && tab === 'career' && (
        <section className="card stack">
          <h3>한줄 경력 / 필모그래픽</h3>
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
          <h3>사진 / 영상 업로드</h3>
          <div className="muted">사진은 신뢰도 보강용, 영상은 더 강한 증빙 자료용으로만 제한적으로 운영합니다. 영상은 계정당 하루 총 50MB, 전체 저장은 1GB까지입니다.</div>
          <button type="button" onClick={() => uploadMedia(() => {}, 'portfolio', 'image/*,video/*')}>사진 또는 영상 업로드</button>
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
          <h3>{profile.display_name || profile.title}</h3>
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

function PublicProfilePage() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/api/profile-public/${slug}`).then(setData).catch(err => setError(err.message))
  }, [slug])

  useEffect(() => {
    if (!data?.profile) return
    const seo = data.seo || {}
    document.title = seo.title || `${data.profile.title} | historyprofile_app`

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
  return (
    <div className="public-shell">
      <div className="public-container">
        <ProfileOverviewCard profile={profile} />
        <section className="card stack">
          <div className="split-row">
            <h3>{owner.nickname}님의 한줄 경력</h3>
            <button type="button" className="ghost" onClick={reportProfile}>신고</button>
          </div>
          {profile.careers.map(item => <CareerCard key={item.id} item={item} />)}
        </section>
        <section className="grid-2">
          <div className="card stack">
            <h3>자기소개서</h3>
            {profile.introductions.map(item => <div key={item.id} className="bordered-box"><strong>{item.title}</strong><div className="pre-wrap">{item.content}</div></div>)}
          </div>
          <div className="card stack">
            <h3>링크 / QR</h3><div className="muted small-text">정적 공개 페이지: <a href={`${getApiBase() || ''}/public/p/${profile.slug}`} target="_blank" rel="noreferrer">열기</a></div>
            <SocialLinkList items={profile.links} />
            <div className="qr-grid">{profile.qrs.map(item => <div key={item.id} className="qr-card"><img src={item.image_url} alt={item.title} /><strong>{item.title}</strong><div className="muted small-text">{item.redirect_url || item.target_url}</div></div>)}</div>
          </div>
        </section>
        {profile.uploads?.length ? <section className="card stack"><h3>사진 / 영상</h3><MediaPreviewList items={profile.uploads.map(item => ({ ...item, url: item.url }))} /></section> : null}
        <QuestionBoard profile={profile} ownerNickname={owner.nickname} isOwner={Boolean(getStoredUser()?.id && Number(getStoredUser()?.id) === Number(owner?.id))} canAsk={canAsk} onRefresh={async () => setData(await api(`/api/profile-public/${slug}`))} />
      </div>
    </div>
  )
}


function ProfileManagementSummary({ profile, plan, usage }) {
  return (
    <section className="grid-2">
      <div className="card stack">
        <h3>현재 플랜 요약</h3>
        <div className="muted">무료 프로필 {plan.free_profile_limit}개 / 현재 허용 {plan.allowed_profile_count}개</div>
        <div className="muted">저장용량 {plan.used_storage_mb}MB / {plan.storage_limit_gb}GB</div>
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
  )
}

function UrlShortenerPage() {
  const [profiles, setProfiles] = useState([])
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

  return (
    <div className="stack page-stack">
      <section className="card stack">
        <h3>URLs단축</h3>
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
        <div className="list">
          {items.length ? items.map(item => (
            <button key={item.id} type="button" className="list-row split-row" onClick={() => copyShort(item.full_short_url)}>
              <div>
                <strong>{item.title || '단축 링크'}</strong>
                <div className="muted small-text">{item.full_short_url}</div>
                <div className="muted small-text">클릭 {item.click_count || 0}회 · 마지막 접속 {formatLastAccess(item.last_accessed_at)}</div>
              </div>
              <span className="chip">복사</span>
            </button>
          )) : <div className="muted">생성된 단축 URL이 없습니다.</div>}
        </div>
      </section>
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
              : <img src={previewUrl || url} alt="업로드 미디어" loading="lazy" />}
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

function SocialLinkList({ items, editable = false }) {
  if (!items?.length) return <div className="muted">등록된 링크가 없습니다.</div>
  return (
    <div className="social-link-list"> 
      {items.map(item => (
        <a key={item.id} className="social-link-chip" href={item.original_url} target="_blank" rel="noreferrer">
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
  return { profile: '기본', career: '경력', intro: '자소서', link: 'URLs', qr: 'QR', media: '미디어' }[name] || name
}

function visibilityLabel(value) {
  return { private: '비공개', link_only: '링크 전용', search: '검색 노출' }[value] || value
}

function questionPermissionLabel(value) {
  return { none: '질문 안 받음', members: '로그인 사용자만', any: '누구나 가능' }[value] || value
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
