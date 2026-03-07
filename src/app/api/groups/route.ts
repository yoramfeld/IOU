import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(request: Request) {
  const { groupId, adminId, name, currency } = await request.json()

  if (!groupId || !adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify admin belongs to this group
  const { data: admin } = await supabase
    .from('members')
    .select('is_admin, group_id')
    .eq('id', adminId)
    .single()

  if (!admin?.is_admin || admin.group_id !== groupId) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  // If changing currency, check all balances are equal (i.e. all zero)
  if (currency) {
    const { data: balances } = await supabase
      .from('member_balances')
      .select('balance')
      .eq('group_id', groupId)

    const hasNonZero = balances?.some((b: { balance: number }) => Math.abs(Number(b.balance)) > 0.01)
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

  const { error } = await supabase
    .from('groups')
    .update(updates)
    .eq('id', groupId)

  if (error) {
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
