import { neon } from '@neondatabase/serverless'
import { calculateSettlements } from '@/lib/settle'
import type { MemberBalance } from '@/types'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

type ExpenseDef = {
  desc: string
  payers: [string, number][]   // [memberName, positiveAmount]
  splits: [string, number][]   // [memberName, positiveAmount stored as negative]
}

type WaveDef = {
  label: string
  newMembers: string[]
  expenses: ExpenseDef[]
}

type ScenarioDef = {
  name: string
  description: string
  members: string[]
  expenses: ExpenseDef[]
  waves?: WaveDef[]  // if set, members/expenses come from waves (executed in order)
  expectedBalances: Record<string, number>
  expectedSettlements: { from: string; to: string; amount: number }[]
}

type StepMsg = { type: 'step'; text: string; status: 'info' | 'ok' | 'fail' }
type ResultMsg = { type: 'result'; passed: number; failed: number; scenarios: ScenarioSummary[] }
type Msg = StepMsg | ResultMsg

type ScenarioSummary = {
  name: string
  passed: number
  failed: number
  failedChecks: { label: string; expected: string; actual: string }[]
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS: ScenarioDef[] = [
  {
    name: 'S1: 7-member group (members join in two waves)',
    description: '3 members transact first; 4 more join and all 7 continue — zero-balance member, 5 settlements',
    members: ['Alice','Bob','Carol','Dave','Eve','Frank','Grace'],
    expenses: [],
    waves: [
      {
        label: 'Alice, Bob, Carol join',
        newMembers: ['Alice','Bob','Carol'],
        expenses: [
          { desc:'Coffee run', payers:[['Alice',30]], splits:[['Alice',10],['Bob',10],['Carol',10]] },
          { desc:'Lunch',      payers:[['Bob',60]],   splits:[['Alice',20],['Bob',20],['Carol',20]] },
          { desc:'Snacks',     payers:[['Carol',45]], splits:[['Alice',15],['Bob',15],['Carol',15]] },
        ],
      },
      {
        label: 'Dave, Eve, Frank, Grace join',
        newMembers: ['Dave','Eve','Frank','Grace'],
        expenses: [
          { desc:'Dinner',    payers:[['Alice',140]], splits:[['Alice',20],['Bob',20],['Carol',20],['Dave',20],['Eve',20],['Frank',20],['Grace',20]] },
          { desc:'Taxi',      payers:[['Bob',60]],    splits:[['Bob',20],['Carol',20],['Dave',20]] },
          { desc:'Hotel',     payers:[['Carol',90]],  splits:[['Alice',18],['Bob',18],['Carol',18],['Dave',18],['Eve',18]] },
          { desc:'Museum',    payers:[['Dave',55]],   splits:[['Alice',10],['Bob',15],['Dave',30]] },
          { desc:'Groceries', payers:[['Eve',42]],    splits:[['Eve',14],['Frank',14],['Grace',14]] },
          { desc:'Concert',   payers:[['Frank',119]], splits:[['Alice',17],['Bob',17],['Carol',17],['Dave',17],['Eve',17],['Frank',17],['Grace',17]] },
          { desc:'Spa',       payers:[['Grace',75]],  splits:[['Bob',25],['Carol',15],['Eve',20],['Grace',15]] },
        ],
      },
    ],
    expectedBalances: { Alice:60, Bob:-40, Carol:0, Dave:-50, Eve:-47, Frank:68, Grace:9 },
    expectedSettlements: [
      { from:'Dave', to:'Frank', amount:50 },
      { from:'Eve',  to:'Frank', amount:18 },
      { from:'Eve',  to:'Alice', amount:29 },
      { from:'Bob',  to:'Alice', amount:31 },
      { from:'Bob',  to:'Grace', amount:9  },
    ],
  },
  {
    name: 'S2: Rounding / decimal precision',
    description: '€10÷3 and €20÷3 — remainder cents distributed, one member zeroes out',
    members: ['R1','R2','R3'],
    expenses: [
      { desc:'Brunch', payers:[['R1',10]], splits:[['R1',3.33],['R2',3.34],['R3',3.33]] },
      { desc:'Coffee', payers:[['R2',20]], splits:[['R1',6.67],['R2',6.67],['R3',6.66]] },
    ],
    expectedBalances: { R1:0, R2:9.99, R3:-9.99 },
    expectedSettlements: [{ from:'R3', to:'R2', amount:9.99 }],
  },
  {
    name: 'S3: Pure debtor (never pays)',
    description: 'One member only ever owes — never the payer',
    members: ['Q1','Q2','Q3'],
    expenses: [
      { desc:'Rent',  payers:[['Q1',90]], splits:[['Q1',30],['Q2',30],['Q3',30]] },
      { desc:'Utils', payers:[['Q2',60]], splits:[['Q1',30],['Q2',30]] },
    ],
    expectedBalances: { Q1:30, Q2:0, Q3:-30 },
    expectedSettlements: [{ from:'Q3', to:'Q1', amount:30 }],
  },
  {
    name: 'S4: Two-person sanity check',
    description: 'Minimal case — one expense, two members, one settlement',
    members: ['T1','T2'],
    expenses: [
      { desc:'Lunch', payers:[['T1',100]], splits:[['T1',50],['T2',50]] },
    ],
    expectedBalances: { T1:50, T2:-50 },
    expectedSettlements: [{ from:'T2', to:'T1', amount:50 }],
  },
  {
    name: 'S5: Multi-payer expense',
    description: 'Two payers share one bill — expense_payers must credit each correctly',
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

async function runScenario(
  db: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  scenario: ScenarioDef,
  log: (text: string, status?: 'info' | 'ok' | 'fail') => void
): Promise<ScenarioSummary> {
  let groupId: string | null = null
  const failedChecks: { label: string; expected: string; actual: string }[] = []
  let passed = 0

  function check(label: string, expected: number, actual: number, tol = 0.005) {
    const ok = Math.abs(actual - expected) < tol
    const exp = String(expected)
    const act = String(Math.round(actual * 100) / 100)
    if (ok) {
      passed++
      log(`  ${label}: ${act} ✓`, 'ok')
    } else {
      failedChecks.push({ label, expected: exp, actual: act })
      log(`  ${label}: expected ${exp}, got ${act} ✗`, 'fail')
    }
  }

  try {
    // Create group
    const code = 'test-' + Math.random().toString(36).slice(2, 10)
    const [group] = await db`INSERT INTO groups (name, code, currency) VALUES (${scenario.name}, ${code}, '€') RETURNING id`
    groupId = group.id
    log(`Created group "${scenario.name}" (${code})`, 'ok')

    // Helper: add a single member
    const memberIds: Record<string, string> = {}
    const addMember = async (name: string) => {
      const [m] = await db`INSERT INTO members (group_id, name, is_admin) VALUES (${groupId}, ${name}, false) RETURNING id`
      memberIds[name] = m.id
      log(`  Added member: ${name}`, 'info')
    }

    // Helper: add a single expense
    const addExpense = async (exp: ExpenseDef) => {
      const totalAmount = exp.payers.reduce((s, [, a]) => s + a, 0)
      const primaryPayerId = memberIds[exp.payers[0][0]]
      const payerNames = exp.payers.map(([n, a]) => `${n} €${a}`).join(' + ')
      const splitNames = exp.splits.map(([n, a]) => `${n}=€${a}`).join(', ')
      log(`  Adding expense: "${exp.desc}" — paid by ${payerNames}, split: ${splitNames}`, 'info')
      const [e] = await db`INSERT INTO expenses (group_id, paid_by, amount, description, entered_by) VALUES (${groupId}, ${primaryPayerId}, ${totalAmount}, ${exp.desc}, ${primaryPayerId}) RETURNING id`
      for (const [name, amt] of exp.payers) {
        await db`INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (${e.id}, ${memberIds[name]}, ${amt})`
      }
      for (const [name, amt] of exp.splits) {
        await db`INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (${e.id}, ${memberIds[name]}, ${-amt})`
      }
    }

    if (scenario.waves) {
      for (const wave of scenario.waves) {
        log(`── ${wave.label} ──`, 'info')
        for (const name of wave.newMembers) await addMember(name)
        for (const exp of wave.expenses) await addExpense(exp)
      }
    } else {
      for (const name of scenario.members) await addMember(name)
      for (const exp of scenario.expenses) await addExpense(exp)
    }

    // Query balances via expense_payers (supports multi-payer)
    log('Querying balances from DB...', 'info')
    const [members, payers, splits] = await Promise.all([
      db`SELECT id, name FROM members WHERE group_id = ${groupId}`,
      db`SELECT ep.member_id, ep.amount FROM expense_payers ep WHERE ep.expense_id IN (SELECT id FROM expenses WHERE group_id = ${groupId})`,
      db`SELECT es.member_id, es.amount FROM expense_splits es WHERE es.expense_id IN (SELECT id FROM expenses WHERE group_id = ${groupId})`,
    ]) as [any[], any[], any[]] // eslint-disable-line @typescript-eslint/no-explicit-any

    const paidBy: Record<string, number> = {}
    const owedBy: Record<string, number> = {}
    for (const p of payers) paidBy[p.member_id] = (paidBy[p.member_id] || 0) + Number(p.amount)
    for (const s of splits) owedBy[s.member_id] = (owedBy[s.member_id] || 0) + Number(s.amount)

    const balances: MemberBalance[] = (members as any[]).map((m: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: m.id, name: m.name, is_admin: false, group_id: groupId!,
      total_paid:  paidBy[m.id] || 0,
      total_owed:  owedBy[m.id] || 0,
      balance:    (paidBy[m.id] || 0) + (owedBy[m.id] || 0),
    }))

    // Balance sum sanity
    const balanceSum = balances.reduce((s, b) => s + b.balance, 0)
    log('Verifying balances...', 'info')
    check('Sum of all balances = 0', 0, balanceSum)

    for (const b of balances) {
      const expected = scenario.expectedBalances[b.name]
      if (expected !== undefined) check(`Balance ${b.name}`, expected, b.balance)
    }

    // Settlements
    log('Running settlement algorithm...', 'info')
    const transfers = calculateSettlements(balances)
    const nameById = Object.fromEntries(balances.map(b => [b.id, b.name]))
    const expectedCount = scenario.expectedSettlements.length

    if (transfers.length !== expectedCount) {
      failedChecks.push({ label: 'Settlement count', expected: String(expectedCount), actual: String(transfers.length) })
      log(`  Settlement count: expected ${expectedCount}, got ${transfers.length} ✗`, 'fail')
    } else {
      log('Verifying settlements...', 'info')
      for (let i = 0; i < scenario.expectedSettlements.length; i++) {
        const exp = scenario.expectedSettlements[i]
        const act = transfers[i]
        const fromName = nameById[act.from]
        const toName   = nameById[act.to]
        const label = `Settlement ${i+1}: ${exp.from}→${exp.to} €${exp.amount}`
        const ok = fromName === exp.from && toName === exp.to && Math.abs(act.amount - exp.amount) < 0.005
        const actStr = `${fromName}→${toName} €${Math.round(act.amount*100)/100}`
        if (ok) {
          passed++
          log(`  ${label} ✓`, 'ok')
        } else {
          failedChecks.push({ label, expected: `${exp.from}→${exp.to} €${exp.amount}`, actual: actStr })
          log(`  ${label}: got ${actStr} ✗`, 'fail')
        }
      }
    }

  } finally {
    if (groupId) {
      await db`DELETE FROM groups WHERE id = ${groupId}`
      log(`Cleaned up group ${groupId.slice(0, 8)}…`, 'info')
    }
  }

  const failed = failedChecks.length
  log(
    failed === 0
      ? `✓ ${scenario.name}: all ${passed} checks passed`
      : `✗ ${scenario.name}: ${failed} checks failed`,
    failed === 0 ? 'ok' : 'fail'
  )

  return { name: scenario.name, passed, failed, failedChecks }
}

// ── Main handler (SSE streaming) ──────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const adminId = searchParams.get('adminId')
  if (!adminId) {
    return new Response('data: {"type":"error","text":"Missing adminId"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(msg: Msg) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
      }

      try {
        const db = neon(process.env.DATABASE_URL!)

        const adminRows = await db`SELECT is_admin FROM members WHERE id = ${adminId} LIMIT 1`
        if (!adminRows[0]?.is_admin) {
          send({ type: 'step', text: 'Error: not an admin', status: 'fail' })
          controller.close()
          return
        }

        const results: ScenarioSummary[] = []
        const total = SCENARIOS.length

        for (let i = 0; i < SCENARIOS.length; i++) {
          const scenario = SCENARIOS[i]
          send({ type: 'step', text: `── Scenario ${i+1}/${total}: ${scenario.name} ──`, status: 'info' })
          send({ type: 'step', text: scenario.description, status: 'info' })

          const summary = await runScenario(db, scenario, (text, status = 'info') => {
            send({ type: 'step', text, status })
          })
          results.push(summary)
        }

        const totalPassed = results.reduce((s, r) => s + r.passed, 0)
        const totalFailed = results.reduce((s, r) => s + r.failed, 0)

        send({ type: 'step', text: '── Complete ──', status: 'info' })
        send({ type: 'result', passed: totalPassed, failed: totalFailed, scenarios: results })
      } catch (err) {
        send({ type: 'step', text: `Fatal error: ${err instanceof Error ? err.message : String(err)}`, status: 'fail' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
