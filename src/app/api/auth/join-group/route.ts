import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { groupCode, memberName, confirmExisting, adminPassword } = await request.json()

  if (!groupCode?.trim() || !memberName?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Find group by code (case-insensitive)
  const groups = await sql`
    SELECT id, name, code, currency FROM groups WHERE code ILIKE ${groupCode.trim()} LIMIT 1
  `
  const group = groups[0]

  if (!group) {
    return NextResponse.json({ error: 'Group not found. Check the code and try again.' }, { status: 401 })
  }

  // Check if name already exists in this group
  const existingRows = await sql`
    SELECT id, is_admin FROM members WHERE group_id = ${group.id} AND name ILIKE ${memberName.trim()} LIMIT 1
  `
  const existing = existingRows[0]

  let memberId: string

  if (existing) {
    if (existing.is_admin) {
      // Admin path: try password before falling through to collision screen
      if (adminPassword?.trim()) {
        const groupRows = await sql`
          SELECT admin_password_hash FROM groups WHERE id = ${group.id}
        `
        const groupWithHash = groupRows[0]

        const match = groupWithHash?.admin_password_hash
          ? await bcrypt.compare(adminPassword.trim(), groupWithHash.admin_password_hash)
          : false

        if (match) {
          // Direct login — no P2P needed
          return NextResponse.json({
            directLogin: true,
            memberId: existing.id,
            memberName: memberName.trim(),
            groupId: group.id,
            groupName: group.name,
            groupCode: group.code,
            currency: group.currency,
            isAdmin: true,
          })
        }
        // Wrong password — fall through to collision screen (don't reveal mismatch)
      }
    }

    if (!confirmExisting) {
      // Name collision — return early, no DB writes
      return NextResponse.json({
        nameCollision: true,
        groupName: group.name,
        memberName: memberName.trim(),
      })
    }
    memberId = existing.id   // re-pair path (unchanged)
  } else {
    // New member: create them first
    const memberRows = await sql`
      INSERT INTO members (group_id, name) VALUES (${group.id}, ${memberName.trim()}) RETURNING id
    `
    const member = memberRows[0]
    if (!member) {
      return NextResponse.json({ error: 'Failed to join group' }, { status: 500 })
    }
    memberId = member.id
  }

  // Always require P2P verification
  const code = String(Math.floor(100 + Math.random() * 900)) // 100–999

  // Remove any stale pending verifications for this member
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
