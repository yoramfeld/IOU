import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { token, memberName, confirmExisting } = await request.json()

  if (!token || !memberName?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Token must exist (no time check — scanner already passed the 120s window on GET)
  const { data: qrToken } = await supabase
    .from('qr_tokens')
    .select('group_id, groups(id, name, code, currency)')
    .eq('token', token)
    .single()

  if (!qrToken) {
    return NextResponse.json({ error: 'Invalid QR code' }, { status: 401 })
  }

  const group = qrToken.groups as { id: string; name: string; code: string; currency: string }

  // Check if name already exists in this group
  const { data: existing } = await supabase
    .from('members')
    .select('id, is_admin')
    .eq('group_id', group.id)
    .ilike('name', memberName.trim())
    .single()

  if (!existing) {
    // New member — insert and return direct login
    const { data: member, error: memberErr } = await supabase
      .from('members')
      .insert({ group_id: group.id, name: memberName.trim() })
      .select('id')
      .single()

    if (memberErr) {
      return NextResponse.json({ error: 'Failed to join group' }, { status: 500 })
    }

    return NextResponse.json({
      directLogin: true,
      memberId: member.id,
      memberName: memberName.trim(),
      groupId: group.id,
      groupName: group.name,
      groupCode: group.code,
      currency: group.currency,
      isAdmin: false,
    })
  }

  // Name found — returning member
  if (!confirmExisting) {
    return NextResponse.json({
      nameCollision: true,
      groupName: group.name,
      memberName: memberName.trim(),
    })
  }

  // confirmExisting: true — needs P2P verification
  const memberId = existing.id
  const code = String(Math.floor(100 + Math.random() * 900))

  // Remove stale pending verifications for this member
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
