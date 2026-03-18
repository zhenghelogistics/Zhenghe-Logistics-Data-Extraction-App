import React, { useState, useRef, useEffect } from 'react';
import {
  Search, ChevronDown, ChevronRight, ClipboardList,
  CheckCircle2, Clock, LayoutDashboard, Download,
  CheckSquare, Square, RotateCcw, AlertCircle, Trash2,
  Archive, BarChart3, TrendingUp,
} from 'lucide-react';
import { ContainerBillingRecord, updateContainerBilling, archiveContainerBilling } from '../services/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

type CrmView = 'dashboard' | 'unbilled' | 'billed' | 'summary';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

interface Props {
  records: ContainerBillingRecord[];
  onRecordUpdate: (id: string, updates: Partial<ContainerBillingRecord>) => void;
  onRecordDelete: (id: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHARGE_LABELS: Record<string, string> = {
  dhc_in: 'DHC In', dhc_out: 'DHC Out',
  dhe_in: 'DHE In', dhe_out: 'DHE Out',
  data_admin_fee: 'Admin Fee',
  washing: 'Washing', repair: 'Repair',
  detention: 'Detention', demurrage: 'Demurrage',
};

// Charges that are non-billable — hidden from validation checkboxes
const NON_BILLABLE_KEYS = new Set(['dhc_in', 'dhc_out', 'dhe_in', 'dhe_out', 'data_admin_fee']);

function billableCharges(r: ContainerBillingRecord): [string, string][] {
  return Object.entries(r.charges).filter(([k]) => !NON_BILLABLE_KEYS.has(k));
}

const AMBER = '#EF9F27';
const GREEN = '#1D9E75';

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseAmount(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function matchesSearch(r: ContainerBillingRecord, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return [r.container_number ?? '', r.filename, r.report_type, r.billing_remarks ?? '', r.container_date ?? '']
    .some(s => s.toLowerCase().includes(q));
}

function triggerCSVDownload(rows: ContainerBillingRecord[], filename: string) {
  const safe = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const allChargeKeys = [...new Set(rows.flatMap(r => Object.keys(r.charges)))];
  const headers = [
    'Container No', 'Report Type', 'Source File', 'Invoice Date',
    ...allChargeKeys.map(k => CHARGE_LABELS[k] ?? k),
    'Status', 'Date Billed', 'Remarks',
  ];
  const lines = rows.map(r => [
    safe(r.container_number ?? '—'),
    safe(r.report_type),
    safe(r.filename),
    safe(r.container_date || r.created_at.split('T')[0]),
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

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CrmBillingTab({ records, onRecordUpdate, onRecordDelete }: Props) {
  const [view, setView] = useState<CrmView>('dashboard');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [datePreset, setDatePreset] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [archiveMonth, setArchiveMonth] = useState<string>('');
  const [archiveConfirm, setArchiveConfirm] = useState(false);
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

  // Only track containers with at least one extra-cost charge (detention, demurrage, washing, repair)
  const isHitList = (r: ContainerBillingRecord) => billableCharges(r).length > 0;
  const activeRecords = records.filter(r => !r.is_archived && isHitList(r));
  const isEffectivelyUnbilled = (r: ContainerBillingRecord) => r.billing_status === 'unbilled';
  const unbilled = activeRecords.filter(isEffectivelyUnbilled);
  const billed   = activeRecords.filter(r => !isEffectivelyUnbilled(r));
  const archived = records.filter(r => r.is_archived && isHitList(r));

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

  const handleDelete = async (id: string) => {
    setDeleteConfirm(null);
    try {
      await onRecordDelete(id);
      toast('Record deleted');
    } catch {
      toast('Failed to delete record', 'error');
    }
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

  // ── Archive
  const availableMonths = [...new Set(
    activeRecords
      .map(r => r.container_date?.slice(0, 7))
      .filter((m): m is string => !!m)
  )].sort();

  const archiveCandidates = archiveMonth
    ? activeRecords.filter(r => r.container_date?.startsWith(archiveMonth))
    : [];

  const handleArchive = async () => {
    if (!archiveMonth || archiveCandidates.length === 0) return;
    const label = formatMonthLabel(archiveMonth);
    try {
      await archiveContainerBilling(archiveCandidates.map(r => r.id), label);
      for (const r of archiveCandidates) {
        onRecordUpdate(r.id, { is_archived: true, archive_label: label });
      }
      setArchiveConfirm(false);
      setArchiveMonth('');
      toast(`Archived ${archiveCandidates.length} records as "${label}" ✓`);
    } catch {
      toast('Archive failed — check your connection', 'error');
    }
  };

  // Grouped archived batches
  const archiveBatches = archived.reduce<Record<string, ContainerBillingRecord[]>>((acc, r) => {
    const label = r.archive_label ?? 'Unknown';
    if (!acc[label]) acc[label] = [];
    acc[label].push(r);
    return acc;
  }, {});

  // ── Charge helpers
  const allTicked = (r: ContainerBillingRecord) => {
    const keys = billableCharges(r).map(([k]) => k);
    return keys.length === 0 || keys.every(k => r.charge_validations[k] === true);
  };

  const checkedCount = (r: ContainerBillingRecord) =>
    billableCharges(r).filter(([k]) => r.charge_validations[k] === true).length;

  // ── Selection
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleSelectAll = (list: ContainerBillingRecord[]) => setSelectedIds(prev => {
    const allSel = list.length > 0 && list.every(r => prev.has(r.id));
    return allSel ? new Set() : new Set(list.map(r => r.id));
  });

  // ── Date preset → dateFrom / dateTo
  const resolvedDateRange = (() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const lastOfMonth  = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
    switch (datePreset) {
      case 'this_month': {
        return { from: fmt(firstOfMonth(today)), to: fmt(today) };
      }
      case 'last_month': {
        const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return { from: fmt(firstOfMonth(lm)), to: fmt(lastOfMonth(lm)) };
      }
      case 'last_3m': {
        const d = new Date(today); d.setMonth(d.getMonth() - 3);
        return { from: fmt(d), to: fmt(today) };
      }
      case 'last_6m': {
        const d = new Date(today); d.setMonth(d.getMonth() - 6);
        return { from: fmt(d), to: fmt(today) };
      }
      case 'this_year': {
        return { from: `${today.getFullYear()}-01-01`, to: fmt(today) };
      }
      case 'custom':
        return { from: dateFrom, to: dateTo };
      default:
        return { from: '', to: '' };
    }
  })();

  // ── Filtered lists
  const filteredUnbilled = unbilled.filter(r => matchesSearch(r, searchQuery));
  const filteredBilled = billed.filter(r => {
    if (!matchesSearch(r, searchQuery)) return false;
    const { from, to } = resolvedDateRange;
    if (from || to) {
      const d = r.billed_at?.split('T')[0];
      if (!d) return false;
      if (from && d < from) return false;
      if (to   && d > to)   return false;
    }
    return true;
  });
  const filteredAll = activeRecords.filter(r => matchesSearch(r, searchQuery));

  // ── Summary filters
  const [summaryDatePreset, setSummaryDatePreset] = useState<string>('all');
  const [summaryCustomFrom, setSummaryCustomFrom] = useState('');
  const [summaryCustomTo,   setSummaryCustomTo]   = useState('');

  const BILLABLE_CHARGE_KEYS = ['demurrage', 'detention', 'washing', 'repair'] as const;
  const [summaryChargeFilter, setSummaryChargeFilter] = useState<Set<string>>(
    new Set(BILLABLE_CHARGE_KEYS)
  );
  const toggleSummaryCharge = (key: string) => {
    setSummaryChargeFilter(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const summaryDateRange = (() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const lastOfMonth  = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
    switch (summaryDatePreset) {
      case 'this_month':  return { from: fmt(firstOfMonth(today)), to: fmt(today) };
      case 'last_month': { const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { from: fmt(firstOfMonth(lm)), to: fmt(lastOfMonth(lm)) }; }
      case 'last_3m': { const d = new Date(today); d.setMonth(d.getMonth() - 3); return { from: fmt(d), to: fmt(today) }; }
      case 'last_6m': { const d = new Date(today); d.setMonth(d.getMonth() - 6); return { from: fmt(d), to: fmt(today) }; }
      case 'this_year':  return { from: `${today.getFullYear()}-01-01`, to: fmt(today) };
      case 'custom':     return { from: summaryCustomFrom, to: summaryCustomTo };
      default:           return { from: '', to: '' };
    }
  })();

  const summaryFilteredActive = activeRecords.filter(r => {
    const { from, to } = summaryDateRange;
    if (from || to) {
      const d = r.container_date || r.created_at.split('T')[0];
      if (from && d < from) return false;
      if (to   && d > to)   return false;
    }
    return true;
  });
  const summaryUnbilled = summaryFilteredActive.filter(isEffectivelyUnbilled);
  const summaryBilled   = summaryFilteredActive.filter(r => !isEffectivelyUnbilled(r));

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

  const displayDate = (r: ContainerBillingRecord) => r.container_date || r.created_at.split('T')[0];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative">

      {/* View tabs */}
      <div className="flex gap-1 mb-5">
        {(['dashboard', 'unbilled', 'billed', 'summary'] as CrmView[]).map(v => (
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
            {v === 'summary'   && <BarChart3 size={14} />}
            <span className="capitalize">{v}</span>
            {v === 'unbilled' && unbilled.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: AMBER }}>{unbilled.length}</span>
            )}
            {v === 'billed' && billed.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: GREEN }}>{billed.length}</span>
            )}
            {v === 'summary' && archived.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-600">{archived.length}</span>
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

          {activeRecords.length === 0 ? (
            <EmptyState message="No container billing records yet. Upload and process Allied or CDAS reports to get started." />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {['Container No', 'Report Type', 'Source File', 'Invoice Date', 'Status', 'Billed At'].map(h => (
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
                      <td className="px-4 py-3 text-xs text-slate-500">{displayDate(r)}</td>
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
                    {['Container No', 'Report Type', 'Source File', 'Invoice Date', 'Verified', '', ''].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
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
                          <td className="px-4 py-3 text-xs text-slate-500">{displayDate(r)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              allDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {checked}/{total}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setDeleteConfirm(r.id)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                              title="Delete record"
                            >
                              <Trash2 size={13} />
                            </button>
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
                            <td colSpan={8} className="px-6 py-5">
                              {billableCharges(r).length === 0 ? (
                                <p className="text-sm text-slate-400 italic mb-4">No billable charges — ready to mark as billed.</p>
                              ) : (
                                <div className="grid grid-cols-2 gap-2 mb-4">
                                  {billableCharges(r).map(([key, amount]) => {
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
            <select
              value={datePreset}
              onChange={e => setDatePreset(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
            >
              <option value="all">All time</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="last_3m">Last 3 months</option>
              <option value="last_6m">Last 6 months</option>
              <option value="this_year">This year</option>
              <option value="custom">Custom range…</option>
            </select>
            {datePreset === 'custom' && (
              <>
                <input
                  type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="text-slate-400 text-sm">→</span>
                <input
                  type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </>
            )}
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
                    {['Container No', 'Report Type', 'Source File', 'Date Billed', 'Charges', 'Remarks', ''].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBilled.map((r, i) => {
                    const chargesStr = Object.entries(r.charges)
                      .filter(([k]) => !NON_BILLABLE_KEYS.has(k))
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
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setRevertConfirm(r.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 hover:border-amber-200 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            >
                              <RotateCcw size={11} /> Revert
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(r.id)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                              title="Delete record"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
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

      {/* ── SUMMARY ───────────────────────────────────────────────────────────── */}
      {view === 'summary' && (
        <div className="space-y-6">
          {/* Summary filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={summaryDatePreset}
              onChange={e => setSummaryDatePreset(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
            >
              <option value="all">All time</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="last_3m">Last 3 months</option>
              <option value="last_6m">Last 6 months</option>
              <option value="this_year">This year</option>
              <option value="custom">Custom range…</option>
            </select>
            {summaryDatePreset === 'custom' && (
              <>
                <input type="date" value={summaryCustomFrom} onChange={e => setSummaryCustomFrom(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                <span className="text-slate-400 text-sm">→</span>
                <input type="date" value={summaryCustomTo} onChange={e => setSummaryCustomTo(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-slate-400 mr-1">Charges:</span>
              {BILLABLE_CHARGE_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => toggleSummaryCharge(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    summaryChargeFilter.has(key)
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {CHARGE_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          {/* Active stats */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Active Records</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-xs text-slate-500 mb-1">Unbilled</p>
                <p className="text-2xl font-bold text-amber-600">{summaryUnbilled.length}</p>
                <p className="text-xs text-slate-400 mt-0.5">containers</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-xs text-slate-500 mb-1">Billed</p>
                <p className="text-2xl font-bold text-emerald-600">{summaryBilled.length}</p>
                <p className="text-xs text-slate-400 mt-0.5">containers</p>
              </div>
            </div>
            {summaryChargeFilter.size > 0 && (
              <div className={`grid gap-3 grid-cols-${Math.min(summaryChargeFilter.size, 4)}`}>
                {BILLABLE_CHARGE_KEYS.filter(k => summaryChargeFilter.has(k)).map(key => {
                  const total = summaryUnbilled.reduce((s, r) => s + parseAmount(r.charges[key]), 0);
                  const colors: Record<string, { border: string; text: string }> = {
                    demurrage: { border: 'border-red-100',    text: 'text-red-600' },
                    detention: { border: 'border-orange-100', text: 'text-orange-600' },
                    washing:   { border: 'border-blue-100',   text: 'text-blue-600' },
                    repair:    { border: 'border-purple-100', text: 'text-purple-600' },
                  };
                  const c = colors[key] ?? { border: 'border-slate-100', text: 'text-slate-700' };
                  return (
                    <div key={key} className={`bg-white rounded-xl border ${c.border} p-4 shadow-sm`}>
                      <p className="text-xs text-slate-500 mb-1">Unbilled {CHARGE_LABELS[key]}</p>
                      <p className={`text-xl font-bold ${c.text}`}>SGD {total.toFixed(2)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">outstanding</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Archive section */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Archive by Month</h3>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-sm text-slate-600 mb-4">
                Select a month based on the invoice date of records. All active records (unbilled + billed) from that month will be archived and removed from the main views.
              </p>
              {availableMonths.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No records with invoice dates available for archiving.</p>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    value={archiveMonth}
                    onChange={e => setArchiveMonth(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">Select month…</option>
                    {availableMonths.map(m => (
                      <option key={m} value={m}>{formatMonthLabel(m)} ({activeRecords.filter(r => r.container_date?.startsWith(m)).length} records)</option>
                    ))}
                  </select>
                  <button
                    disabled={!archiveMonth || archiveCandidates.length === 0}
                    onClick={() => setArchiveConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Archive size={14} />
                    Archive {archiveCandidates.length > 0 ? `${archiveCandidates.length} records` : ''}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Archived batches */}
          {Object.keys(archiveBatches).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Archived Batches</h3>
              <div className="space-y-3">
                {Object.entries(archiveBatches)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([label, batch]) => {
                    const batchUnbilled = batch.filter(r => r.billing_status === 'unbilled').length;
                    const batchBilled   = batch.filter(r => r.billing_status === 'billed').length;
                    const batchDemurrage = batch.reduce((s, r) => s + parseAmount(r.charges['demurrage']), 0);
                    const batchDetention = batch.reduce((s, r) => s + parseAmount(r.charges['detention']), 0);
                    return (
                      <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Archive size={15} className="text-slate-400" />
                            <span className="font-semibold text-slate-800">{label}</span>
                            <span className="text-xs text-slate-400">{batch.length} containers</span>
                          </div>
                          <button
                            onClick={() => triggerCSVDownload(batch, `archive_${label.replace(/\s+/g, '_')}.csv`)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
                          >
                            <Download size={11} /> Export
                          </button>
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                          <div className="text-center">
                            <p className="text-lg font-bold text-amber-600">{batchUnbilled}</p>
                            <p className="text-xs text-slate-400">Unbilled</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-bold text-emerald-600">{batchBilled}</p>
                            <p className="text-xs text-slate-400">Billed</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-red-500">{batchDemurrage > 0 ? `SGD ${batchDemurrage.toFixed(2)}` : '—'}</p>
                            <p className="text-xs text-slate-400">Demurrage</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-orange-500">{batchDetention > 0 ? `SGD ${batchDetention.toFixed(2)}` : '—'}</p>
                            <p className="text-xs text-slate-400">Detention</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {archived.length === 0 && availableMonths.length === 0 && (
            <EmptyState message="No records to archive yet. Upload Allied or CDAS reports to get started." />
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
              <button onClick={() => setRevertConfirm(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => moveToUnbilled(revertConfirm)} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-500 hover:bg-amber-600">Move Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm dialog ─────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-900 mb-2">Delete this record?</h3>
            <p className="text-sm text-slate-500 mb-5">
              This will permanently remove this container billing record. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Archive confirm dialog ────────────────────────────────────────────── */}
      {archiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-900 mb-2">Archive {formatMonthLabel(archiveMonth)}?</h3>
            <p className="text-sm text-slate-500 mb-5">
              {archiveCandidates.length} records with invoice dates in {formatMonthLabel(archiveMonth)} will be archived and removed from the active unbilled/billed views. You can still export them from the Summary tab.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setArchiveConfirm(false)} className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={handleArchive} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-700">
                <Archive size={13} /> Archive
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
