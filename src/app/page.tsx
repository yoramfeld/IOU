'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/session'
import SignupGate from '@/components/auth/SignupGate'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const session = getSession()
    if (session) {
      router.replace('/expenses')
    }
  }, [router])

  return <SignupGate />
}
