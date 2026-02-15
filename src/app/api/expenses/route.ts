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
  const { groupId, paidBy, amount, description, splitAmong, enteredBy } = await request.json()

  if (!groupId || !paidBy || !amount || !description?.trim() || !splitAmong?.length || !enteredBy) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  if (amount <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // If entered by someone other than payer, verify they're admin or it's a settlement by the lender
  if (enteredBy !== paidBy) {
    const isSettlement = typeof description === 'string' && description.startsWith('⚡ Settlement:')
    const isLender = isSettlement && splitAmong.includes(enteredBy)

    if (!isLender) {
      const { data: enterer } = await supabase
        .from('members')
        .select('is_admin')
        .eq('id', enteredBy)
        .single()
      if (!enterer?.is_admin) {
        return NextResponse.json({ error: 'Only admins can enter expenses on behalf of others' }, { status: 403 })
      }
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
  const splitAmount = -(Number(amount) / splitAmong.length)
  const splits = splitAmong.map((memberId: string) => ({
    expense_id: expense.id,
    member_id: memberId,
    amount: Math.round(splitAmount * 100) / 100,
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
  const { expenseId, adminId } = await request.json()

  if (!expenseId || !adminId) {
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

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
