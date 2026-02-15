'use client'

import { useState } from 'react'
import type { MemberSession } from '@/types'

const CURRENCIES = [
  { symbol: '€', label: 'Euro (€)' },
  { symbol: '$', label: 'Dollar ($)' },
  { symbol: '£', label: 'Pound (£)' },
  { symbol: '₪', label: 'Shekel (₪)' },
  { symbol: '¥', label: 'Yen (¥)' },
  { symbol: '₹', label: 'Rupee (₹)' },
  { symbol: 'kr', label: 'Krone (kr)' },
  { symbol: 'R$', label: 'Real (R$)' },
]

interface Props {
  session: MemberSession
  onUpdate: (updates: { name?: string; currency?: string }) => Promise<{ ok: boolean; error?: string }>
}

export default function GroupSettings({ session, onUpdate }: Props) {
  const [groupName, setGroupName] = useState(session.groupName)
  const [currency, setCurrency] = useState(session.currency)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSave() {
    setSaving(true)
    setMessage('')

    const updates: { name?: string; currency?: string } = {}
    if (groupName.trim() !== session.groupName) updates.name = groupName.trim()
    if (currency !== session.currency) updates.currency = currency

    if (Object.keys(updates).length === 0) {
      setMessage('No changes')
      setSaving(false)
      return
    }

    const result = await onUpdate(updates)
    if (result.ok) {
      setMessage('Saved!')
    } else {
      setMessage(result.error || 'Failed to save')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-ink-soft block mb-1">Group name</label>
        <input
          className="input"
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs font-medium text-ink-soft block mb-1">Currency</label>
        <select
          className="input"
          value={currency}
          onChange={e => setCurrency(e.target.value)}
        >
          {CURRENCIES.map(c => (
            <option key={c.symbol} value={c.symbol}>{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-ink-soft block mb-1">Group code</label>
        <div className="bg-surface border border-border rounded-xl p-3">
          <p className="font-mono text-sm font-bold text-accent">{session.groupCode}</p>
        </div>
        <p className="text-xs text-ink-muted mt-1">Share this with friends to join</p>
      </div>

      {message && (
        <p className={`text-sm ${message === 'Saved!' ? 'text-green' : 'text-red'}`}>{message}</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn btn-primary"
      >
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  )
}
