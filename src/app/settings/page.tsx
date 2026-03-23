'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import BottomNav from '@/components/ui/BottomNav'
import GroupSettings from '@/components/settings/GroupSettings'

type TestResult = {
  passed: number
  failed: number
  scenarios: {
    name: string
    description: string
    passed: number
    failed: number
    failedChecks: { label: string; expected: string; actual: string }[]
  }[]
}

export default function SettingsPage() {
  const router = useRouter()
  const { session, loading, logout, updateSession } = useSession()
  const [testState, setTestState] = useState<'idle' | 'running' | 'done'>('idle')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/')
      return
    }
    if (!loading && session && !session.isAdmin) {
      router.replace('/expenses')
    }
  }, [session, loading, router])

  async function handleUpdate(updates: { name?: string; currency?: string }): Promise<{ ok: boolean; error?: string }> {
    if (!session) return { ok: false, error: 'Not logged in' }

    const res = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        adminId: session.memberId,
        ...updates,
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      return { ok: false, error: err.error }
    }

    // Update local session
    const sessionUpdates: Record<string, string> = {}
    if (updates.name) sessionUpdates.groupName = updates.name
    if (updates.currency) sessionUpdates.currency = updates.currency
    if (Object.keys(sessionUpdates).length > 0) {
      updateSession(sessionUpdates)
    }

    return { ok: true }
  }

  if (loading) {
    return <div className="phone-frame flex items-center justify-center min-h-dvh text-ink-muted">Loading...</div>
  }

  async function handleReset() {
    if (!session) return
    if (!confirm('This will permanently delete ALL expenses and settlements. Balances will be reset to zero. Continue?')) return

    const res = await fetch('/api/expenses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: session.groupId,
        adminId: session.memberId,
        resetAll: true,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      alert(data.error || 'Failed to reset')
      return
    }

    alert('All transactions have been reset.')
    window.location.href = '/board'
  }

  async function handleRunTest() {
    if (!session) return
    setTestState('running')
    setTestResult(null)
    try {
      const res = await fetch(`/api/test-balances?adminId=${session.memberId}`)
      const data: TestResult = await res.json()
      setTestResult(data)
      setTestState('done')
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
      dismissTimer.current = setTimeout(() => setTestState('idle'), 8000)
    } catch {
      setTestState('idle')
      alert('Test failed to run')
    }
  }

  async function handleClearPending() {
    if (!session) return
    if (!confirm('Clear all pending join requests? Users waiting for approval will need to try again.')) return

    const res = await fetch('/api/auth/verify', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: session.groupId, adminId: session.memberId }),
    })

    if (!res.ok) {
      const data = await res.json()
      alert(data.error || 'Failed to clear')
      return
    }

    alert('Pending requests cleared.')
  }

  if (!session || !session.isAdmin) return null

  return (
    <div className="phone-frame pb-20">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div>
          <h1 className="font-bold text-lg">Settings</h1>
          <p className="text-xs text-ink-muted">
            {session.name}
          </p>
        </div>
      </header>

      <main className="p-4">
        <GroupSettings session={session} onUpdate={handleUpdate} />

        <div className="mt-8 pt-6 border-t border-border space-y-4">
          <div>
            <p className="text-xs text-ink-muted mb-2">
              Clear stale join requests that are showing the &ldquo;Approve a friend&rdquo; bar.
            </p>
            <button onClick={handleClearPending} className="btn btn-outline">
              Clear pending requests
            </button>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border space-y-3">
          <h2 className="text-sm font-semibold text-ink-soft mb-1">Developer tools</h2>
          <p className="text-xs text-ink-muted">
            Runs a 7-member test scenario, verifies balances and settlements, then cleans up.
          </p>
          <button
            onClick={handleRunTest}
            disabled={testState === 'running'}
            className="btn btn-outline"
          >
            {testState === 'running' ? 'Running test…' : 'Run balance test'}
          </button>
          {testState === 'done' && testResult && (
            <div className={`rounded-lg p-3 text-sm space-y-2 ${testResult.failed === 0 ? 'bg-green/10' : 'bg-red/10'}`}>
              <p className={`font-semibold ${testResult.failed === 0 ? 'text-green' : 'text-red'}`}>
                {testResult.failed === 0
                  ? `✓ All ${testResult.passed} checks passed across ${testResult.scenarios.length} scenarios`
                  : `✗ ${testResult.failed} of ${testResult.passed + testResult.failed} checks failed`}
              </p>
              {testResult.scenarios.map((s, i) => (
                <div key={i} className="text-xs">
                  <span className={s.failed === 0 ? 'text-green' : 'text-red'}>
                    {s.failed === 0 ? '✓' : '✗'} {s.name} ({s.passed}/{s.passed + s.failed})
                  </span>
                  {s.failedChecks.length > 0 && (
                    <ul className="ml-3 mt-0.5 space-y-0.5 text-red">
                      {s.failedChecks.map((c, j) => (
                        <li key={j}>{c.label}: expected {c.expected}, got {c.actual}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-border">
          <h2 className="text-sm font-semibold text-red mb-1">Danger zone</h2>
          <p className="text-xs text-ink-muted mb-3">
            Delete all expenses and settlements. Members will be kept.
          </p>
          <button onClick={handleReset} className="btn bg-red text-white hover:bg-red/90">
            Reset all transactions
          </button>
        </div>
      </main>

      <BottomNav active="settings" isAdmin={session.isAdmin} groupId={session.groupId} />
    </div>
  )
}
