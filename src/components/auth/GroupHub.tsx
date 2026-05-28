'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import SignupGate from './SignupGate'

type Mode = 'hub' | 'join' | 'create'

export default function GroupHub() {
  const router = useRouter()
  const { sessions, switchGroup, logout } = useSession()
  const [mode, setMode] = useState<Mode>('hub')
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [leavingGroupId, setLeavingGroupId] = useState<string | null>(null)
  const [leaveInput, setLeaveInput] = useState('')

  // Stable string dependency — sessions is a new array ref on every render
  const groupIds = sessions.map(s => s.groupId).join(',')

  useEffect(() => {
    if (!groupIds) return
    const current = sessions
    Promise.all(
      current.map(s =>
        fetch(`/api/balances?groupId=${s.groupId}`)
          .then(r => r.json())
          .then((data: { id: string; balance: number }[]) => {
            const member = data.find(m => m.id === s.memberId)
            return { groupId: s.groupId, balance: member ? Number(member.balance) : 0 }
          })
          .catch(() => ({ groupId: s.groupId, balance: 0 }))
      )
    ).then(results => {
      const map: Record<string, number> = {}
      for (const r of results) map[r.groupId] = r.balance
      setBalances(map)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIds])

  function handleEnter(groupId: string) {
    switchGroup(groupId)
    router.push('/expenses')
  }

  function handleLeaveClick(groupId: string) {
    setLeavingGroupId(groupId)
    setLeaveInput('')
  }

  function handleLeaveCancel() {
    setLeavingGroupId(null)
    setLeaveInput('')
  }

  function handleLeaveConfirm(groupId: string) {
    logout(groupId)
    setLeavingGroupId(null)
    setLeaveInput('')
  }

  if (mode === 'join') return <SignupGate initialStep="join" onBack={() => setMode('hub')} />
  if (mode === 'create') return <SignupGate initialStep="create" onBack={() => setMode('hub')} />

  if (sessions.length === 0) return <SignupGate />

  return (
    <div className="phone-frame flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-xs">
        <h1 className="text-3xl font-bold text-center mb-2">IOU</h1>
        <p className="text-ink-muted text-center text-sm mb-8">Your groups</p>

        <div className="space-y-2 mb-6">
          {sessions.map(s => {
            const bal = balances[s.groupId]
            const balLoaded = bal !== undefined
            const isZero = balLoaded && Math.abs(bal) < 0.01
            const isLeaving = leavingGroupId === s.groupId
            const fmt = (v: number) =>
              new Intl.NumberFormat('en-US', { style: 'currency', currency: s.currency }).format(v)

            return (
              <div key={s.groupId} className="border-2 border-green-500 rounded-xl overflow-hidden">
                {!isLeaving ? (
                  <div className="relative">
                    <button
                      onClick={() => handleEnter(s.groupId)}
                      className="w-full text-left px-4 py-3 hover:bg-green-50 transition-colors"
                    >
                      <p className="font-semibold text-sm pr-12 truncate">{s.groupName}</p>
                      <p className="text-xs text-ink-muted truncate">{s.name}</p>
                      <p className={`text-xs mt-0.5 ${
                        !balLoaded
                          ? 'text-ink-muted'
                          : bal > 0.005
                          ? 'text-green-600'
                          : bal < -0.005
                          ? 'text-red'
                          : 'text-ink-muted'
                      }`}>
                        {!balLoaded ? '—' : `${bal >= 0 ? '+' : ''}${fmt(bal)}`}
                      </p>
                    </button>
                    {isZero && (
                      <button
                        onClick={() => handleLeaveClick(s.groupId)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red border border-red rounded px-2 py-0.5 hover:bg-red hover:text-white transition-colors"
                      >
                        Leave
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <p className="font-semibold text-sm truncate mb-1">{s.groupName}</p>
                    <p className="text-xs text-ink-muted mb-3">
                      Your balance: {fmt(bal ?? 0)}
                    </p>
                    <input
                      type="text"
                      value={leaveInput}
                      onChange={e => setLeaveInput(e.target.value)}
                      placeholder='type "leave" to confirm'
                      className="input w-full mb-2 text-sm"
                      autoFocus
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleLeaveConfirm(s.groupId)}
                        disabled={leaveInput !== 'leave'}
                        className="btn bg-red text-white text-sm py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Leave group
                      </button>
                      <button
                        onClick={handleLeaveCancel}
                        className="text-xs text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="space-y-3">
          <button onClick={() => setMode('join')} className="btn btn-outline">
            Join another group
          </button>
          <button onClick={() => setMode('create')} className="btn btn-outline">
            Create new group
          </button>
        </div>
      </div>
    </div>
  )
}
