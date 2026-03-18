import React, { useState, useRef, useEffect } from 'react';
import {
  Search, ChevronDown, ChevronRight, ClipboardList,
  CheckCircle2, Clock, LayoutDashboard, Download,
  CheckSquare, Square, RotateCcw, AlertCircle,
} from 'lucide-react';
import { ContainerBillingRecord, updateContainerBilling } from '../services/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

type CrmView = 'dashboard' | 'unbilled' | 'billed';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

interface Props {
  records: ContainerBillingRecord[];
  onRecordUpdate: (id: string, updates: Partial<ContainerBillingRecord>) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHARGE_LABELS: Record<string, string> = {
  dhc_in: 'DHC In', dhc_out: 'DHC Out',
  dhe_in: 'DHE In', dhe_out: 'DHE Out',
  data_admin_fee: 'Admin Fee',
  washing: 'Washing', repair: 'Repair',
  detention: 'Detention', demurrage: 'Demurrage',
  dhc: 'DHC', admin_fees: 'Admin Fees', demurage: 'Demurrage',
};

const AMBER = '#EF9F27';
const GREEN = '#1D9E75';

// ── Helpers ────────────────────────────────────────────────────────────────────

function matchesSearch(r: ContainerBillingRecord, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return [r.container_number ?? '', r.filename, r.report_type, r.billing_remarks ?? '']
    .some(s => s.toLowerCase().includes(q));
}

function triggerCSVDownload(rows: ContainerBillingRecord[], filename: string) {
  const safe = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const allChargeKeys = [...new Set(rows.flatMap(r => Object.keys(r.charges)))];
  const headers = [
    'Container No', 'Report Type', 'Source File', 'Date',
    ...allChargeKeys.map(k => CHARGE_LABELS[k] ?? k),
    'Status', 'Date Billed', 'Remarks',
  ];
  const lines = rows.map(r => [
    safe(r.container_number ?? '—'),
    safe(r.report_type),
    safe(r.filename),
    safe(r.created_at.split('T')[0]),
    ...allChargeKeys.map(k => safe(r.charges[k] ?? '')),
    safe(r.billing_status),
    safe(r.billed_at ? new Date(r.billed_at).toLocaleDateString() : ''),
    safe(r.billing_remarks ?? ''),
  ].join(','));
  const csv = [headers.map(h => `"${h}"`).join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CrmBillingTab({ records, onRecordUpdate }: Props) {
  const [view, setView] = useState<CrmView>('dashboard');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null);
  // Local remarks map to avoid textarea losing focus on debounce
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});
  const remarksTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Seed remarksMap for new records only
  useEffect(() => {
    setRemarksMap(prev => {
      const next = { ...prev };
      for (const r of records) {
        if (!(r.id in next)) next[r.id] = r.billing_remarks ?? '';
      }
      return next;
    });
  }, [records]);

  // Reset search/selection on view change
  useEffect(() => {
    setSearchQuery('');
    setSelectedIds(new Set());
    setExpandedId(null);
  }, [view]);

  const unbilled = records.filter(r => r.billing_status === 'unbilled');
  const billed   = records.filter(r => r.billing_status === 'billed');

  // ── Toast
  const toast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // ── Core update
  const applyUpdate = async (id: string, updates: Partial<ContainerBillingRecord>) => {
    onRecordUpdate(id, updates);
    try {
      await updateContainerBilling(id, updates);
    } catch {
      toast('Failed to save — check your connection', 'error');
    }
  };

  const markAsBilled = async (id: string) => {
    await applyUpdate(id, { billing_status: 'billed', billed_at: new Date().toISOString() });
    setExpandedId(null);
    toast('Marked as billed ✓');
  };

  const moveToUnbilled = async (id: string) => {
    await applyUpdate(id, { billing_status: 'unbilled', billed_at: null });
    setRevertConfirm(null);
    toast('Moved back to Unbilled');
  };

  const toggleCharge = (id: string, key: string, current: Record<string, boolean>) => {
    applyUpdate(id, { charge_validations: { ...current, [key]: !current[key] } });
  };

  const onRemarksChange = (id: string, value: string) => {
    setRemarksMap(prev => ({ ...prev, [id]: value }));
    clearTimeout(remarksTimers.current[id]);
    remarksTimers.current[id] = setTimeout(() => {
      applyUpdate(id, { billing_remarks: value });
    }, 800);
  };

  // ── Charge helpers
  const allTicked = (r: ContainerBillingRecord) =>
    Object.keys(r.charges).length > 0 &&
    Object.keys(r.charges).every(k => r.charge_validations[k] === true);

  const checkedCount = (r: ContainerBillingRecord) =>
    Object.keys(r.charges).filter(k => r.charge_validations[k] === true).length;

  // ── Selection
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleSelectAll = (list: ContainerBillingRecord[]) => setSelectedIds(prev => {
    const allSel = list.length > 0 && list.every(r => prev.has(r.id));
    return allSel ? new Set() : new Set(list.map(r => r.id));
  });

