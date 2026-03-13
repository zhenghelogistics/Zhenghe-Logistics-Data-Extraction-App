import React, { useState, useCallback, useEffect } from 'react';
import { extractDocumentData, validateDocumentData } from './services/claudeService';
import { supabase, fetchDocuments, saveDocument, deleteDocument } from './services/supabase';
import ResultsTable from './components/ResultsTable';
import DeveloperNotes from './components/DeveloperNotes';
import LoginScreen from './components/LoginScreen';
import CustomRulesPanel from './components/CustomRulesPanel';
import { ProcessedFile, FileStatus, DocumentData } from './types';
import { AppConfig } from './config';
import { UserRole, TEAM_NAMES } from './users';
// @ts-ignore
import JSZip from 'jszip';
import ConfirmationModal from './components/ConfirmationModal';
import {
  Ship, User, LogOut, Upload, Zap, Download, FileText, Loader2,
  FolderOpen, LayoutDashboard, Receipt, FileCheck2, CreditCard,
  Anchor, Package, ShoppingCart, Code2,
} from 'lucide-react';

const CUSTOM_RULES_STORAGE_KEY = 'zhenghe_custom_rules';

const TAB_ICONS: Record<string, React.ReactNode> = {
  'All Files': <FolderOpen size={15} />,
  'All': <LayoutDashboard size={15} />,
  'Logistics Local Charges Report': <Receipt size={15} />,
  'Outward Permit Declaration': <FileCheck2 size={15} />,
  'Payment Voucher/GL': <CreditCard size={15} />,
  'Bill of Lading': <Anchor size={15} />,
  'Commercial Invoice': <FileText size={15} />,
  'Packing List': <Package size={15} />,
  'Purchase Order': <ShoppingCart size={15} />,
  'Developer Notes': <Code2 size={15} />,
};

