import React, { useEffect, useMemo, useRef } from 'react'
import { api } from '../api'

const ADSENSE_CLIENT = String(import.meta.env.VITE_ADSENSE_CLIENT || '').trim()
const DEFAULT_MODE = String(import.meta.env.VITE_QUESTION_PROFILE_AD_MODE || 'adsense').trim().toLowerCase()
const QUESTION_TOP_SLOT = String(import.meta.env.VITE_ADSENSE_SLOT_QUESTION_TOP || '').trim()
const QUESTION_PROFILE_SLOT = String(import.meta.env.VITE_ADSENSE_SLOT_QUESTION_PROFILE || '').trim()
const HOME_FEED_LAYOUT_KEY = String(import.meta.env.VITE_ADSENSE_LAYOUT_KEY_HOME_FEED_INLINE || '').trim()
const SLOT_BY_PLACEMENT = {
  question_profile: QUESTION_PROFILE_SLOT || QUESTION_TOP_SLOT,
  question_top: QUESTION_TOP_SLOT || QUESTION_PROFILE_SLOT,
  question_feed_inline: String(import.meta.env.VITE_ADSENSE_SLOT_QUESTION_FEED_INLINE || '').trim(),
  home_feed_inline: String(import.meta.env.VITE_ADSENSE_SLOT_HOME_FEED_INLINE || '').trim(),
  rewards_inline: String(import.meta.env.VITE_ADSENSE_SLOT_REWARDS_INLINE || '').trim(),
}
const DIRECT_LABEL = String(import.meta.env.VITE_DIRECT_AD_LABEL || '추천 광고').trim()
const DIRECT_TITLE = String(import.meta.env.VITE_DIRECT_AD_TITLE || '브랜드 제휴 광고를 연결해 보세요').trim()
const DIRECT_DESC = String(import.meta.env.VITE_DIRECT_AD_DESC || '단가가 높은 업종 스폰서를 직접 유치하면 일반 네트워크 광고보다 수익성이 좋아질 수 있습니다.').trim()
const DIRECT_CTA = String(import.meta.env.VITE_DIRECT_AD_CTA || '광고 문의').trim()
const DIRECT_LINK = String(import.meta.env.VITE_DIRECT_AD_LINK || '').trim()
const DIRECT_IMAGE = String(import.meta.env.VITE_DIRECT_AD_IMAGE || '').trim()
const HIDE_FOR_ADMIN = String(import.meta.env.VITE_ADS_HIDE_FOR_ADMIN || 'true').trim().toLowerCase() !== 'false'
const HIDDEN_GRADES = new Set(
  String(import.meta.env.VITE_ADS_HIDDEN_GRADES || '1')
    .split(',')
    .map(item => Number(String(item || '').trim()))
    .filter(item => Number.isFinite(item) && item > 0)
)

let adsenseScriptPromise = null

function isValidAdSenseClient(value) {
  const client = String(value || '').trim()
  return /^ca-pub-\d{10,20}$/.test(client)
}

function isValidAdSenseSlot(value) {
  const slot = String(value || '').trim()
  return /^\d{6,20}$/.test(slot)
}

