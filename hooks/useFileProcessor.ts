import { useState, useCallback, useEffect } from 'react';
import { extractDocumentData, validateDocumentData } from '../services/claudeService';
import {
  fetchDocuments, saveDocument, deleteDocument,
  fetchContainerBilling, insertContainerBillingRows,
  deleteContainerBilling, deleteManyContainerBilling,
  ContainerBillingRecord,
} from '../services/supabase';
import { ProcessedFile, FileStatus, DocumentData } from '../types';
import { UserRole } from '../users';

interface Options {
  customRules: string[];
  userRole: UserRole | null;
  addLog: (msg: string) => void;
  activeTab?: string;
}

const NON_BILLABLE_KEYS = new Set(['dhc_in', 'dhc_out', 'dhe_in', 'dhe_out', 'data_admin_fee']);

function extractContainerRows(
  dataList: DocumentData[],
  filename: string,
  documentId: string,
): Omit<ContainerBillingRecord, 'id' | 'user_id' | 'created_at'>[] {
  const rows: Omit<ContainerBillingRecord, 'id' | 'user_id' | 'created_at'>[] = [];
  const add = (charges: Record<string, string>, k: string, v: string | null | undefined) => {
    if (v) charges[k] = v;
  };
  const hasBillableCharge = (charges: Record<string, string>) =>
    Object.keys(charges).some(k => !NON_BILLABLE_KEYS.has(k));

  for (const doc of dataList) {
    if (doc.document_type === 'Allied Report' && doc.allied_report) {
      const r = doc.allied_report;
      const container_date = r.invoice_date ?? doc.metadata?.date ?? null;
      const charges: Record<string, string> = {};
      add(charges, 'dhc_in', r.dhc_in); add(charges, 'dhc_out', r.dhc_out);
      add(charges, 'dhe_in', r.dhe_in); add(charges, 'dhe_out', r.dhe_out);
      add(charges, 'data_admin_fee', r.data_admin_fee);
      add(charges, 'washing', r.washing); add(charges, 'repair', r.repair);
      add(charges, 'detention', r.detention); add(charges, 'demurrage', r.demurrage);
      if (!hasBillableCharge(charges)) continue;
      rows.push({ source_document_id: documentId, filename, report_type: 'Allied Report', container_number: r.container_booking_no ?? null, charges, charge_validations: {}, billing_status: 'unbilled', billed_at: null, billing_remarks: null, container_date, is_archived: false, archive_label: null });
    }
    if (doc.document_type === 'CDAS Report' && doc.cdas_report) {
      const r = doc.cdas_report;
      const container_date = r.invoice_date ?? doc.metadata?.date ?? null;
      const charges: Record<string, string> = {};
      add(charges, 'dhc_in', r.dhc_in); add(charges, 'dhc_out', r.dhc_out);
      add(charges, 'dhe_in', r.dhe_in); add(charges, 'dhe_out', r.dhe_out);
      add(charges, 'data_admin_fee', r.data_admin_fee);
      add(charges, 'washing', r.washing); add(charges, 'repair', r.repair);
      add(charges, 'detention', r.detention); add(charges, 'demurrage', r.demurrage);
      if (!hasBillableCharge(charges)) continue;
      rows.push({ source_document_id: documentId, filename, report_type: 'CDAS Report', container_number: r.container_number ?? null, charges, charge_validations: {}, billing_status: 'unbilled', billed_at: null, billing_remarks: null, container_date, is_archived: false, archive_label: null });
    }
  }
  return rows;
}

