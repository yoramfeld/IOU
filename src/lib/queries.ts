import { createServiceClient } from '@/lib/supabase/server'
import type { Member, Expense, ExpenseSplit, MemberBalance } from '@/types'

export async function fetchMembers(groupId: string): Promise<Member[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('group_id', groupId)
    .order('name')
  if (error) throw error
  return data
}

export async function fetchExpenses(groupId: string): Promise<(Expense & { splits: ExpenseSplit[] })[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('expenses')
    .select('*, splits:expense_splits(*)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchBalances(groupId: string): Promise<MemberBalance[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('member_balances')
    .select('*')
    .eq('group_id', groupId)
    .order('balance', { ascending: true })
  if (error) throw error
  return data
}

export async function addExpense(
  groupId: string,
  paidBy: string,
  amount: number,
  description: string,
  splitAmong: string[],
  enteredBy: string,
): Promise<void> {
  const supabase = createServiceClient()

  const { data: expense, error: expError } = await supabase
    .from('expenses')
    .insert({ group_id: groupId, paid_by: paidBy, amount, description, entered_by: enteredBy })
    .select('id')
    .single()
  if (expError) throw expError

  const splitAmount = -(amount / splitAmong.length)
  const splits = splitAmong.map(memberId => ({
    expense_id: expense.id,
    member_id: memberId,
    amount: Math.round(splitAmount * 100) / 100,
  }))

  const { error: splitError } = await supabase
    .from('expense_splits')
    .insert(splits)
  if (splitError) throw splitError
}

export async function removeExpense(expenseId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)
  if (error) throw error
}

export async function removeMember(memberId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)
  if (error) throw error
}
