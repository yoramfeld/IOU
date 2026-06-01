'use client'

import Link from 'next/link'
import clsx from 'clsx'
import ApproveBar from './ApproveBar'

interface Props {
  active: 'expenses' | 'board' | 'settle' | 'settings'
  isAdmin?: boolean
  groupId?: string
}

const NAV = [
  { key: 'expenses', href: '/expenses', label: 'Expenses', icon: '💰', hardNav: false },
  { key: 'board',    href: '/board',    label: 'Board',    icon: '📊', hardNav: true },
  // { key: 'settle',   href: '/settle',   label: 'Settle',   icon: '🤝', hardNav: true },
  { key: 'settings', href: '/settings', label: 'Settings', icon: '⚙️', hardNav: false },
]

export default function BottomNav({ active, isAdmin, groupId }: Props) {
  const items = NAV

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm z-20">
      {groupId && <ApproveBar groupId={groupId} />}
      <nav className="bg-white border-t border-border flex items-center pb-safe">
        {items.map((item) => {
          const className = clsx(
            'flex-1 flex flex-col items-center py-3 text-xs font-semibold transition-colors',
            active === item.key ? 'text-accent' : 'text-ink-muted hover:text-ink-soft'
          )
          return item.hardNav ? (
            <a key={item.key} href={item.href} className={className}>
              <span className="text-lg mb-0.5">{item.icon}</span>
              {item.label}
            </a>
          ) : (
            <Link key={item.key} href={item.href} className={className}>
              <span className="text-lg mb-0.5">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
