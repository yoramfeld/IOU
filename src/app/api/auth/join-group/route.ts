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

  // Check if name already exists in this group
  const { data: existing } = await supabase
    .from('members')
    .select('id')
    .eq('group_id', group.id)
    .ilike('name', memberName.trim())
    .single()

  let memberId: string

  if (existing) {
    // Re-pairing: use the existing member
    memberId = existing.id
  } else {
    // New member: create them first
    const { data: member, error: memberErr } = await supabase
      .from('members')
      .insert({ group_id: group.id, name: memberName.trim() })
      .select('id')
      .single()

    if (memberErr) {
      return NextResponse.json({ error: 'Failed to join group' }, { status: 500 })
    }
    memberId = member.id
  }

  // Always require P2P verification
  const code = String(Math.floor(100 + Math.random() * 900)) // 100–999

  // Remove any stale pending verifications for this member
  await supabase
    .from('pending_verifications')
    .delete()
    .eq('member_id', memberId)

  const { data: pending, error: pendingErr } = await supabase
    .from('pending_verifications')
    .insert({ group_id: group.id, member_id: memberId, code })
    .select('id')
    .single()

  if (pendingErr) {
    return NextResponse.json({ error: 'Failed to start verification' }, { status: 500 })
  }

  return NextResponse.json({
    needsVerification: true,
    pendingId: pending.id,
    memberId,
    code,
    memberName: memberName.trim(),
    groupId: group.id,
    groupName: group.name,
    groupCode: group.code,
    currency: group.currency,
  })
}
