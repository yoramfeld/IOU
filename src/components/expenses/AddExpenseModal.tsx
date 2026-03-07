'use client'

import { useState, useEffect, useRef } from 'react'
import type { Member } from '@/types'

interface Props {
  members: Member[]
  currentMemberId: string
  isAdmin: boolean
  currency: string
  memberBalances?: Record<string, number>
  onSubmit: (data: {
    paidBy: string
    amount: number
    description: string
    splitAmong: string[]
    customSplits?: { memberId: string; amount: number }[]
    payers: { memberId: string; amount: number }[]
  }) => Promise<void>
  onClose: () => void
}

const TIP_OPTIONS = [0, 10, 12, 15]

function readSavedTip(): number {
  try { return parseInt(localStorage.getItem('iou_tip_pct') || '0', 10) || 0 } catch { return 0 }
}

export default function AddExpenseModal({ members, currentMemberId, isAdmin, currency, memberBalances, onSubmit, onClose }: Props) {
  // Sort by biggest debt first (most negative balance), randomize ties — fixed on open
  const [sortedMembers] = useState<Member[]>(() => {
    const shuffled = [...members].sort(() => Math.random() - 0.5)
    return shuffled.sort((a, b) => (memberBalances?.[a.id] ?? 0) - (memberBalances?.[b.id] ?? 0))
  })

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [tipPct, setTipPct] = useState(readSavedTip)
  const [roundUp, setRoundUp] = useState(true)
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [tipIncAmounts, setTipIncAmounts] = useState<Record<string, string>>({})
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>({})
  const [calcOpen, setCalcOpen] = useState<string | null>(null)
  const [calcExpr, setCalcExpr] = useState('')
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function fmt(n: number) {
    return n.toFixed(2).replace(/\.?0+$/, '')
  }

  function selectAll(e: React.FocusEvent<HTMLInputElement>) {
    const el = e.target
    setTimeout(() => el.select(), 0)
  }

  // Disable browser back button while modal is open
  useEffect(() => {
    // Push two states so a rapid double-tap of Back is also absorbed
    window.history.pushState(null, '', window.location.href)
    window.history.pushState(null, '', window.location.href)
    const onPop = () => window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function parseSum(expr: string): number {
    return expr.split('+').reduce((s, v) => s + (parseFloat(v.trim()) || 0), 0)
  }

  // Tip inc. — exact proportional share of the grand total per member.
  // Stored to 4 decimal places so balances accumulate without systematic bias.
  // Display separately rounds to integer.
  function computeTipInc(ordered: Record<string, string>, pct: number, ru: boolean): Record<string, string> {
    const ids = Object.keys(ordered)
    const amounts = ids.map(id => parseFloat(ordered[id]) || 0)
    const totalOrdered = amounts.reduce((s, v) => s + v, 0)
    const tipInc: Record<string, string> = {}
    for (const id of ids) tipInc[id] = ''
    if (totalOrdered <= 0) return tipInc

    const rawGrand = Math.round(totalOrdered * (1 + pct / 100) * 100) / 100
    const grandTotal = ru ? Math.ceil(rawGrand) : Math.round(rawGrand)
    if (grandTotal <= 0) return tipInc

    for (let i = 0; i < ids.length; i++) {
      if (amounts[i] <= 0) continue
      // Store exact share to 4 decimal places — no integer rounding here
      const exact = Math.round(amounts[i] / totalOrdered * grandTotal * 10000) / 10000
      tipInc[ids[i]] = String(exact)
    }
    return tipInc
  }

  function handleTipChange(pct: number) {
    setTipPct(pct)
    try { localStorage.setItem('iou_tip_pct', String(pct)) } catch {}
    setTipIncAmounts(computeTipInc(customAmounts, pct, roundUp))
  }

  // Cascade ceiled distribution; also recomputes tipIncAmounts
  function handleOrderedChange(pivotIdx: number, pivotMemberId: string, rawValue: string) {
    const val = parseFloat(rawValue) || 0
    const ceiled = val > 0 ? Math.ceil(val) : 0
    const bRef = parseFloat(amount) || 0

    const newOrdered: Record<string, string> = { ...customAmounts, [pivotMemberId]: ceiled > 0 ? String(ceiled) : '' }
    if (bRef > 0) {
      const fixedSum = sortedMembers.slice(0, pivotIdx).reduce((s, m) => s + (parseFloat(customAmounts[m.id]) || 0), 0)
      const remaining = bRef - fixedSum - ceiled
      const following = sortedMembers.slice(pivotIdx + 1)
      if (remaining > 0 && following.length > 0) {
        const exactShare = Math.round(remaining / following.length * 10000) / 10000
        for (const m of following) newOrdered[m.id] = String(exactShare)
      } else {
        for (const m of following) newOrdered[m.id] = ''
      }
    }
    setCustomAmounts(newOrdered)
    setTipIncAmounts(computeTipInc(newOrdered, tipPct, roundUp))
  }

  function handleBillChange(value: string) {
    setAmount(value)
    const billRef = parseFloat(value) || 0
    if (billRef > 0) {
      const exactShare = Math.round(billRef / sortedMembers.length * 10000) / 10000
      const newAmounts: Record<string, string> = {}
      for (const m of sortedMembers) newAmounts[m.id] = String(exactShare)
      setCustomAmounts(newAmounts)
      setTipIncAmounts(computeTipInc(newAmounts, tipPct, roundUp))
    } else {
      setCustomAmounts({})
      setTipIncAmounts({})
    }
  }

  // --- Totals ---
  const subtotal = Object.values(customAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const finalTotal = Object.values(tipIncAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const tipAmount = finalTotal - subtotal

  // --- Split (uses tipIncAmounts as the authoritative per-person totals) ---
  const computedCustomSplits = sortedMembers
    .filter(m => (parseFloat(tipIncAmounts[m.id]) || 0) > 0)
    .map(m => ({ memberId: m.id, amount: parseFloat(tipIncAmounts[m.id]) || 0 }))

  // --- Ordered unassigned (vs bill) ---
  const billVal = parseFloat(amount) || 0
  const orderedUnassigned = billVal > 0 ? Math.round((billVal - subtotal) * 100) / 100 : 0

  // --- Paid ---
  const totalPaid = sortedMembers.reduce((s, m) => s + (parseFloat(paidAmounts[m.id]) || 0), 0)
  const unassigned = Math.round((finalTotal - totalPaid) * 100) / 100

  const payers = sortedMembers
    .filter(m => (parseFloat(paidAmounts[m.id]) || 0) > 0)
    .map(m => ({ memberId: m.id, amount: Math.round(parseFloat(paidAmounts[m.id]) * 100) / 100 }))

  const paidBy = payers[0]?.memberId ?? currentMemberId

  async function handleSubmit() {
    if (!description.trim()) { setError('Enter a description'); return }
    if (computedCustomSplits.length === 0) { setError('Enter at least one ordered amount'); return }
    if (payers.length === 0) { setError('Enter who paid'); return }
    if (unassigned !== 0) {
      setError(unassigned > 0
        ? `${currency}${unassigned} still unassigned`
        : `Paid exceeds total by ${currency}${-unassigned}`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onSubmit({
        paidBy,
        amount: finalTotal,
        description: description.trim(),
        splitAmong: computedCustomSplits.map(s => s.memberId),
        customSplits: computedCustomSplits,
        payers,
      })
      onClose()
    } catch {
      setError('Failed to add expense')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add expense</h2>
          <button onClick={onClose} className="text-ink-muted text-xl leading-none">&times;</button>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-ink-soft block mb-2">Description</label>
          <input
            className="input"
            placeholder="What was it for?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onFocus={selectAll}
            autoFocus
          />
        </div>

        {/* Bill | Tip | Total+Roundup */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-ink-soft block mb-2">Bill</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted text-xs">{currency}</span>
              <input
                className="input pl-5 pr-1"
                type="number"
                step="any"
                min="0"
                placeholder="0"
                value={amount}
                onFocus={selectAll}
                onChange={e => handleBillChange(e.target.value)}
              />
            </div>
          </div>
          <div className="w-[22%]">
            <label className="text-xs font-medium text-ink-soft block mb-2">Tip</label>
            <select
              className="input px-2"
              value={tipPct}
              onChange={e => handleTipChange(Number(e.target.value))}
            >
              {TIP_OPTIONS.map(pct => (
                <option key={pct} value={pct}>{pct}%</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-medium text-ink-soft">Tip inc.</span>
              <button
                type="button"
                onClick={() => {
                  const ru = !roundUp
                  setRoundUp(ru)
                  setTipIncAmounts(computeTipInc(customAmounts, tipPct, ru))
                }}
                title={roundUp ? 'Round up on' : 'Round up off'}
                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  roundUp ? 'bg-accent border-accent' : 'border-ink-muted bg-white'
                }`}
              >
                {roundUp && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
              </button>
            </div>
            <input
              className="input py-3 text-sm font-semibold text-right bg-surface"
              type="text"
              readOnly
              value={finalTotal > 0 ? String(Math.round(finalTotal)) : ''}
              placeholder=""
            />
          </div>
        </div>

        {/* Member table: Ordered | Tip inc. | Paid */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="flex-1" />
            <span className="w-20 shrink-0 text-xs font-medium text-ink-soft text-center">Ordered</span>
            <span className="w-10 shrink-0 text-xs font-medium text-ink-soft text-center">Tip</span>
            <span className="w-20 shrink-0 text-xs font-medium text-ink-soft text-center">Paid</span>
          </div>

          <div className="space-y-2">
            {sortedMembers.map((m, memberIdx) => {
              const label = m.name + (m.id === currentMemberId ? ' (you)' : '')
              function openCalc() { setCalcOpen(m.id); setCalcExpr('') }
              return (
                <div key={m.id} className="flex items-center gap-1.5">
                  <span className="text-xs flex-1 truncate min-w-0">{label}</span>

                  {/* Ordered — disabled until bill is set; no spinners; cascade; double-click/long-press opens calc */}
                  {(() => {
                    const raw = parseFloat(customAmounts[m.id] || '') || 0
                    const rounded2 = Math.round(raw * 100) / 100
                    const isApprox = raw > 0 && Math.abs(raw - rounded2) > 1e-9
                    const displayVal = raw > 0 ? String(rounded2) : (customAmounts[m.id] ?? '')
                    return (
                      <div className="relative w-20 shrink-0">
                        {isApprox && (
                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-muted text-[11px] select-none">~</span>
                        )}
                        <input
                          className={`input no-spinner py-1.5 text-sm w-full ${isApprox ? 'pl-5' : 'pl-3'} ${!billVal ? 'opacity-40 pointer-events-none' : ''}`}
                          type="number"
                          step="any"
                          min="0"
                          placeholder="0"
                          disabled={!billVal}
                          value={displayVal}
                          onFocus={selectAll}
                          onChange={e => handleOrderedChange(memberIdx, m.id, e.target.value)}
                          onDoubleClick={openCalc}
                          onPointerDown={() => { longPressTimer.current = setTimeout(openCalc, 500) }}
                          onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                          onPointerCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                        />
                      </div>
                    )
                  })()}

                  {/* Tip inc. — read-only, greyed, narrow; 2 decimal places with ~ if rounded */}
                  {(() => {
                    const raw = parseFloat(tipIncAmounts[m.id] || '') || 0
                    const rounded2 = Math.round(raw * 100) / 100
                    const isApprox = raw > 0 && Math.abs(raw - rounded2) > 1e-9
                    return (
                      <div className="w-10 shrink-0 text-center">
                        <span className="text-[10px] text-ink-muted">
                          {raw > 0 ? (isApprox ? `~${rounded2}` : String(rounded2)) : ''}
                        </span>
                      </div>
                    )
                  })()}

                  {/* Paid — ceil on blur; snap to ceil(unassigned) on focus */}
                  <div className="relative w-20 shrink-0">
                    <input
                      className="input pl-3 py-1.5 text-sm w-full"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={paidAmounts[m.id] ?? ''}
                      onFocus={e => {
                        if (unassigned > 0) setPaidAmounts(prev => ({ ...prev, [m.id]: String(Math.ceil(unassigned)) }))
                        selectAll(e)
                      }}
                      onChange={e => setPaidAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                      onBlur={e => {
                        const val = parseFloat(e.target.value)
                        if (val > 0) setPaidAmounts(prev => ({ ...prev, [m.id]: String(Math.ceil(val)) }))
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Per-column left/over indicators */}
          {(orderedUnassigned !== 0 || unassigned !== 0) && (
            <div className="flex justify-end mt-1 gap-1.5">
              <span className="w-20 shrink-0 text-xs text-center text-ink-muted">
                {orderedUnassigned !== 0 ? (orderedUnassigned > 0 ? `${orderedUnassigned} left` : `+${-orderedUnassigned} over`) : ''}
              </span>
              <span className="w-10 shrink-0" />
              <span className="w-20 shrink-0 text-xs text-center text-ink-muted">
                {unassigned !== 0 && finalTotal > 0 ? (unassigned > 0 ? `${unassigned} left` : `+${-unassigned} over`) : ''}
              </span>
            </div>
          )}
        </div>

        {error && <p className="text-red text-sm">{error}</p>}

        {/* Calculator modal */}
        {calcOpen && (() => {
          const calcSum = parseSum(calcExpr)
          const calcMemberIdx = members.findIndex(m => m.id === calcOpen)
          const memberName = members[calcMemberIdx]?.name ?? ''
          function applyCalc() {
            if (calcSum > 0) handleOrderedChange(calcMemberIdx, calcOpen!, String(calcSum))
            setCalcOpen(null); setCalcExpr('')
          }
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
              onClick={() => { setCalcOpen(null); setCalcExpr('') }}
            >
              <div className="bg-white rounded-2xl p-5 w-72 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
                <p className="text-sm font-semibold">{memberName} — Ordered</p>
                <input
                  className="input text-center text-base"
                  type="text"
                  placeholder="15 + 8 + 12"
                  value={calcExpr}
                  autoFocus
                  onChange={e => setCalcExpr(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') applyCalc()
                    if (e.key === 'Escape') { setCalcOpen(null); setCalcExpr('') }
                  }}
                />
                {calcExpr && (
                  <p className="text-center text-2xl font-bold text-accent">
                    {calcSum > 0 ? `${currency}${fmt(calcSum)}` : '—'}
                  </p>
                )}
                <div className="flex gap-2">
                  <button className="btn btn-outline btn-sm flex-1" onClick={() => { setCalcOpen(null); setCalcExpr('') }}>Cancel</button>
                  <button className="btn btn-primary btn-sm flex-1" disabled={calcSum <= 0} onClick={applyCalc}>Use {calcSum > 0 ? fmt(calcSum) : ''}</button>
                </div>
              </div>
            </div>
          )
        })()}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`btn ${
            payers.length > 0 && unassigned !== 0
              ? 'btn-danger'
              : description.trim() && computedCustomSplits.length > 0 && payers.length > 0
                ? 'btn-success'
                : 'btn-primary'
          }`}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
