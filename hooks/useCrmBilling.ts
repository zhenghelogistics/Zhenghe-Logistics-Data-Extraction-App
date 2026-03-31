import { useState, useRef, useEffect } from 'react';
import { ContainerBillingRecord, updateContainerBilling, archiveContainerBilling } from '../services/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CrmView = 'dashboard' | 'unbilled' | 'billed' | 'summary';

export interface CrmToast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export interface CrmBillingProps {
  records: ContainerBillingRecord[];
  onRecordUpdate: (id: string, updates: Partial<ContainerBillingRecord>) => void;
  onRecordDelete: (id: string) => void;
  onRecordDeleteMany: (ids: string[]) => Promise<void>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CHARGE_LABELS: Record<string, string> = {
  dhc_in: 'DHC In', dhc_out: 'DHC Out',
  dhe_in: 'DHE In', dhe_out: 'DHE Out',
  data_admin_fee: 'Admin Fee',
  washing: 'Washing', repair: 'Repair',
  detention: 'Detention', demurrage: 'Demurrage',
};

export const NON_BILLABLE_KEYS = new Set(['dhc_in', 'dhc_out', 'dhe_in', 'dhe_out', 'data_admin_fee']);

export const BILLABLE_CHARGE_KEYS = ['demurrage', 'detention', 'washing', 'repair'] as const;

export const AMBER = '#EF9F27';
export const GREEN = '#1D9E75';

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function billableCharges(r: ContainerBillingRecord): [string, string][] {
  return Object.entries(r.charges).filter(([k]) => !NON_BILLABLE_KEYS.has(k));
}

export function parseAmount(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function matchesSearch(r: ContainerBillingRecord, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return [r.container_number ?? '', r.filename, r.report_type, r.billing_remarks ?? '', r.container_date ?? '']
    .some(s => s.toLowerCase().includes(q));
}

export function triggerCSVDownload(rows: ContainerBillingRecord[], filename: string) {
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

export function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

function resolveDateRange(preset: string, customFrom: string, customTo: string) {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const lastOfMonth  = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
  switch (preset) {
    case 'this_month': return { from: fmt(firstOfMonth(today)), to: fmt(today) };
    case 'last_month': { const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { from: fmt(firstOfMonth(lm)), to: fmt(lastOfMonth(lm)) }; }
    case 'last_3m': { const d = new Date(today); d.setMonth(d.getMonth() - 3); return { from: fmt(d), to: fmt(today) }; }
    case 'last_6m': { const d = new Date(today); d.setMonth(d.getMonth() - 6); return { from: fmt(d), to: fmt(today) }; }
    case 'this_year': return { from: `${today.getFullYear()}-01-01`, to: fmt(today) };
    case 'custom': return { from: customFrom, to: customTo };
    default: return { from: '', to: '' };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCrmBilling({ records, onRecordUpdate, onRecordDelete, onRecordDeleteMany }: CrmBillingProps) {
  const [view, setView] = useState<CrmView>('dashboard');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<CrmToast[]>([]);
  const [datePreset, setDatePreset] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revertConfirm, setRevertConfirm] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [archiveMonth, setArchiveMonth] = useState<string>('');
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});
  const remarksTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [summaryDatePreset, setSummaryDatePreset] = useState<string>('all');
  const [summaryCustomFrom, setSummaryCustomFrom] = useState('');
  const [summaryCustomTo, setSummaryCustomTo] = useState('');
  const [summaryChargeFilter, setSummaryChargeFilter] = useState<Set<string>>(
    new Set(BILLABLE_CHARGE_KEYS)
  );

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

  // ── Derived record lists
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

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    setBulkDeleteConfirm(false);
    try {
      await onRecordDeleteMany(ids);
      setSelectedIds(new Set());
      toast(`${ids.length} record${ids.length > 1 ? 's' : ''} deleted`);
    } catch {
      toast('Failed to delete records', 'error');
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
    activeRecords.map(r => r.container_date?.slice(0, 7)).filter((m): m is string => !!m)
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

  const toggleSummaryCharge = (key: string) => {
    setSummaryChargeFilter(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Filtered lists
  const resolvedDateRange = resolveDateRange(datePreset, dateFrom, dateTo);
  const summaryDateRange  = resolveDateRange(summaryDatePreset, summaryCustomFrom, summaryCustomTo);

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

  const displayDate = (r: ContainerBillingRecord) => r.container_date || r.created_at.split('T')[0];

  return {
    // State
    view, setView,
    expandedId, setExpandedId,
    searchQuery, setSearchQuery,
    selectedIds,
    toasts,
    datePreset, setDatePreset,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    revertConfirm, setRevertConfirm,
    deleteConfirm, setDeleteConfirm,
    bulkDeleteConfirm, setBulkDeleteConfirm,
    archiveMonth, setArchiveMonth,
    archiveConfirm, setArchiveConfirm,
    remarksMap,
    summaryDatePreset, setSummaryDatePreset,
    summaryCustomFrom, setSummaryCustomFrom,
    summaryCustomTo, setSummaryCustomTo,
    summaryChargeFilter,
    // Derived
    activeRecords, unbilled, billed, archived,
    filteredUnbilled, filteredBilled, filteredAll,
    availableMonths, archiveCandidates, archiveBatches,
    summaryUnbilled, summaryBilled,
    // Handlers
    markAsBilled, moveToUnbilled,
    handleDelete, handleBulkDelete,
    toggleCharge, onRemarksChange, handleArchive,
    toggleSelect, toggleSelectAll, toggleSummaryCharge,
    allTicked, checkedCount, displayDate,
  };
}
