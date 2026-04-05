import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Metric } from '../components/ui'

const MONETIZATION_MODELS = [
  {
    key: 'adsense',
    label: 'Google AdSense 반응형 광고',
    inUse: true,
    revenueType: 'RPM',
    defaultPageViews: 100000,
    defaultRpm: 1.5,
    defaultCost: 0,
    summary: '현재 질문 화면 AD 영역에 연결 가능한 기본 광고 모델입니다.',
    details: '질문 화면 페이지뷰 기준 RPM으로 예상 수익을 계산합니다.',
  },
  {
    key: 'direct',
    label: '직접 판매형 스폰서 광고',
    inUse: true,
    revenueType: 'FIXED_PLUS_RPM',
    defaultPageViews: 100000,
    defaultRpm: 4.5,
    defaultCost: 100000,
    defaultFixedRevenue: 500000,
    summary: '앱 운영자가 직접 광고주를 받아 고정비 또는 보장형 금액을 받는 방식입니다.',
    details: '고정 스폰서비 + 노출 기반 추가 단가를 합산해 계산합니다.',
  },
  {
    key: 'recommendation',
    label: '추천/대체 광고 영역',
    inUse: true,
    revenueType: 'NONE',
    defaultPageViews: 100000,
    defaultRpm: 0,
    defaultCost: 0,
    summary: '광고 코드가 없을 때 추천 배너를 보여주는 안전 모드입니다.',
    details: '직접 수익은 없지만 공백 지면 방지, 제휴 문의 유도 용도로 사용됩니다.',
  },
]

const KRW_PER_USD = 1450

function formatNumber(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toLocaleString('ko-KR') : '0'
}

function formatCurrency(value) {
  const numeric = Math.round(Number(value || 0))
  return `${numeric.toLocaleString('ko-KR')}원`
}

function createCalculatorState(model) {
  return {
    pageViews: model.defaultPageViews || 0,
    rpmUsd: model.defaultRpm || 0,
    adCostKrw: model.defaultCost || 0,
    fixedRevenueKrw: model.defaultFixedRevenue || 0,
    fillRate: model.revenueType === 'NONE' ? 0 : 100,
  }
}

