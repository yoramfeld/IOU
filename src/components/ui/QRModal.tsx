'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'react-qr-code'

interface Props {
  groupId: string
  memberId: string
  onClose: () => void
}

type State = 'loading' | 'ready' | 'expired' | 'error'

export default function QRModal({ groupId, memberId, onClose }: Props) {
  const [state, setState] = useState<State>('loading')
  const [qrUrl, setQrUrl] = useState('')
  const [timeLeft, setTimeLeft] = useState(120)
  const expiresAtRef = useRef<number>(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const generateToken = useCallback(async () => {
    setState('loading')
    if (intervalRef.current) clearInterval(intervalRef.current)
    try {
      const res = await fetch('/api/auth/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, memberId }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setQrUrl(data.qrUrl)
      expiresAtRef.current = data.expiresAt
      setTimeLeft(120)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [groupId, memberId])

  useEffect(() => {
    generateToken()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [generateToken])

  useEffect(() => {
    if (state !== 'ready') return
    intervalRef.current = setInterval(() => {
      const remaining = Math.round((expiresAtRef.current - Date.now()) / 1000)
      if (remaining <= 0) {
        setState('expired')
        if (intervalRef.current) clearInterval(intervalRef.current)
      } else {
        setTimeLeft(remaining)
      }
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Scan to join</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        {state === 'loading' && (
          <div className="flex items-center justify-center py-16">
            <span className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {state === 'ready' && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="bg-white rounded-2xl p-4 border border-border">
                <QRCode value={qrUrl} size={200} />
              </div>
            </div>
            <div className="w-full bg-surface rounded-full h-1.5">
              <div
                className="bg-accent h-1.5 rounded-full transition-all duration-1000"
                style={{ width: `${(timeLeft / 120) * 100}%` }}
              />
            </div>
            <p className="text-center text-sm text-ink-muted">
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </p>
          </div>
        )}

        {state === 'expired' && (
          <div className="space-y-4 text-center py-8">
            <p className="text-ink-soft">QR code expired</p>
            <button onClick={generateToken} className="btn btn-primary">
              Generate new code
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-4 text-center py-8">
            <p className="text-ink-soft">Failed to generate</p>
            <button onClick={generateToken} className="btn btn-primary">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