function ensureAdSenseScript(client) {
  if (typeof window === 'undefined' || !client) return Promise.resolve(false)
  if (window.adsbygoogle) return Promise.resolve(true)
  if (adsenseScriptPromise) return adsenseScriptPromise
  adsenseScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-adsense-client="${client}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', () => reject(new Error('adsense-script-load-failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.adsenseClient = client
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`
    script.onload = () => resolve(true)
    script.onerror = () => reject(new Error('adsense-script-load-failed'))
    document.head.appendChild(script)
  })
  return adsenseScriptPromise
}

function shouldHideAdsForUser(user) {
  if (!user) return false
  const role = String(user?.role || '').trim().toLowerCase()
  const grade = Number(user?.grade || 0)
  if (HIDE_FOR_ADMIN && role === 'admin') return true
  if (Number.isFinite(grade) && HIDDEN_GRADES.has(grade)) return true
  return false
}

async function sendAdEvent(payload) {
  try {
    await api('/api/ads/events', { method: 'POST', body: JSON.stringify(payload) })
  } catch {
    // ignore ad analytics errors
  }
}

export default function MonetizationAdBanner({ placement = 'question_profile', className = '', mode, compact = false, user = null, pageKey = '', eventKeySuffix = '' }) {
  const adRef = useRef(null)
  const wrapRef = useRef(null)
  const hasLoggedImpressionRef = useRef(false)
  const slot = SLOT_BY_PLACEMENT[placement] || SLOT_BY_PLACEMENT.question_profile
  const effectiveMode = String(mode || DEFAULT_MODE || 'adsense').trim().toLowerCase()
  const isManualInfeedPlacement = placement === 'home_feed_inline'
  const canRenderAdSense = effectiveMode === 'adsense' && isValidAdSenseClient(ADSENSE_CLIENT) && isValidAdSenseSlot(slot)
  const shouldHide = shouldHideAdsForUser(user)
  const directHref = DIRECT_LINK || 'mailto:ads@historyprofile.com?subject=%ED%94%84%EB%A1%9C%ED%95%84%20%EA%B4%91%EA%B3%A0%20%EB%AC%B8%EC%9D%98'
  const displayMode = useMemo(() => {
    if (canRenderAdSense) return 'adsense'
    if (effectiveMode === 'direct') return 'direct'
    return 'recommendation'
  }, [canRenderAdSense, effectiveMode])
  const baseEventKey = useMemo(() => `${placement}:${slot || 'noslot'}:${eventKeySuffix || 'default'}`, [placement, slot, eventKeySuffix])

  useEffect(() => {
    if (shouldHide || !canRenderAdSense || !adRef.current) return
    let mounted = true
    ensureAdSenseScript(ADSENSE_CLIENT).then(() => {
      if (!mounted || !adRef.current || adRef.current.dataset.adStatus) return
      try {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
      } catch {}
    }).catch(() => {})
    return () => { mounted = false }
  }, [canRenderAdSense, placement, slot, shouldHide])

  useEffect(() => {
    if (shouldHide || !wrapRef.current || hasLoggedImpressionRef.current) return undefined
    const target = wrapRef.current
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0]
      if (!entry?.isIntersecting || hasLoggedImpressionRef.current) return
      hasLoggedImpressionRef.current = true
      sendAdEvent({
        placement,
        event_type: 'impression',
        ad_kind: displayMode === 'adsense' ? 'adsense' : displayMode === 'direct' ? 'direct' : 'recommendation',
        ad_unit_key: slot || placement,
        page_key: pageKey || (typeof window !== 'undefined' ? window.location.pathname : ''),
        event_key: `${baseEventKey}:impression`,
      })
      observer.disconnect()
    }, { threshold: 0.35 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [baseEventKey, displayMode, pageKey, placement, shouldHide, slot])

  function handleClick() {
    if (shouldHide) return
    sendAdEvent({
      placement,
      event_type: 'click',
      ad_kind: displayMode === 'adsense' ? 'adsense' : displayMode === 'direct' ? 'direct' : 'recommendation',
      ad_unit_key: slot || placement,
      page_key: pageKey || (typeof window !== 'undefined' ? window.location.pathname : ''),
      event_key: `${baseEventKey}:click:${Date.now()}`,
    })
  }

  if (shouldHide) return null

  const wrapClass = `asked-ad-banner ${compact ? 'asked-ad-banner-compact' : ''} ${className}`.trim()

  if (displayMode === 'adsense') {
    return (
      <div ref={wrapRef} className={wrapClass} onClickCapture={handleClick}>
        <div className="asked-ad-banner-head">
          <div className="asked-ad-label">AD</div>
          <div className="asked-ad-copy">Google AdSense 반응형 광고</div>
        </div>
        <ins
          key={`${placement}-${slot}-${isManualInfeedPlacement ? HOME_FEED_LAYOUT_KEY || 'manual-infeed' : 'auto'}`}
          ref={adRef}
          className="adsbygoogle asked-adsense-slot"
          style={{ display: 'block' }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format={isManualInfeedPlacement ? 'fluid' : 'auto'}
          data-ad-layout-key={isManualInfeedPlacement && HOME_FEED_LAYOUT_KEY ? HOME_FEED_LAYOUT_KEY : undefined}
          data-full-width-responsive={isManualInfeedPlacement ? undefined : 'true'}
        />
      </div>
    )
  }

  if (displayMode === 'direct') {
    return (
      <a ref={wrapRef} className={`${wrapClass} asked-direct-ad`.trim()} href={directHref} target="_blank" rel="noreferrer" onClick={handleClick}>
        <div className="asked-ad-banner-head">
          <div className="asked-ad-label">{DIRECT_LABEL}</div>
          <div className="asked-ad-copy">직접 판매형 스폰서 광고</div>
        </div>
        <div className="asked-direct-ad-body">
          <div className="asked-direct-ad-copy">
            <strong>{DIRECT_TITLE}</strong>
            <span>{DIRECT_DESC}</span>
          </div>
          {DIRECT_IMAGE ? <img src={DIRECT_IMAGE} alt={DIRECT_TITLE} /> : <span className="asked-direct-ad-cta">{DIRECT_CTA}</span>}
        </div>
      </a>
    )
  }

  return (
    <div ref={wrapRef} className={`${wrapClass} asked-ad-banner-recommendation`.trim()} onClickCapture={handleClick}>
      <div className="asked-ad-banner-head">
        <div className="asked-ad-label">AD</div>
        <div className="asked-ad-copy">추천 수익화 방식</div>
      </div>
      <div className="asked-ad-recommendation">
        <strong>기본값: Google AdSense 반응형 디스플레이 광고</strong>
        <span>질문 화면 상단, 홈 피드 중간, 리워드센터 안내 영역처럼 콘텐츠 흐름을 해치지 않는 위치에 자동 대응형 광고를 노출합니다.</span>
        <span>추후 영상 광고를 붙일 때도 동일한 지면 전략을 유지할 수 있습니다.</span>
      </div>
    </div>
  )
}
