import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const [members, splits, payers] = await Promise.all([
    sql`SELECT id, name, is_admin, is_left, group_id, starting_balance FROM members WHERE group_id = ${groupId}`,
    sql`SELECT es.member_id, es.amount FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = ${groupId}`,
    sql`SELECT ep.member_id, ep.amount FROM expense_payers ep
        JOIN expenses e ON e.id = ep.expense_id
        WHERE e.group_id = ${groupId}`,
  ])

  if (!members) {
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }

  const paidByMember: Record<string, number> = {}
  const owedByMember: Record<string, number> = {}

  for (const p of payers) {
    paidByMember[p.member_id] = (paidByMember[p.member_id] || 0) + Number(p.amount)
  }
  for (const s of splits) {
    owedByMember[s.member_id] = (owedByMember[s.member_id] || 0) + Number(s.amount)
  }

  const balances = (members as { id: string; name: string; is_admin: boolean; is_left: boolean; group_id: string; starting_balance: string | number }[]).map(m => {
    const startBal = Number(m.starting_balance || 0)
    const paid = paidByMember[m.id] || 0
    const owed = owedByMember[m.id] || 0
    return {
      id: m.id,
      name: m.name,
      is_admin: m.is_admin,
      is_left: m.is_left,
      group_id: m.group_id,
      starting_balance: startBal,
      total_paid: paid,
      total_owed: owed,
      balance: startBal + paid + owed,
    }
  })

  balances.sort((a, b) => a.balance - b.balance)

  return NextResponse.json(balances, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
