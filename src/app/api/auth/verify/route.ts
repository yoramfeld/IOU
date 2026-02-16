import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// POST — Authenticator approves a pending verification by code
export async function POST(request: NextRequest) {
  const { groupId, code } = await request.json()

  if (!groupId || !code?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: pending } = await supabase
    .from('pending_verifications')
    .select('id')
    .eq('group_id', groupId)
    .eq('code', code.trim())
    .single()

  if (!pending) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 404 })
  }

  await supabase
    .from('pending_verifications')
    .delete()
    .eq('id', pending.id)

  return NextResponse.json({ approved: true })
}

// GET — Joiner polls OR check if any pending verifications exist for a group
export async function GET(request: NextRequest) {
  const pendingId = request.nextUrl.searchParams.get('pendingId')
  const memberId = request.nextUrl.searchParams.get('memberId')
  const groupId = request.nextUrl.searchParams.get('groupId')

  const supabase = createServiceClient()

  // Check if any pending verifications exist for a group
  if (groupId && !pendingId) {
    const { data } = await supabase
      .from('pending_verifications')
      .select('id')
      .eq('group_id', groupId)
      .limit(1)

    return NextResponse.json({ hasPending: (data?.length ?? 0) > 0 })
  }

  if (!pendingId || !memberId) {
    return NextResponse.json({ error: 'Missing pendingId or memberId' }, { status: 400 })
  }

  const { data: pending } = await supabase
    .from('pending_verifications')
    .select('id')
    .eq('id', pendingId)
    .single()

  if (pending) {
    return NextResponse.json({ approved: false })
  }

  // Row deleted → approved. Fetch session data for the member.
  const { data: member } = await supabase
    .from('members')
    .select('id, name, is_admin, group_id')
    .eq('id', memberId)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, code, currency')
    .eq('id', member.group_id)
    .single()

  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }

  return NextResponse.json({
    approved: true,
    groupId: group.id,
    groupName: group.name,
    groupCode: group.code,
    currency: group.currency,
    memberId: member.id,
    name: member.name,
    isAdmin: member.is_admin,
  })
}

// DELETE — Admin clears all pending verifications for a group
export async function DELETE(request: NextRequest) {
  const { groupId, adminId } = await request.json()

  if (!groupId || !adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: admin } = await supabase
    .from('members')
    .select('is_admin, group_id')
    .eq('id', adminId)
    .single()

  if (!admin?.is_admin || admin.group_id !== groupId) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  await supabase
    .from('pending_verifications')
    .delete()
    .eq('group_id', groupId)

  return NextResponse.json({ ok: true })
}
