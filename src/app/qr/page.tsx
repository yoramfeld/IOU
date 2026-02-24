'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSession, setSession } from '@/lib/session'
import { useSession, type VerificationData } from '@/hooks/useSession'
import type { MemberSession } from '@/types'

type Step = 'loading' | 'enter-name' | 'name-collision' | 'verify-wait' | 'invalid'

function QRContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const { claimSession } = useSession()

  const [step, setStep] = useState<Step>('loading')
  const [groupName, setGroupName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [invalidReason, setInvalidReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [verification, setVerification] = useState<VerificationData | null>(null)

  useEffect(() => {
    if (getSession()) {
      router.replace('/expenses')
      return
    }

    if (!token) {
      setInvalidReason('No QR token provided.')
      setStep('invalid')
      return
    }

    fetch(`/api/auth/qr?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        if (!data.valid) {
          setInvalidReason(
            data.reason === 'expired'
              ? 'This QR code has expired. Ask your friend to generate a new one.'
              : 'This QR code is invalid or not found.'
          )
          setStep('invalid')
        } else {
          setGroupName(data.groupName)
          setStep('enter-name')
        }
      })
      .catch(() => {
        setInvalidReason('Failed to validate QR code. Please try again.')
        setStep('invalid')
      })
  }, [token, router])

  async function handleJoin() {
    if (!memberName.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/auth/qr-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, memberName: memberName.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid QR code')
        setSubmitting(false)
        return
      }

      if (data.directLogin) {
        const s: MemberSession = {
          groupId: data.groupId,
          groupName: data.groupName,
          groupCode: data.groupCode,
          currency: data.currency,
          memberId: data.memberId,
          name: data.memberName,
          isAdmin: data.isAdmin,
        }
        setSession(s)
        router.replace('/expenses')
        return
      }

      if (data.nameCollision) {
        setStep('name-collision')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  async function handleConfirmExisting() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/auth/qr-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, memberName: memberName.trim(), confirmExisting: true }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid QR code')
        setSubmitting(false)
        return
      }

      if (data.needsVerification) {
        const v: VerificationData = {
          pendingId: data.pendingId,
          memberId: data.memberId,
          code: data.code,
          memberName: data.memberName,
          groupId: data.groupId,
          groupName: data.groupName,
          groupCode: data.groupCode,
          currency: data.currency,
        }
        setVerification(v)
        setStep('verify-wait')
        claimSession(v).then(() => {
          router.replace('/expenses')
        })
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  return (
    <div className="phone-frame flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-xs">
        <h1 className="text-3xl font-bold text-center mb-2">IOU</h1>
        <p className="text-ink-muted text-center text-sm mb-8">Split expenses with friends</p>

        {step === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {step === 'enter-name' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Join {groupName}</h2>
            <input
              className="input"
              placeholder="Your name"
              value={memberName}
              onChange={e => setMemberName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              autoFocus
            />
            {error && <p className="text-red text-sm">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={submitting || !memberName.trim()}
              className="btn btn-primary"
            >
              {submitting ? 'Joining...' : `Join ${groupName}`}
            </button>
          </div>
        )}

        {step === 'name-collision' && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">Name already taken</h2>
            <p className="text-sm text-ink-soft">
              There&rsquo;s already a <strong>{memberName}</strong> in <strong>{groupName}</strong>.
              Are you this person rejoining, or a new member?
            </p>
            {error && <p className="text-red text-sm">{error}</p>}
            <button
              onClick={handleConfirmExisting}
              disabled={submitting}
              className="btn btn-primary"
            >
              {submitting ? 'Joining...' : `Yes, I'm ${memberName}`}
            </button>
            <button
              onClick={() => {
                setMemberName('')
                setStep('enter-name')
              }}
              className="btn btn-outline"
            >
              I&rsquo;m a new member
            </button>
          </div>
        )}

        {step === 'verify-wait' && verification && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">Verify your identity</h2>
            <p className="text-sm text-ink-soft">
              Tell a friend in <strong>{verification.groupName}</strong> your code:
            </p>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-5xl font-mono font-bold tracking-widest text-accent">
                {verification.code}
              </p>
            </div>
            <p className="text-xs text-ink-muted">
              They can approve you from the &ldquo;Approve a friend&rdquo; bar in the app.
            </p>
            <div className="flex items-center justify-center gap-2 text-ink-muted text-sm">
              <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              Waiting for approval...
            </div>
            <button
              onClick={() => { setStep('enter-name'); setVerification(null); setError('') }}
              className="btn btn-outline"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'invalid' && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">Invalid QR code</h2>
            <p className="text-sm text-ink-soft">{invalidReason}</p>
            <Link href="/" className="btn btn-outline block">
              Back to IOU
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function QRPage() {
  return (
    <Suspense fallback={
      <div className="phone-frame flex items-center justify-center min-h-dvh">
        <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <QRContent />
    </Suspense>
  )
}
