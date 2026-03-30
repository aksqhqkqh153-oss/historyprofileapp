import React, { useEffect, useRef } from 'react'

export default function TurnstileWidget({ enabled, siteKey, onToken, refreshKey = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!enabled || !siteKey || !ref.current || !window.turnstile) return
    ref.current.innerHTML = ''
    const widgetId = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      callback: token => onToken?.(token),
      'expired-callback': () => onToken?.(''),
      'error-callback': () => onToken?.(''),
      theme: 'light',
    })
    return () => { try { window.turnstile.remove(widgetId) } catch {} }
  }, [enabled, siteKey, refreshKey, onToken])
  if (!enabled || !siteKey) return null
  return <div className="turnstile-box"><div ref={ref} /></div>
}
