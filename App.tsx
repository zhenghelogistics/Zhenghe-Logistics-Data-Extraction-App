import React, { useState, useCallback, useEffect } from 'react';
import { extractDocumentData, validateDocumentData } from './services/claudeService';
import { supabase, fetchDocuments, saveDocument, deleteDocument } from './services/supabase';
import ResultsTable from './components/ResultsTable';
import DeveloperNotes from './components/DeveloperNotes';
import LoginScreen from './components/LoginScreen';
import CustomRulesPanel from './components/CustomRulesPanel';
import { ProcessedFile, FileStatus, DocumentData } from './types';
import { AppConfig } from './config';
import { UserRole, USERS } from './users';
// @ts-ignore
import JSZip from 'jszip';
import ConfirmationModal from './components/ConfirmationModal';

const CUSTOM_RULES_STORAGE_KEY = 'zhenghe_custom_rules';

function App() {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('All');
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [customRules, setCustomRules] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_RULES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Delete Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);

  // Persist custom rules to localStorage whenever they change
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

  // Check for existing session on mount
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

  // Load documents when user logs in
  useEffect(() => {
    if (!userRole) return;

    const loadDocs = async () => {
      addLog('Fetching existing documents from database...');
      const docs = await fetchDocuments();
      if (docs.length === 0) return;

      const processedFiles: ProcessedFile[] = docs.map(d => {
        let parsedData: DocumentData[] | undefined;
        if (d.extracted_data) {
          // Supabase JSONB comes back as an object already — handle both cases
          parsedData = typeof d.extracted_data === 'string'
            ? JSON.parse(d.extracted_data)
            : d.extracted_data;
        }
        return {
          id: d.id,
          file: new File([], d.filename, { type: 'application/pdf' }),
          status: d.status as FileStatus,
          data: parsedData,
          uploadedAt: d.created_at, // Real upload date from DB
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
    const user = USERS.find(u => u.role === role);
    return user ? user.teamName : 'Logistics Data Controller';
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    const newFiles: ProcessedFile[] = Array.from(event.target.files).map((file: File) => ({
      id: Math.random().toString(36).substring(7),
      file,
      status: FileStatus.PENDING,
    }));
    setFiles(prev => [...prev, ...newFiles]);
    addLog(`Added ${newFiles.length} file(s) to queue.`);
    event.target.value = '';
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

  // Process pending files with concurrency control
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
        // Pass custom rules into extraction
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
            ...f,
            status: newStatus,
            data: dataList,
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

    // Process in chunks
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
      if (userRole === UserRole.LOGISTICS) {
        headers = ['A. BL NUMBER','B. CARRIER / FORWARDER','C. PSS INVOICE NUMBER','D. FREIGHT TERM','E. PLACE OF DESTINATION','F. CNTR TYPE','G. CONTAINER QTY','H. (SGD) THC','I. (SGD) SEAL FEE','J. (SGD) BL FEE','K. (SGD) BL PRINTED FEE','L. (SGD) ENS / AMS / SCMC','M. (SGD) OTHERS CHARGES','N. REMARKS','O. TOTAL AMOUNT','Source File'];
      } else {
        switch (type) {
          case 'Payment Voucher/GL': headers = ["PSS's Invoice #","Carrier/Forwarder Inv #","BL Number","Payable Amount","Total Payable Amount","Charges","Source File"]; break;
          case 'Bill of Lading': headers = ['BL Number','Shipper','Consignee','Notify Party','Vessel','Voyage','POL','POD','Source File']; break;
          case 'Commercial Invoice': headers = ['Invoice Number','Supplier','Buyer','Incoterms','Total Amount','Currency','Date','Source File']; break;
          default: headers = ['Document Type','Reference Number','Date','Entity','Total Amount','Source File'];
        }
      }

      const rows = list.map(({ data: d, filename }) => {
        const m = d.metadata || {};
        const p = m.parties || {};
        const fin = d.financials || {};
        const log = d.logistics_details || {};

        if (userRole === UserRole.LOGISTICS) {
          const l = d.logistics_local_charges || {};
          return [safe(l.bl_number||m.reference_number),safe(l.carrier_forwarder),safe(l.pss_invoice_number),safe(l.freight_term),safe(l.place_of_destination),safe(l.container_type),safe(l.container_qty),safe(l.thc_amount),safe(l.seal_fee),safe(l.bl_fee),safe(l.bl_printed_fee),safe(l.ens_ams_fee),safe(l.other_charges),safe(l.remarks),safe(l.total_payable_amount),safe(filename)].join(',');
        }

        switch (type) {
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
    URL.revokeObjectURL(url); // Clean up memory
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

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!userRole) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="md:flex md:items-center md:justify-between mb-8">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              {getTeamName(userRole)}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Classify and extract complex logistics data using Claude AI.
            </p>
          </div>
          <div className="mt-4 flex flex-col md:flex-row gap-2 md:ml-4 md:mt-0">
            <label
              htmlFor="file-upload"
              className={`cursor-pointer inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Select PDFs
              <input id="file-upload" name="file-upload" type="file" accept="application/pdf" multiple className="sr-only" onChange={handleFileChange} disabled={isProcessing} />
            </label>
            <button
              type="button"
              onClick={processFiles}
              disabled={isProcessing || pendingCount === 0}
              className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm ${isProcessing || pendingCount === 0 ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {isProcessing ? 'Processing...' : `Process ${pendingCount > 0 ? pendingCount : ''} Files`}
            </button>
            <button
              type="button"
              onClick={downloadReport}
              disabled={completedCount === 0}
              className={`inline-flex items-center justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 ${completedCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Download Report (Zip)
            </button>
            <button
              type="button"
              onClick={downloadLogs}
              disabled={logs.length === 0}
              className={`inline-flex items-center justify-center rounded-md bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 ${logs.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Log
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Custom Rules Panel */}
        <CustomRulesPanel rules={customRules} onRulesChange={setCustomRules} />

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium ${activeTab === tab ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'Developer Notes' ? (
          <DeveloperNotes />
        ) : files.length === 0 ? (
          <div className="text-center rounded-lg border-2 border-dashed border-gray-300 p-12 hover:border-gray-400">
            <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v20c0 4.418 7.163 8 16 8 1.381 0 2.721-.087 4-.252M8 14c0 4.418 7.163 8 16 8s16-3.582 16-8M8 14c0-4.418 7.163-8 16-8s16 3.582 16 8m0 0v14m0-4c0 4.418-7.163 8-16 8S8 28.418 8 24m32 10v6m0 0v6m0-6h6m-6 0h-6" />
            </svg>
            <span className="mt-2 block text-sm font-semibold text-gray-900">Upload documents to get started</span>
            <label htmlFor="file-upload-center" className="mt-2 inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 cursor-pointer">
              Select PDF Files
              <input id="file-upload-center" name="file-upload-center" type="file" accept="application/pdf" multiple className="sr-only" onChange={handleFileChange} disabled={isProcessing} />
            </label>
          </div>
        ) : (
          <ResultsTable files={files} onUpdateIncoterm={handleIncotermUpdate} onDeleteFile={handleDeleteFile} activeTab={activeTab} userRole={userRole} />
        )}

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
