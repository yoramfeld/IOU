'use client'

interface Props {
  adminMode: boolean
  setAdminMode: (value: boolean) => void
}

export default function AdminModeToggle({ adminMode, setAdminMode }: Props) {
  return (
    <label className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={adminMode}
        onChange={e => setAdminMode(e.target.checked)}
        className="w-4 h-4"
      />
      <span className="text-sm font-medium text-ink">Admin mode</span>
    </label>
  )
}
