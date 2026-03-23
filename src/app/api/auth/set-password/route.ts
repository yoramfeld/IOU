import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { memberId, currentPassword, newPassword } = await request.json()

  if (!memberId) {
    return NextResponse.json({ error: 'Missing memberId' }, { status: 400 })
  }

  const rows = await sql`SELECT password_hash FROM members WHERE id = ${memberId} LIMIT 1`
  const member = rows[0]
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // If a password is already set, require the current one
  if (member.password_hash) {
    if (!currentPassword?.trim()) {
      return NextResponse.json({ error: 'Current password required' }, { status: 400 })
    }
    const match = await bcrypt.compare(currentPassword.trim(), member.password_hash)
    if (!match) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
  }

  if (!newPassword?.trim()) {
    await sql`UPDATE members SET password_hash = NULL WHERE id = ${memberId}`
    return NextResponse.json({ ok: true })
  }

  const hash = await bcrypt.hash(newPassword.trim(), 10)
  await sql`UPDATE members SET password_hash = ${hash} WHERE id = ${memberId}`
  return NextResponse.json({ ok: true })
}
