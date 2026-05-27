import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function PATCH(request: Request) {
  const { groupId, adminId, name, currency } = await request.json()

  if (!groupId || !adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify admin belongs to this group
  const adminRows = await sql`
    SELECT is_admin, group_id FROM members WHERE id = ${adminId} LIMIT 1
  `
  const admin = adminRows[0]

  if (!admin?.is_admin || admin.group_id !== groupId) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  // If changing currency, check all balances are zero
  if (currency) {
    const [payers, splits, membersWithStart] = await Promise.all([
      sql`SELECT ep.member_id, ep.amount FROM expense_payers ep JOIN expenses e ON e.id = ep.expense_id WHERE e.group_id = ${groupId}`,
      sql`SELECT es.member_id, es.amount FROM expense_splits es JOIN expenses e ON e.id = es.expense_id WHERE e.group_id = ${groupId}`,
      sql`SELECT id, starting_balance FROM members WHERE group_id = ${groupId}`,
    ])

    const bal: Record<string, number> = {}
    for (const m of membersWithStart) bal[m.id] = Number(m.starting_balance || 0)
    for (const p of payers) bal[p.member_id] = (bal[p.member_id] || 0) + Number(p.amount)
    for (const s of splits) bal[s.member_id] = (bal[s.member_id] || 0) + Number(s.amount)

    const hasNonZero = Object.values(bal).some(b => Math.abs(b) > 0.01)
    if (hasNonZero) {
      return NextResponse.json(
        { error: 'Cannot change currency while there are unsettled balances. Settle up first.' },
        { status: 409 }
      )
    }
  }

  const updates: Record<string, string> = {}
  if (name?.trim()) updates.name = name.trim()
  if (currency) updates.currency = currency

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  if (updates.name && updates.currency) {
    await sql`UPDATE groups SET name = ${updates.name}, currency = ${updates.currency} WHERE id = ${groupId}`
  } else if (updates.name) {
    await sql`UPDATE groups SET name = ${updates.name} WHERE id = ${groupId}`
  } else {
    await sql`UPDATE groups SET currency = ${updates.currency} WHERE id = ${groupId}`
  }

  return NextResponse.json({ ok: true })
}
