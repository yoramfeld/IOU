import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('group_id', groupId)
    .order('name')

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const { memberId, adminId } = await request.json()

  if (!memberId || !adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify admin
  const { data: admin } = await supabase
    .from('members')
    .select('is_admin, group_id')
    .eq('id', adminId)
    .single()

  if (!admin?.is_admin) {
    return NextResponse.json({ error: 'Only admins can remove members' }, { status: 403 })
  }

  // Verify target is in the same group
  const { data: target } = await supabase
    .from('members')
    .select('group_id')
    .eq('id', memberId)
    .single()

  if (!target || target.group_id !== admin.group_id) {
    return NextResponse.json({ error: 'Member not found in your group' }, { status: 404 })
  }

  const { error } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)

  if (error) {
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
