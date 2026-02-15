import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch members, expenses, and splits separately to avoid view issues
  const [membersRes, expensesRes, splitsRes] = await Promise.all([
    supabase.from('members').select('id, name, is_admin, group_id').eq('group_id', groupId),
    supabase.from('expenses').select('id, paid_by, amount').eq('group_id', groupId),
    supabase.from('expense_splits').select('member_id, amount, expense_id'),
  ])

  if (membersRes.error) {
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }

  const members = (membersRes.data || []) as { id: string; name: string; is_admin: boolean; group_id: string }[]
  const expenses = (expensesRes.data || []) as { id: string; paid_by: string; amount: number }[]

  // Get expense IDs for this group to filter splits
  const expenseIds = new Set(expenses.map((e: { id: string }) => e.id))
  const splits = ((splitsRes.data || []) as { member_id: string; amount: number; expense_id: string }[]).filter(s => expenseIds.has(s.expense_id))

  // Compute totals per member
  const paidByMember: Record<string, number> = {}
  for (const e of expenses) {
    paidByMember[e.paid_by] = (paidByMember[e.paid_by] || 0) + Number(e.amount)
  }

  const owedByMember: Record<string, number> = {}
  for (const s of splits) {
    owedByMember[s.member_id] = (owedByMember[s.member_id] || 0) + Number(s.amount)
  }

  const balances = members.map(m => ({
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
