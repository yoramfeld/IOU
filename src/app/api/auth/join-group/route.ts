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
    return NextResponse.json(
      { error: `"${memberName.trim()}" is already taken in this group. Try adding a last initial.` },
      { status: 409 }
    )
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
