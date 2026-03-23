import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { calculateSettlements } from '@/lib/settle'
import type { MemberBalance } from '@/types'

export const dynamic = 'force-dynamic'

// ── Scenario definition types ─────────────────────────────────────────────────

type ExpenseDef = {
  desc: string
  payers: [string, number][]   // [memberName, positiveAmount] — multi-payer supported
  splits: [string, number][]   // [memberName, positiveAmount] — stored as negative
}

type ScenarioDef = {
  name: string
  description: string
  members: string[]
  expenses: ExpenseDef[]
  expectedBalances: Record<string, number>
  expectedSettlements: { from: string; to: string; amount: number }[]
}

// ── Test scenarios ────────────────────────────────────────────────────────────

const SCENARIOS: ScenarioDef[] = [
  // ── S1: 7-member complex ────────────────────────────────────────────────────
  // Even splits, custom splits, subset splits, zero-balance member (Carol)
  // Alice=+75, Bob=−55, Carol=0, Dave=−50, Eve=−47, Frank=+68, Grace=+9
  {
    name: 'S1: Complex 7-member group',
    description: 'Even/custom/subset splits, zero-balance member, 5 settlement transfers',
    members: ['Alice','Bob','Carol','Dave','Eve','Frank','Grace'],
    expenses: [
      { desc:'Dinner',    payers:[['Alice',140]], splits:[['Alice',20],['Bob',20],['Carol',20],['Dave',20],['Eve',20],['Frank',20],['Grace',20]] },
      { desc:'Taxi',      payers:[['Bob',60]],    splits:[['Bob',20],['Carol',20],['Dave',20]] },
      { desc:'Hotel',     payers:[['Carol',90]],  splits:[['Alice',18],['Bob',18],['Carol',18],['Dave',18],['Eve',18]] },
      { desc:'Museum',    payers:[['Dave',55]],   splits:[['Alice',10],['Bob',15],['Dave',30]] },
      { desc:'Groceries', payers:[['Eve',42]],    splits:[['Eve',14],['Frank',14],['Grace',14]] },
      { desc:'Concert',   payers:[['Frank',119]], splits:[['Alice',17],['Bob',17],['Carol',17],['Dave',17],['Eve',17],['Frank',17],['Grace',17]] },
      { desc:'Spa',       payers:[['Grace',75]],  splits:[['Bob',25],['Carol',15],['Eve',20],['Grace',15]] },
    ],
    expectedBalances: { Alice:75, Bob:-55, Carol:0, Dave:-50, Eve:-47, Frank:68, Grace:9 },
    expectedSettlements: [
      { from:'Bob',  to:'Alice', amount:55 },
      { from:'Dave', to:'Alice', amount:20 },
      { from:'Dave', to:'Frank', amount:30 },
      { from:'Eve',  to:'Frank', amount:38 },
      { from:'Eve',  to:'Grace', amount:9  },
    ],
  },

  // ── S2: Rounding / decimal precision ────────────────────────────────────────
  // €10÷3 and €20÷3 produce remainder cents.
  // R1: +10 −3.33 −6.67 = 0.00  (zero balance from rounding)
  // R2: +20 −3.34 −6.67 = +9.99
  // R3:   0 −3.33 −6.66 = −9.99
  {
    name: 'S2: Rounding / decimal precision',
    description: '€10÷3 and €20÷3 — remainder cents distributed, one zero-balance from rounding',
    members: ['R1','R2','R3'],
    expenses: [
      // €10/3: base=3.33, R2 gets the extra penny → 3.33 + 3.34 + 3.33 = 10.00
      { desc:'Brunch', payers:[['R1',10]], splits:[['R1',3.33],['R2',3.34],['R3',3.33]] },
      // €20/3: base=6.66, R1 and R2 each get extra penny → 6.67 + 6.67 + 6.66 = 20.00
      { desc:'Coffee', payers:[['R2',20]], splits:[['R1',6.67],['R2',6.67],['R3',6.66]] },
    ],
    expectedBalances: { R1:0, R2:9.99, R3:-9.99 },
    expectedSettlements: [
      { from:'R3', to:'R2', amount:9.99 },
    ],
  },

  // ── S3: Pure debtor — member who never pays ──────────────────────────────────
  // Q3 never appears as a payer, only in splits.
  // Q1: +90 −30 −30 = +30
  // Q2: +60 −30 −30 =   0
  // Q3:   0 −30     = −30
  {
    name: 'S3: Pure debtor (never pays)',
    description: 'Q3 only ever owes — never a payer; Q2 has zero net balance',
    members: ['Q1','Q2','Q3'],
    expenses: [
      { desc:'Rent',  payers:[['Q1',90]], splits:[['Q1',30],['Q2',30],['Q3',30]] },
      { desc:'Utils', payers:[['Q2',60]], splits:[['Q1',30],['Q2',30]] }, // Q3 excluded
    ],
    expectedBalances: { Q1:30, Q2:0, Q3:-30 },
    expectedSettlements: [
      { from:'Q3', to:'Q1', amount:30 },
    ],
  },

  // ── S4: Two-person sanity check ──────────────────────────────────────────────
  // Simplest possible case.
  // T1: +100 −50 = +50
  // T2:    0 −50 = −50
  {
    name: 'S4: Two-person sanity check',
    description: 'Minimal case — one expense, two members, one settlement',
    members: ['T1','T2'],
    expenses: [
      { desc:'Lunch', payers:[['T1',100]], splits:[['T1',50],['T2',50]] },
    ],
    expectedBalances: { T1:50, T2:-50 },
    expectedSettlements: [
      { from:'T2', to:'T1', amount:50 },
    ],
  },

  // ── S5: Multi-payer expense ──────────────────────────────────────────────────
  // M1 paid 60, M2 paid 40 for a 100 expense — credit must split between them.
  // M1: +60 −25 = +35
  // M2: +40 −25 = +15
  // M3:   0 −26 = −26
  // M4:   0 −24 = −24
  {
    name: 'S5: Multi-payer expense',
    description: 'Two payers share one bill — expense_payers must attribute credit correctly',
    members: ['M1','M2','M3','M4'],
    expenses: [
      { desc:'Dinner', payers:[['M1',60],['M2',40]], splits:[['M1',25],['M2',25],['M3',26],['M4',24]] },
    ],
    expectedBalances: { M1:35, M2:15, M3:-26, M4:-24 },
    expectedSettlements: [
      { from:'M3', to:'M1', amount:26 },
      { from:'M4', to:'M1', amount:9  },
      { from:'M4', to:'M2', amount:15 },
    ],
  },
]

