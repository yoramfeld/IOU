'use client'

import { useState } from 'react'

interface Props {
  groupId: string
}

export default function ApproveBar({ groupId }: Props) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  async function handleApprove() {
    if (!code.trim()) return
    setSubmitting(true)
    setMessage(null)

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, code: code.trim() }),
      })
      const data = await res.json()

      if (data.approved) {
        setMessage({ text: 'Approved!', ok: true })
        setCode('')
        setTimeout(() => {
          setMessage(null)
          setOpen(false)
        }, 2000)
      } else {
        setMessage({ text: data.error || 'Invalid code', ok: false })
      }
    } catch {
      setMessage({ text: 'Network error', ok: false })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full py-1.5 text-xs font-medium text-accent bg-accent/10 hover:bg-accent/15 transition-colors"
        >
          Approve a friend
        </button>
      ) : (
        <div className="bg-accent/10 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              placeholder="3-digit code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="flex-1 bg-white border border-border rounded-lg px-3 py-1.5 text-sm text-center font-mono tracking-widest"
            />
            <button
              onClick={handleApprove}
              disabled={submitting || code.length !== 3}
              className="px-3 py-1.5 bg-accent text-white text-sm font-semibold rounded-lg disabled:opacity-50"
            >
              {submitting ? '...' : 'Confirm'}
            </button>
            <button
              onClick={() => { setOpen(false); setCode(''); setMessage(null) }}
              className="text-ink-muted text-sm px-1"
            >
              ✕
            </button>
          </div>
          {message && (
            <p className={`text-xs text-center ${message.ok ? 'text-green' : 'text-red'}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
