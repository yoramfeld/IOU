import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { generateGroupCode } from '@/lib/groupCode'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { groupName, currency, memberName, adminPassword } = await request.json()

  if (!groupName?.trim() || !memberName?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Generate unique code with retry
  let code = ''
  for (let i = 0; i < 10; i++) {
    code = generateGroupCode()
    const existing = await sql`SELECT id FROM groups WHERE code = ${code} LIMIT 1`
    if (existing.length === 0) break
  }

  const hash = adminPassword?.trim() ? await bcrypt.hash(adminPassword.trim(), 10) : null

  // Create group
  const groups = await sql`
    INSERT INTO groups (name, code, currency, admin_password_hash)
    VALUES (${groupName.trim()}, ${code}, ${currency || '€'}, ${hash})
    RETURNING id, name, code, currency
  `
  const group = groups[0]
  if (!group) {
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }

  // Create first member (admin) — also store their personal recovery password hash
  const members = await sql`
    INSERT INTO members (group_id, name, is_admin, password_hash)
    VALUES (${group.id}, ${memberName.trim()}, true, ${hash})
    RETURNING id, name, is_admin
  `
  const member = members[0]
  if (!member) {
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  }

  // Update group's created_by
  await sql`UPDATE groups SET created_by = ${member.id} WHERE id = ${group.id}`

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
