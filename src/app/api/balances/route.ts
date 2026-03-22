import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const db = neon(process.env.DATABASE_URL!)

  const [members, splits, expensePaidBy] = await Promise.all([
    db`SELECT id, name, is_admin, group_id FROM members WHERE group_id = ${groupId}`,
    db`SELECT es.member_id, es.amount FROM expense_splits es WHERE es.expense_id IN (SELECT id FROM expenses WHERE group_id = ${groupId})`,
    db`SELECT paid_by AS member_id, amount FROM expenses WHERE group_id = ${groupId}`,
  ])

  if (!members) {
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }

  const paidByMember: Record<string, number> = {}
  const owedByMember: Record<string, number> = {}

  for (const p of expensePaidBy) {
    paidByMember[p.member_id] = (paidByMember[p.member_id] || 0) + Number(p.amount)
  }
  for (const s of splits) {
    owedByMember[s.member_id] = (owedByMember[s.member_id] || 0) + Number(s.amount)
  }

  const balances = (members as { id: string; name: string; is_admin: boolean; group_id: string }[]).map(m => ({
    id: m.id,
    name: m.name,
    is_admin: m.is_admin,
    group_id: m.group_id,
    total_paid: paidByMember[m.id] || 0,
    total_owed: owedByMember[m.id] || 0,
    balance: (paidByMember[m.id] || 0) + (owedByMember[m.id] || 0),
  }))

  balances.sort((a, b) => a.balance - b.balance)

  return NextResponse.json(balances)
}
