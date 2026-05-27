import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('groupId')

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 })
  }

  const data = await sql`
    SELECT id, group_id, name, is_admin, created_at,
           (password_hash IS NOT NULL) AS has_password,
           starting_balance
    FROM members WHERE group_id = ${groupId} ORDER BY name
  `

  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const { memberId, adminId } = await request.json()

  if (!memberId || !adminId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify admin
  const adminRows = await sql`
    SELECT is_admin, group_id FROM members WHERE id = ${adminId} LIMIT 1
  `
  const admin = adminRows[0]

  if (!admin?.is_admin) {
    return NextResponse.json({ error: 'Only admins can remove members' }, { status: 403 })
  }

  // Verify target is in the same group
  const targetRows = await sql`
    SELECT group_id FROM members WHERE id = ${memberId} LIMIT 1
  `
  const target = targetRows[0]

  if (!target || target.group_id !== admin.group_id) {
    return NextResponse.json({ error: 'Member not found in your group' }, { status: 404 })
  }

  await sql`DELETE FROM members WHERE id = ${memberId}`

  return NextResponse.json({ ok: true })
}
