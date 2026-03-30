import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, setSession } from '../api'
import { useTurnstileConfig } from '../hooks/useTurnstileConfig'
import TurnstileWidget from '../components/TurnstileWidget'
import { TextField } from '../components/ui'

export default function AuthPage({ onLogin }) {
  const location = useLocation()
  const navigate = useNavigate()
  const isSignup = location.pathname === '/signup'
  const [form, setForm] = useState({
    login_id: '',
    recovery_email: '',
    password: '',
    nickname: '',
    phone: '',
    phone_verification_token: '',
  })
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneHelp, setPhoneHelp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const turnstile = useTurnstileConfig()
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaVersion, setCaptchaVersion] = useState(0)
  const demoAccounts = useMemo(() => ([
    { key: 'admin', label: '데모 관리자', email: 'demo.admin@historyprofile.com', password: 'demo1234!', roleLabel: '전체 권한' },
    { key: 'user', label: '데모 일반회원', email: 'demo.user@historyprofile.com', password: 'demo1234!', roleLabel: '일반 회원' },
    ...Array.from({ length: 10 }, (_, index) => ({
      key: `test-${index + 1}`,
      label: `데모 테스트${String(index + 1).padStart(2, '0')}`,
      email: `test${String(index + 1).padStart(2, '0')}@historyprofile.com`,
      password: 'demo1234!',
      roleLabel: '일반 회원',
    })),
  ]), [])
  const adminForceAccount = demoAccounts.find(account => account.key === 'admin')
  const userForceAccount = demoAccounts.find(account => account.key === 'user')

  async function requestPhoneCode() {
    if (!form.phone) {
      setError('휴대폰 번호를 먼저 입력해주세요.')
      return
    }
    setError('')
    setForm(prev => ({ ...prev, phone_verification_token: '' }))
    const data = await api('/api/auth/phone/request-code', { method: 'POST', body: JSON.stringify({ phone: form.phone, captcha_token: captchaToken }) })
    setCaptchaVersion(v => v + 1)
    setCaptchaToken('')
    setPhoneCode('')
    setPhoneHelp(data.debug_code ? `인증번호가 발급되었습니다. 개발용 코드: ${data.debug_code}` : `인증번호가 발급되었습니다. SMS 제공자: ${data.provider}`)
  }

  async function verifyPhoneCode() {
    if (!form.phone) {
      setError('휴대폰 번호를 먼저 입력해주세요.')
      return
    }
    if (!phoneCode) {
      setError('인증번호를 입력해주세요.')
      return
    }
    setError('')
    const data = await api('/api/auth/phone/verify-code', { method: 'POST', body: JSON.stringify({ phone: form.phone, code: phoneCode, captcha_token: captchaToken }) })
    setForm(prev => ({ ...prev, phone_verification_token: data.verification_token }))
    setPhoneCode('')
    setPhoneHelp(`${data.phone_masked} 인증 완료`)
  }

  async function handleDemoLogin(account) {
    setForm(prev => ({ ...prev, login_id: account.email, password: account.password }))
    if (turnstile.turnstile_enabled && !captchaToken) {
      setError('캡차가 활성화된 환경입니다. 캡차 완료 후 데모 계정을 다시 클릭해주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: account.email, password: account.password, captcha_token: captchaToken }) })
      setSession(data.token || data.access_token || '', data.user, true)
      onLogin(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const path = isSignup ? '/api/auth/signup' : '/api/auth/login'
      const payload = isSignup
        ? {
            email: form.login_id,
            recovery_email: form.recovery_email,
            password: form.password,
            nickname: form.nickname,
            phone: form.phone,
            phone_verification_token: form.phone_verification_token,
            captcha_token: captchaToken,
          }
        : {
            email: form.login_id,
            password: form.password,
            captcha_token: captchaToken,
          }
      const data = await api(path, { method: 'POST', body: JSON.stringify(payload) })
      setSession(data.token || data.access_token || '', data.user, true)
      onLogin(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell auth-shell-single">
      <div className="auth-card auth-card-compact">
        <form className="auth-form stack" onSubmit={submit}>
          {isSignup ? (
            <div className="auth-back-row">
              <button
                type="button"
                className="ghost icon-only-button"
                onClick={() => { setError(''); navigate('/') }}
                disabled={busy}
                aria-label="로그인 화면으로 돌아가기"
              >
                ←
              </button>
            </div>
          ) : null}

          <div className="stack" style={{ gap: 6 }}>
            <h1 style={{ margin: 0 }}>{isSignup ? '회원가입' : '로그인'}</h1>
            <div className="muted">{isSignup ? '회원정보를 입력한 뒤 계정을 생성해주세요.' : '아이디와 비밀번호를 입력해주세요.'}</div>
          </div>

          <TextField label="아이디" value={form.login_id} onChange={v => setForm({ ...form, login_id: v })} />
          <TextField label={isSignup ? '패스워드' : '비밀번호'} type="password" value={form.password} onChange={v => setForm({ ...form, password: v })} />

          {isSignup ? <TextField label="닉네임" value={form.nickname} onChange={v => setForm({ ...form, nickname: v })} /> : null}
          {isSignup ? <TextField label="비밀번호 복구용 이메일" type="email" value={form.recovery_email} onChange={v => setForm({ ...form, recovery_email: v })} /> : null}
          {isSignup ? (
            <>
              <TextField label="휴대폰 번호" value={form.phone} onChange={v => { setForm({ ...form, phone: v, phone_verification_token: '' }); setPhoneHelp(''); setPhoneCode(''); setError('') }} />
              <div className="inline-form phone-verify-row">
                <input className="phone-code-input" value={phoneCode} onChange={e => setPhoneCode(e.target.value)} placeholder="인증번호 6자리" />
                <button type="button" className="ghost" onClick={requestPhoneCode}>인증요청</button>
                <button type="button" className="ghost" onClick={verifyPhoneCode}>인증하기</button>
              </div>
              {phoneHelp ? <div className="muted small-text">{phoneHelp}</div> : null}
            </>
          ) : null}

          {!isSignup ? (
            <div className="action-wrap" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="ghost small-action-button" onClick={() => { setError(''); navigate('/signup') }} disabled={busy}>회원가입</button>
            </div>
          ) : null}

          <TurnstileWidget enabled={turnstile.turnstile_enabled} siteKey={turnstile.turnstile_site_key} onToken={setCaptchaToken} refreshKey={`${isSignup ? 'signup' : 'login'}-${captchaVersion}`} />
          {error ? <div className="alert error">{error}</div> : null}
          <button disabled={busy || (isSignup && !form.phone_verification_token) || (turnstile.turnstile_enabled && !captchaToken)}>{busy ? '처리 중...' : isSignup ? '계정 생성' : '로그인'}</button>

          {!isSignup ? (
            <>
              <div className="inline-form">
                <button type="button" className="ghost" onClick={() => adminForceAccount && handleDemoLogin(adminForceAccount)} disabled={busy}>관리자강제로그인</button>
                <button type="button" className="ghost" onClick={() => userForceAccount && handleDemoLogin(userForceAccount)} disabled={busy}>고객강제로그인</button>
              </div>
              <div className="demo-login-panel">
                <div className="demo-login-header">
                  <strong>데모용(테스트) 계정</strong>
                  <span className="muted small-text">아래 계정 ID를 누르면 ID/PW가 입력되고 바로 로그인됩니다.</span>
                </div>
                <div className="demo-login-list">
                  {demoAccounts.map(account => (
                    <button
                      key={account.key}
                      type="button"
                      className="demo-login-button"
                      onClick={() => handleDemoLogin(account)}
                      disabled={busy}
                    >
                      <span className="demo-login-title">{account.label}</span>
                      <span className="demo-login-id">ID: {account.email}</span>
                      <span className="demo-login-role">권한: {account.roleLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </form>
      </div>
    </div>
  )
}