  // ── Filtered lists
  const filteredUnbilled = unbilled.filter(r => matchesSearch(r, searchQuery));
  const filteredBilled = billed.filter(r => {
    if (!matchesSearch(r, searchQuery)) return false;
    if (dateFrom || dateTo) {
      const d = r.billed_at?.split('T')[0];
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }
    return true;
  });
  const filteredAll = records.filter(r => matchesSearch(r, searchQuery));

  // ── Shared search bar
  const SearchBar = ({ placeholder }: { placeholder: string }) => (
    <div className="relative flex-1">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text" placeholder={placeholder} value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative">

      {/* View tabs */}
      <div className="flex gap-1 mb-5">
        {(['dashboard', 'unbilled', 'billed'] as CrmView[]).map(v => (
          <button
            key={v} onClick={() => setView(v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === v
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
            }`}
          >
            {v === 'dashboard' && <LayoutDashboard size={14} />}
            {v === 'unbilled'  && <Clock size={14} />}
            {v === 'billed'    && <CheckCircle2 size={14} />}
            <span className="capitalize">{v}</span>
            {v === 'unbilled' && unbilled.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: AMBER }}>{unbilled.length}</span>
            )}
            {v === 'billed' && billed.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: GREEN }}>{billed.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ─────────────────────────────────────────────────────────── */}
      {view === 'dashboard' && (
        <div className="space-y-5">
          <SearchBar placeholder="Search by container, filename, report type…" />

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setView('unbilled')}
              className="p-5 rounded-2xl text-left hover:scale-[1.01] transition-transform shadow-sm border border-amber-100"
              style={{ background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: AMBER }}>
                  <Clock size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-900">{unbilled.length}</p>
                  <p className="text-sm font-medium text-amber-700">Haven't Billed</p>
                </div>
              </div>
              <p className="text-xs text-amber-600">Click to review and validate charges →</p>
            </button>

            <button
              onClick={() => setView('billed')}
              className="p-5 rounded-2xl text-left hover:scale-[1.01] transition-transform shadow-sm border border-emerald-100"
              style={{ background: 'linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: GREEN }}>
                  <CheckCircle2 size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-900">{billed.length}</p>
                  <p className="text-sm font-medium text-emerald-700">Billed</p>
                </div>
              </div>
              <p className="text-xs text-emerald-600">Click to view billed records →</p>
            </button>
          </div>

          {records.length === 0 ? (
            <EmptyState message="No container billing records yet. Upload and process Allied, CDAC, or CDAS reports to get started." />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {['Container No', 'Report Type', 'Source File', 'Date', 'Status', 'Billed At'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAll.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-sm text-slate-400 py-8">No results for "{searchQuery}"</td>
                    </tr>
                  ) : filteredAll.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${i % 2 !== 0 ? 'bg-slate-50/30' : ''}`}
                      onClick={() => { setView(r.billing_status === 'billed' ? 'billed' : 'unbilled'); setExpandedId(r.id); }}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{r.container_number ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.report_type}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={r.filename}>{r.filename}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{r.created_at.split('T')[0]}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.billing_status === 'billed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {r.billing_status === 'billed' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                          {r.billing_status === 'billed' ? 'Billed' : 'Unbilled'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {r.billed_at ? new Date(r.billed_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── UNBILLED ──────────────────────────────────────────────────────────── */}
      {view === 'unbilled' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBar placeholder="Search unbilled records…" />
            <button
              onClick={() => toggleSelectAll(filteredUnbilled)}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors"
            >
              {filteredUnbilled.length > 0 && filteredUnbilled.every(r => selectedIds.has(r.id))
                ? <CheckSquare size={13} /> : <Square size={13} />}
              Select All
            </button>
            <button
              disabled={selectedIds.size === 0}
              onClick={() => triggerCSVDownload(filteredUnbilled.filter(r => selectedIds.has(r.id)), 'unbilled_selected.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={13} /> Export Selected
            </button>
            <button
              disabled={filteredUnbilled.length === 0}
              onClick={() => triggerCSVDownload(filteredUnbilled, 'unbilled_all.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={13} /> Export All
            </button>
          </div>

          {filteredUnbilled.length === 0 ? (
            unbilled.length === 0
              ? <EmptyState message="All records have been billed. Great work!" icon="check" />
              : <p className="text-center text-sm text-slate-400 py-8">No results for "{searchQuery}"</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={filteredUnbilled.length > 0 && filteredUnbilled.every(r => selectedIds.has(r.id))}
                        onChange={() => toggleSelectAll(filteredUnbilled)}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    </th>
                    {['Container No', 'Report Type', 'Source File', 'Date', 'Verified', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUnbilled.map((r, i) => {
                    const isExpanded = expandedId === r.id;
                    const checked = checkedCount(r);
                    const total = Object.keys(r.charges).length;
                    const allDone = allTicked(r);
                    return (
                      <React.Fragment key={r.id}>
                        <tr
                          className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${
                            isExpanded ? 'bg-blue-50/40' : i % 2 !== 0 ? 'bg-slate-50/30' : ''
                          }`}
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                        >
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
                              className="w-4 h-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{r.container_number ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-600">{r.report_type}</td>
                          <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate" title={r.filename}>{r.filename}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{r.created_at.split('T')[0]}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              allDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {checked}/{total}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isExpanded
                              ? <ChevronDown size={15} className="text-slate-400 inline" />
                              : <ChevronRight size={15} className="text-slate-400 inline" />
                            }
                          </td>
                        </tr>

                        {/* Expanded charge panel */}
                        {isExpanded && (
                          <tr className="bg-blue-50/20 border-b border-slate-100">
                            <td colSpan={7} className="px-6 py-5">
                              {Object.keys(r.charges).length === 0 ? (
                                <p className="text-sm text-slate-400 italic mb-4">No charges extracted — ready to bill immediately.</p>
                              ) : (
                                <div className="grid grid-cols-2 gap-2 mb-4">
                                  {Object.entries(r.charges).map(([key, amount]) => {
                                    const isTicked = r.charge_validations[key] === true;
                                    return (
                                      <label
                                        key={key}
                                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                                          isTicked
                                            ? 'border-emerald-200 bg-emerald-50'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2.5">
                                          <input
                                            type="checkbox"
                                            checked={isTicked}
                                            onChange={() => toggleCharge(r.id, key, r.charge_validations)}
                                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                                          />
                                          <span className={`text-sm font-medium ${isTicked ? 'text-emerald-700' : 'text-slate-700'}`}>
                                            {CHARGE_LABELS[key] ?? key}
                                          </span>
                                        </div>
                                        <span className={`text-sm font-mono ${isTicked ? 'text-emerald-600' : 'text-slate-500'}`}>
                                          SGD {amount}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}

                              <div className="mb-4">
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Remarks</label>
                                <textarea
                                  rows={2}
                                  placeholder="Add notes…"
                                  value={remarksMap[r.id] ?? ''}
                                  onChange={e => onRemarksChange(r.id, e.target.value)}
                                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                                />
                              </div>

                              <div className="flex justify-end">
                                <button
                                  disabled={!allDone}
                                  onClick={() => markAsBilled(r.id)}
                                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                                    allDone
                                      ? 'text-white shadow-md hover:opacity-90 active:scale-[0.98]'
                                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                  }`}
                                  style={allDone ? { backgroundColor: GREEN } : {}}
                                >
                                  <CheckCircle2 size={15} />
                                  Mark as Billed
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── BILLED ────────────────────────────────────────────────────────────── */}
      {view === 'billed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBar placeholder="Search billed records…" />
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <span className="text-slate-400 text-sm">→</span>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              disabled={selectedIds.size === 0}
              onClick={() => triggerCSVDownload(filteredBilled.filter(r => selectedIds.has(r.id)), 'billed_selected.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} /> Export Selected
            </button>
            <button
              disabled={filteredBilled.length === 0}
              onClick={() => triggerCSVDownload(filteredBilled, 'billed_all.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} /> Export All
            </button>
          </div>

          {filteredBilled.length === 0 ? (
            billed.length === 0
              ? <EmptyState message="No billed records yet. Mark records as billed in the Unbilled view." />
              : <p className="text-center text-sm text-slate-400 py-8">No results match your filters.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={filteredBilled.length > 0 && filteredBilled.every(r => selectedIds.has(r.id))}
                        onChange={() => toggleSelectAll(filteredBilled)}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    </th>
                    {['Container No', 'Report Type', 'Source File', 'Date Billed', 'Charges', 'Remarks', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBilled.map((r, i) => {
                    const chargesStr = Object.entries(r.charges)
                      .map(([k, v]) => `${CHARGE_LABELS[k] ?? k}: ${v}`).join(' · ') || '—';
                    return (
                      <tr key={r.id} className={`border-b border-slate-50 ${i % 2 !== 0 ? 'bg-slate-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} className="w-4 h-4 rounded border-slate-300" />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{r.container_number ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{r.report_type}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate" title={r.filename}>{r.filename}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {r.billed_at ? new Date(r.billed_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate" title={chargesStr}>{chargesStr}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[140px] truncate">
                          {r.billing_remarks || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setRevertConfirm(r.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <RotateCcw size={11} /> Revert
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Revert confirm dialog ─────────────────────────────────────────────── */}
      {revertConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-900 mb-2">Move back to Unbilled?</h3>
            <p className="text-sm text-slate-500 mb-5">
              This will reset the billing status and clear the billed date. Your remarks will be kept.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRevertConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => moveToUnbilled(revertConfirm)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600"
              >
                Move Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast stack ───────────────────────────────────────────────────────── */}
      <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${
              t.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          >
            {t.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ message, icon = 'list' }: { message: string; icon?: 'list' | 'check' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
        {icon === 'check'
          ? <CheckCircle2 size={28} className="text-emerald-400" />
          : <ClipboardList size={28} className="text-slate-400" />
        }
      </div>
      <p className="text-slate-500 text-sm max-w-xs">{message}</p>
    </div>
  );
}
