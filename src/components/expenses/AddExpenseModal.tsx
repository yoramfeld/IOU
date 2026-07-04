'use client'

import { useState, useEffect, useRef } from 'react'
import type { Member } from '@/types'

interface ReceiptPayload {
  imageUrl: string
  cloudinaryPublicId: string
  rawOcrJson?: unknown
  total: number | null
  items: { description: string; amount: number }[]
}

interface Props {
  groupId: string
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
    receipt?: ReceiptPayload
  }) => Promise<void>
  onClose: () => void
}

const TIP_OPTIONS = [0, 10, 12, 15]

function readSavedTip(): number {
  try { return parseInt(localStorage.getItem('iou_tip_pct') || '0', 10) || 0 } catch { return 0 }
}

export default function AddExpenseModal({ groupId, members, currentMemberId, isAdmin, currency, memberBalances, onSubmit, onClose }: Props) {
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
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [isManualSplit, setIsManualSplit] = useState(false)
  const [focusedOrderedId, setFocusedOrderedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Receipt upload / OCR — all optional, additive to the flow above.
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null)
  const [cloudinaryPublicId, setCloudinaryPublicId] = useState<string | null>(null)
  const [receiptItems, setReceiptItems] = useState<{ description: string; amount: string }[]>([])
  const [ocrRaw, setOcrRaw] = useState<unknown>(null)
  const [receiptStatus, setReceiptStatus] = useState<'idle' | 'uploading' | 'scanning' | 'error'>('idle')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function showError(msg: string) {
    setError(msg)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(''), 2000)
  }

  // Downscale to keep the upload light and speed up OCR; still legible for row totals.
  function compressImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const maxDim = 1600
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas unavailable')); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('compression failed')), 'image/jpeg', 0.8)
      }
      img.onerror = () => reject(new Error('failed to load image'))
      img.src = url
    })
  }

  function uploadToCloudinary(blob: Blob, params: { signature: string; timestamp: number; folder: string; apiKey: string; cloudName: string }): Promise<{ secure_url: string; public_id: string }> {
    return new Promise((resolve, reject) => {
      const form = new FormData()
      form.append('file', blob)
      form.append('api_key', params.apiKey)
      form.append('timestamp', String(params.timestamp))
      form.append('signature', params.signature)
      form.append('folder', params.folder)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${params.cloudName}/image/upload`)
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
        else reject(new Error('Cloudinary upload failed'))
      }
      xhr.onerror = () => reject(new Error('Cloudinary upload failed'))
      xhr.send(form)
    })
  }

  async function handleReceiptFile(file: File) {
    setReceiptStatus('uploading')
    try {
      const compressed = await compressImage(file)
      const signRes = await fetch('/api/receipts/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, memberId: currentMemberId }),
      })
      if (!signRes.ok) throw new Error('sign failed')
      const signData = await signRes.json()
      const uploaded = await uploadToCloudinary(compressed, signData)

      setReceiptImageUrl(uploaded.secure_url)
      setCloudinaryPublicId(uploaded.public_id)
      setReceiptStatus('scanning')

      const ocrRes = await fetch('/api/receipts/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, memberId: currentMemberId, imageUrl: uploaded.secure_url }),
      })
      if (!ocrRes.ok) throw new Error('ocr failed')
      const ocrData: { items: { description: string; amount: number }[]; total: number | null; raw: unknown } = await ocrRes.json()

      setReceiptItems(ocrData.items.map(it => ({ description: it.description, amount: String(it.amount) })))
      setOcrRaw(ocrData.raw)
      if (ocrData.total && !amount) handleBillChange(String(ocrData.total))
      setReceiptStatus('idle')
    } catch {
      setReceiptStatus('error')
      showError('Could not scan receipt')
    }
  }

  function updateReceiptItem(idx: number, field: 'description' | 'amount', value: string) {
    setReceiptItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  function removeReceiptItem(idx: number) {
    setReceiptItems(prev => prev.filter((_, i) => i !== idx))
  }

  function addReceiptItem() {
    setReceiptItems(prev => [...prev, { description: `Row ${prev.length + 1}`, amount: '' }])
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

  // --- Receipt items vs bill ---
  const itemsTotal = receiptItems.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0)
  const itemsOvershoot = receiptItems.length > 0 && billVal > 0 ? Math.round((itemsTotal - billVal) * 100) / 100 : 0

  async function handleSubmit() {
    if (!description.trim()) { showError('Enter a description'); return }
    if (computedCustomSplits.length === 0) { showError('Enter at least one ordered amount'); return }
    if (billVal > 0 && orderedUnassigned !== 0) {
      showError(orderedUnassigned > 0
        ? `${currency}${orderedUnassigned} missing`
        : `${currency}${-orderedUnassigned} over`)
      return
    }
    if (itemsOvershoot > 0) { showError(`Items exceed bill by ${currency}${itemsOvershoot}`); return }
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
      const validReceiptItems = receiptItems.filter(it => (parseFloat(it.amount) || 0) > 0)
      const receipt: ReceiptPayload | undefined = receiptImageUrl && cloudinaryPublicId
        ? {
            imageUrl: receiptImageUrl,
            cloudinaryPublicId,
            rawOcrJson: ocrRaw,
            total: billVal > 0 ? billVal : null,
            // Manual split overrides and itemized-consumption review are mutually exclusive
            items: isManualSplit ? [] : validReceiptItems.map(it => ({ description: it.description, amount: parseFloat(it.amount) })),
          }
        : undefined
      await onSubmit({
        paidBy,
        amount: finalTotal,
        description: description.trim(),
        splitAmong: computedCustomSplits.map(s => s.memberId),
        customSplits: computedCustomSplits,
        payers,
        receipt,
      })
      onClose()
    } catch {
      showError('Failed to add expense')
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
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-ink-soft">Description</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={receiptStatus === 'uploading' || receiptStatus === 'scanning'}
              className="text-xs text-accent font-medium disabled:opacity-50"
            >
              {receiptStatus === 'uploading' ? 'Uploading…' : receiptStatus === 'scanning' ? 'Scanning…' : receiptImageUrl ? 'Re-upload' : 'Upload receipt'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleReceiptFile(file)
                e.target.value = ''
              }}
            />
          </div>
          <input
            className="input"
            placeholder="What was it for?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onFocus={selectAll}
            autoFocus
          />
        </div>

        {receiptImageUrl && (
          <div className="space-y-2">
            <p className="text-xs text-ink-muted">
              Editing rows here changes the receipt for everyone. Each person opts out of items they didn&apos;t have after you submit.
            </p>
            <div className="flex gap-3 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receiptImageUrl} alt="Receipt" className="w-16 h-16 object-cover rounded-lg border border-border shrink-0" />
              <div className="flex-1 space-y-1.5 min-w-0">
                {receiptItems.map((it, idx) => (
                  <div key={idx} className="flex gap-1.5 items-center">
                    <input
                      className="input py-1 text-xs flex-1 min-w-0"
                      value={it.description}
                      onChange={e => updateReceiptItem(idx, 'description', e.target.value)}
                      onFocus={selectAll}
                    />
                    <div className="relative w-16 shrink-0">
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-muted text-[10px]">{currency}</span>
                      <input
                        className="input py-1 text-xs w-full pl-4 pr-1"
                        type="number"
                        step="any"
                        min="0"
                        value={it.amount}
                        onChange={e => updateReceiptItem(idx, 'amount', e.target.value)}
                        onFocus={selectAll}
                      />
                    </div>
                    <button type="button" onClick={() => removeReceiptItem(idx)} className="text-ink-muted text-xs px-1">&times;</button>
                  </div>
                ))}
                <button type="button" onClick={addReceiptItem} className="text-xs text-accent font-medium">+ Add row</button>
              </div>
            </div>
            {receiptItems.length > 0 && billVal > 0 && (
              <p className="text-xs text-ink-muted text-right">
                Items {currency}{Math.round(itemsTotal * 100) / 100}
                {itemsOvershoot > 0 && <span className="text-red"> — {currency}{itemsOvershoot} over bill</span>}
              </p>
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
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
