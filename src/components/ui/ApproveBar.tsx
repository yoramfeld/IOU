'use client'

import { useState, useEffect } from 'react'

interface Props {
  groupId: string
}

export default function ApproveBar({ groupId }: Props) {
  const [hasPending, setHasPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    fetch(`/api/auth/verify?groupId=${groupId}`)
      .then(r => r.json())
      .then(d => setHasPending(d.hasPending))
      .catch(() => {})
  }, [groupId])

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
          setHasPending(false)
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

  if (!hasPending) return null

  return (
    <div className="w-full max-w-sm mx-auto">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full py-2.5 text-sm font-semibold text-white bg-accent hover:bg-accent/90 transition-colors"
        >
          Approve a friend
        </button>
      ) : (
        <div className="bg-accent/15 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              placeholder="3-digit code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="flex-1 bg-white border border-border rounded-lg px-3 py-2 text-base text-center font-mono tracking-widest"
              autoFocus
            />
            <button
              onClick={handleApprove}
              disabled={submitting || code.length !== 3}
              className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg disabled:opacity-50"
            >
              {submitting ? '...' : 'Confirm'}
            </button>
            <button
              onClick={() => { setOpen(false); setCode(''); setMessage(null) }}
              className="text-ink-muted text-lg px-1"
            >
              ✕
            </button>
          </div>
          {message && (
            <p className={`text-sm text-center font-medium ${message.ok ? 'text-green' : 'text-red'}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
