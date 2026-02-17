'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/session'
import SignupGate from '@/components/auth/SignupGate'

export default function HomePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const session = getSession()
    if (session) {
      router.replace('/expenses')
    } else {
      setReady(true)
    }
  }, [router])

  if (!ready) return null

  return <SignupGate />
}
