import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { calculateSettlements } from '@/lib/settle'
import type { MemberBalance } from '@/types'

export const dynamic = 'force-dynamic'

const EXPECTED_BALANCES: Record<string, number> = {
  Alice: 75,
  Bob: -55,
  Carol: 0,
  Dave: -50,
  Eve: -47,
  Frank: 68,
  Grace: 9,
}

const EXPECTED_SETTLEMENTS = [
  { from: 'Bob',  to: 'Alice', amount: 55 },
  { from: 'Dave', to: 'Alice', amount: 20 },
  { from: 'Dave', to: 'Frank', amount: 30 },
  { from: 'Eve',  to: 'Frank', amount: 38 },
  { from: 'Eve',  to: 'Grace', amount:  9 },
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const adminId = searchParams.get('adminId')
  if (!adminId) return NextResponse.json({ error: 'Missing adminId' }, { status: 400 })

  const db = neon(process.env.DATABASE_URL!)

  // Guard: adminId must be a real admin
  const adminRows = await db`SELECT is_admin FROM members WHERE id = ${adminId} LIMIT 1`
  if (!adminRows[0]?.is_admin) return NextResponse.json({ error: 'Not an admin' }, { status: 403 })

  let groupId: string | null = null

  try {
    // ── 1. Create test group ──────────────────────────────────────────────────
    const [group] = await db`
      INSERT INTO groups (name, code, currency)
      VALUES ('Test Seven', 'test-seven-tmp-' || substr(md5(random()::text), 1, 6), '€')
      RETURNING id`
    groupId = group.id

    // ── 2. Create 7 members ───────────────────────────────────────────────────
    const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace']
    const memberIds: Record<string, string> = {}
    for (const name of names) {
      const [m] = await db`
        INSERT INTO members (group_id, name, is_admin)
        VALUES (${groupId}, ${name}, false)
        RETURNING id`
      memberIds[name] = m.id
    }

    // ── 3. Insert expenses ────────────────────────────────────────────────────
    type Split = [string, number]  // [memberName, positiveAmount]
    const expenses: { desc: string; payer: string; amount: number; splits: Split[] }[] = [
      {
        desc: 'Dinner', payer: 'Alice', amount: 140,
        splits: [['Alice',20],['Bob',20],['Carol',20],['Dave',20],['Eve',20],['Frank',20],['Grace',20]],
      },
      {
        desc: 'Taxi', payer: 'Bob', amount: 60,
        splits: [['Bob',20],['Carol',20],['Dave',20]],
      },
      {
        desc: 'Hotel', payer: 'Carol', amount: 90,
        splits: [['Alice',18],['Bob',18],['Carol',18],['Dave',18],['Eve',18]],
      },
      {
        desc: 'Museum', payer: 'Dave', amount: 55,
        splits: [['Alice',10],['Bob',15],['Dave',30]],
      },
      {
        desc: 'Groceries', payer: 'Eve', amount: 42,
        splits: [['Eve',14],['Frank',14],['Grace',14]],
      },
      {
        desc: 'Concert', payer: 'Frank', amount: 119,
        splits: [['Alice',17],['Bob',17],['Carol',17],['Dave',17],['Eve',17],['Frank',17],['Grace',17]],
      },
      {
        desc: 'Spa', payer: 'Grace', amount: 75,
        splits: [['Bob',25],['Carol',15],['Eve',20],['Grace',15]],
      },
    ]

    for (const exp of expenses) {
      const payerId = memberIds[exp.payer]
      const [e] = await db`
        INSERT INTO expenses (group_id, paid_by, amount, description, entered_by)
        VALUES (${groupId}, ${payerId}, ${exp.amount}, ${exp.desc}, ${payerId})
        RETURNING id`
      await db`
        INSERT INTO expense_payers (expense_id, member_id, amount)
        VALUES (${e.id}, ${payerId}, ${exp.amount})`
      for (const [name, amt] of exp.splits) {
        await db`
          INSERT INTO expense_splits (expense_id, member_id, amount)
          VALUES (${e.id}, ${memberIds[name]}, ${-amt})`
      }
    }

    // ── 4. Compute balances (same logic as /api/balances) ─────────────────────
    const [members, splits, paid] = await Promise.all([
      db`SELECT id, name FROM members WHERE group_id = ${groupId}`,
      db`SELECT es.member_id, es.amount FROM expense_splits es WHERE es.expense_id IN (SELECT id FROM expenses WHERE group_id = ${groupId})`,
      db`SELECT paid_by AS member_id, amount FROM expenses WHERE group_id = ${groupId}`,
    ])

    const paidBy: Record<string, number> = {}
    const owedBy: Record<string, number> = {}
    for (const p of paid)   paidBy[p.member_id] = (paidBy[p.member_id] || 0) + Number(p.amount)
    for (const s of splits) owedBy[s.member_id] = (owedBy[s.member_id] || 0) + Number(s.amount)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balances: MemberBalance[] = members.map((m: any) => ({
      id: m.id,
      name: m.name,
      is_admin: false,
      group_id: groupId!,
      total_paid: paidBy[m.id] || 0,
      total_owed: owedBy[m.id] || 0,
      balance: (paidBy[m.id] || 0) + (owedBy[m.id] || 0),
    }))

    // ── 5. Verify balances ────────────────────────────────────────────────────
    const balanceChecks = balances.map(b => ({
      member: b.name,
      expected: EXPECTED_BALANCES[b.name] ?? null,
      actual: Math.round(b.balance * 100) / 100,
      pass: Math.abs(b.balance - (EXPECTED_BALANCES[b.name] ?? NaN)) < 0.01,
    }))

    // ── 6. Verify settlements ─────────────────────────────────────────────────
    const transfers = calculateSettlements(balances)
    const nameById = Object.fromEntries(balances.map(b => [b.id, b.name]))
    const settlementChecks = EXPECTED_SETTLEMENTS.map((exp, i) => {
      const actual = transfers[i]
      const pass = actual &&
        nameById[actual.from] === exp.from &&
        nameById[actual.to]   === exp.to   &&
        Math.abs(actual.amount - exp.amount) < 0.01
      return {
        from: exp.from, to: exp.to, expected: exp.amount,
        actual: actual ? Math.round(actual.amount * 100) / 100 : null,
        actualFrom: actual ? nameById[actual.from] : null,
        actualTo:   actual ? nameById[actual.to]   : null,
        pass: !!pass,
      }
    })
    // Also flag if extra unexpected transfers exist
    if (transfers.length !== EXPECTED_SETTLEMENTS.length) {
      settlementChecks.push({
        from: '(count)', to: '', expected: EXPECTED_SETTLEMENTS.length,
        actual: transfers.length, actualFrom: null, actualTo: null,
        pass: false,
      })
    }

    const passed = [...balanceChecks, ...settlementChecks].filter(c => c.pass).length
    const failed = [...balanceChecks, ...settlementChecks].filter(c => !c.pass).length

    return NextResponse.json({ passed, failed, balanceChecks, settlementChecks })

  } finally {
    // ── 7. Cleanup (cascade deletes everything) ───────────────────────────────
    if (groupId) await db`DELETE FROM groups WHERE id = ${groupId}`
  }
}
