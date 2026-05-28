'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import SignupGate from './SignupGate'

type Mode = 'hub' | 'join' | 'create'

export default function GroupHub() {
  const router = useRouter()
  const { sessions, switchGroup, logout } = useSession()
  const [mode, setMode] = useState<Mode>('hub')

  function handleEnter(groupId: string) {
    switchGroup(groupId)
    router.push('/expenses')
  }

  function handleLeave(groupId: string) {
    if (!confirm('Leave this group? You can rejoin later with the group code.')) return
    logout(groupId)
    // If no sessions remain, re-render will show SignupGate via parent
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
          {sessions.map(s => (
            <div key={s.groupId} className="relative">
              <button
                onClick={() => handleEnter(s.groupId)}
                className="w-full text-left border-2 border-green-500 rounded-xl px-4 py-3 hover:bg-green-50 transition-colors"
              >
                <p className="font-semibold text-sm pr-12 truncate">{s.groupName}</p>
                <p className="text-xs text-ink-muted truncate">{s.name}</p>
              </button>
              <button
                onClick={() => handleLeave(s.groupId)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red border border-red rounded px-2 py-0.5 hover:bg-red hover:text-white transition-colors"
              >
                Leave
              </button>
            </div>
          ))}
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