function App() {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('All');
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [customRules, setCustomRules] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_RULES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(CUSTOM_RULES_STORAGE_KEY, JSON.stringify(customRules));
  }, [customRules]);

  const getTabs = useCallback(() => {
    if (!userRole) return [];
    const roleConfig = AppConfig.roles[userRole as keyof typeof AppConfig.roles];
    const allowedTypes = roleConfig ? roleConfig.allowedTypes : [];
    return [...allowedTypes, 'Developer Notes'];
  }, [userRole]);

  const tabs = getTabs();

  useEffect(() => {
    if (userRole) {
      const roleConfig = AppConfig.roles[userRole as keyof typeof AppConfig.roles];
      setActiveTab(roleConfig ? roleConfig.defaultTab : 'All');
    }
  }, [userRole]);

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const storedRole = localStorage.getItem('userRole') as UserRole;
        setUserRole(storedRole || UserRole.LOGISTICS);
      }
      setIsSessionLoading(false);
    };
    checkSession();
  }, []);

  useEffect(() => {
    if (!userRole) return;
    const loadDocs = async () => {
      addLog('Fetching existing documents from database...');
      const docs = await fetchDocuments();
      if (docs.length === 0) return;
      const processedFiles: ProcessedFile[] = docs.map(d => {
        let parsedData: DocumentData[] | undefined;
        if (d.extracted_data) {
          parsedData = typeof d.extracted_data === 'string'
            ? JSON.parse(d.extracted_data)
            : d.extracted_data;
        }
        return {
          id: d.id,
          file: new File([], d.filename, { type: 'application/pdf' }),
          status: d.status as FileStatus,
          data: parsedData,
          uploadedAt: d.created_at,
        };
      });
      setFiles(processedFiles);
      addLog(`Loaded ${docs.length} documents from database.`);
    };
    loadDocs();
  }, [userRole]);

  const handleLogin = (role: UserRole) => {
    localStorage.setItem('userRole', role);
    setUserRole(role);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('userRole');
    setUserRole(null);
    setFiles([]);
    setLogs([]);
  };

  const getTeamName = (role: UserRole | null) => {
    return role ? TEAM_NAMES[role] : 'Logistics Data Controller';
  };

  const addFilesToQueue = (newFilesArray: File[]) => {
    const pdfs = newFilesArray.filter(f => f.type === 'application/pdf');
    if (!pdfs.length) return;
    const newFiles: ProcessedFile[] = pdfs.map((file: File) => ({
      id: Math.random().toString(36).substring(7),
      file,
      status: FileStatus.PENDING,
    }));
    setFiles(prev => [...prev, ...newFiles]);
    addLog(`Added ${newFiles.length} file(s) to queue.`);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    addFilesToQueue(Array.from(event.target.files));
    event.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFilesToQueue(Array.from(e.dataTransfer.files));
  };

  const handleIncotermUpdate = (id: string, docIndex: number, newIncoterm: string) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== id || !f.data) return f;
      const newData = [...f.data];
      if (newData[docIndex]) {
        newData[docIndex] = {
          ...newData[docIndex],
          metadata: { ...newData[docIndex].metadata, incoterms: newIncoterm },
        };
      }
      return { ...f, data: newData };
    }));
  };

  const handleDeleteFile = (id: string) => {
    setFileToDelete(id);
    setDeleteModalOpen(true);
  };

  const handleBulkDelete = async (ids: string[]) => {
    if (!window.confirm(`Delete ${ids.length} file(s)? This cannot be undone.`)) return;
    for (const id of ids) {
      const result = await deleteDocument(id);
      if (result.success) {
        setFiles(prev => prev.filter(f => f.id !== id));
        addLog(`Deleted file ${id}`);
      } else {
        addLog(`Error deleting ${id}: ${result.message}`);
      }
    }
  };

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    const id = fileToDelete;
    addLog(`Attempting to delete file ${id}...`);
    const result = await deleteDocument(id);
    if (result.success) {
      setFiles(prev => prev.filter(f => f.id !== id));
      addLog(`Success: ${result.message}`);
    } else {
      addLog(`Error: ${result.message}`);
      alert(`Failed to delete: ${result.message}`);
    }
    setFileToDelete(null);
  };

  const processFiles = useCallback(async () => {
    setIsProcessing(true);
    addLog('Starting batch processing...');
    const pendingFiles = files.filter(f => f.status === FileStatus.PENDING);
    const concurrencyLimit = 10;

    const processSingleFile = async (fileWrapper: ProcessedFile) => {
      setFiles(prev => prev.map(f =>
        f.id === fileWrapper.id ? { ...f, status: FileStatus.PROCESSING } : f
      ));
      addLog(`Processing: ${fileWrapper.file.name}`);
      try {
        const dataList = await extractDocumentData(fileWrapper.file, customRules);
        const validationErrors = validateDocumentData(dataList);
        const newStatus = validationErrors.length > 0 ? FileStatus.WARNING : FileStatus.COMPLETED;
        if (validationErrors.length > 0) {
          addLog(`Warnings for ${fileWrapper.file.name}: ${validationErrors.join(', ')}`);
        } else {
          addLog(`Done: ${fileWrapper.file.name} — ${dataList.length} document(s) found.`);
        }
        const savedDoc = await saveDocument(fileWrapper.file.name, newStatus, dataList);
        setFiles(prev => prev.map(f =>
          f.id === fileWrapper.id ? {
            ...f, status: newStatus, data: dataList,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
            id: savedDoc?.id || f.id,
          } : f
        ));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setFiles(prev => prev.map(f =>
          f.id === fileWrapper.id ? { ...f, status: FileStatus.ERROR, errorMessage } : f
        ));
        addLog(`ERROR processing ${fileWrapper.file.name}: ${errorMessage}`);
        await saveDocument(fileWrapper.file.name, FileStatus.ERROR, undefined);
      }
    };

    for (let i = 0; i < pendingFiles.length; i += concurrencyLimit) {
      const chunk = pendingFiles.slice(i, i + concurrencyLimit);
      await Promise.all(chunk.map(f => processSingleFile(f)));
    }

    addLog('Batch processing finished.');
    setIsProcessing(false);
  }, [files, customRules]);

  const downloadReport = async () => {
    const allDocuments: { data: DocumentData; filename: string }[] = [];
    files.forEach(f => {
      if ((f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING) && f.data) {
        f.data.forEach(doc => allDocuments.push({ data: doc, filename: f.file.name }));
      }
    });
    if (allDocuments.length === 0) return;

    const zip = new JSZip();
    const groups: Record<string, { data: DocumentData; filename: string }[]> = {};
    allDocuments.forEach(item => {
      const type = item.data.document_type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    });

    const safe = (v: any) => `"${String(v || '').replace(/"/g, '""')}"`;

    const generateCSVForType = (type: string, list: { data: DocumentData; filename: string }[]) => {
      let headers: string[] = [];
      switch (type) {
        case 'Logistics Local Charges Report': headers = ['A. BL NUMBER','B. CARRIER / FORWARDER','C. PSS INVOICE NUMBER','D. FREIGHT TERM','E. PLACE OF DESTINATION','F. CNTR TYPE','G. CONTAINER QTY','H. (SGD) THC','I. (SGD) SEAL FEE','J. (SGD) BL FEE','K. (SGD) BL PRINTED FEE','L. (SGD) ENS / AMS / SCMC','M. (SGD) OTHERS CHARGES','N. REMARKS','O. TOTAL AMOUNT','Source File']; break;
        case 'Outward Permit Declaration': headers = ['BL Number','Carrier','Consignee','Container No','Seal No','Ctnr Type','Final Destination','Vessel Name','Voyage','HS Code','Description','Net Weight','Value','Total Outer Pack','Gross Weight','Source File']; break;
        case 'Payment Voucher/GL': headers = ["PSS's Invoice #","Carrier/Forwarder Inv #","BL Number","Payable Amount","Total Payable Amount","Charges","Source File"]; break;
        case 'Bill of Lading': headers = ['BL Number','Shipper','Consignee','Notify Party','Vessel','Voyage','POL','POD','Source File']; break;
        case 'Commercial Invoice': headers = ['Invoice Number','Supplier','Buyer','Incoterms','Total Amount','Currency','Date','Source File']; break;
        default: headers = ['Document Type','Reference Number','Date','Entity','Total Amount','Source File'];
      }

      const rows = list.map(({ data: d, filename }) => {
        const m = d.metadata || {};
        const p = m.parties || {};
        const fin = d.financials || {};
        const log = d.logistics_details || {};

        switch (type) {
          case 'Logistics Local Charges Report': {
            const l = d.logistics_local_charges || {};
            return [safe(l.bl_number||m.reference_number),safe(l.carrier_forwarder),safe(l.pss_invoice_number),safe(l.freight_term),safe(l.place_of_destination),safe(l.container_type),safe(l.container_qty),safe(l.thc_amount),safe(l.seal_fee),safe(l.bl_fee),safe(l.bl_printed_fee),safe(l.ens_ams_fee),safe(l.other_charges),safe(l.remarks),safe(l.total_payable_amount),safe(filename)].join(',');
          }
          case 'Outward Permit Declaration': {
            const opd = d.outward_permit_declaration || {};
            return [safe(opd.bl_number),safe(opd.carrier),safe(opd.consignee),safe(opd.container_no),safe(opd.seal_no),safe(opd.container_type),safe(opd.final_destination_port),safe(opd.vessel_name),safe(opd.voyage),safe(opd.hs_code),safe(opd.description),safe(opd.net_weight_kgs),safe(opd.item_price),safe(opd.total_outer_pack),safe(opd.gross_weight),safe(filename)].join(',');
          }
          case 'Payment Voucher/GL': {
            const pv = d.payment_voucher_details || {};
            const charges = pv.charges_summary || fin.line_item_charges?.map(c => `${c.description}: ${c.amount}`).join('; ') || '';
            return [safe(pv.pss_invoice_number),safe(pv.carrier_invoice_number||m.reference_number),safe(pv.bl_number||m.related_reference_number),safe(pv.payable_amount||fin.total_amount),safe(pv.total_payable_amount),safe(charges),safe(filename)].join(',');
          }
          case 'Bill of Lading':
            return [safe(m.reference_number),safe(p.shipper_supplier),safe(p.consignee_buyer),safe(p.notify_party),safe(log.vessel_name),safe(log.voyage_number),safe(log.port_of_loading),safe(log.port_of_discharge),safe(filename)].join(',');
          case 'Commercial Invoice':
            return [safe(m.reference_number),safe(p.shipper_supplier),safe(p.consignee_buyer),safe(m.incoterms),safe(fin.total_amount),safe(m.currency),safe(m.date),safe(filename)].join(',');
          default:
            return [safe(d.document_type),safe(m.reference_number),safe(m.date),safe(p.shipper_supplier),safe(fin.total_amount),safe(filename)].join(',');
        }
      });

      return [headers.join(','), ...rows].join('\n');
    };

    Object.keys(groups).forEach(type => {
      const csvContent = generateCSVForType(type, groups[type]);
      zip.file(`${type.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`, csvContent);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = AppConfig.export.zipFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog('Exported ZIP Report');
  };

  const downloadLogs = () => {
    if (logs.length === 0) return;
    const blob = new Blob([logs.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = AppConfig.export.logFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const pendingCount = files.filter(f => f.status === FileStatus.PENDING).length;
  const completedCount = files.filter(f => f.status === FileStatus.COMPLETED || f.status === FileStatus.WARNING).length;
  const processingCount = files.filter(f => f.status === FileStatus.PROCESSING).length;
  const errorCount = files.filter(f => f.status === FileStatus.ERROR).length;
  const hasFiles = files.length > 0;

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!userRole) return <LoginScreen onLogin={handleLogin} />;

  const mainTabs = tabs.filter(t => t !== 'Developer Notes');
  const hasDevNotes = tabs.includes('Developer Notes');

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">

      {/* ─── Sidebar ─── */}
      <aside className="w-56 bg-slate-900 flex flex-col flex-shrink-0">

        {/* Brand */}
        <div className="px-4 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <Ship size={16} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">Zhenghe</p>
              <p className="text-slate-500 text-xs mt-0.5">Logistics Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
          <p className="px-3 mb-2 text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Documents
          </p>
          {mainTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-left ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="flex-shrink-0">{TAB_ICONS[tab] || <FileText size={15} />}</span>
              <span className="truncate text-xs">{tab}</span>
            </button>
          ))}

          {hasDevNotes && (
            <>
              <div className="my-3 border-t border-slate-800" />
              <button
                onClick={() => setActiveTab('Developer Notes')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-left ${
                  activeTab === 'Developer Notes'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Code2 size={15} className="flex-shrink-0" />
                <span className="text-xs">Developer Notes</span>
              </button>
            </>
          )}
        </nav>

        {/* User Footer */}
        <div className="px-2 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-7 h-7 bg-blue-600/20 border border-blue-500/30 rounded-full flex items-center justify-center flex-shrink-0">
              <User size={13} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-slate-300 text-xs font-medium truncate">{getTeamName(userRole)}</p>
              <p className="text-slate-600 text-xs">Active session</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300 text-xs transition-colors cursor-pointer"
          >
            <LogOut size={13} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ─── Main Area ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-sm font-semibold text-slate-900">{activeTab}</h1>
              <p className="text-xs text-slate-400">AI-powered logistics document extraction</p>
            </div>

            <div className="flex items-center gap-2">
              {/* Live Stats */}
              {hasFiles && (
                <div className="flex items-center gap-3 pr-3 mr-1 border-r border-slate-200">
                  <div className="text-center">
                    <p className="text-base font-bold text-slate-800 leading-none">{files.length}</p>
                    <p className="text-xs text-slate-400">Files</p>
                  </div>
                  <div className="text-center">
                    <p className="text-base font-bold text-emerald-600 leading-none">{completedCount}</p>
                    <p className="text-xs text-slate-400">Done</p>
                  </div>
                  {pendingCount > 0 && (
                    <div className="text-center">
                      <p className="text-base font-bold text-amber-500 leading-none">{pendingCount}</p>
                      <p className="text-xs text-slate-400">Pending</p>
                    </div>
                  )}
                  {errorCount > 0 && (
                    <div className="text-center">
                      <p className="text-base font-bold text-red-500 leading-none">{errorCount}</p>
                      <p className="text-xs text-slate-400">Errors</p>
                    </div>
                  )}
                </div>
              )}

              {/* Select PDFs */}
              <label
                htmlFor="file-upload"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors cursor-pointer ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Upload size={14} />
                Select PDFs
                <input
                  id="file-upload"
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={isProcessing}
                />
              </label>

              {/* Process */}
              <button
                onClick={processFiles}
                disabled={isProcessing || pendingCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isProcessing
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Zap size={14} />
                }
                {isProcessing ? 'Processing...' : `Process${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
              </button>

              {/* Export */}
              <button
                onClick={downloadReport}
                disabled={completedCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Download size={14} />
                Export
              </button>

              {/* Logs */}
              <button
                onClick={downloadLogs}
                disabled={logs.length === 0}
                title="Download Logs"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <FileText size={14} />
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {isProcessing && (
            <div className="mt-3 pb-1">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" />
                  Processing {processingCount} file{processingCount !== 1 ? 's' : ''}...
                </span>
                <span>{completedCount} of {files.length} complete</span>
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-500"
                  style={{ width: `${files.length > 0 ? (completedCount / files.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-auto p-5">
          <CustomRulesPanel rules={customRules} onRulesChange={setCustomRules} />

          {activeTab === 'Developer Notes' ? (
            <DeveloperNotes />
          ) : !hasFiles ? (
            /* ── Drag & Drop Upload Zone ── */
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload-drop')?.click()}
              className={`flex flex-col items-center justify-center min-h-96 rounded-2xl border-2 border-dashed transition-all cursor-pointer select-none ${
                isDragging
                  ? 'border-blue-400 bg-blue-50 scale-[1.01]'
                  : 'border-slate-300 bg-white hover:border-blue-300 hover:bg-slate-50'
              }`}
            >
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-colors ${isDragging ? 'bg-blue-100' : 'bg-slate-100'}`}>
                <Upload size={28} className={isDragging ? 'text-blue-500' : 'text-slate-400'} />
              </div>
              <p className="text-slate-800 font-semibold text-base mb-1">
                {isDragging ? 'Drop your PDFs here' : 'Upload PDF Documents'}
              </p>
              <p className="text-slate-400 text-sm mb-5">
                Drag & drop files here, or click to browse
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors pointer-events-none">
                <Upload size={15} />
                Browse Files
              </div>
              <p className="text-slate-400 text-xs mt-4">PDF files only</p>
              <input
                id="file-upload-drop"
                type="file"
                accept="application/pdf"
                multiple
                className="sr-only"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
            </div>
          ) : (
            <ResultsTable
              files={files}
              onUpdateIncoterm={handleIncotermUpdate}
              onDeleteFile={handleDeleteFile}
              onBulkDelete={handleBulkDelete}
              activeTab={activeTab}
              userRole={userRole}
            />
          )}
        </main>
      </div>

      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDeleteFile}
        title="Delete Document"
        message="Are you sure you want to delete this document? This action cannot be undone and will remove it for all users."
      />
    </div>
  );
}

export default App;
