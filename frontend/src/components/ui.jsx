import React from 'react'

export function TextField({ label, value = '', onChange, type = 'text', children }) {
  return (
    <div className="stack">
      <label>{label}</label>
      {children ? children : <input type={type} value={value} onChange={e => onChange?.(e.target.value)} />}
    </div>
  )
}

export function Metric({ label, value }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>
}
