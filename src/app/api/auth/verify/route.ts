import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

// POST — Authenticator approves a pending verification by code
export async function POST(request: NextRequest) {
  const { groupId, code } = await request.json()

  if (!groupId || !code?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const pendingRows = await sql`
    SELECT id FROM pending_verifications
    WHERE group_id = ${groupId} AND code = ${code.trim()}
    LIMIT 1
  `
  const pending = pendingRows[0]

  if (!pending) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 404 })
  }

  await sql`DELETE FROM pending_verifications WHERE id = ${pending.id}`

  return NextResponse.json({ approved: true })
}

// GET — Joiner polls OR check if any pending verifications exist for a group
export async function GET(request: NextRequest) {
  const pendingId = request.nextUrl.searchParams.get('pendingId')
  const memberId = request.nextUrl.searchParams.get('memberId')
  const groupId = request.nextUrl.searchParams.get('groupId')

  // Check if any pending verifications exist for a group
  if (groupId && !pendingId) {
    const rows = await sql`
      SELECT pv.id, pv.member_id, m.name AS member_name
      FROM pending_verifications pv
      JOIN members m ON m.id = pv.member_id
      WHERE pv.group_id = ${groupId}
      LIMIT 1
    `
    const first = rows[0]
    return NextResponse.json({
      hasPending: rows.length > 0,
      pendingName: first?.member_name ?? null,
    })
  }

  if (!pendingId || !memberId) {
    return NextResponse.json({ error: 'Missing pendingId or memberId' }, { status: 400 })
  }

  const pendingRows = await sql`
    SELECT id FROM pending_verifications WHERE id = ${pendingId} LIMIT 1
  `

  if (pendingRows.length > 0) {
    return NextResponse.json({ approved: false })
  }

  // Row deleted → approved. Fetch session data for the member.
  const memberRows = await sql`
    SELECT id, name, is_admin, group_id FROM members WHERE id = ${memberId} LIMIT 1
  `
  const member = memberRows[0]

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const groupRows = await sql`
    SELECT id, name, code, currency FROM groups WHERE id = ${member.group_id} LIMIT 1
  `
  const group = groupRows[0]

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

  const adminRows = await sql`
    SELECT is_admin, group_id FROM members WHERE id = ${adminId} LIMIT 1
  `
  const admin = adminRows[0]

  if (!admin?.is_admin || admin.group_id !== groupId) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  await sql`DELETE FROM pending_verifications WHERE group_id = ${groupId}`

  return NextResponse.json({ ok: true })
}
