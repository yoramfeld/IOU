import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(request: Request) {
  const { token, memberName, confirmExisting } = await request.json()

  if (!token || !memberName?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Token must exist (no time check — scanner already passed the 120s window on GET)
  const tokenRows = await sql`
    SELECT qt.group_id, g.id, g.name, g.code, g.currency
    FROM qr_tokens qt
    JOIN groups g ON g.id = qt.group_id
    WHERE qt.token = ${token}
    LIMIT 1
  `
  const qrToken = tokenRows[0]

  if (!qrToken) {
    return NextResponse.json({ error: 'Invalid QR code' }, { status: 401 })
  }

  const group = { id: qrToken.id, name: qrToken.name, code: qrToken.code, currency: qrToken.currency }

  // Check if name already exists in this group
  const existingRows = await sql`
    SELECT id, is_admin FROM members
    WHERE group_id = ${group.id} AND name ILIKE ${memberName.trim()}
    LIMIT 1
  `
  const existing = existingRows[0]

  if (!existing) {
    // New member — insert and return direct login
    const memberRows = await sql`
      INSERT INTO members (group_id, name) VALUES (${group.id}, ${memberName.trim()}) RETURNING id
    `
    const member = memberRows[0]

    if (!member) {
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
  await sql`DELETE FROM pending_verifications WHERE member_id = ${memberId}`

  const pendingRows = await sql`
    INSERT INTO pending_verifications (group_id, member_id, code)
    VALUES (${group.id}, ${memberId}, ${code})
    RETURNING id
  `
  const pending = pendingRows[0]

  if (!pending) {
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
