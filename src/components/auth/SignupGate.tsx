'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, type VerificationData } from '@/hooks/useSession'

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

type Step = 'choose' | 'create' | 'join' | 'show-code' | 'verify-wait'

export default function SignupGate() {
  const router = useRouter()
  const { createGroup, joinGroup, claimSession } = useSession()
  const [step, setStep] = useState<Step>('choose')
  const [groupName, setGroupName] = useState('')
  const [currency, setCurrency] = useState('€')
  const [memberName, setMemberName] = useState('')
  const [groupCode, setGroupCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [verification, setVerification] = useState<VerificationData | null>(null)

  async function handleCreate() {
    if (!groupName.trim() || !memberName.trim()) return
    setSubmitting(true)
    setError('')
    const session = await createGroup(groupName.trim(), currency, memberName.trim())
    if (session) {
      setGroupCode(session.groupCode)
      setStep('show-code')
    } else {
      setError('Failed to create group')
    }
    setSubmitting(false)
  }

  async function handleJoin() {
    if (!joinCode.trim() || !memberName.trim()) return
    setSubmitting(true)
    setError('')
    const result = await joinGroup(joinCode.trim().toLowerCase(), memberName.trim())
    if (result.ok) {
      router.push('/expenses')
    } else if (result.verification) {
      setVerification(result.verification)
      setStep('verify-wait')
      // Start polling — auto-redirect on approval
      claimSession(result.verification).then(() => {
        router.push('/expenses')
      })
    } else {
      setError(result.error || 'Failed to join')
    }
    setSubmitting(false)
  }

  return (
    <div className="phone-frame flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-xs">
        <h1 className="text-3xl font-bold text-center mb-2">IOU</h1>
        <p className="text-ink-muted text-center text-sm mb-8">Split expenses with friends</p>

        {step === 'choose' && (
          <div className="space-y-3">
            <button onClick={() => setStep('create')} className="btn btn-primary">
              Create a group
            </button>
            <button onClick={() => setStep('join')} className="btn btn-outline">
              Join a group
            </button>
          </div>
        )}

        {step === 'create' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Create a group</h2>
            <input
              className="input"
              placeholder="Group name (e.g. Sardinia 2026)"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
            <select
              className="input"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
            >
              {CURRENCIES.map(c => (
                <option key={c.symbol} value={c.symbol}>{c.label}</option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Your name"
              value={memberName}
              onChange={e => setMemberName(e.target.value)}
            />
            {error && <p className="text-red text-sm">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={submitting || !groupName.trim() || !memberName.trim()}
              className="btn btn-primary"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setStep('choose'); setError('') }} className="btn btn-outline">
              Back
            </button>
          </div>
        )}

        {step === 'show-code' && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">Group created!</h2>
            <p className="text-sm text-ink-soft">Share this code with your friends:</p>
            <div className="bg-surface border border-border rounded-xl p-4">
              <p className="text-2xl font-mono font-bold tracking-wide text-accent">{groupCode}</p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(groupCode)
              }}
              className="btn btn-outline btn-sm mx-auto"
            >
              Copy code
            </button>
            <button
              onClick={() => router.push('/expenses')}
              className="btn btn-primary"
            >
              Go to expenses
            </button>
          </div>
        )}

        {step === 'join' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Join a group</h2>
            <input
              className="input"
              placeholder="Group code (e.g. sunny-dolphin-42)"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
            />
            <input
              className="input"
              placeholder="Your name"
              value={memberName}
              onChange={e => setMemberName(e.target.value)}
            />
            {error && <p className="text-red text-sm">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={submitting || !joinCode.trim() || !memberName.trim()}
              className="btn btn-primary"
            >
              {submitting ? 'Joining...' : 'Join'}
            </button>
            <button onClick={() => { setStep('choose'); setError('') }} className="btn btn-outline">
              Back
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
              onClick={() => { setStep('join'); setVerification(null); setError('') }}
              className="btn btn-outline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
