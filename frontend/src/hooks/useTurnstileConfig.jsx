import { useEffect, useState } from 'react'
import { api } from '../api'

export function useTurnstileConfig() {
  const [config, setConfig] = useState({ turnstile_enabled: false, turnstile_site_key: '', sms_provider: 'demo' })
  useEffect(() => { api('/api/public/config').then(setConfig).catch(() => {}) }, [])
  return config
}
