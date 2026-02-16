import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { groupCode, memberName } = await request.json()

  if (!groupCode?.trim() || !memberName?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Find group by code (case-insensitive)
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, code, currency')
    .ilike('code', groupCode.trim())
    .single()

  if (!group) {
    return NextResponse.json({ error: 'Group not found. Check the code and try again.' }, { status: 401 })
  }

  // Check name uniqueness within group
  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('group_id', group.id)
    .ilike('name', memberName.trim())
    .single()

  if (existing) {
    // Name exists → start P2P verification flow
    const code = String(Math.floor(100 + Math.random() * 900)) // 100–999

    // Remove any stale pending verifications for this member
    await supabase
      .from('pending_verifications')
      .delete()
      .eq('member_id', existing.id)

    const { data: pending, error: pendingErr } = await supabase
      .from('pending_verifications')
      .insert({ group_id: group.id, member_id: existing.id, code })
      .select('id')
      .single()

    if (pendingErr) {
      return NextResponse.json({ error: 'Failed to start verification' }, { status: 500 })
    }

    return NextResponse.json({
      needsVerification: true,
      pendingId: pending.id,
      memberId: existing.id,
      code,
      memberName: memberName.trim(),
      groupId: group.id,
      groupName: group.name,
      groupCode: group.code,
      currency: group.currency,
    })
  }

  // Create member
  const { data: member, error: memberErr } = await supabase
    .from('members')
    .insert({ group_id: group.id, name: memberName.trim() })
    .select('id, name, is_admin')
    .single()

  if (memberErr) {
    return NextResponse.json({ error: 'Failed to join group' }, { status: 500 })
  }

  return NextResponse.json({
    groupId: group.id,
    groupName: group.name,
    groupCode: group.code,
    currency: group.currency,
    memberId: member.id,
    name: member.name,
    isAdmin: member.is_admin,
  })
}
