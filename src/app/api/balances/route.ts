import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

interface MemberRow { id: string; name: string; is_admin: boolean; group_id: string }
interface ExpenseRow { id: string; paid_by: string; amount: number; expense_splits: SplitRow[] }
interface SplitRow { member_id: string; amount: number }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [membersRes, expensesRes] = await Promise.all([
    supabase.from('members').select('id, name, is_admin, group_id').eq('group_id', groupId),
    supabase.from('expenses').select('id, paid_by, amount, expense_splits(member_id, amount)').eq('group_id', groupId),
  ])

  if (membersRes.error || expensesRes.error) {
    return NextResponse.json({
      error: 'Failed to fetch balances',
      details: membersRes.error?.message || expensesRes.error?.message,
    }, { status: 500 })
  }

  const members = (membersRes.data || []) as MemberRow[]
  const expenses = (expensesRes.data || []) as ExpenseRow[]

  // Compute totals per member
  const paidByMember: Record<string, number> = {}
  const owedByMember: Record<string, number> = {}

  for (const e of expenses) {
    paidByMember[e.paid_by] = (paidByMember[e.paid_by] || 0) + Number(e.amount)
    for (const s of e.expense_splits) {
      owedByMember[s.member_id] = (owedByMember[s.member_id] || 0) + Number(s.amount)
    }
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
