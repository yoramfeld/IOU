'use client'

import { useEffect, useState } from 'react'
import type { MemberSession } from '@/types'

interface MemberRow {
  id: string
  name: string
  starting_balance: string | number
}

interface Props {
  session: MemberSession
}

export default function StartingBalances({ session }: Props) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch(`/api/starting-balances?groupId=${session.groupId}`)
      .then(r => r.json())
      .then((rows: MemberRow[]) => {
        setMembers(rows)
        const init: Record<string, string> = {}
        for (const m of rows) {
          const val = Number(m.starting_balance || 0)
          init[m.id] = val === 0 ? '' : String(val)
        }
        setAmounts(init)
        setLoaded(true)
      })
  }, [session.groupId])

  const sum = members.reduce((acc, m) => acc + (parseFloat(amounts[m.id] || '0') || 0), 0)
  const sumOk = Math.abs(sum) < 0.01
  const hasChanges = members.some(m => {
    const current = Number(m.starting_balance || 0)
    const entered = parseFloat(amounts[m.id] || '0') || 0
    return Math.abs(current - entered) > 0.001
  })

  async function handleSave() {
    setSaving(true)
    setMessage(null)

    const balances = members.map(m => ({
      memberId: m.id,
      amount: parseFloat(amounts[m.id] || '0') || 0,
    }))

    const res = await fetch('/api/starting-balances', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        adminId: session.memberId,
        balances,
      }),
    })

    if (res.ok) {
      setMessage({ text: 'Saved!', ok: true })
      // Update local state to reflect saved values
      setMembers(prev => prev.map(m => ({
        ...m,
        starting_balance: parseFloat(amounts[m.id] || '0') || 0,
      })))
    } else {
      const data = await res.json()
      setMessage({ text: data.error || 'Failed to save', ok: false })
    }
    setSaving(false)
  }

  if (!loaded) return null

  return (
    <div className="mt-8 pt-6 border-t border-border space-y-3">
      <h2 className="text-sm font-semibold text-ink-soft">Starting balances</h2>
      <p className="text-xs text-ink-muted">
        Set pre-existing debts from before the app. Positive = is owed, negative = owes. Must sum to zero.
      </p>

      <div className="space-y-2">
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-2">
            <label className="text-sm text-ink-soft w-28 truncate">{m.name}</label>
            <input
              type="number"
              step="0.01"
              className="input flex-1 text-right"
              value={amounts[m.id] ?? ''}
              placeholder="0"
              onChange={e => setAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className={`text-xs font-medium ${sumOk ? 'text-green' : 'text-red'}`}>
        Sum: {sum.toFixed(2)} {sumOk ? '(balanced)' : '(must be zero)'}
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green' : 'text-red'}`}>{message.text}</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !sumOk || !hasChanges}
        className="btn btn-primary"
      >
        {saving ? 'Saving...' : 'Save starting balances'}
      </button>
    </div>
  )
}
