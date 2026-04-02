import React, { useEffect, useMemo, useRef } from 'react'

const ADSENSE_CLIENT = String(import.meta.env.VITE_ADSENSE_CLIENT || '').trim()
const QUESTION_PROFILE_SLOT = String(import.meta.env.VITE_ADSENSE_SLOT_QUESTION_PROFILE || '').trim()
const AD_MODE = String(import.meta.env.VITE_QUESTION_PROFILE_AD_MODE || 'adsense').trim().toLowerCase()
const DIRECT_LABEL = String(import.meta.env.VITE_DIRECT_AD_LABEL || '추천 광고').trim()
const DIRECT_TITLE = String(import.meta.env.VITE_DIRECT_AD_TITLE || '브랜드 제휴 광고를 연결해 보세요').trim()
const DIRECT_DESC = String(import.meta.env.VITE_DIRECT_AD_DESC || '단가가 높은 업종 스폰서를 직접 유치하면 일반 네트워크 광고보다 수익성이 좋아질 수 있습니다.').trim()
const DIRECT_CTA = String(import.meta.env.VITE_DIRECT_AD_CTA || '광고 문의').trim()
const DIRECT_LINK = String(import.meta.env.VITE_DIRECT_AD_LINK || '').trim()
const DIRECT_IMAGE = String(import.meta.env.VITE_DIRECT_AD_IMAGE || '').trim()

let adsenseScriptPromise = null

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

export default function MonetizationAdBanner() {
  const adRef = useRef(null)
  const canRenderAdSense = AD_MODE === 'adsense' && ADSENSE_CLIENT && QUESTION_PROFILE_SLOT
  const directHref = DIRECT_LINK || 'mailto:ads@historyprofile.com?subject=%ED%94%84%EB%A1%9C%ED%95%84%20%EC%A7%88%EB%AC%B8%20%ED%99%94%EB%A9%B4%20%EA%B4%91%EA%B3%A0%20%EB%AC%B8%EC%9D%98'
  const displayMode = useMemo(() => {
    if (canRenderAdSense) return 'adsense'
    if (AD_MODE === 'direct') return 'direct'
    return 'recommendation'
  }, [canRenderAdSense])

  useEffect(() => {
    if (!canRenderAdSense || !adRef.current) return
    let mounted = true
    ensureAdSenseScript(ADSENSE_CLIENT)
      .then(() => {
        if (!mounted || !adRef.current || adRef.current.dataset.adStatus) return
        try {
          ;(window.adsbygoogle = window.adsbygoogle || []).push({})
        } catch {}
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [canRenderAdSense])

  if (displayMode === 'adsense') {
    return (
      <div className="asked-ad-banner asked-ad-banner-live">
        <div className="asked-ad-banner-head">
          <div className="asked-ad-label">AD</div>
          <div className="asked-ad-copy">Google AdSense 반응형 광고</div>
        </div>
        <ins
          ref={adRef}
          className="adsbygoogle asked-adsense-slot"
          style={{ display: 'block' }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={QUESTION_PROFILE_SLOT}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    )
  }

  if (displayMode === 'direct') {
    return (
      <a className="asked-ad-banner asked-direct-ad" href={directHref} target="_blank" rel="noreferrer">
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
    <div className="asked-ad-banner asked-ad-banner-recommendation">
      <div className="asked-ad-banner-head">
        <div className="asked-ad-label">AD</div>
        <div className="asked-ad-copy">추천 수익화 방식</div>
      </div>
      <div className="asked-ad-recommendation">
        <strong>1순위 기본값: Google AdSense 반응형 디스플레이 광고</strong>
        <span>설정이 간단하고 공개 질문 페이지처럼 트래픽이 분산된 화면에 바로 적용하기 좋습니다.</span>
        <span>고정 스폰서를 직접 유치할 수 있으면 `direct` 모드로 바꿔 단가 높은 제휴 광고도 운영할 수 있습니다.</span>
      </div>
    </div>
  )
}
