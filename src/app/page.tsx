'use client'

import { useEffect, useState } from 'react'
import { getSessions } from '@/lib/session'
import SignupGate from '@/components/auth/SignupGate'
import GroupHub from '@/components/auth/GroupHub'

export default function HomePage() {
  const [ready, setReady] = useState(false)
  const [hasGroups, setHasGroups] = useState(false)

  useEffect(() => {
    setHasGroups(getSessions().length > 0)
    setReady(true)
  }, [])

  if (!ready) return null

  if (hasGroups) return <GroupHub />

  return <SignupGate />
}