// ── Scenario runner ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runScenario(
  db: any,
  scenario: ScenarioDef
): Promise<{ name: string; description: string; passed: number; failed: number; failedChecks: { label: string; expected: string; actual: string }[] }> {

  let groupId: string | null = null
  const checks: { label: string; pass: boolean; expected: string; actual: string }[] = []

  function assert(label: string, expected: number, actual: number, tolerance = 0.005) {
    const pass = Math.abs(actual - expected) < tolerance
    checks.push({ label, pass, expected: String(expected), actual: String(Math.round(actual * 100) / 100) })
  }

  try {
    // 1. Create group
    const [group] = await db`
      INSERT INTO groups (name, code, currency)
      VALUES (${scenario.name}, 'test-tmp-' || substr(md5(random()::text), 1, 8), '€')
      RETURNING id`
    groupId = group.id

    // 2. Create members
    const memberIds: Record<string, string> = {}
    for (const name of scenario.members) {
      const [m] = await db`
        INSERT INTO members (group_id, name, is_admin)
        VALUES (${groupId}, ${name}, false)
        RETURNING id`
      memberIds[name] = m.id
    }

    // 3. Insert expenses
    for (const exp of scenario.expenses) {
      const totalAmount = exp.payers.reduce((s, [, a]) => s + a, 0)
      const primaryPayerId = memberIds[exp.payers[0][0]]
      const [e] = await db`
        INSERT INTO expenses (group_id, paid_by, amount, description, entered_by)
        VALUES (${groupId}, ${primaryPayerId}, ${totalAmount}, ${exp.desc}, ${primaryPayerId})
        RETURNING id`
      for (const [name, amt] of exp.payers) {
        await db`INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (${e.id}, ${memberIds[name]}, ${amt})`
      }
      for (const [name, amt] of exp.splits) {
        await db`INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (${e.id}, ${memberIds[name]}, ${-amt})`
      }
    }

    // 4. Compute balances using expense_payers (correct for single and multi-payer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [members, payers, splits] = await Promise.all([
      db`SELECT id, name FROM members WHERE group_id = ${groupId}`,
      db`SELECT ep.member_id, ep.amount FROM expense_payers ep WHERE ep.expense_id IN (SELECT id FROM expenses WHERE group_id = ${groupId})`,
      db`SELECT es.member_id, es.amount FROM expense_splits es WHERE es.expense_id IN (SELECT id FROM expenses WHERE group_id = ${groupId})`,
    ]) as [any[], any[], any[]]

    const paidBy: Record<string, number> = {}
    const owedBy: Record<string, number> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of payers as any[]) paidBy[p.member_id] = (paidBy[p.member_id] || 0) + Number(p.amount)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of splits as any[]) owedBy[s.member_id] = (owedBy[s.member_id] || 0) + Number(s.amount)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balances: MemberBalance[] = (members as any[]).map((m: any) => ({
      id: m.id, name: m.name, is_admin: false, group_id: groupId!,
      total_paid:  paidBy[m.id] || 0,
      total_owed:  owedBy[m.id] || 0,
      balance:    (paidBy[m.id] || 0) + (owedBy[m.id] || 0),
    }))

    // 5. Assert sum of balances = 0
    const balanceSum = balances.reduce((s, b) => s + b.balance, 0)
    assert('Sum of all balances = 0', 0, balanceSum)

    // 6. Assert each member's balance
    for (const b of balances) {
      const expected = scenario.expectedBalances[b.name]
      if (expected !== undefined) assert(`Balance: ${b.name}`, expected, b.balance)
    }

    // 7. Compute and assert settlements
    const transfers = calculateSettlements(balances)
    const nameById = Object.fromEntries(balances.map(b => [b.id, b.name]))

    // Count check
    const expectedCount = scenario.expectedSettlements.length
    if (transfers.length !== expectedCount) {
      checks.push({
        label: 'Settlement count',
        pass: false,
        expected: String(expectedCount),
        actual: String(transfers.length),
      })
    } else {
      for (let i = 0; i < scenario.expectedSettlements.length; i++) {
        const exp = scenario.expectedSettlements[i]
        const act = transfers[i]
        const fromName = nameById[act.from]
        const toName   = nameById[act.to]
        const label = `Settlement ${i+1}: ${exp.from}→${exp.to} €${exp.amount}`
        const pass = fromName === exp.from && toName === exp.to && Math.abs(act.amount - exp.amount) < 0.005
        checks.push({ label, pass, expected: `${exp.from}→${exp.to} €${exp.amount}`, actual: `${fromName}→${toName} €${Math.round(act.amount*100)/100}` })
      }
    }

  } finally {
    if (groupId) await db`DELETE FROM groups WHERE id = ${groupId}`
  }

  const passed = checks.filter(c => c.pass).length
  const failed  = checks.filter(c => !c.pass).length
  return {
    name: scenario.name,
    description: scenario.description,
    passed,
    failed,
    failedChecks: checks.filter(c => !c.pass).map(c => ({ label: c.label, expected: c.expected, actual: c.actual })),
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const adminId = searchParams.get('adminId')
  if (!adminId) return NextResponse.json({ error: 'Missing adminId' }, { status: 400 })

  const db = neon(process.env.DATABASE_URL!)

  const adminRows = await db`SELECT is_admin FROM members WHERE id = ${adminId} LIMIT 1`
  if (!adminRows[0]?.is_admin) return NextResponse.json({ error: 'Not an admin' }, { status: 403 })

  const results = []
  for (const scenario of SCENARIOS) {
    results.push(await runScenario(db, scenario))
  }

  const passed = results.reduce((s, r) => s + r.passed, 0)
  const failed  = results.reduce((s, r) => s + r.failed,  0)

  return NextResponse.json({ passed, failed, scenarios: results })
}
