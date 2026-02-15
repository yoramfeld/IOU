import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateGroupCode } from '@/lib/groupCode'

export async function POST(request: Request) {
  const { groupName, currency, memberName } = await request.json()

  if (!groupName?.trim() || !memberName?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Generate unique code with retry
  let code = ''
  for (let i = 0; i < 10; i++) {
    code = generateGroupCode()
    const { data: existing } = await supabase
      .from('groups')
      .select('id')
      .eq('code', code)
      .single()
    if (!existing) break
  }

  // Create group
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .insert({ name: groupName.trim(), code, currency: currency || '€' })
    .select('id, name, code, currency')
    .single()

  if (groupErr) {
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }

  // Create first member (admin)
  const { data: member, error: memberErr } = await supabase
    .from('members')
    .insert({ group_id: group.id, name: memberName.trim(), is_admin: true })
    .select('id, name, is_admin')
    .single()

  if (memberErr) {
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  }

  // Update group's created_by
  await supabase
    .from('groups')
    .update({ created_by: member.id })
    .eq('id', group.id)

  return NextResponse.json({
    groupId: group.id,
    groupName: group.name,
    groupCode: group.code,
    currency: group.currency,
    memberId: member.id,
    name: member.name,
    isAdmin: true,
  })
}
