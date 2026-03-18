import React, { useState, useEffect, useRef } from 'react';
import {
  Search, ChevronDown, ChevronRight, ClipboardList,
  CheckCircle2, Clock, LayoutDashboard, Download,
  CheckSquare, Square, RotateCcw, AlertCircle,
} from 'lucide-react';
import { ProcessedFile, FileStatus } from '../types';
import { updateBilling } from '../services/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BillingState {
  billing_status: 'unbilled' | 'billed';
  billed_at: string | null;
  billing_remarks: string | null;
  charge_validations: Record<string, boolean>;
}

interface ChargeGroup {
  reportType: string;
  charges: { key: string; label: string; amount: string }[];
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

type CrmView = 'dashboard' | 'unbilled' | 'billed';

interface Props {
  files: ProcessedFile[];
  onBillingUpdate: (fileId: string, updates: Partial<ProcessedFile>) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getChargeGroups(file: ProcessedFile): ChargeGroup[] {
  const groups: ChargeGroup[] = [];
  for (const doc of file.data ?? []) {
    if (doc.document_type === 'Allied Report' && doc.allied_report) {
      const r = doc.allied_report;
      const charges = [
        { key: 'dhc_in',        label: 'DHC In',    amount: r.dhc_in },
        { key: 'dhc_out',       label: 'DHC Out',   amount: r.dhc_out },
        { key: 'dhe_in',        label: 'DHE In',    amount: r.dhe_in },
        { key: 'dhe_out',       label: 'DHE Out',   amount: r.dhe_out },
        { key: 'data_admin_fee',label: 'Admin Fee', amount: r.data_admin_fee },
        { key: 'washing',       label: 'Washing',   amount: r.washing },
        { key: 'repair',        label: 'Repair',    amount: r.repair },
        { key: 'detention',     label: 'Detention', amount: r.detention },
        { key: 'demurrage',     label: 'Demurrage', amount: r.demurrage },
      ].filter(c => c.amount) as { key: string; label: string; amount: string }[];
      if (charges.length) groups.push({ reportType: 'Allied Report', charges });
    }
    if (doc.document_type === 'CDAC Report' && doc.cdac_report) {
      const r = doc.cdac_report;
      const charges = [
        { key: 'dhc',        label: 'DHC',        amount: r.dhc },
        { key: 'repair',     label: 'Repair',     amount: r.repair },
        { key: 'detention',  label: 'Detention',  amount: r.detention },
        { key: 'demurage',   label: 'Demurrage',  amount: r.demurage },
        { key: 'admin_fees', label: 'Admin Fees', amount: r.admin_fees },
        { key: 'washing',    label: 'Washing',    amount: r.washing },
      ].filter(c => c.amount) as { key: string; label: string; amount: string }[];
      if (charges.length) groups.push({ reportType: 'CDAC Report', charges });
    }
    if (doc.document_type === 'CDAS Report' && doc.cdas_report) {
      const r = doc.cdas_report;
      const charges = [
        { key: 'dhc_in',        label: 'DHC In',    amount: r.dhc_in },
        { key: 'dhc_out',       label: 'DHC Out',   amount: r.dhc_out },
        { key: 'dhe_in',        label: 'DHE In',    amount: r.dhe_in },
        { key: 'dhe_out',       label: 'DHE Out',   amount: r.dhe_out },
        { key: 'data_admin_fee',label: 'Admin Fee', amount: r.data_admin_fee },
        { key: 'washing',       label: 'Washing',   amount: r.washing },
        { key: 'repair',        label: 'Repair',    amount: r.repair },
        { key: 'detention',     label: 'Detention', amount: r.detention },
        { key: 'demurrage',     label: 'Demurrage', amount: r.demurrage },
      ].filter(c => c.amount) as { key: string; label: string; amount: string }[];
      if (charges.length) groups.push({ reportType: 'CDAS Report', charges });
    }
  }
  return groups;
}

function getContainerNo(file: ProcessedFile): string {
  for (const doc of file.data ?? []) {
    if (doc.allied_report?.container_booking_no) return doc.allied_report.container_booking_no;
    if (doc.cdac_report?.container_number) return doc.cdac_report.container_number;
    if (doc.cdas_report?.container_number) return doc.cdas_report.container_number;
    if (doc.transport_job?.container_number) return doc.transport_job.container_number;
    if (doc.logistics_details?.container_numbers?.[0]) return doc.logistics_details.container_numbers[0];
  }
  return '—';
}

function getDocTypes(file: ProcessedFile): string {
  return [...new Set(file.data?.map(d => d.document_type) ?? [])].join(', ');
}

function getDate(file: ProcessedFile): string {
  for (const doc of file.data ?? []) {
    if (doc.metadata?.date) return doc.metadata.date;
  }
  return file.uploadedAt?.split('T')[0] ?? '—';
}

function allChargesTicked(chargeGroups: ChargeGroup[], validations: Record<string, boolean>): boolean {
  const allKeys = chargeGroups.flatMap(g => g.charges.map(c => `${g.reportType}::${c.key}`));
  return allKeys.every(k => validations[k] === true);
}

function matchesSearch(file: ProcessedFile, billing: BillingState, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  const candidates = [
    file.file.name,
    getContainerNo(file),
    billing.billing_remarks ?? '',
    ...(file.data?.flatMap(d => [
      d.metadata?.parties?.consignee_buyer ?? '',
      d.logistics_details?.vessel_name ?? '',
      d.metadata?.reference_number ?? '',
    ]) ?? []),
  ];
  return candidates.some(s => s.toLowerCase().includes(q));
}

function triggerCSVDownload(rows: ProcessedFile[], billingMap: Record<string, BillingState>, filename: string) {
  const safe = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Container No', 'Filename', 'Document Types', 'Date', 'Charges Summary', 'Status', 'Date Billed', 'Remarks'];
  const EMPTY_BILLING: BillingState = { billing_status: 'unbilled', billed_at: null, billing_remarks: null, charge_validations: {} };
  const lines = rows.map(f => {
    const b = billingMap[f.id] ?? EMPTY_BILLING;
    const groups = getChargeGroups(f);
    const chargesStr = groups.flatMap(g => g.charges.map(c => `${c.label}: ${c.amount}`)).join('; ');
    return [
      safe(getContainerNo(f)),
      safe(f.file.name),
      safe(getDocTypes(f)),
      safe(getDate(f)),
      safe(chargesStr),
      safe(b.billing_status),
      safe(b.billed_at ? new Date(b.billed_at).toLocaleDateString() : ''),
      safe(b.billing_remarks),
    ].join(',');
  });
  const csv = [headers.map(h => `"${h}"`).join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EMPTY_BILLING: BillingState = { billing_status: 'unbilled', billed_at: null, billing_remarks: null, charge_validations: {} };
const AMBER = '#EF9F27';
const GREEN = '#1D9E75';

// ── Component ──────────────────────────────────────────────────────────────────

export default function CrmBillingTab({ files, onBillingUpdate }: Props) {
  const [view, setView] = useState<CrmView>('dashboard');
  const [billingMap, setBillingMap] = useState<Record<string, BillingState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null);
  const remarksTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Seed billingMap from files prop (only add entries not yet tracked locally)
  useEffect(() => {
    setBillingMap(prev => {
      const next = { ...prev };
      for (const f of files) {
        if (!next[f.id]) {
          next[f.id] = {
            billing_status: f.billing_status ?? 'unbilled',
            billed_at: f.billed_at ?? null,
            billing_remarks: f.billing_remarks ?? null,
            charge_validations: f.charge_validations ?? {},
          };
        }
      }
      return next;
    });
  }, [files]);

  // Reset search/selection when switching views
  useEffect(() => {
    setSearchQuery('');
    setSelectedIds(new Set());
    setExpandedId(null);
  }, [view]);

  // CRM-relevant files: completed/warning transport docs only
  const crmFiles = files.filter(f =>
    (f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING) &&
    f.data?.some(d => ['Allied Report', 'CDAC Report', 'CDAS Report', 'Transport Job'].includes(d.document_type))
  );

  const getBilling = (id: string): BillingState => billingMap[id] ?? EMPTY_BILLING;

  const unbilledFiles = crmFiles.filter(f => getBilling(f.id).billing_status === 'unbilled');
  const billedFiles   = crmFiles.filter(f => getBilling(f.id).billing_status === 'billed');

  // ── Toast helper
  const toast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // ── Apply billing update: local state + parent + DB
  const applyBillingUpdate = async (fileId: string, updates: Partial<BillingState>) => {
    const current = billingMap[fileId] ?? EMPTY_BILLING;
    const next = { ...current, ...updates };
    setBillingMap(prev => ({ ...prev, [fileId]: next }));
    onBillingUpdate(fileId, {
      billing_status: next.billing_status,
      billed_at: next.billed_at,
      billing_remarks: next.billing_remarks,
      charge_validations: next.charge_validations,
    });
    try {
      await updateBilling(fileId, {
        billing_status: next.billing_status,
        billed_at: next.billed_at,
        billing_remarks: next.billing_remarks,
        charge_validations: next.charge_validations,
      });
    } catch {
      toast('Failed to save — check your connection', 'error');
    }
  };

  const markAsBilled = async (fileId: string) => {
    const billing = getBilling(fileId);
    await applyBillingUpdate(fileId, {
      billing_status: 'billed',
      billed_at: new Date().toISOString(),
      billing_remarks: billing.billing_remarks,
    });
    setExpandedId(null);
    toast('Marked as billed ✓');
  };

  const moveToUnbilled = async (fileId: string) => {
    await applyBillingUpdate(fileId, { billing_status: 'unbilled', billed_at: null });
    setRevertConfirm(null);
    toast('Moved back to Unbilled');
  };

  const toggleCharge = async (fileId: string, chargeKey: string) => {
    const billing = getBilling(fileId);
    const next = { ...billing.charge_validations, [chargeKey]: !billing.charge_validations[chargeKey] };
    await applyBillingUpdate(fileId, { charge_validations: next });
  };

  // Debounced remarks save
  const onRemarksChange = (fileId: string, value: string) => {
    setBillingMap(prev => ({
      ...prev,
      [fileId]: { ...(prev[fileId] ?? EMPTY_BILLING), billing_remarks: value },
    }));
    clearTimeout(remarksTimers.current[fileId]);
    remarksTimers.current[fileId] = setTimeout(async () => {
      onBillingUpdate(fileId, { billing_remarks: value });
      try {
        await updateBilling(fileId, { billing_remarks: value });
      } catch {
        console.error('Failed to save remarks');
      }
    }, 800);
  };

  // ── Filtered lists
  const filteredUnbilled = unbilledFiles.filter(f => matchesSearch(f, getBilling(f.id), searchQuery));
  const filteredBilled   = billedFiles.filter(f => {
    if (!matchesSearch(f, getBilling(f.id), searchQuery)) return false;
    if (dateFrom || dateTo) {
      const d = getBilling(f.id).billed_at?.split('T')[0];
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
    }
    return true;
  });
  const filteredAll = crmFiles.filter(f => matchesSearch(f, getBilling(f.id), searchQuery));

  // ── Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (list: ProcessedFile[]) => {
    setSelectedIds(prev => {
      const allSelected = list.length > 0 && list.every(f => prev.has(f.id));
      return allSelected ? new Set() : new Set(list.map(f => f.id));
    });
  };

  // ── Shared search bar
  const SearchBar = ({ placeholder }: { placeholder: string }) => (
    <div className="relative flex-1">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={searchQuery}
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
            key={v}
            onClick={() => setView(v)}
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
            {v === 'unbilled' && unbilledFiles.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: AMBER }}>
                {unbilledFiles.length}
              </span>
            )}
            {v === 'billed' && billedFiles.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: GREEN }}>
                {billedFiles.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ─────────────────────────────────────────────────────────── */}
      {view === 'dashboard' && (
        <div className="space-y-5">
          <SearchBar placeholder="Search by container, filename, consignee…" />

          {/* Summary cards */}
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
                  <p className="text-2xl font-bold text-amber-900">{unbilledFiles.length}</p>
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
                  <p className="text-2xl font-bold text-emerald-900">{billedFiles.length}</p>
                  <p className="text-sm font-medium text-emerald-700">Billed</p>
                </div>
              </div>
              <p className="text-xs text-emerald-600">Click to view billed records →</p>
            </button>
          </div>

          {/* All records table */}
          {crmFiles.length === 0 ? (
            <EmptyState message="No transport records found. Upload and process Allied, CDAC, or CDAS reports to get started." />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {['Container No', 'Filename', 'Document Type', 'Date', 'Status', 'Billed At'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAll.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-sm text-slate-400 py-8">No results for "{searchQuery}"</td></tr>
                  ) : filteredAll.map((f, i) => {
                    const billing = getBilling(f.id);
                    const isBilled = billing.billing_status === 'billed';
                    return (
                      <tr
                        key={f.id}
                        className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${i % 2 !== 0 ? 'bg-slate-50/30' : ''}`}
                        onClick={() => { setView(isBilled ? 'billed' : 'unbilled'); setExpandedId(f.id); }}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{getContainerNo(f)}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-xs truncate text-xs" title={f.file.name}>{f.file.name}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{getDocTypes(f)}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{getDate(f)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            isBilled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {isBilled ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                            {isBilled ? 'Billed' : 'Unbilled'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {billing.billed_at ? new Date(billing.billed_at).toLocaleDateString() : '—'}
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

      {/* ── UNBILLED ──────────────────────────────────────────────────────────── */}
      {view === 'unbilled' && (
        <div className="space-y-4">
          {/* Search + bulk actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBar placeholder="Search unbilled records…" />
            <button
              onClick={() => toggleSelectAll(filteredUnbilled)}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors"
            >
              {filteredUnbilled.length > 0 && filteredUnbilled.every(f => selectedIds.has(f.id))
                ? <CheckSquare size={13} /> : <Square size={13} />}
              Select All
            </button>
            <button
              disabled={selectedIds.size === 0}
              onClick={() => triggerCSVDownload(filteredUnbilled.filter(f => selectedIds.has(f.id)), billingMap, 'unbilled_selected.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={13} /> Export Selected
            </button>
            <button
              disabled={filteredUnbilled.length === 0}
              onClick={() => triggerCSVDownload(filteredUnbilled, billingMap, 'unbilled_all.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={13} /> Export All
            </button>
          </div>

          {/* Cards */}
          {filteredUnbilled.length === 0 ? (
            unbilledFiles.length === 0
              ? <EmptyState message="All records have been billed. Great work!" icon="check" />
              : <p className="text-center text-sm text-slate-400 py-8">No results for "{searchQuery}"</p>
          ) : (
            <div className="space-y-3">
              {filteredUnbilled.map(f => {
                const billing  = getBilling(f.id);
                const groups   = getChargeGroups(f);
                const allTicked = allChargesTicked(groups, billing.charge_validations);
                const isExpanded = expandedId === f.id;
                const totalChecked = Object.values(billing.charge_validations).filter(Boolean).length;
                const totalCharges = groups.flatMap(g => g.charges).length;

                return (
                  <div key={f.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Card header */}
                    <div
                      className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors select-none"
                      onClick={() => setExpandedId(isExpanded ? null : f.id)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(f.id)}
                          onChange={() => toggleSelect(f.id)}
                          onClick={e => e.stopPropagation()}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                        />
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">{getContainerNo(f)}</p>
                          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-sm">
                            {f.file.name} · {getDocTypes(f)} · {getDate(f)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {totalCharges > 0 && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            allTicked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {totalChecked}/{totalCharges} checked
                          </span>
                        )}
                        {isExpanded
                          ? <ChevronDown size={16} className="text-slate-400" />
                          : <ChevronRight size={16} className="text-slate-400" />
                        }
                      </div>
                    </div>

                    {/* Expanded body */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 px-5 py-4 space-y-4">
                        {groups.length === 0 ? (
                          <p className="text-sm text-slate-400 italic">No charges extracted — ready to bill immediately.</p>
                        ) : (
                          groups.map(group => (
                            <div key={group.reportType}>
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                {group.reportType}
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {group.charges.map(charge => {
                                  const key     = `${group.reportType}::${charge.key}`;
                                  const checked = billing.charge_validations[key] === true;
                                  return (
                                    <label
                                      key={key}
                                      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                                        checked
                                          ? 'border-emerald-200 bg-emerald-50'
                                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleCharge(f.id, key)}
                                          className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                                        />
                                        <span className={`text-sm font-medium ${checked ? 'text-emerald-700' : 'text-slate-700'}`}>
                                          {charge.label}
                                        </span>
                                      </div>
                                      <span className={`text-sm font-mono ${checked ? 'text-emerald-600' : 'text-slate-500'}`}>
                                        SGD {charge.amount}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}

                        {/* Remarks */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                            Remarks
                          </label>
                          <textarea
                            rows={2}
                            placeholder="Add notes…"
                            value={billing.billing_remarks ?? ''}
                            onChange={e => onRemarksChange(f.id, e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                          />
                        </div>

                        {/* Mark as Billed */}
                        <div className="flex justify-end">
                          <button
                            disabled={!allTicked}
                            onClick={() => markAsBilled(f.id)}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                              allTicked
                                ? 'text-white shadow-md hover:opacity-90 active:scale-[0.98]'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                            style={allTicked ? { backgroundColor: GREEN } : {}}
                          >
                            <CheckCircle2 size={15} />
                            Mark as Billed
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── BILLED ────────────────────────────────────────────────────────────── */}
      {view === 'billed' && (
        <div className="space-y-4">
          {/* Search + date range + export */}
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
              onClick={() => triggerCSVDownload(filteredBilled.filter(f => selectedIds.has(f.id)), billingMap, 'billed_selected.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} /> Export Selected
            </button>
            <button
              disabled={filteredBilled.length === 0}
              onClick={() => triggerCSVDownload(filteredBilled, billingMap, 'billed_all.csv')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} /> Export All
            </button>
          </div>

          {filteredBilled.length === 0 ? (
            billedFiles.length === 0
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
                        checked={filteredBilled.length > 0 && filteredBilled.every(f => selectedIds.has(f.id))}
                        onChange={() => toggleSelectAll(filteredBilled)}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    </th>
                    {['Container No', 'Filename', 'Doc Type', 'Date Billed', 'Charges', 'Remarks', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBilled.map((f, i) => {
                    const billing    = getBilling(f.id);
                    const groups     = getChargeGroups(f);
                    const chargesStr = groups.flatMap(g => g.charges.map(c => `${c.label}: ${c.amount}`)).join(' · ') || '—';
                    return (
                      <tr key={f.id} className={`border-b border-slate-50 ${i % 2 !== 0 ? 'bg-slate-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(f.id)}
                            onChange={() => toggleSelect(f.id)}
                            className="w-4 h-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{getContainerNo(f)}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate text-xs" title={f.file.name}>{f.file.name}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{getDocTypes(f)}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {billing.billed_at ? new Date(billing.billed_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate" title={chargesStr}>{chargesStr}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs max-w-[140px] truncate">{billing.billing_remarks || '—'}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setRevertConfirm(f.id)}
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
