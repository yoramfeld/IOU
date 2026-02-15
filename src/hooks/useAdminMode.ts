'use client'

import { useState, useEffect } from 'react'

const ADMIN_MODE_KEY = 'admin_mode'

export function useAdminMode() {
  const [adminMode, setAdminModeState] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(ADMIN_MODE_KEY)
    if (saved === 'true') {
      setAdminModeState(true)
    }
    setLoaded(true)
  }, [])

  function setAdminMode(value: boolean) {
    setAdminModeState(value)
    localStorage.setItem(ADMIN_MODE_KEY, String(value))
  }

  return { adminMode, setAdminMode, loaded }
}
