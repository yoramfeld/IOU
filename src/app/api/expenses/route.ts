import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('expenses')
    .select('*, splits:expense_splits(*)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const { groupId, paidBy, amount, description, splitAmong, customSplits, enteredBy } = await request.json()

  const hasCustom = Array.isArray(customSplits) && customSplits.length > 0
  if (!groupId || !paidBy || !amount || !description?.trim() || !enteredBy) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (!hasCustom && !splitAmong?.length) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  if (amount <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify enteredBy is a valid member of the group
  if (enteredBy !== paidBy) {
    const { data: enterer } = await supabase
      .from('members')
      .select('id, group_id')
      .eq('id', enteredBy)
      .eq('group_id', groupId)
      .single()
    if (!enterer) {
      return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
    }
  }

  // Create expense
  const { data: expense, error: expErr } = await supabase
    .from('expenses')
    .insert({
      group_id: groupId,
      paid_by: paidBy,
      amount: Number(amount),
      description: description.trim(),
      entered_by: enteredBy,
    })
    .select('id')
    .single()

  if (expErr) {
    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
  }

  // Create splits
  const splits = hasCustom
    ? customSplits.map(({ memberId, amount: a }: { memberId: string; amount: number }) => ({
        expense_id: expense.id,
        member_id: memberId,
        amount: -Math.round(a * 100) / 100,
      }))
    : splitAmong.map((memberId: string) => ({
        expense_id: expense.id,
        member_id: memberId,
        amount: Math.round(-(Number(amount) / splitAmong.length) * 100) / 100,
      }))

  const { error: splitErr } = await supabase
    .from('expense_splits')
    .insert(splits)

  if (splitErr) {
    // Rollback expense
    await supabase.from('expenses').delete().eq('id', expense.id)
    return NextResponse.json({ error: 'Failed to create splits' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { expenseId, groupId, adminId, resetAll } = await request.json()

  if (!adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify admin
  const { data: admin } = await supabase
    .from('members')
    .select('is_admin')
    .eq('id', adminId)
    .single()

  if (!admin?.is_admin) {
    return NextResponse.json({ error: 'Only admins can delete expenses' }, { status: 403 })
  }

  // Reset all expenses for a group
  if (resetAll && groupId) {
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('group_id', groupId)

    if (error) {
      return NextResponse.json({ error: 'Failed to reset transactions' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  // Delete single expense
  if (!expenseId) {
    return NextResponse.json({ error: 'Missing expenseId' }, { status: 400 })
  }

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
