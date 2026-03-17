import React, { useState, useEffect } from 'react';
import { ProcessedFile, FileStatus, DocumentData } from '../types';
import { AppConfig } from '../config';
import { CheckCircle, AlertTriangle, Clock, XCircle, Loader2, Trash2, FileText } from 'lucide-react';
import { UserRole } from '../users';

interface ResultsTableProps {
  files: ProcessedFile[];
  onUpdateIncoterm: (fileId: string, docIndex: number, value: string) => void;
  onDeleteFile: (fileId: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onGenerateVoucher?: (docs: DocumentData[]) => void;
  activeTab: string;
  userRole: UserRole | null;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ files, onUpdateIncoterm, onDeleteFile, onBulkDelete, onGenerateVoucher, activeTab, userRole }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (allIds: string[]) => {
    const allSelected = allIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  if (files.length === 0) {
    return null;
  }

  // We need to flatten the files structure for display, because 1 file might = 3 documents
  const flattenedRows: { file: ProcessedFile; data: DocumentData; docIndex: number }[] = [];

  files.forEach(file => {
    if (file.status === FileStatus.COMPLETED || file.status === FileStatus.WARNING) {
      if (file.data && file.data.length > 0) {
        file.data.forEach((doc, index) => {
          flattenedRows.push({ file, data: doc, docIndex: index });
        });
      } else {
        // Fallback if no docs found but status is complete (rare)
      }
    } else {
      // For pending/processing/error, we just show one row per file
      // We create a dummy data object for display purposes if needed, or handle in render
    }
  });

  // Helper to render status badge
  const renderStatusBadge = (status: FileStatus) => {
    switch (status) {
      case FileStatus.COMPLETED:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle size={14} className="mr-1" />
            Done
          </span>
        );
      case FileStatus.WARNING:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <AlertTriangle size={14} className="mr-1" />
            Warning
          </span>
        );
      case FileStatus.PROCESSING:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <Loader2 size={14} className="mr-1 animate-spin" />
            Processing
          </span>
        );
      case FileStatus.PENDING:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            <Clock size={14} className="mr-1" />
            Pending
          </span>
        );
      case FileStatus.ERROR:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <XCircle size={14} className="mr-1" />
            Error
          </span>
        );
      default:
        return null;
    }
  };

  // Helper to render specific cell data based on type
  const renderDynamicCell = (header: string, data: DocumentData, fileId: string, docIndex: number) => {
    switch (header) {
      // Logistics Team Specifics
      case 'A. BL NUMBER': return data.logistics_local_charges?.bl_number || data.metadata?.reference_number || '-';
      case 'B. CARRIER / FORWARDER': return data.logistics_local_charges?.carrier_forwarder || '-';
      case 'C. PSS INVOICE NUMBER': return data.logistics_local_charges?.pss_invoice_number || '-';
      case 'D. FREIGHT TERM': return data.logistics_local_charges?.freight_term || '-';
      case 'E. PLACE OF DESTINATION': return data.logistics_local_charges?.place_of_destination || '-';
      case 'F. CNTR TYPE': return data.logistics_local_charges?.container_type || '-';
      case 'G. CONTAINER QTY': return data.logistics_local_charges?.container_qty || '-';
      case 'H. (SGD) THC': return data.logistics_local_charges?.thc_amount || '-';
      case 'I. (SGD) SEAL FEE': return data.logistics_local_charges?.seal_fee || '-';
      case 'J. (SGD) BL FEE': return data.logistics_local_charges?.bl_fee || '-';
      case 'K. (SGD) BL PRINTED FEE': return data.logistics_local_charges?.bl_printed_fee || '-';
      case 'L. (SGD) ENS / AMS / SCMC': return data.logistics_local_charges?.ens_ams_fee || '-';
      case 'M. (SGD) OTHERS CHARGES': return data.logistics_local_charges?.other_charges || '-';
      case 'N. REMARKS': return data.logistics_local_charges?.remarks || '-';
      case 'O. TOTAL AMOUNT': return data.logistics_local_charges?.total_payable_amount || '-';

      // Payment Voucher Specifics
      case "PSS's Invoice #": return data.payment_voucher_details?.pss_invoice_number || '-';
      case "Carrier/Forwarder Inv #": return data.payment_voucher_details?.carrier_invoice_number || data.metadata?.reference_number || '-';
      case "BL Number": return data.payment_voucher_details?.bl_number || data.metadata?.related_reference_number || data.metadata?.reference_number || '-';
      case "Payable Amount": {
        const raw = data.payment_voucher_details?.payable_amount || (data.financials?.total_amount ? `${data.financials.total_amount.toLocaleString()} ${data.metadata?.currency || ''}` : '-');
        return typeof raw === 'string' ? raw.replace(/SGD\s*/gi, '').trim() || '-' : raw;
      }
      case "Total Payable Amount": {
        const raw = data.payment_voucher_details?.total_payable_amount || '-';
        return typeof raw === 'string' ? raw.replace(/SGD\s*/gi, '').trim() || '-' : raw;
      }
      case "Charges": return data.payment_voucher_details?.charges_summary || data.financials?.line_item_charges?.map(c => `${c.description}: ${c.amount}`).join('; ') || '-';
      
      // Outward Permit Declaration
      case 'BL number': return data.outward_permit_declaration?.bl_number || '-';
      case 'Carrier': return data.outward_permit_declaration?.carrier || '-';
      case 'Consignee': return data.outward_permit_declaration?.consignee || data.metadata?.parties?.consignee_buyer || '-';
      case 'Container No': return data.outward_permit_declaration?.container_no || '-';
      case 'Seal No': return data.outward_permit_declaration?.seal_no || '-';
      case 'Ctnr Type': return data.outward_permit_declaration?.container_type || '-';
      case 'Final Destination (Port Code)': return data.outward_permit_declaration?.final_destination_port || '-';
      case 'Vessel Name': return data.outward_permit_declaration?.vessel_name || '-';
      case 'Voyage': return data.outward_permit_declaration?.voyage || '-';
      case 'HS code': return data.outward_permit_declaration?.hs_code || '-';
      case 'Description': return data.outward_permit_declaration?.description || '-';
      case 'Net Weight': return data.outward_permit_declaration?.net_weight_kgs || `${data.cargo_details?.total_net_weight || ''} ${data.cargo_details?.weight_unit || ''}`.trim() || '-';
      case 'Value Amount': return data.outward_permit_declaration?.item_price_amount || '-';
      case 'Value Currency': return data.outward_permit_declaration?.item_price_currency || '-';
      case 'Total Outer Pack Qty': return data.outward_permit_declaration?.total_outer_pack_qty || '-';
      case 'Total Outer Pack Unit': return data.outward_permit_declaration?.total_outer_pack_unit || '-';
      case 'Gross Weight Amount': return data.outward_permit_declaration?.gross_weight_amount || '-';
      case 'Gross Weight Unit': return data.outward_permit_declaration?.gross_weight_unit || '-';

      // Transport Job
      case 'Job Number': return data.transport_job?.job_number || '-';
      case 'Customer': return data.transport_job?.customer || '-';
      case 'Pick-up': return data.transport_job?.pickup_location || '-';
      case 'Delivery': return data.transport_job?.delivery_location || '-';
      case 'Container #': return data.transport_job?.container_number || '-';

      // Allied Report
      case 'Container/Booking No': return data.allied_report?.container_booking_no || '-';
      case 'DHC In': return data.allied_report?.dhc_in || data.cdas_report?.dhc_in || '-';
      case 'DHC Out': return data.allied_report?.dhc_out || data.cdas_report?.dhc_out || '-';
      case 'DHE In': return data.allied_report?.dhe_in || data.cdas_report?.dhe_in || '-';
      case 'DHE Out': return data.allied_report?.dhe_out || data.cdas_report?.dhe_out || '-';
      case 'Data Admin Fee': return data.allied_report?.data_admin_fee || data.cdas_report?.data_admin_fee || '-';
      case 'Repair': return data.allied_report?.repair || data.cdas_report?.repair || data.cdac_report?.repair || '-';
      case 'Detention': return data.allied_report?.detention || data.cdas_report?.detention || data.cdac_report?.detention || '-';
      case 'Demurrage': return data.allied_report?.demurrage || data.cdas_report?.demurrage || '-';
      case 'Washing': return data.allied_report?.washing || data.cdas_report?.washing || data.cdac_report?.washing || '-';

      // CDAC Report
      case 'Container Number': return data.cdac_report?.container_number || data.cdas_report?.container_number || '-';
      case 'Demurage': return data.cdac_report?.demurage || '-';
      case 'Admin Fees': return data.cdac_report?.admin_fees || '-';
      case 'DHC': return data.cdac_report?.dhc || '-';
      
      // Bill of Lading Specifics
      // BL Number is already handled above in Payment Voucher section
      case 'Shipper': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Vessel/Voyage': return `${data.logistics_details?.vessel_name || ''} ${data.logistics_details?.voyage_number || ''}`.trim() || '-';
      case 'POL': return data.logistics_details?.port_of_loading || data.outward_permit_declaration?.port_of_loading || '-';
      case 'POD': return data.logistics_details?.port_of_discharge || data.outward_permit_declaration?.port_of_discharge || '-';

      // Commercial Invoice Specifics
      case 'Invoice #': return data.metadata?.reference_number || '-';
      case 'Supplier': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Buyer': return data.metadata?.parties?.consignee_buyer || '-';
      case 'Total Amount': return data.financials?.total_amount?.toLocaleString() || '-';
      case 'Currency': return data.metadata?.currency || '-';
      case 'Incoterms':
        const currentIncoterm = data.metadata?.incoterms || '';
        const isCustomValue = currentIncoterm && !AppConfig.validation.incotermsList.includes(currentIncoterm);
        return (
           <select
            value={currentIncoterm}
            onChange={(e) => onUpdateIncoterm(fileId, docIndex, e.target.value)}
            className="block w-24 rounded-md border-0 py-1 pl-2 pr-6 text-xs text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:text-xs sm:leading-6"
          >
            <option value="">Select</option>
            {isCustomValue && <option value={currentIncoterm}>{currentIncoterm}</option>}
            {AppConfig.validation.incotermsList.map(term => (
              <option key={term} value={term}>{term}</option>
            ))}
          </select>
        );

      // Packing List
      case 'Ref #': return data.metadata?.reference_number || '-';
      case 'Seller': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Total Packages': return data.cargo_details?.total_packages || '-';
      case 'Gross Weight': return `${data.cargo_details?.total_gross_weight || ''} ${data.cargo_details?.weight_unit || ''}`;
      case 'Marks': return data.logistics_details?.marks_and_numbers || '-';

      // PO
      case 'PO Number': return data.metadata?.reference_number || '-';
      case 'Date': return data.metadata?.date || '-';
      case 'Delivery Date': return '-'; 
      
      // Default
      default: return '-';
    }
  };

  // Filter based on active tab
  const displayRows = activeTab === 'All' 
    ? flattenedRows 
    : flattenedRows.filter(row => row.data.document_type === activeTab);

  // Special handling for "All Files" tab - Show one row per FILE, not per document
  if (activeTab === 'All Files') {
    const allFileIds = files.map(f => f.id);
    const allSelected = allFileIds.length > 0 && allFileIds.every(id => selectedIds.has(id));

    return (
      <div className="space-y-2">
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
            <span className="text-sm text-red-700 font-medium">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={() => onBulkDelete(Array.from(selectedIds))}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md transition-colors"
            >
              <Trash2 size={13} /> Delete Selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-red-500 hover:text-red-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-3 py-3 pl-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => handleSelectAll(allFileIds)}
                      className="rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                    />
                  </th>
                  {['File Name', 'Status', 'Document Types Found', 'Upload Date', 'Actions'].map(header => (
                    <th key={header} scope="col" className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {files.map(file => {
                  const typesFound = file.data
                    ? Array.from(new Set(file.data.map(d => d.document_type))).join(', ')
                    : '-';
                  return (
                    <tr key={file.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(file.id) ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-3.5 pl-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(file.id)}
                          onChange={() => toggleSelect(file.id)}
                          className="rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                        />
                      </td>
                      <td className="whitespace-nowrap py-3.5 pr-3 text-sm font-medium text-slate-800">
                        {file.file.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sm">
                        {renderStatusBadge(file.status as FileStatus)}
                      </td>
                      <td className="px-3 py-3.5 text-sm text-slate-500 max-w-xs">
                        {file.status === FileStatus.ERROR
                          ? <span className="text-red-500 text-xs">{file.errorMessage || 'Processing failed — try re-uploading'}</span>
                          : typesFound}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-500">{new Date().toLocaleDateString()}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onDeleteFile(file.id); }}
                          className="text-slate-400 hover:text-red-600 cursor-pointer transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Also include processing/error files in "All" view only
  const processingFiles = activeTab === 'All' ? files.filter(f => f.status !== FileStatus.COMPLETED && f.status !== FileStatus.WARNING) : [];

  if (displayRows.length === 0 && processingFiles.length === 0) {
    return (
      <div className="text-center text-sm text-slate-400 py-12 border-2 border-dashed border-slate-200 rounded-xl bg-white">
        No documents found for <span className="font-medium text-slate-600">{activeTab}</span>
      </div>
    );
  }

  // Determine Columns
  let dynamicHeaders: string[] = [];
  
  // Strict Role-Based Column Selection
  if (activeTab === 'All Files') {
     dynamicHeaders = ['File Name', 'Status', 'Document Types Found', 'Upload Date', 'Actions'];
  } else if (activeTab !== 'All' && AppConfig.views[activeTab as keyof typeof AppConfig.views]) {
    dynamicHeaders = [...AppConfig.views[activeTab as keyof typeof AppConfig.views].columns, 'Actions'];
  } else {
    // Fallback for 'All' or unknown tabs (though 'All' should be hidden for strict roles)
    dynamicHeaders = ['Type', 'Ref #', 'Date', 'Entity', 'Amount/Details', 'Source File', 'Status', 'Actions']; 
  }

  const allVisibleIds = Array.from(new Set(displayRows.map(r => r.file.id)));
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedIds.has(id));

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-sm text-red-700 font-medium">{selectedIds.size} file(s) selected</span>
          <button
            type="button"
            onClick={() => onBulkDelete(Array.from(selectedIds))}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md transition-colors"
          >
            <Trash2 size={13} /> Delete Selected
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-red-500 hover:text-red-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-3 py-3 pl-4">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => handleSelectAll(allVisibleIds)}
                  className="rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                />
              </th>
              {dynamicHeaders.map(header => (
                 <th key={header} scope="col" className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                   {header}
                 </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {/* Render Processing Files first (if in All tab) */}
            {processingFiles.map(file => (
               <tr key={file.id} className="hover:bg-slate-50 transition-colors">
                 <td className="whitespace-nowrap py-3.5 pl-4 pr-3 text-sm text-blue-600 sm:pl-5 font-medium">
                   {file.status === FileStatus.PROCESSING ? 'Processing...' : file.status === FileStatus.PENDING ? 'Pending' : 'Error'}
                 </td>
                 <td colSpan={dynamicHeaders.length - 4} className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-400">
                   {file.status === FileStatus.ERROR
                     ? <span className="text-red-500">{file.errorMessage || 'Unknown Error'}</span>
                     : <span className="inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin shrink-0" />{file.stage || 'Analysis in progress'}</span>}
                 </td>
                 <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-500">{file.file.name}</td>
                 <td className="whitespace-nowrap px-3 py-3.5 text-sm">
                   {renderStatusBadge(file.status as FileStatus)}
                 </td>
                 <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFile(file.id);
                      }}
                      className="text-slate-400 hover:text-red-600 cursor-pointer transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                 </td>
               </tr>
            ))}

            {/* Render Completed/Warning Rows */}
            {displayRows.map((row) => {
              const uniqueKey = `${row.file.id}-${row.docIndex}`;
              const d = row.data;

              return (
              <tr key={uniqueKey} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(row.file.id) ? 'bg-red-50' : ''}`}>
                <td className="px-3 py-3.5 pl-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.file.id)}
                    onChange={() => toggleSelect(row.file.id)}
                    className="rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                  />
                </td>
                {activeTab === 'All' && userRole !== 'logistics' ? (
                   // Generic Row for "All" view
                   <>
                    <td className="whitespace-nowrap py-3.5 pr-3 text-sm font-medium text-slate-800">{d.document_type}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-500">{d.metadata?.reference_number || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-500">{d.metadata?.date || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-500" title={d.metadata?.parties?.shipper_supplier || ''}>
                      {d.metadata?.parties?.shipper_supplier ? d.metadata.parties.shipper_supplier.substring(0, 15) + '...' : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-500">
                       {d.financials?.total_amount ? d.financials.total_amount : d.cargo_details?.total_gross_weight ? `${d.cargo_details.total_gross_weight} kg` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-xs text-slate-400">
                       {row.file.file.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm">
                      {renderStatusBadge(row.file.status as FileStatus)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFile(row.file.id);
                        }}
                        className="text-slate-400 hover:text-red-600 cursor-pointer transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                   </>
                ) : (
                  // Specific Row for Typed view OR Logistics View
                  <>
                    {dynamicHeaders.slice(0, -1).map((header, idx) => (
                      <td key={idx} className="whitespace-nowrap px-3 py-3.5 text-sm text-slate-600 first:pl-4 sm:first:pl-5">
                        {renderDynamicCell(header, d, row.file.id, row.docIndex)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-3.5 text-sm text-right">
                      <div className="flex items-center justify-end gap-2">
                        {activeTab === 'Payment Voucher/GL' && onGenerateVoucher && d && (
                          <button
                            type="button"
                            title="Generate PDF voucher"
                            onClick={(e) => { e.stopPropagation(); onGenerateVoucher([d]); }}
                            className="text-slate-400 hover:text-blue-600 cursor-pointer transition-colors"
                          >
                            <FileText size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteFile(row.file.id);
                          }}
                          className="text-slate-400 hover:text-red-600 cursor-pointer transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
};

export default ResultsTable;