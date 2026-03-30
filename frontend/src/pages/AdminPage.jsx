import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Metric } from '../components/ui'

export default function AdminPage() {
  const [overview, setOverview] = useState(null)
  const [reports, setReports] = useState([])
  const [uploads, setUploads] = useState([])
  const [users, setUsers] = useState([])
  const [queue, setQueue] = useState({ reports: [], uploads: [], notes: [] })
  const [history, setHistory] = useState([])
  const [selectedReports, setSelectedReports] = useState([])
  const [selectedUploads, setSelectedUploads] = useState([])
  const [integrationStatus, setIntegrationStatus] = useState(null)
  const [costGuide, setCostGuide] = useState(null)
  const [smsTestPhone, setSmsTestPhone] = useState('')
  const [integrationMessage, setIntegrationMessage] = useState('')

  async function load() {
    const [o, r, u, us, q, h, integ] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/reports'),
      api('/api/admin/uploads'),
      api('/api/admin/users'),
      api('/api/admin/moderation/queue'),
      api('/api/admin/moderation/history'),
      api('/api/admin/integrations/status'),
      api('/api/admin/cost-protection/guide'),
    ])
    setOverview(o)
    setReports(r.items || [])
    setUploads(u.items || [])
    setUsers(us.items || [])
    setQueue(q)
    setHistory(h.items || [])
    setIntegrationStatus(integ)
    setCostGuide(guide)
  }

  useEffect(() => { load() }, [])

  function toggleSelection(setter, id) {
    setter(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
  }

  async function resolveReport(item, status) {
    await api(`/api/admin/reports/${item.id}/resolve`, { method: 'POST', body: JSON.stringify({ status, resolution_note: `${status} 처리` }) })
    await load()
  }

  async function reviewUpload(item, moderation_status) {
    await api(`/api/admin/uploads/${item.id}/review`, { method: 'POST', body: JSON.stringify({ moderation_status, moderation_note: moderation_status === 'approved' ? '관리자 승인' : '관리자 반려' }) })
    await load()
  }

  async function bulkResolve(status) {
    if (!selectedReports.length) return window.alert('선택된 신고가 없습니다.')
    await api('/api/admin/reports/bulk-resolve', { method: 'POST', body: JSON.stringify({ report_ids: selectedReports, status, resolution_note: `${status} 일괄 처리` }) })
    setSelectedReports([])
    await load()
  }

  async function bulkReview(moderation_status) {
    if (!selectedUploads.length) return window.alert('선택된 업로드가 없습니다.')
    await api('/api/admin/uploads/bulk-review', { method: 'POST', body: JSON.stringify({ upload_ids: selectedUploads, moderation_status, moderation_note: `${moderation_status} 일괄 처리` }) })
    setSelectedUploads([])
    await load()
  }

  async function updateUser(item, patch = {}) {
    const raw = window.prompt('추가 프로필 슬롯 수를 입력하세요', String(item.extra_profile_slots || 0))
    if (raw == null && !Object.keys(patch).length) return
    const slots = raw == null ? Number(item.extra_profile_slots || 0) : Number(raw)
    if (Number.isNaN(slots)) return
    await api(`/api/admin/users/${item.id}`, { method: 'PATCH', body: JSON.stringify({ extra_profile_slots: slots, ...patch }) })
    await load()
  }

  async function sendTwilioTest() {
    setIntegrationMessage('')
    const data = await api('/api/admin/integrations/twilio/send-test', { method: 'POST', body: JSON.stringify({ phone: smsTestPhone }) })
    setIntegrationMessage(data.debug_code ? `데모 코드: ${data.debug_code}` : `${data.provider} / ${data.status}`)
  }

  const pendingCounts = useMemo(() => ({
    reports: reports.filter(item => item.status === 'pending').length,
    uploads: uploads.filter(item => item.moderation_status === 'pending').length,
  }), [reports, uploads])

  return (
    <div className="stack page-stack">
      {overview ? (
        <section className="grid-4">
          <Metric label="대기 신고" value={overview.pending_reports} />
          <Metric label="대기 업로드 검수" value={overview.pending_uploads} />
          <Metric label="차단 수" value={overview.blocked_count} />
          <Metric label="프로필 수" value={overview.profile_count} />
          <Metric label="자동 숨김 질문" value={overview.auto_hidden_questions || 0} />
          <Metric label="자동 비공개 프로필" value={overview.auto_private_profiles || 0} />
          <Metric label="경고 사용자" value={overview.warned_users || 0} />
          <Metric label="정지 사용자" value={overview.suspended_users || 0} />
        </section>
      ) : null}

      {integrationStatus ? (
        <section className="card stack">
          <h3>운영 연동 상태</h3>
          <div className="grid-2">
            <div className="bordered-box stack">
              <strong>Turnstile</strong>
              <div className="muted small-text">활성화: {integrationStatus.turnstile?.enabled ? '예' : '아니오'}</div>
              <div className="muted small-text">Site key: {integrationStatus.turnstile?.site_key_configured ? '설정됨' : '미설정'}</div>
              <div className="muted small-text">Secret: {integrationStatus.turnstile?.secret_configured ? '설정됨' : '미설정'}</div>
              <div className="muted small-text pre-wrap">허용 호스트: {(integrationStatus.turnstile?.allowed_hostnames || []).join(', ') || '-'}</div>
            </div>
            <div className="bordered-box stack">
              <strong>Twilio Verify</strong>
              <div className="muted small-text">활성화: {integrationStatus.twilio_verify?.enabled ? '예' : '아니오'}</div>
              <div className="muted small-text">Account SID: {integrationStatus.twilio_verify?.account_sid_configured ? '설정됨' : '미설정'}</div>
              <div className="muted small-text">Auth Token: {integrationStatus.twilio_verify?.auth_token_configured ? '설정됨' : '미설정'}</div>
              <div className="muted small-text">Verify Service SID: {integrationStatus.twilio_verify?.service_sid_configured ? '설정됨' : '미설정'}</div>
              <div className="inline-form">
                <input value={smsTestPhone} onChange={e => setSmsTestPhone(e.target.value)} placeholder="테스트 휴대폰 번호" />
                <button type="button" className="ghost" onClick={sendTwilioTest}>SMS 테스트</button>
              </div>
              {integrationMessage ? <div className="muted small-text">{integrationMessage}</div> : null}
            </div>
          </div>
        </section>
      ) : null}

      {costGuide ? (
        <section className="card stack">
          <h3>서버 비용 보호 가이드</h3>
          <div className="bordered-box stack">
            <strong>{costGuide.summary?.headline}</strong>
            <div className="grid-4">
              <Metric label="전체 IP 제한" value={`${costGuide.summary?.global_per_ip?.max_requests || 0}/${costGuide.summary?.global_per_ip?.window_seconds || 0}s`} />
              <Metric label="인증 제한" value={`${costGuide.summary?.auth_per_ip?.max_requests || 0}/${costGuide.summary?.auth_per_ip?.window_seconds || 0}s`} />
              <Metric label="공개페이지 제한" value={`${costGuide.summary?.public_page_per_ip?.max_requests || 0}/${costGuide.summary?.public_page_per_ip?.window_seconds || 0}s`} />
              <Metric label="공개API 제한" value={`${costGuide.summary?.api_read_per_ip?.max_requests || 0}/${costGuide.summary?.api_read_per_ip?.window_seconds || 0}s`} />
            </div>
            <div className="muted small-text pre-wrap">차단 User-Agent: {(costGuide.summary?.blocked_user_agents || []).join(', ')}</div>
          </div>
          <div className="grid-2">
            {(costGuide.examples || []).map(item => (
              <div key={item.title} className="bordered-box stack">
                <strong>{item.title}</strong>
                <div className="muted small-text">문제: {item.problem}</div>
                <div className="muted small-text">대응: {item.solution}</div>
                <div className="muted small-text">예시: {item.example}</div>
              </div>
            ))}
          </div>
          <div className="bordered-box stack">
            <strong>추가 권장 방안</strong>
            <div className="list compact-list">
              {(costGuide.recommended_actions || []).map((item, index) => (
                <div key={`${index}-${item}`}>{index + 1}. {item}</div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="card stack">
        <div className="split-row">
          <h3>신고 관리</h3>
          <div className="action-wrap">
            <span className="muted small-text">선택 {selectedReports.length} / 대기 {pendingCounts.reports}</span>
            <button type="button" className="ghost" onClick={() => bulkResolve('resolved')}>선택 해결</button>
            <button type="button" className="ghost" onClick={() => bulkResolve('dismissed')}>선택 기각</button>
          </div>
        </div>
        <div className="list compact-list">
          {reports.map(item => (
            <div key={item.id} className="bordered-box split-row">
              <div className="inline-check">
                <input type="checkbox" checked={selectedReports.includes(item.id)} onChange={() => toggleSelection(setSelectedReports, item.id)} />
                <div>
                  <strong>{item.target_type} #{item.target_id}</strong>
                  <div className="muted small-text">{item.reason}</div>
                  <div className="muted small-text">상태: {item.status}</div>
                </div>
              </div>
              <div className="action-wrap">
                <button type="button" className="ghost" onClick={() => resolveReport(item, 'resolved')}>해결</button>
                <button type="button" className="ghost" onClick={() => resolveReport(item, 'dismissed')}>기각</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <div className="split-row">
          <h3>업로드 검수</h3>
          <div className="action-wrap">
            <span className="muted small-text">선택 {selectedUploads.length} / 대기 {pendingCounts.uploads}</span>
            <button type="button" className="ghost" onClick={() => bulkReview('approved')}>선택 승인</button>
            <button type="button" className="ghost" onClick={() => bulkReview('rejected')}>선택 반려</button>
          </div>
        </div>
        <div className="list compact-list">
          {uploads.map(item => (
            <div key={item.id} className="bordered-box split-row">
              <div className="inline-check">
                <input type="checkbox" checked={selectedUploads.includes(item.id)} onChange={() => toggleSelection(setSelectedUploads, item.id)} />
                <div>
                  <strong>{item.media_kind} · {item.name}</strong>
                  <div className="muted small-text">{item.url}</div>
                  <div className="muted small-text">상태: {item.moderation_status} · {item.size_mb}MB · 신고 {item.report_count || 0}회</div>
                  {item.preview_url ? <div className="muted small-text">미리보기 생성 완료</div> : null}
                </div>
              </div>
              <div className="action-wrap">
                <button type="button" className="ghost" onClick={() => reviewUpload(item, 'approved')}>승인</button>
                <button type="button" className="ghost" onClick={() => reviewUpload(item, 'rejected')}>반려</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h3>검수 큐 / 히스토리</h3>
        <div className="grid-2">
          <div className="bordered-box stack">
            <strong>실시간 큐</strong>
            <div className="muted small-text">대기 신고 {queue.reports?.length || 0}건 · 대기 업로드 {queue.uploads?.length || 0}건</div>
            <div className="list compact-list">
              {(queue.notes || []).slice(0, 8).map(item => <div key={`q-${item.id}`}>{item.target_type} #{item.target_id} · {item.note}</div>)}
            </div>
          </div>
          <div className="bordered-box stack">
            <strong>검수 메모 히스토리</strong>
            <div className="list compact-list">
              {history.slice(0, 10).map(item => <div key={`h-${item.id}`}>{item.target_type} #{item.target_id} · {item.note}</div>)}
            </div>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h3>유저 / 추가 프로필 슬롯 관리</h3>
        <div className="list compact-list">
          {users.map(item => (
            <div key={item.id} className="bordered-box split-row">
              <div>
                <strong>{item.nickname}</strong>
                <div className="muted small-text">{item.email} · {item.phone || '연락처 미등록'}</div>
                <div className="muted small-text">상태: {item.account_status || 'active'} · 경고 {item.warning_count || 0}회 · 전화인증 {item.phone_verified_at ? '완료' : '미완료'}</div>
                <div className="muted small-text">추가 프로필 슬롯: {item.extra_profile_slots || 0} · 채팅미디어 {Math.round((item.chat_media_quota_bytes || 0) / 1024 / 1024)}MB/월</div>
              </div>
              <div className="action-wrap">
                <button type="button" className="ghost" onClick={() => updateUser(item)}>슬롯 수정</button>
                <button type="button" className="ghost" onClick={() => updateUser(item, { account_status: 'warned' })}>경고</button>
                <button type="button" className="ghost" onClick={() => updateUser(item, { account_status: 'suspended', suspended_reason: '관리자 수동 정지' })}>정지</button>
                <button type="button" className="ghost" onClick={() => updateUser(item, { account_status: 'active', suspended_reason: '' })}>해제</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
