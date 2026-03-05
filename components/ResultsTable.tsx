import React from 'react';
import { ProcessedFile, FileStatus, DocumentData } from '../types';
import { AppConfig } from '../config';
import { CheckCircle, AlertTriangle, Clock, XCircle, Loader2, Trash2 } from 'lucide-react';
import { UserRole } from '../users';

interface ResultsTableProps {
  files: ProcessedFile[];
  onUpdateIncoterm: (fileId: string, docIndex: number, value: string) => void;
  onDeleteFile: (fileId: string) => void;
  activeTab: string;
  userRole: UserRole | null;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ files, onUpdateIncoterm, onDeleteFile, activeTab, userRole }) => {
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
      case "Payable Amount": return data.payment_voucher_details?.payable_amount || (data.financials?.total_amount ? `${data.financials.total_amount.toLocaleString()} ${data.metadata?.currency || ''}` : '-');
      case "Total Payable Amount": return data.payment_voucher_details?.total_payable_amount || '-';
      case "Charges": return data.payment_voucher_details?.charges_summary || data.financials?.line_item_charges?.map(c => `${c.description}: ${c.amount}`).join('; ') || '-';
      
      // Outward Permit Declaration
      case 'Permit Number': return data.outward_permit_declaration?.permit_number || '-';
      case 'Exporter': return data.outward_permit_declaration?.exporter || '-';
      case 'Consignee': return data.outward_permit_declaration?.consignee || '-';
      case 'Total FOB Value': return data.outward_permit_declaration?.total_fob_value || '-';
      case 'GST Amount': return data.outward_permit_declaration?.gst_amount || '-';

      // Transport Job
      case 'Job Number': return data.transport_job?.job_number || '-';
      case 'Customer': return data.transport_job?.customer || '-';
      case 'Pick-up': return data.transport_job?.pickup_location || '-';
      case 'Delivery': return data.transport_job?.delivery_location || '-';
      case 'Container #': return data.transport_job?.container_number || '-';
      
      // Bill of Lading Specifics
      // BL Number is already handled above in Payment Voucher section
      case 'Shipper': return data.metadata?.parties?.shipper_supplier || '-';
      case 'Consignee': return data.metadata?.parties?.consignee_buyer || '-';
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
      case 'Net Weight': return `${data.cargo_details?.total_net_weight || ''} ${data.cargo_details?.weight_unit || ''}`;
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
    const dynamicHeaders = ['File Name', 'Status', 'Document Types Found', 'Upload Date', 'Actions'];
    
    return (
      <div className="mt-8 overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                {dynamicHeaders.map(header => (
                   <th key={header} scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 first:pl-4 sm:first:pl-6">
                     {header}
                   </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {files.map(file => {
                // Summarize types found in this file
                const typesFound = file.data 
                  ? Array.from(new Set(file.data.map(d => d.document_type))).join(', ') 
                  : '-';

                return (
                  <tr key={file.id}>
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                      {file.file.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {renderStatusBadge(file.status as FileStatus)}
                      {file.status === FileStatus.ERROR && <span className="text-red-500 text-xs block">{file.errorMessage}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {typesFound}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {new Date().toLocaleDateString()} {/* Placeholder for upload date */}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-right">
                       <button 
                         type="button"
                         onClick={(e) => {
                           e.stopPropagation();
                           onDeleteFile(file.id);
                         }} 
                         className="text-red-600 hover:text-red-900 cursor-pointer"
                       >
                         <Trash2 size={16} />
                       </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Also include processing/error files in "All" view only
  const processingFiles = activeTab === 'All' ? files.filter(f => f.status !== FileStatus.COMPLETED && f.status !== FileStatus.WARNING) : [];

  if (displayRows.length === 0 && processingFiles.length === 0) {
    return (
      <div className="mt-8 text-center text-sm text-gray-500 py-8 border-2 border-dashed border-gray-200 rounded-lg">
        No documents found for {activeTab}
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

  return (
    <div className="mt-8 overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              {dynamicHeaders.map(header => (
                 <th key={header} scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 first:pl-4 sm:first:pl-6">
                   {header}
                 </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {/* Render Processing Files first (if in All tab) */}
            {processingFiles.map(file => (
               <tr key={file.id}>
                 <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-blue-600 sm:pl-6 font-medium">
                   {file.status === FileStatus.PROCESSING ? 'Processing...' : file.status === FileStatus.PENDING ? 'Pending' : 'Error'}
                 </td>
                 <td colSpan={dynamicHeaders.length - 4} className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">
                   {file.status === FileStatus.ERROR ? <span className="text-red-500">{file.errorMessage || 'Unknown Error'}</span> : 'Analysis in progress'}
                 </td>
                 <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{file.file.name}</td>
                 <td className="whitespace-nowrap px-3 py-4 text-sm">
                   {renderStatusBadge(file.status as FileStatus)}
                 </td>
                 <td className="whitespace-nowrap px-3 py-4 text-sm text-right">
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('Trash clicked (Processing) for ID:', file.id);
                        onDeleteFile(file.id);
                      }} 
                      className="text-red-600 hover:text-red-900 cursor-pointer z-50 relative"
                    >
                      <Trash2 size={16} />
                    </button>
                 </td>
               </tr>
            ))}
            
            {/* Render Completed/Warning Rows */}
            {displayRows.map((row, idx) => {
              const uniqueKey = `${row.file.id}-${row.docIndex}`;
              const d = row.data;

              return (
              <tr key={uniqueKey}>
                {activeTab === 'All' && userRole !== 'logistics' ? (
                   // Generic Row for "All" view
                   <>
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{d.document_type}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{d.metadata?.reference_number || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{d.metadata?.date || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500" title={d.metadata?.parties?.shipper_supplier || ''}>
                      {d.metadata?.parties?.shipper_supplier ? d.metadata.parties.shipper_supplier.substring(0, 15) + '...' : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                       {d.financials?.total_amount ? d.financials.total_amount : d.cargo_details?.total_gross_weight ? `${d.cargo_details.total_gross_weight} kg` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 text-xs">
                       {row.file.file.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      {renderStatusBadge(row.file.status as FileStatus)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-right">
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Trash clicked (Generic) for ID:', row.file.id);
                          onDeleteFile(row.file.id);
                        }} 
                        className="text-red-600 hover:text-red-900 cursor-pointer z-50 relative"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                   </>
                ) : (
                  // Specific Row for Typed view OR Logistics View
                  <>
                    {dynamicHeaders.slice(0, -1).map((header, idx) => (
                      <td key={idx} className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 first:pl-4 sm:first:pl-6">
                        {renderDynamicCell(header, d, row.file.id, row.docIndex)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-right">
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Trash clicked (Specific) for ID:', row.file.id);
                          onDeleteFile(row.file.id);
                        }} 
                        className="text-red-600 hover:text-red-900 cursor-pointer z-50 relative"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;