export function useFileProcessor({ customRules, userRole, addLog, activeTab }: Options) {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [containerRecords, setContainerRecords] = useState<ContainerBillingRecord[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);

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
          billing_status: d.billing_status ?? 'unbilled',
          billed_at: d.billed_at ?? null,
          billing_remarks: d.billing_remarks ?? null,
          charge_validations: (d.charge_validations as Record<string, boolean>) ?? {},
        };
      });
      setFiles(processedFiles);
      addLog(`Loaded ${docs.length} documents from database.`);
      const containerRows = await fetchContainerBilling();
      setContainerRecords(containerRows);
      addLog(`Loaded ${containerRows.length} container billing records.`);
    };
    loadDocs();
  }, [userRole]);

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
        let firstResult = await extractDocumentData(fileWrapper.file, customRules, (stage, progress) => {
          setFiles(prev => prev.map(f => f.id === fileWrapper.id ? { ...f, stage, progress } : f));
        }, userRole ?? undefined, undefined, undefined, activeTab);

        // Auto-retry once transparently when partial — most transient failures resolve on retry
        if (firstResult.status === 'partial') {
          addLog(`Auto-retrying ${fileWrapper.file.name} (${firstResult.warnings.length} batch(es) failed — trying again)...`);
          setFiles(prev => prev.map(f => f.id === fileWrapper.id ? { ...f, stage: 'Retrying…', progress: 0 } : f));
          const retry = await extractDocumentData(fileWrapper.file, customRules, (stage, progress) => {
            setFiles(prev => prev.map(f => f.id === fileWrapper.id ? { ...f, stage, progress } : f));
          }, userRole ?? undefined, undefined, undefined, activeTab);
          if (retry.documents.length >= firstResult.documents.length) firstResult = retry;
        }

        const { documents: dataList, warnings: extractionWarnings, status: extractionStatus } = firstResult;
        const validationErrors = validateDocumentData(dataList);
        const hasWarnings = validationErrors.length > 0 || extractionWarnings.length > 0;
        const newStatus = extractionStatus === 'failed' ? FileStatus.ERROR
          : hasWarnings || extractionStatus === 'partial' ? FileStatus.WARNING
          : FileStatus.COMPLETED;
        if (extractionWarnings.length > 0) {
          addLog(`⚠️ Partial extraction for ${fileWrapper.file.name} after auto-retry: ${extractionWarnings.join(' | ')}`);
        }
        if (validationErrors.length > 0) {
          addLog(`Validation warnings for ${fileWrapper.file.name}: ${validationErrors.join(', ')}`);
        }
        if (!hasWarnings && extractionStatus === 'complete') {
          addLog(`Done: ${fileWrapper.file.name} — ${dataList.length} document(s) found.`);
        }
        const savedDoc = await saveDocument(fileWrapper.file.name, newStatus, dataList);
        setFiles(prev => prev.map(f =>
          f.id === fileWrapper.id ? {
            ...f, status: newStatus, data: dataList,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
            extractionWarnings: extractionWarnings.length > 0 ? extractionWarnings : undefined,
            failedChunkIndices: firstResult.chunkDiagnostics.filter(d => d.status === 'failed').map(d => d.chunkIndex),
            id: savedDoc?.id || f.id,
          } : f
        ));
        if (savedDoc?.id) {
          const containerRows = extractContainerRows(dataList, fileWrapper.file.name, savedDoc.id);
          addLog(`Extracted ${containerRows.length} container row(s) for ${fileWrapper.file.name}.`);
          if (containerRows.length > 0) {
            const inserted = await insertContainerBillingRows(containerRows);
            addLog(`Inserted ${inserted.length} new container billing record(s) for ${fileWrapper.file.name}.`);
            const refreshed = await fetchContainerBilling();
            setContainerRecords(refreshed);
          }
        }
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
  }, [files, customRules, userRole, activeTab]);

  const handleReprocess = useCallback(async (id: string) => {
    const fileWrapper = files.find(f => f.id === id);
    if (!fileWrapper || fileWrapper.file.size === 0) return;
    setIsProcessing(true);
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: FileStatus.PROCESSING, data: undefined, errorMessage: undefined, validationErrors: undefined, stage: undefined, progress: undefined } : f
    ));
    addLog(`Re-processing: ${fileWrapper.file.name}`);
    try {
      const { documents: dataList, warnings: extractionWarnings, status: extractionStatus } =
        await extractDocumentData(fileWrapper.file, customRules, (stage, progress) => {
          setFiles(prev => prev.map(f => f.id === id ? { ...f, stage, progress } : f));
        }, userRole ?? undefined, undefined, undefined, activeTab);
      const validationErrors = validateDocumentData(dataList);
      const hasWarnings = validationErrors.length > 0 || extractionWarnings.length > 0;
      const newStatus = extractionStatus === 'failed' ? FileStatus.ERROR
        : hasWarnings || extractionStatus === 'partial' ? FileStatus.WARNING
        : FileStatus.COMPLETED;
      if (extractionWarnings.length > 0) {
        addLog(`⚠️ Partial extraction for ${fileWrapper.file.name}: ${extractionWarnings.join(' | ')}`);
      }
      addLog(`Re-done: ${fileWrapper.file.name} — ${dataList.length} document(s).`);
      const savedDoc = await saveDocument(fileWrapper.file.name, newStatus, dataList);
      setFiles(prev => prev.map(f =>
        f.id === id ? {
          ...f, status: newStatus, data: dataList,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
          extractionWarnings: extractionWarnings.length > 0 ? extractionWarnings : undefined,
          id: savedDoc?.id || f.id,
        } : f
      ));
      if (savedDoc?.id) {
        const containerRows = extractContainerRows(dataList, fileWrapper.file.name, savedDoc.id);
        if (containerRows.length > 0) {
          await insertContainerBillingRows(containerRows);
          const refreshed = await fetchContainerBilling();
          setContainerRecords(refreshed);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: FileStatus.ERROR, errorMessage } : f));
      addLog(`ERROR re-processing ${fileWrapper.file.name}: ${errorMessage}`);
    }
    setIsProcessing(false);
  }, [files, customRules, userRole, activeTab]);

  const handleIncotermUpdate = (id: string, docIndex: number, newIncoterm: string) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== id || !f.data) return f;
      const newData = [...f.data];
      if (newData[docIndex]) {
        newData[docIndex] = { ...newData[docIndex], metadata: { ...newData[docIndex].metadata, incoterms: newIncoterm } };
      }
      return { ...f, data: newData };
    }));
  };

  const handleFreightTermUpdate = (id: string, docIndex: number, newFreightTerm: string) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== id || !f.data) return f;
      const newData = [...f.data];
      if (newData[docIndex]) {
        newData[docIndex] = { ...newData[docIndex], logistics_local_charges: { ...newData[docIndex].logistics_local_charges, freight_term: newFreightTerm } };
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
        setContainerRecords(prev => prev.map(r => r.source_document_id === id ? { ...r, source_document_id: null } : r));
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
      setContainerRecords(prev => prev.map(r => r.source_document_id === id ? { ...r, source_document_id: null } : r));
      addLog(`Success: ${result.message}`);
    } else {
      addLog(`Error: ${result.message}`);
      alert(`Failed to delete: ${result.message}`);
    }
    setFileToDelete(null);
  };

  const handleBillingUpdate = (fileId: string, updates: Partial<ProcessedFile>) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
  };

  const handleContainerRecordUpdate = (id: string, updates: Partial<ContainerBillingRecord>) => {
    setContainerRecords(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const handleContainerRecordDelete = async (id: string) => {
    try {
      await deleteContainerBilling(id);
      setContainerRecords(prev => prev.filter(r => r.id !== id));
    } catch {
      addLog(`Error deleting container billing record ${id}`);
    }
  };

  const handleContainerRecordDeleteMany = async (ids: string[]) => {
    await deleteManyContainerBilling(ids);
    setContainerRecords(prev => prev.filter(r => !ids.includes(r.id)));
  };

  const handleRetryFailedChunks = useCallback(async (id: string) => {
    const fileWrapper = files.find(f => f.id === id);
    if (!fileWrapper || fileWrapper.file.size === 0 || !fileWrapper.failedChunkIndices?.length) return;
    setIsProcessing(true);
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: FileStatus.PROCESSING, stage: 'Retrying failed batches…', progress: 0 } : f
    ));
    addLog(`Retrying ${fileWrapper.failedChunkIndices.length} failed batch(es) for: ${fileWrapper.file.name}`);
    try {
      const { documents: dataList, warnings: extractionWarnings, status: extractionStatus, chunkDiagnostics } =
        await extractDocumentData(
          fileWrapper.file, customRules,
          (stage, progress) => setFiles(prev => prev.map(f => f.id === id ? { ...f, stage, progress } : f)),
          userRole ?? undefined,
          fileWrapper.failedChunkIndices,
          fileWrapper.data,
          activeTab,
        );
      const validationErrors = validateDocumentData(dataList);
      const hasWarnings = validationErrors.length > 0 || extractionWarnings.length > 0;
      const newStatus = extractionStatus === 'failed' ? FileStatus.ERROR
        : hasWarnings || extractionStatus === 'partial' ? FileStatus.WARNING
        : FileStatus.COMPLETED;
      const savedDoc = await saveDocument(fileWrapper.file.name, newStatus, dataList);
      setFiles(prev => prev.map(f =>
        f.id === id ? {
          ...f, status: newStatus, data: dataList,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
          extractionWarnings: extractionWarnings.length > 0 ? extractionWarnings : undefined,
          failedChunkIndices: chunkDiagnostics.filter(d => d.status === 'failed').map(d => d.chunkIndex),
          id: savedDoc?.id || f.id,
        } : f
      ));
      addLog(`Retry done: ${fileWrapper.file.name} — ${dataList.length} document(s).`);
      if (savedDoc?.id) {
        const containerRows = extractContainerRows(dataList, fileWrapper.file.name, savedDoc.id);
        if (containerRows.length > 0) {
          await insertContainerBillingRows(containerRows);
          const refreshed = await fetchContainerBilling();
          setContainerRecords(refreshed);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: FileStatus.ERROR, errorMessage } : f));
      addLog(`ERROR retrying chunks for ${fileWrapper.file.name}: ${errorMessage}`);
    }
    setIsProcessing(false);
  }, [files, customRules, userRole, activeTab]);

  return {
    files, setFiles, isProcessing, containerRecords, setContainerRecords,
    deleteModalOpen, setDeleteModalOpen, fileToDelete,
    addFilesToQueue, processFiles, handleReprocess, handleRetryFailedChunks,
    handleIncotermUpdate, handleFreightTermUpdate,
    handleDeleteFile, handleBulkDelete, confirmDeleteFile,
    handleBillingUpdate, handleContainerRecordUpdate,
    handleContainerRecordDelete, handleContainerRecordDeleteMany,
  };
}
