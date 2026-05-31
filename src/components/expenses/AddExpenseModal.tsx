'use client'

import { useState, useEffect, useRef } from 'react'
import type { Member } from '@/types'

interface EditExpenseData {
  description: string
  amount: number
  payers: { memberId: string; amount: number }[]
  splits: { memberId: string; amount: number }[]
}

interface Props {
  members: Member[]
  currentMemberId: string
  isAdmin: boolean
  currency: string
  memberBalances?: Record<string, number>
  settledMemberIds?: Set<string>
  editExpense?: EditExpenseData
  onSubmit: (data: {
    paidBy: string
    amount: number
    description: string
    splitAmong: string[]
    customSplits?: { memberId: string; amount: number }[]
    payers: { memberId: string; amount: number }[]
    receiptUrl?: string
  }) => Promise<void>
  onClose: () => void
}

const TIP_OPTIONS = [0, 10, 12, 15]

function readSavedTip(): number {
  try { return parseInt(localStorage.getItem('iou_tip_pct') || '0', 10) || 0 } catch { return 0 }
}

export default function AddExpenseModal({ members, currentMemberId, isAdmin, currency, memberBalances, settledMemberIds, editExpense, onSubmit, onClose }: Props) {
  // Sort by biggest debt first (most negative balance), randomize ties — fixed on open
  const [sortedMembers] = useState<Member[]>(() => {
    const shuffled = [...members].sort(() => Math.random() - 0.5)
    return shuffled.sort((a, b) => (memberBalances?.[a.id] ?? 0) - (memberBalances?.[b.id] ?? 0))
  })

  const [description, setDescription] = useState(editExpense?.description ?? '')
  const [amount, setAmount] = useState(editExpense ? String(editExpense.amount) : '')
  const [tipPct, setTipPct] = useState(editExpense ? 0 : readSavedTip)
  const [roundUp, setRoundUp] = useState(editExpense ? false : true)
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() => {
    if (!editExpense) return {}
    const amounts: Record<string, string> = {}
    for (const s of editExpense.splits) amounts[s.memberId] = String(Math.abs(s.amount))
    return amounts
  })
  const [tipIncAmounts, setTipIncAmounts] = useState<Record<string, string>>(() => {
    if (!editExpense) return {}
    const amounts: Record<string, string> = {}
    for (const s of editExpense.splits) amounts[s.memberId] = String(Math.abs(s.amount))
    return amounts
  })
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>(() => {
    if (!editExpense) return {}
    const amounts: Record<string, string> = {}
    for (const p of editExpense.payers) amounts[p.memberId] = String(p.amount)
    return amounts
  })
  const [calcOpen, setCalcOpen] = useState<string | null>(null)
  const [calcExpr, setCalcExpr] = useState('')
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    if (editExpense) {
      const splitIds = new Set(editExpense.splits.map(s => s.memberId))
      return new Set(members.filter(m => !splitIds.has(m.id)).map(m => m.id))
    }
    // Default-exclude members who have settled (zero balance after a settlement)
    return new Set(members.filter(m => settledMemberIds?.has(m.id)).map(m => m.id))
  })
  const [isManualSplit, setIsManualSplit] = useState(!!editExpense)
  const [focusedOrderedId, setFocusedOrderedId] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showError(msg: string) {
    setError(msg)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(''), 2000)
  }

  function toggleExclude(memberId: string) {
    const next = new Set(excluded)
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId)
    setExcluded(next)

    const billRef = parseFloat(amount) || 0
    if (billRef > 0 && !isManualSplit) {
      const active = sortedMembers.filter(m => !next.has(m.id))
      const share = active.length > 0 ? Math.round(billRef / active.length * 10000) / 10000 : 0
      const newAmounts: Record<string, string> = {}
      for (const m of sortedMembers)
        newAmounts[m.id] = next.has(m.id) ? '' : String(share)
      setCustomAmounts(newAmounts)
      setTipIncAmounts(computeTipInc(newAmounts, tipPct, roundUp))
    }
    if (next.has(memberId)) {
      setPaidAmounts(prev => ({ ...prev, [memberId]: '' }))
      if (isManualSplit) {
        setCustomAmounts(prev => ({ ...prev, [memberId]: '' }))
        setTipIncAmounts(prev => ({ ...prev, [memberId]: '' }))
      }
    }
  }

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

  function handleOrderedChange(pivotIdx: number, pivotMemberId: string, rawValue: string) {
    if (!isManualSplit) {
      // First manual edit: clear all others, enter manual mode
      setIsManualSplit(true)
      const newAmounts: Record<string, string> = {}
      for (const m of sortedMembers) newAmounts[m.id] = ''
      newAmounts[pivotMemberId] = rawValue
      setCustomAmounts(newAmounts)
      setTipIncAmounts(computeTipInc(newAmounts, tipPct, roundUp))
    } else {
      // Manual mode: just update this person, no cascade
      const newAmounts = { ...customAmounts, [pivotMemberId]: rawValue }
      setCustomAmounts(newAmounts)
      setTipIncAmounts(computeTipInc(newAmounts, tipPct, roundUp))
    }
  }

  function handleOrderedBlur(memberId: string) {
    const val = parseFloat(customAmounts[memberId] || '') || 0
    if (val > 0) {
      const rounded = String(Math.round(val * 100) / 100)
      const newAmounts = { ...customAmounts, [memberId]: rounded }
      setCustomAmounts(newAmounts)
      setTipIncAmounts(computeTipInc(newAmounts, tipPct, roundUp))
    }
  }

  function handleBillChange(value: string) {
    setAmount(value)
    setIsManualSplit(false)
    const billRef = parseFloat(value) || 0
    if (billRef > 0) {
      const active = sortedMembers.filter(m => !excluded.has(m.id))
      const share = active.length > 0 ? Math.round(billRef / active.length * 10000) / 10000 : 0
      const newAmounts: Record<string, string> = {}
      for (const m of sortedMembers) newAmounts[m.id] = excluded.has(m.id) ? '' : String(share)
      setCustomAmounts(newAmounts)
      setTipIncAmounts(computeTipInc(newAmounts, tipPct, roundUp))
    } else {
      setCustomAmounts({})
      setTipIncAmounts({})
    }
  }

  // --- Totals ---
  const billVal = parseFloat(amount) || 0
  const subtotal = Object.values(customAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  // Base the grand total on the bill (stable), not the running ordered sum
  const finalTotal = billVal > 0
    ? (() => { const cents = Math.round(billVal * (1 + tipPct / 100) * 100) / 100; return roundUp ? Math.ceil(cents) : Math.round(cents) })()
    : Object.values(tipIncAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const tipAmount = finalTotal - subtotal

  // --- Split (uses tipIncAmounts as the authoritative per-person totals) ---
  const computedCustomSplits = sortedMembers
    .filter(m => (parseFloat(tipIncAmounts[m.id]) || 0) > 0)
    .map(m => ({ memberId: m.id, amount: parseFloat(tipIncAmounts[m.id]) || 0 }))

  // --- Ordered unassigned (vs bill) ---
  const orderedUnassigned = billVal > 0 ? Math.round((billVal - subtotal) * 100) / 100 : 0

  // --- Paid ---
  const totalPaid = sortedMembers.reduce((s, m) => s + (parseFloat(paidAmounts[m.id]) || 0), 0)
  const unassigned = Math.round((finalTotal - totalPaid) * 100) / 100

  const payers = sortedMembers
    .filter(m => (parseFloat(paidAmounts[m.id]) || 0) > 0)
    .map(m => ({ memberId: m.id, amount: Math.round(parseFloat(paidAmounts[m.id]) * 100) / 100 }))

  const paidBy = payers[0]?.memberId ?? currentMemberId

  async function handleSubmit() {
    if (!description.trim()) { showError('Enter a description'); return }
    if (computedCustomSplits.length === 0) { showError('Enter at least one ordered amount'); return }
    if (billVal > 0 && orderedUnassigned !== 0) {
      showError(orderedUnassigned > 0
        ? `${currency}${orderedUnassigned} missing`
        : `${currency}${-orderedUnassigned} over`)
      return
    }
    if (payers.length === 0) { showError('Enter who paid'); return }
    if (unassigned !== 0) {
      showError(unassigned > 0
        ? `${currency}${unassigned} missing`
        : `${currency}${-unassigned} over`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      let receiptUrl: string | undefined
      if (receiptFile) {
        const fd = new FormData()
        fd.append('file', receiptFile)
        const uploadRes = await fetch('/api/expenses/upload', { method: 'POST', body: fd })
        if (!uploadRes.ok) { showError('Failed to upload receipt'); setSubmitting(false); return }
        receiptUrl = (await uploadRes.json()).url
      }
      await onSubmit({
        paidBy,
        amount: finalTotal,
        description: description.trim(),
        splitAmong: computedCustomSplits.map(s => s.memberId),
        customSplits: computedCustomSplits,
        payers,
        receiptUrl,
      })
      onClose()
    } catch {
      showError(editExpense ? 'Failed to save expense' : 'Failed to add expense')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center">
      <div className="bg-white rounded-t-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{editExpense ? 'Edit expense' : 'Add expense'}</h2>
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

        {/* Receipt attachment (creation only) */}
        {!editExpense && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => setReceiptFile(e.target.files?.[0] ?? null)}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => setReceiptFile(e.target.files?.[0] ?? null)}
            />
            {receiptFile ? (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="shrink-0 text-ink-muted" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1" y="5" width="18" height="13" rx="2"/>
                  <circle cx="10" cy="11.5" r="3.5"/>
                  <path d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1"/>
                </svg>
                <span className="text-xs text-ink-muted truncate flex-1">{receiptFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                    if (cameraInputRef.current) cameraInputRef.current.value = ''
                  }}
                  className="text-xs text-red shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 text-xs text-ink-soft border border-border rounded-lg px-3 py-2 flex-1"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="1" y="5" width="18" height="13" rx="2"/>
                    <circle cx="10" cy="11.5" r="3.5"/>
                    <path d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1"/>
                  </svg>
                  Gallery
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 text-xs text-ink-soft border border-border rounded-lg px-3 py-2 flex-1"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                    <circle cx="12" cy="13" r="3"/>
                  </svg>
                  Camera
                </button>
              </div>
            )}
          </div>
        )}

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
              <span className="text-xs font-medium text-ink-soft">To pay</span>
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
            <span className="w-14 shrink-0 text-xs font-medium text-ink-soft text-center">To pay</span>
            <span className="w-20 shrink-0 text-xs font-medium text-ink-soft text-center">Paid</span>
          </div>

          <div className="space-y-2">
            {sortedMembers.map((m, memberIdx) => {
              const label = m.name + (m.id === currentMemberId ? ' (you)' : '')
              function openCalc() { setCalcOpen(m.id); setCalcExpr('') }
              return (
                <div key={m.id} className={`flex items-center gap-1.5 transition-opacity ${excluded.has(m.id) ? 'opacity-40' : ''}`}>
                  <span
                    onClick={() => toggleExclude(m.id)}
                    className={`text-xs flex-1 truncate min-w-0 cursor-pointer select-none transition-opacity
                      ${excluded.has(m.id) ? 'line-through' : 'active:opacity-60'}`}
                  >
                    {label}
                  </span>

                  {/* Ordered — disabled until bill is set; no spinners; cascade; double-click/long-press opens calc */}
                  {(() => {
                    const raw = parseFloat(customAmounts[m.id] || '') || 0
                    const rounded2 = Math.round(raw * 100) / 100
                    const isFocused = focusedOrderedId === m.id
                    const isApprox = raw > 0 && Math.abs(raw - rounded2) > 1e-9
                    const displayVal = isFocused ? (customAmounts[m.id] ?? '') : (raw > 0 ? String(rounded2) : '')
                    return (
                      <div className="relative w-20 shrink-0">
                        {isApprox && !isFocused && (
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs leading-none select-none pointer-events-none">…</span>
                        )}
                        <input
                          className={`input no-spinner py-1.5 text-sm text-right w-full pl-3 ${isApprox && !isFocused ? 'pr-4' : 'pr-2'} ${!billVal || excluded.has(m.id) ? 'opacity-40 pointer-events-none' : ''}`}
                          type="number"
                          step="any"
                          min="0"
                          placeholder="0"
                          disabled={!billVal || excluded.has(m.id)}
                          value={displayVal}
                          onFocus={e => { setFocusedOrderedId(m.id); selectAll(e) }}
                          onChange={e => handleOrderedChange(memberIdx, m.id, e.target.value)}
                          onBlur={() => { setFocusedOrderedId(null); handleOrderedBlur(m.id) }}
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
                      <div className="w-14 shrink-0 text-center">
                        <span className="text-[10px] text-ink-muted">
                          {raw > 0 ? (isApprox ? `${currency}${rounded2}…` : `${currency}${rounded2}`) : ''}
                        </span>
                      </div>
                    )
                  })()}

                  {/* Paid — ceil on blur; snap to ceil(unassigned) on focus */}
                  <div className="relative w-20 shrink-0">
                    <input
                      className={`input pl-3 pr-2 py-1.5 text-sm text-right w-full ${excluded.has(m.id) ? 'opacity-40 pointer-events-none' : ''}`}
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      disabled={excluded.has(m.id)}
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
                {orderedUnassigned !== 0 ? (orderedUnassigned > 0 ? `${currency}${orderedUnassigned} missing` : `${currency}${-orderedUnassigned} over`) : ''}
              </span>
              <span className="w-14 shrink-0" />
              <span className="w-20 shrink-0 text-xs text-center text-ink-muted">
                {unassigned !== 0 && finalTotal > 0 ? (unassigned > 0 ? `${currency}${unassigned} missing` : `${currency}${-unassigned} over`) : ''}
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
          {submitting ? 'Saving...' : editExpense ? 'Save' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