function calculateModel(model, input) {
  const pageViews = Math.max(0, Number(input.pageViews || 0))
  const rpmUsd = Math.max(0, Number(input.rpmUsd || 0))
  const adCostKrw = Math.max(0, Number(input.adCostKrw || 0))
  const fixedRevenueKrw = Math.max(0, Number(input.fixedRevenueKrw || 0))
  const fillRate = Math.min(100, Math.max(0, Number(input.fillRate || 0)))
  const effectivePageViews = Math.round(pageViews * (fillRate / 100))
  const rpmRevenueKrw = (effectivePageViews / 1000) * rpmUsd * KRW_PER_USD

  if (model.revenueType === 'FIXED_PLUS_RPM') {
    const totalRevenue = fixedRevenueKrw + rpmRevenueKrw
    return {
      effectivePageViews,
      revenueKrw: totalRevenue,
      adCostKrw,
      netProfitKrw: totalRevenue - adCostKrw,
    }
  }

  if (model.revenueType === 'RPM') {
    return {
      effectivePageViews,
      revenueKrw: rpmRevenueKrw,
      adCostKrw,
      netProfitKrw: rpmRevenueKrw - adCostKrw,
    }
  }

  return {
    effectivePageViews,
    revenueKrw: fixedRevenueKrw,
    adCostKrw,
    netProfitKrw: fixedRevenueKrw - adCostKrw,
  }
}

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
  const [rewardsOverview, setRewardsOverview] = useState(null)
  const [calculatorInputs, setCalculatorInputs] = useState(() => (
    Object.fromEntries(MONETIZATION_MODELS.map(model => [model.key, createCalculatorState(model)]))
  ))

  async function load() {
    const [o, r, u, us, q, h, integ, guide, rewards] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/reports'),
      api('/api/admin/uploads'),
      api('/api/admin/users'),
      api('/api/admin/moderation/queue'),
      api('/api/admin/moderation/history'),
      api('/api/admin/integrations/status'),
      api('/api/admin/cost-protection/guide'),
      api('/api/admin/rewards/overview'),
    ])
    setOverview(o)
    setReports(r.items || [])
    setUploads(u.items || [])
    setUsers(us.items || [])
    setQueue(q)
    setHistory(h.items || [])
    setIntegrationStatus(integ)
    setCostGuide(guide)
    setRewardsOverview(rewards)
  }

  useEffect(() => { load() }, [])

  function toggleSelection(setter, id) {
    setter(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
  }

  function updateCalculator(modelKey, field, value) {
    const nextValue = value === '' ? '' : Number(value)
    setCalculatorInputs(prev => ({
      ...prev,
      [modelKey]: {
        ...prev[modelKey],
        [field]: Number.isNaN(nextValue) ? 0 : nextValue,
      },
    }))
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

  async function processRewardWithdrawal(item, status) {
    const rejectionReason = status === 'rejected' ? (window.prompt('반려 사유를 입력하세요', '증빙 부족') || '') : ''
    const note = status === 'paid' ? (window.prompt('지급 메모를 입력하세요', '송금 완료') || '') : (status === 'approved' ? '지급 준비 승인' : '')
    await api(`/api/admin/rewards/withdrawals/${item.id}/process`, { method: 'POST', body: JSON.stringify({ status, note, rejection_reason: rejectionReason }) })
    await load()
  }

  async function processBrandVerification(item, status) {
    const note = window.prompt(status === 'approved' ? '승인 메모를 입력하세요' : '반려 사유를 입력하세요', status === 'approved' ? '브랜드/기업 인증 승인' : '증빙 확인 필요') || ''
    await api(`/api/admin/brand-verification/${item.id}/process`, { method: 'POST', body: JSON.stringify({ status, note }) })
    await load()
  }

  async function processDirectAd(item, status) {
    const note = window.prompt(status === 'approved' ? '승인 메모를 입력하세요' : '반려 사유를 입력하세요', status === 'approved' ? '홈 피드 직접 광고 승인' : '광고 문구 또는 URL 수정 필요') || ''
    await api(`/api/admin/direct-ads/${item.id}/process`, { method: 'POST', body: JSON.stringify({ status, note }) })
    await load()
  }

  const pendingCounts = useMemo(() => ({
    reports: reports.filter(item => item.status === 'pending').length,
    uploads: uploads.filter(item => item.moderation_status === 'pending').length,
  }), [reports, uploads])

  const monetizationRows = useMemo(() => MONETIZATION_MODELS.map(model => {
    const input = calculatorInputs[model.key] || createCalculatorState(model)
    return {
      ...model,
      ...calculateModel(model, input),
      input,
    }
  }), [calculatorInputs])

  const monetizationSummary = useMemo(() => monetizationRows.reduce((acc, item) => ({
    pageViews: acc.pageViews + Number(item.input.pageViews || 0),
    revenueKrw: acc.revenueKrw + Number(item.revenueKrw || 0),
    adCostKrw: acc.adCostKrw + Number(item.adCostKrw || 0),
    netProfitKrw: acc.netProfitKrw + Number(item.netProfitKrw || 0),
  }), { pageViews: 0, revenueKrw: 0, adCostKrw: 0, netProfitKrw: 0 }), [monetizationRows])

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

      {rewardsOverview ? (
        <section className="card stack">
          <div className="split-row responsive-row">
            <div>
              <h3>리워드 정산 관리자</h3>
              <div className="muted small-text">회원 활동 기반 포인트 적립과 출금 요청을 검수하고 지급 상태를 관리합니다.</div>
            </div>
            <div className="muted small-text">최소 출금 10,000P · 월 1회</div>
          </div>

          <div className="grid-4">
            <Metric label="대기 출금" value={rewardsOverview.summary?.pending_count || 0} />
            <Metric label="승인 대기" value={rewardsOverview.summary?.approved_count || 0} />
            <Metric label="지급 완료" value={rewardsOverview.summary?.paid_count || 0} />
            <Metric label="지급 예정 포인트" value={`${formatNumber(rewardsOverview.summary?.total_pending_points || 0)}P`} />
            <Metric label="직접 광고 승인대기" value={rewardsOverview.direct_ad_summary?.pending_count || 0} />
            <Metric label="직접 광고 활성" value={rewardsOverview.direct_ad_summary?.active_count || 0} />
          </div>

          <div className="grid-2">
            <div className="stack compact-list">
              <strong>출금 요청 목록</strong>
              {(rewardsOverview.requests || []).map(item => (
                <div key={`reward-request-${item.id}`} className="bordered-box stack">
                  <div className="split-row responsive-row">
                    <strong>{item.nickname || item.email || `회원 #${item.user_id}`}</strong>
                    <strong>{formatNumber(item.points_amount || 0)}P</strong>
                  </div>
                  <div className="muted small-text">{item.email} · {item.bank_name} · {item.account_holder} · {item.account_number_masked}</div>
                  <div className="muted small-text">상태: {item.status} · 신청일: {item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '-'}</div>
                  {item.rejection_reason ? <div className="muted small-text">반려 사유: {item.rejection_reason}</div> : null}
                  <div className="action-wrap wrap-row">
                    <button type="button" className="ghost" onClick={() => processRewardWithdrawal(item, 'approved')} disabled={item.status === 'approved' || item.status === 'paid'}>승인</button>
                    <button type="button" className="ghost" onClick={() => processRewardWithdrawal(item, 'rejected')} disabled={item.status === 'paid'}>반려</button>
                    <button type="button" onClick={() => processRewardWithdrawal(item, 'paid')} disabled={item.status === 'paid'}>지급완료</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="stack compact-list">
              <strong>상위 리워드 회원</strong>
              {(rewardsOverview.top_users || []).map(item => (
                <div key={`top-user-${item.user_id}`} className="bordered-box">
                  <div className="split-row responsive-row"><strong>{item.nickname || item.email}</strong><strong>{formatNumber(item.earned_points || 0)}P</strong></div>
                  <div className="muted small-text">예상 월 리워드 {formatNumber(item.projected_month_points || 0)}P · 예상 광고 노출 지수 {formatNumber(item.estimated_ad_exposure || 0)}회</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid-2">
            <div className="stack compact-list">
              <strong>브랜드/기업 인증 요청</strong>
              {(rewardsOverview.brand_requests || []).length ? rewardsOverview.brand_requests.map(item => (
                <div key={`brand-request-${item.id}`} className="bordered-box stack">
                  <div className="split-row responsive-row"><strong>{item.business_name || item.nickname || item.email}</strong><strong>{item.status}</strong></div>
                  <div className="muted small-text">{item.email} · {item.business_category || '업종 미입력'} · {item.website_url || '웹사이트 없음'}</div>
                  <div className="muted small-text">신청일: {item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '-'}</div>
                  <div className="action-wrap wrap-row">
                    <button type="button" className="ghost" onClick={() => processBrandVerification(item, 'approved')} disabled={item.status === 'approved'}>승인</button>
                    <button type="button" onClick={() => processBrandVerification(item, 'rejected')}>반려</button>
                  </div>
                </div>
              )) : <div className="muted small-text">인증 요청이 없습니다.</div>}
            </div>

            <div className="stack compact-list">
              <strong>상위 노출 키워드 경쟁</strong>
              {(rewardsOverview.top_keywords || []).length ? rewardsOverview.top_keywords.map(item => (
                <div key={`top-keyword-${item.keyword}`} className="bordered-box">
                  <div className="split-row responsive-row"><strong>{item.keyword}</strong><strong>{formatNumber(item.total_points || 0)}P</strong></div>
                  <div className="muted small-text">활성 콘텐츠 {formatNumber(item.item_count || 0)}개</div>
                </div>
              )) : <div className="muted small-text">활성 키워드 경쟁이 없습니다.</div>}
            </div>
          </div>

          <div className="grid-2">
            <div className="stack compact-list">
              <strong>직접 광고 요청</strong>
              {(rewardsOverview.direct_ads || []).length ? rewardsOverview.direct_ads.map(item => (
                <div key={`direct-ad-${item.id}`} className="bordered-box stack">
                  <div className="split-row responsive-row"><strong>{item.title}</strong><strong>{formatNumber(item.bid_points || 0)}P</strong></div>
                  <div className="muted small-text">{item.nickname || item.email} · {item.placement} · 카테고리 {item.category || '전체'}</div>
                  <div className="muted small-text">상태: {item.status} · 노출 {formatNumber(item.impressions || 0)}회 · 클릭 {formatNumber(item.clicks || 0)}회</div>
                  <div className="muted small-text">{item.target_url}</div>
                  <div className="action-wrap wrap-row">
                    <button type="button" className="ghost" onClick={() => processDirectAd(item, 'approved')} disabled={item.status === 'approved'}>승인</button>
                    <button type="button" onClick={() => processDirectAd(item, 'rejected')}>반려</button>
                  </div>
                </div>
              )) : <div className="muted small-text">직접 광고 요청이 없습니다.</div>}
            </div>

            <div className="stack compact-list">
              <strong>직접 광고 운영 메모</strong>
              <div className="bordered-box small-text">홈 피드 스폰서 카드 방식으로만 노출하고, 강제 재생형 광고는 사용하지 않는 운영 정책을 기준으로 구성했습니다.</div>
              <div className="bordered-box small-text">같은 지면/카테고리에서 사용 포인트가 높을수록 우선 노출되며, 관리자 승인 전까지는 보류 상태입니다.</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card stack">
        <div className="split-row responsive-row">
          <div>
            <h3>광고 수익 모델 관리자</h3>
            <div className="muted small-text">현재 앱에 연결된 광고 수익 모델을 한 화면에서 정리하고, 조회수·광고비·예상 순수익을 즉시 계산합니다.</div>
          </div>
          <div className="muted small-text">기준 환율: 1 USD = {formatNumber(KRW_PER_USD)}원</div>
        </div>

        <div className="grid-4">
          <Metric label="총 예상 조회수" value={formatNumber(monetizationSummary.pageViews)} />
          <Metric label="총 예상 매출" value={formatCurrency(monetizationSummary.revenueKrw)} />
          <Metric label="총 광고비/운영비" value={formatCurrency(monetizationSummary.adCostKrw)} />
          <Metric label="총 예상 순수익" value={formatCurrency(monetizationSummary.netProfitKrw)} />
        </div>

        <div className="list compact-list">
          {monetizationRows.map(item => (
            <div key={item.key} className="bordered-box stack">
              <div className="split-row responsive-row">
                <div>
                  <strong>{item.label}</strong>
                  <div className="muted small-text">{item.summary}</div>
                  <div className="muted small-text">{item.details}</div>
                </div>
                <div className="muted small-text">앱 사용 여부: {item.inUse ? '사용 중' : '미사용'}</div>
              </div>

              <div className="grid-4">
                <label className="stack small-text">
                  <span>예상 조회수(PV)</span>
                  <input type="number" min="0" value={item.input.pageViews} onChange={e => updateCalculator(item.key, 'pageViews', e.target.value)} />
                </label>
                <label className="stack small-text">
                  <span>실제 광고 노출률(%)</span>
                  <input type="number" min="0" max="100" value={item.input.fillRate} onChange={e => updateCalculator(item.key, 'fillRate', e.target.value)} />
                </label>
                <label className="stack small-text">
                  <span>{item.revenueType === 'FIXED_PLUS_RPM' || item.revenueType === 'RPM' ? '예상 RPM(USD)' : '고정 수익(원)'}</span>
                  {item.revenueType === 'NONE' ? (
                    <input type="number" min="0" value={item.input.fixedRevenueKrw} onChange={e => updateCalculator(item.key, 'fixedRevenueKrw', e.target.value)} />
                  ) : (
                    <input type="number" min="0" step="0.1" value={item.input.rpmUsd} onChange={e => updateCalculator(item.key, 'rpmUsd', e.target.value)} />
                  )}
                </label>
                <label className="stack small-text">
                  <span>광고비/운영비(원)</span>
                  <input type="number" min="0" value={item.input.adCostKrw} onChange={e => updateCalculator(item.key, 'adCostKrw', e.target.value)} />
                </label>
              </div>

              {item.revenueType === 'FIXED_PLUS_RPM' ? (
                <div className="grid-2">
                  <label className="stack small-text">
                    <span>고정 스폰서 매출(원)</span>
                    <input type="number" min="0" value={item.input.fixedRevenueKrw} onChange={e => updateCalculator(item.key, 'fixedRevenueKrw', e.target.value)} />
                  </label>
                  <div className="muted small-text bordered-box">직접 판매형은 고정 계약비 + 노출형 매출을 함께 더해 순수익을 계산합니다.</div>
                </div>
              ) : null}

              <div className="grid-4">
                <Metric label="실제 계산 노출수" value={formatNumber(item.effectivePageViews)} />
                <Metric label="예상 수익금액" value={formatCurrency(item.revenueKrw)} />
                <Metric label="광고비용" value={formatCurrency(item.adCostKrw)} />
                <Metric label="순수익" value={formatCurrency(item.netProfitKrw)} />
              </div>
            </div>
          ))}
        </div>
      </section>

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
