'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import SignupGate from './SignupGate'

type Mode = 'hub' | 'join' | 'create'
type LeaveStage = 'confirming-leave' | 'left' | 'confirming-quit'

export default function GroupHub() {
  const router = useRouter()
  const { sessions, switchGroup, logout } = useSession()
  const [mode, setMode] = useState<Mode>('hub')
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [leaveStages, setLeaveStages] = useState<Record<string, LeaveStage>>({})
  const [inputValue, setInputValue] = useState('')

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

  function setStage(groupId: string, stage: LeaveStage | null) {
    setLeaveStages(prev => {
      const next = { ...prev }
      if (stage === null) delete next[groupId]; else next[groupId] = stage
      return next
    })
    setInputValue('')
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
            const stage = leaveStages[s.groupId] ?? null
            const currency = s.currency || 'USD'
            const fmt = (v: number) => {
              try {
                return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
              } catch {
                return v.toFixed(2)
              }
            }

            return (
              <div key={s.groupId} className="border-2 border-green-500 rounded-xl overflow-hidden">
                {/* Always-visible enter row */}
                <div className="relative">
                  <button
                    onClick={() => handleEnter(s.groupId)}
                    className="w-full text-left px-4 py-3 hover:bg-green-50 transition-colors"
                  >
                    <p className="font-semibold text-sm pr-24 truncate">{s.groupName}</p>
                    <p className="text-xs text-ink-muted truncate">{s.name}</p>
                    <p className={`text-xs mt-0.5 ${
                      !balLoaded ? 'text-ink-muted'
                      : bal > 0.005 ? 'text-green-600'
                      : bal < -0.005 ? 'text-red'
                      : 'text-ink-muted'
                    }`}>
                      {!balLoaded ? '—' : `${bal >= 0 ? '+' : ''}${fmt(bal)}`}
                    </p>
                  </button>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {stage === null && isZero && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setStage(s.groupId, 'confirming-leave') }}
                        className="text-xs text-red border border-red rounded px-2 py-0.5 hover:bg-red hover:text-white transition-colors"
                      >
                        Leave
                      </button>
                    )}
                    {stage === 'left' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setStage(s.groupId, 'confirming-quit') }}
                        className="text-xs text-red border border-red rounded px-2 py-0.5 hover:bg-red hover:text-white transition-colors"
                      >
                        Quit
                      </button>
                    )}
                  </div>
                </div>

                {/* Confirmation panels */}
                {stage === 'confirming-leave' && (
                  <div className="px-4 pb-3 border-t border-border">
                    <p className="text-xs text-ink-muted mt-2 mb-2">Type <strong>Leave</strong> to confirm</p>
                    <input
                      type="text"
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      className="input w-full mb-2 text-sm"
                      autoFocus
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setStage(s.groupId, 'left')}
                        disabled={inputValue !== 'Leave'}
                        className="btn bg-red text-white text-sm py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Confirm leave
                      </button>
                      <button onClick={() => setStage(s.groupId, null)} className="text-xs text-ink-muted hover:text-ink">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {stage === 'confirming-quit' && (
                  <div className="px-4 pb-3 border-t border-border">
                    <p className="text-xs text-ink-muted mt-2 mb-2">Type <strong>Quit</strong> to remove this group</p>
                    <input
                      type="text"
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      className="input w-full mb-2 text-sm"
                      autoFocus
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { logout(s.groupId); setStage(s.groupId, null) }}
                        disabled={inputValue !== 'Quit'}
                        className="btn bg-red text-white text-sm py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Confirm quit
                      </button>
                      <button onClick={() => setStage(s.groupId, 'left')} className="text-xs text-ink-muted hover:text-ink">
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
