import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import { ProcessedFile, FileStatus, ExportPermitPSSItem } from '../types';

interface Props {
  files: ProcessedFile[];
}

const ExportPermitTab: React.FC<Props> = ({ files }) => {
  const items = useMemo(() => {
    const result: (ExportPermitPSSItem & { _filename: string })[] = [];
    for (const file of files) {
      if (file.status !== FileStatus.COMPLETED && file.status !== FileStatus.WARNING) continue;
      for (const doc of file.data ?? []) {
        if (doc.document_type !== 'Export Permit Declaration (PSS)') continue;
        for (const item of doc.export_permit_pss?.items ?? []) {
          result.push({ ...item, _filename: file.file.name });
        }
      }
    }
    return result;
  }, [files]);

  const exportCSV = () => {
    const headers = [
      'A. HS Code', 'B. Qty', 'C. UOM', 'D. Item Description', 'E. Product of Origin',
      'F. Nett Weight (KGS)', 'G. Nett Wt Unit', 'H. Amount', 'I. Currency',
      'J. PO Number', 'K. Invoice Number', 'Source File',
    ];
    const safe = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = items.map(item => [
      safe(item.hs_code),
      safe(item.quantity),
      safe(item.uom),
      safe(item.item_description),
      safe(item.product_of_origin),
      safe(item.nett_weight),
      safe(item.nett_weight_unit ?? 'KGS'),
      safe(item.amount),
      safe(item.currency),
      safe(item.po_number),
      safe(item.invoice_number),
      safe(item._filename),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export_permit_pss.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
        <p className="font-medium">No Export Permit Declaration (PSS) data extracted yet.</p>
        <p className="text-sm mt-1">Upload and process a PSS shipment bundle PDF (PO + Invoice + Packing List).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600 font-medium">{items.length} line item{items.length !== 1 ? 's' : ''} extracted</p>
        <button
          onClick={exportCSV}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors cursor-pointer"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {[
                'A. HS Code', 'B. Qty', 'C. UOM', 'D. Item Description', 'E. Product of Origin',
                'F. Nett Weight (KGS)', 'G. Nett Wt Unit', 'H. Amount', 'I. Currency',
                'J. PO Number', 'K. Invoice Number',
              ].map(col => (
                <th key={col} className="text-left px-3 py-2.5 font-semibold text-slate-600 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                <td className="px-3 py-2 text-slate-700 font-mono">{item.hs_code ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{item.quantity ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{item.uom ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700 max-w-xs">{item.item_description ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{item.product_of_origin ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{item.nett_weight ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{item.nett_weight_unit ?? 'KGS'}</td>
                <td className="px-3 py-2 text-slate-700">{item.amount ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{item.currency ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700 font-mono">{item.po_number ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700 font-mono">{item.invoice_number ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExportPermitTab;
