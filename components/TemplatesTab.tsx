import React, { useState, useRef, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import { jsonrepair } from 'jsonrepair';
import { Plus, Pencil, Trash2, FlaskConical, Download, X, FileText, Copy, Check, Blocks } from 'lucide-react';
import { ExtractionTemplate, TemplateField, ProcessedFile, FileStatus } from '../types';
import { saveTemplate, updateTemplate, deleteTemplate } from '../services/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  templates: ExtractionTemplate[];
  onTemplatesChange: (templates: ExtractionTemplate[]) => void;
  files: ProcessedFile[];
  currentUserId: string | null;
  pinnedTemplateIds: string[];
  onPinToggle: (id: string) => void;
  focusedTemplateName?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toKey = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const ADMIN_USER_ID = import.meta.env.VITE_ADMIN_USER_ID;

// ─── Discovery Wizard ─────────────────────────────────────────────────────────

type WizardStage = 'name' | 'upload' | 'scanning' | 'pick';

interface DiscoveredItem { label: string; value: string }
interface PickedField { docLabel: string; userLabel: string }

interface WizardProps {
  initial?: ExtractionTemplate | null;
  onSave: (t: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onClose: () => void;
}

const Wizard: React.FC<WizardProps> = ({ initial, onSave, onClose }) => {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [stage, setStage] = useState<WizardStage>(isEdit ? 'pick' : 'name');
  const [scanProgress, setScanProgress] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredItem[]>([]);
  const [picked, setPicked] = useState<PickedField[]>(
    initial?.fields.map(f => ({ docLabel: f.hint || f.label, userLabel: f.label })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  };

  const scanPDF = async (file: File) => {
    setStage('scanning');
    setScanProgress('Reading your document…');
    setScanError(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const total = pdfDoc.getPageCount();
      const allValues: DiscoveredItem[] = [];

      for (let start = 0; start < total; start += 10) {
        const end = Math.min(start + 10, total);
        setScanProgress(total === 1 ? 'Scanning document…' : `Scanning pages ${start + 1}–${end} of ${total}…`);
        try {
          const chunk = await PDFDocument.create();
          const indices = Array.from({ length: end - start }, (_, i) => start + i);
          const pages = await chunk.copyPages(pdfDoc, indices);
          pages.forEach(p => chunk.addPage(p));
          const bytes = await chunk.save();
          const base64 = toBase64(bytes);

          const apiRes = await fetch('/api/templateChat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64,
              systemPrompt: 'You are a document scanner. Return ONLY a valid JSON array of {"label": "exact label text from document", "value": "the corresponding value"} objects. Include every labelled field you can find.',
              userText: 'List every labelled field and its value. Return as a JSON array.',
              maxTokens: 1024,
              prefill: '[',
            }),
          });
          if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);
          const { text } = await apiRes.json();
          const raw = '[' + text;
          const parsed = JSON.parse(jsonrepair(raw));
          if (Array.isArray(parsed)) allValues.push(...parsed);
        } catch (e) { console.warn('Chunk scan failed:', e); }
      }

      const seen = new Set<string>();
      const unique = allValues.filter(v => {
        const k = `${v.label}|${v.value}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setDiscovered(unique);
      setStage('pick');
    } catch (err) {
      console.error('PDF scan failed:', err);
      setScanError('Could not read this PDF. Try a different one, or skip to add fields manually.');
      setDiscovered([]);
      setStage('pick');
    }
  };

  const isSelected = (item: DiscoveredItem) => picked.some(p => p.docLabel === item.label);

  const toggleItem = (item: DiscoveredItem) => {
    if (isSelected(item)) {
      setPicked(prev => prev.filter(p => p.docLabel !== item.label));
    } else {
      setPicked(prev => [...prev, { docLabel: item.label, userLabel: item.label }]);
    }
  };

  const updateField = (i: number, key: 'userLabel' | 'docLabel', value: string) =>
    setPicked(prev => prev.map((f, j) => j === i ? { ...f, [key]: value } : f));

  const removePickedField = (i: number) => setPicked(prev => prev.filter((_, j) => j !== i));

  const addManualField = () => setPicked(prev => [...prev, { docLabel: '', userLabel: '' }]);

  const handleSave = async () => {
    const fields = picked
      .filter(p => p.userLabel.trim())
      .map(p => ({ key: toKey(p.userLabel), label: p.userLabel.trim(), hint: p.docLabel.trim() || p.userLabel.trim() }));
    setSaving(true);
    try {
      await onSave({ name: name.trim(), document_hint: '', fields, is_active: initial?.is_active ?? true });
    } finally { setSaving(false); }
  };

  const canSave = name.trim().length > 0 && picked.some(p => p.userLabel.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-lowest rounded-2xl w-[680px] max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="px-7 pt-6 pb-4 flex-shrink-0 flex items-center justify-between">
          <p className="text-[1rem] font-semibold text-primary">
            {isEdit ? `Edit — ${initial!.name}` : 'New Template'}
          </p>
          <button onClick={onClose} className="text-outline hover:text-primary transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="px-7 pb-7 flex-1 overflow-y-auto space-y-5">

          {/* Stage: name */}
          {stage === 'name' && (
            <>
              <div>
                <p className="text-[1.75rem] font-bold text-primary leading-tight">What do you call this document?</p>
                <p className="text-sm text-[#4a5568] mt-1">Give your template a recognisable name — e.g. "FR Meyer Freight Invoice"</p>
              </div>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && setStage('upload')}
                placeholder="Template name…"
                className="w-full bg-surface-low rounded-lg px-4 py-3 text-sm text-primary placeholder-outline focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/10 border border-transparent transition"
              />
              <div className="flex justify-end">
                <button
                  onClick={() => setStage('upload')}
                  disabled={!name.trim()}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold disabled:opacity-40 cursor-pointer hover:opacity-90 transition-opacity"
                >
                  Next →
                </button>
              </div>
            </>
          )}

          {/* Stage: upload */}
          {stage === 'upload' && (
            <>
              <div>
                <p className="text-[1.75rem] font-bold text-primary leading-tight">Drop a sample PDF</p>
                <p className="text-sm text-[#4a5568] mt-1">Claude will scan it and show you everything it finds. You just click what you want to capture.</p>
              </div>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') scanPDF(f); }}
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center min-h-52 rounded-xl border-2 border-dashed border-outline/40 bg-surface-low hover:border-secondary/50 hover:bg-secondary-fixed/10 transition-all cursor-pointer"
              >
                <FileText size={32} className="mb-3 text-outline" />
                <p className="text-sm font-medium text-primary">Drop your PDF here</p>
                <p className="text-xs text-[#4a5568] mt-1">or click to browse</p>
                <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) scanPDF(f); e.target.value = ''; }} />
              </div>
              <div className="flex items-center justify-between">
                <button onClick={() => setStage('name')} className="text-sm text-[#4a5568] hover:text-primary transition-colors cursor-pointer">← Back</button>
                <button
                  onClick={() => { setDiscovered([]); setStage('pick'); }}
                  className="text-sm text-secondary hover:text-on-secondary-container transition-colors cursor-pointer"
                >
                  Skip — I'll add fields manually →
                </button>
              </div>
            </>
          )}

          {/* Stage: scanning */}
          {stage === 'scanning' && (
            <div className="flex flex-col items-center justify-center min-h-64 space-y-4 py-12">
              <div className="w-10 h-10 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium text-primary">{scanProgress}</p>
              <p className="text-xs text-[#4a5568]">This takes 10–30 seconds depending on document size.</p>
            </div>
          )}

          {/* Stage: pick */}
          {stage === 'pick' && (
            <>
              {scanError && (
                <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-700">
                  <p className="font-medium">Couldn't scan the PDF</p>
                  <p className="text-xs mt-0.5">{scanError}</p>
                </div>
              )}

              <div>
                <p className="text-[1.25rem] font-bold text-primary leading-tight">
                  {discovered.length > 0
                    ? `Found ${discovered.length} values — click the ones you want`
                    : isEdit ? `Edit fields for "${name}"` : 'Add your fields'}
                </p>
                {discovered.length > 0 && (
                  <p className="text-sm text-[#4a5568] mt-1">Select everything you want to capture. You can rename each one.</p>
                )}
              </div>

              {/* Discovered grid */}
              {discovered.length > 0 && (
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {discovered.map((item, i) => {
                    const selected = isSelected(item);
                    return (
                      <button
                        key={i}
                        onClick={() => toggleItem(item)}
                        className={`text-left rounded-xl px-4 py-3 transition-all cursor-pointer ${
                          selected
                            ? 'bg-secondary-fixed border-2 border-secondary/40'
                            : 'bg-surface-low hover:bg-surface-container border-2 border-transparent'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.6875rem] text-[#4a5568] truncate">{item.label}</p>
                            <p className="text-sm font-semibold text-primary truncate mt-0.5">{item.value}</p>
                          </div>
                          {selected && (
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-secondary flex items-center justify-center mt-0.5">
                              <Check size={11} className="text-white" />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Selected fields list */}
              {picked.length > 0 && (
                <div className="space-y-2">
                  {discovered.length > 0 && (
                    <p className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568]">
                      Your fields ({picked.filter(p => p.userLabel.trim()).length})
                    </p>
                  )}
                  {picked.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 bg-surface-low rounded-lg px-3 py-2.5">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <input
                          value={p.userLabel}
                          onChange={e => updateField(i, 'userLabel', e.target.value)}
                          placeholder="What do you call this?"
                          className="w-full bg-transparent text-sm font-medium text-primary placeholder-outline focus:outline-none"
                        />
                        <input
                          value={p.docLabel}
                          onChange={e => updateField(i, 'docLabel', e.target.value)}
                          placeholder="How it appears in the document (optional)"
                          className="w-full bg-transparent text-[0.6875rem] text-[#4a5568] placeholder-outline/60 focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => removePickedField(i)}
                        className="text-outline hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {picked.length === 0 && <p className="text-sm text-[#4a5568]">No fields selected yet.</p>}

              <button
                onClick={addManualField}
                className="text-secondary text-sm font-medium hover:text-on-secondary-container transition-colors cursor-pointer"
              >
                + Add a field manually
              </button>

              <div className="flex items-center justify-between pt-2">
                {!isEdit ? (
                  <button
                    onClick={() => setStage('upload')}
                    className="text-sm text-[#4a5568] hover:text-primary transition-colors cursor-pointer"
                  >
                    ← Scan a different PDF
                  </button>
                ) : <div />}
                <button
                  onClick={handleSave}
                  disabled={!canSave || saving}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold disabled:opacity-40 cursor-pointer hover:opacity-90 transition-opacity"
                >
                  {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

// ─── Test Mode Panel ──────────────────────────────────────────────────────────

interface TestPanelProps {
  template: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>;
  onClose: () => void;
  onFixHints: () => void;
}

const TestPanel: React.FC<TestPanelProps> = ({ template, onClose, onFixHints }) => {
  const [testResults, setTestResults] = useState<Record<string, string | null> | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null); // null | stage label
  const [attempts, setAttempts] = useState(0);
  const [copied, setCopied] = useState(false);
  const [testFileName, setTestFileName] = useState('');
  const [discovery, setDiscovery] = useState<{label: string; value: string}[] | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [descriptionsUpdated, setDescriptionsUpdated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toBase64 = (arrayBuffer: ArrayBuffer): string => {
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i += 8192) {
      binary += String.fromCharCode(...uint8.subarray(i, i + 8192));
    }
    return btoa(binary);
  };

  const friendlyError = (err: any): string => {
    const msg: string = err?.message || err?.toString() || '';
    if (msg.includes('JSON') || msg.includes('token') || msg.includes('is not valid')) {
      return "Claude's response wasn't in the expected format. Try re-running — this usually fixes itself.";
    }
    if (msg.includes('401') || msg.toLowerCase().includes('api_key') || msg.toLowerCase().includes('authentication')) {
      return "API key problem. The app may need to be redeployed with the correct API key.";
    }
    if (msg.includes('400') || msg.toLowerCase().includes('invalid request')) {
      return "The PDF couldn't be read. Make sure it's not password-protected or corrupted.";
    }
    if (msg.includes('529') || msg.toLowerCase().includes('overloaded')) {
      return "Claude is busy right now. Wait a few seconds and try again.";
    }
    return msg || 'Something went wrong. Try again.';
  };

  const runTest = async (file: File) => {
    setTestError(null);
    setDescriptionsUpdated(false);
    setTestFileName(file.name);

    try {
      setTesting('Reading document…');
      const arrayBuffer = await file.arrayBuffer();
      const base64 = toBase64(arrayBuffer);

      const fieldLines = template.fields.map(f => {
        const desc = f.hint?.trim() ? ` — ${f.hint}` : '';
        return `- ${f.key}${desc}`;
      }).join('\n');

      setTesting('Extracting your fields…');
      // Run field extraction + discovery in parallel
      const [extractionRes, discoveryRes] = await Promise.all([
        fetch('/api/templateChat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            systemPrompt: 'You are a JSON extraction API. Respond with ONLY a valid JSON object — no prose, no explanation, no apology. Every key must be present; use null if the value is not found. Your entire response must be parseable by JSON.parse().',
            userText: `Extract these fields:\n${fieldLines}`,
            maxTokens: 1024,
            prefill: '{',
          }),
        }),
        fetch('/api/templateChat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            systemPrompt: 'You are a document scanner. Respond with ONLY a valid JSON array — no prose, no explanation.',
            userText: 'List every clearly labelled value in this document (amounts, dates, IDs, names, codes). Return a JSON array of {"label": "...", "value": "..."} objects. Include all you can find.',
            maxTokens: 768,
            prefill: '[',
          }),
        }),
      ]);

      if (!extractionRes.ok) throw new Error(`Extraction API error: HTTP ${extractionRes.status}`);
      const { text: extractionText } = await extractionRes.json();
      const rawExtraction = '{' + extractionText;
      const parsed = JSON.parse(jsonrepair(rawExtraction));
      setTestResults(parsed);
      setAttempts(a => a + 1);

      // Parse discovery (optional — don't fail if it errors)
      try {
        if (discoveryRes.ok) {
          const { text: discoveryText } = await discoveryRes.json();
          const rawDiscovery = '[' + discoveryText;
          const disc = JSON.parse(jsonrepair(rawDiscovery));
          setDiscovery(Array.isArray(disc) ? disc : []);
        }
      } catch { /* discovery is bonus, ignore parse errors */ }

    } catch (err: any) {
      console.error('Test extraction failed:', err);
      setTestError(friendlyError(err));
    } finally {
      setTesting(null);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') runTest(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) runTest(file);
    e.target.value = '';
  };

  const failingFields = testResults
    ? template.fields.filter(f => !testResults[f.key])
    : [];

  const copyDiagnostic = () => {
    const lines = [
      'TEMPLATE DIAGNOSTIC',
      `Template: "${template.name}"`,
      `Test file: ${testFileName}`,
      '',
      ...template.fields.map(f => {
        const val = testResults?.[f.key];
        const status = val ? `PASSING → ${val}` : `FAILING → null`;
        return `${f.key}: ${status}`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasResults = testResults !== null && !testError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-lowest rounded-2xl w-[800px] max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-7 pt-6 pb-4 flex items-center justify-between">
          <div>
            <p className="text-[1rem] font-semibold text-primary">Test Mode — {template.name}</p>
            <p className="text-xs text-[#4a5568] mt-0.5">Upload a sample PDF to see what Claude can extract</p>
          </div>
          <button onClick={onClose} className="text-outline hover:text-primary transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="px-7 pb-7 space-y-5">
          <div className={`grid gap-5 ${hasResults || testError ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {/* Drop zone */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => !testing && fileRef.current?.click()}
              className="flex flex-col items-center justify-center min-h-48 rounded-xl border-2 border-dashed border-outline/40 bg-surface-low hover:border-secondary/50 hover:bg-secondary-fixed/10 transition-all cursor-pointer"
            >
              {testing ? (
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-secondary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm text-[#4a5568]">{testing}</p>
                </div>
              ) : (
                <div className="text-center px-4">
                  <FlaskConical size={28} className="mx-auto mb-2 text-outline" />
                  <p className="text-sm font-medium text-primary">{testFileName ? 'Drop another PDF to re-test' : 'Drop a sample PDF to test'}</p>
                  <p className="text-xs text-[#4a5568] mt-1">{testFileName || 'or click to browse'}</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" onChange={handleFileSelect} />
            </div>

            {/* Error */}
            {testError && (
              <div className="space-y-3">
                <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">
                  <p className="font-semibold mb-1">Something went wrong</p>
                  <p className="text-xs">{testError}</p>
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-surface-low text-primary text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Results */}
            {hasResults && (
              <div className="space-y-2">
                {descriptionsUpdated && (
                  <div className="flex items-center gap-1.5 text-xs text-secondary mb-2">
                    <Check size={12} />
                    Descriptions updated — results below use your new descriptions
                  </div>
                )}
                <p className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568] mb-2">
                  Your fields — {template.fields.filter((f: TemplateField) => testResults![f.key]).length}/{template.fields.length} found
                </p>
                {template.fields.map(f => {
                  const val = testResults![f.key];
                  const found = !!val;
                  return (
                    <div key={f.key} className="space-y-1">
                      <div className="flex items-start gap-2 text-sm">
                        <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${found ? 'bg-secondary' : 'bg-red-400'}`} />
                        <span className="font-semibold text-primary flex-shrink-0">{f.label}</span>
                        <span className={`flex-1 text-xs mt-0.5 ${found ? 'text-[#4a5568]' : 'text-red-400 italic'}`}>
                          {found ? val : 'not found'}
                        </span>
                      </div>
                      {!found && (
                        <div className="ml-4 bg-amber-50 rounded-lg p-2.5 text-xs text-amber-700">
                          <p className="font-medium mb-0.5">Couldn't find this automatically.</p>
                          <p>Check the "What's in your doc" section below — find the value you're after and note what it's labelled on the document, then click <span className="font-semibold">Update descriptions</span>.</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="pt-3 flex flex-wrap gap-2">
                  {failingFields.length > 0 && (
                    <button
                      onClick={() => { setDescriptionsUpdated(false); onFixHints(); }}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold cursor-pointer hover:opacity-90"
                    >
                      Update descriptions →
                    </button>
                  )}
                  {attempts >= 2 && failingFields.length > 0 && (
                    <button
                      onClick={copyDiagnostic}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-low text-[#4a5568] text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied!' : 'Copy diagnostic'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Discovery — what's in the document */}
          {discovery && discovery.length > 0 && (
            <div className="bg-surface-low rounded-xl overflow-hidden">
              <button
                onClick={() => setShowDiscovery((s: boolean) => !s)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-primary cursor-pointer hover:bg-surface-container transition-colors"
              >
                <span>What's in your document ({discovery.length} values found)</span>
                <span className="text-outline text-xs">{showDiscovery ? '▲ hide' : '▼ show'}</span>
              </button>
              {showDiscovery && (
                <div className="px-4 pb-4">
                  <p className="text-xs text-[#4a5568] mb-3">Everything Claude detected in your PDF. If a field above shows "not found", look for it here — the label Claude sees may be different from what you called it.</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {discovery.map((d: {label: string; value: string}, i: number) => (
                      <div key={i} className="flex items-baseline gap-2 text-xs bg-surface-lowest rounded-lg px-3 py-2">
                        <span className="text-[#4a5568] flex-shrink-0 min-w-[80px]">{d.label}</span>
                        <span className="font-medium text-primary truncate">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Delete Confirm ───────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirm: React.FC<DeleteConfirmProps> = ({ name, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 backdrop-blur-sm">
    <div className="bg-surface-lowest rounded-2xl w-[400px] shadow-2xl p-7 space-y-4">
      <p className="text-[1rem] font-semibold text-primary">Delete Template</p>
      <p className="text-sm text-[#4a5568]">Delete <span className="font-semibold text-primary">"{name}"</span>? This cannot be undone.</p>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-outline/20 text-[#4a5568] text-sm hover:bg-surface-low transition-colors cursor-pointer">
          Cancel
        </button>
        <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors cursor-pointer">
          Delete
        </button>
      </div>
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const TemplatesTab: React.FC<Props> = ({ templates, onTemplatesChange, files, currentUserId, pinnedTemplateIds, onPinToggle, focusedTemplateName }) => {
  const isAdmin = currentUserId === ADMIN_USER_ID;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExtractionTemplate | null>(null);
  const [testingTemplate, setTestingTemplate] = useState<Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'> | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<ExtractionTemplate | null>(null);

  const canManage = (t: ExtractionTemplate) =>
    currentUserId === t.user_id || isAdmin;

  // ── CRUD ──

  const handleSave = useCallback(async (payload: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>) => {
    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, payload);
      onTemplatesChange(templates.map(t => t.id === editingTemplate.id ? { ...t, ...payload } : t));
    } else {
      const saved = await saveTemplate(payload);
      if (saved) onTemplatesChange([saved, ...templates]);
    }
    setWizardOpen(false);
    setEditingTemplate(null);
  }, [editingTemplate, templates, onTemplatesChange]);

  const handleDelete = async () => {
    if (!deletingTemplate) return;
    await deleteTemplate(deletingTemplate.id);
    onTemplatesChange(templates.filter(t => t.id !== deletingTemplate.id));
    setDeletingTemplate(null);
  };

  const handleToggleActive = async (t: ExtractionTemplate) => {
    await updateTemplate(t.id, { is_active: !t.is_active });
    onTemplatesChange(templates.map(r => r.id === t.id ? { ...r, is_active: !r.is_active } : r));
  };

  // ── Extracted Results ──

  const extractedGroups = templates.map(t => {
    const rows: { filename: string; date: string | null; fields: Record<string, string | null> }[] = [];
    for (const f of files) {
      if (f.status !== FileStatus.COMPLETED && f.status !== FileStatus.WARNING) continue;
      for (const doc of f.data ?? []) {
        if (doc.document_type !== t.name) continue;
        rows.push({
          filename: f.file.name,
          date: doc.metadata?.date ?? null,
          fields: (doc.custom_fields as Record<string, string | null>) ?? {},
        });
      }
    }
    return { template: t, rows };
  }).filter(g => g.rows.length > 0);

  const exportCSV = (g: typeof extractedGroups[0]) => {
    const cols = g.template.fields.map(f => f.label);
    const headers = ['Filename', 'Date', ...cols];
    const safe = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = g.rows.map(r => [
      safe(r.filename),
      safe(r.date),
      ...g.template.fields.map(f => safe(r.fields[f.key])),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${g.template.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Focused tab view (when template is pinned and active in sidebar) ──
  if (focusedTemplateName) {
    const focused = templates.find(t => t.name === focusedTemplateName);
    const group = extractedGroups.find(g => g.template.name === focusedTemplateName);
    if (!focused) return null;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#4a5568]">
            {group ? `${group.rows.length} document${group.rows.length !== 1 ? 's' : ''} extracted` : 'No documents extracted yet for this template.'}
          </p>
          {group && (
            <button
              onClick={() => exportCSV(group)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold cursor-pointer hover:opacity-90"
            >
              <Download size={14} />
              Export CSV
            </button>
          )}
        </div>
        {group ? (
          <div className="bg-surface-lowest rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-low">
                    <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Filename</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Date</th>
                    {focused.fields.map(f => (
                      <th key={f.key} className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, i) => (
                    <tr key={i} className={`hover:bg-surface-low transition-colors ${i % 2 === 1 ? 'bg-surface-low/50' : ''}`}>
                      <td className="px-4 py-2 text-primary font-mono text-[11px]">{row.filename}</td>
                      <td className="px-4 py-2 text-[#4a5568]">{row.date ?? '—'}</td>
                      {focused.fields.map(f => (
                        <td key={f.key} className="px-4 py-2 text-primary">{row.fields[f.key] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-64 rounded-xl border-2 border-dashed border-outline/30 bg-surface-lowest text-[#4a5568]">
            <Blocks size={28} className="mb-3 text-outline" />
            <p className="font-medium text-primary">No results yet</p>
            <p className="text-sm mt-1">Process documents that match the <span className="font-semibold">{focusedTemplateName}</span> template to see them here.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[1.75rem] font-bold text-primary">Template Library</h2>
          <p className="text-[0.875rem] text-[#4a5568] mt-0.5">Reuse extraction schemas across your organisation.</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="bg-amber-50 text-amber-700 rounded-full px-3 py-1 text-xs font-medium">
              Admin view — you can edit any template
            </span>
          )}
          <button
            onClick={() => { setEditingTemplate(null); setWizardOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold transition-opacity cursor-pointer hover:opacity-90"
          >
            <Plus size={15} />
            New Template
          </button>
        </div>
      </div>

      {/* ── Template Cards ── */}
      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-64 rounded-xl border-2 border-dashed border-outline/30 bg-surface-lowest text-[#4a5568]">
          <Blocks size={32} className="mb-3 text-outline" />
          <p className="font-medium text-primary">No templates yet</p>
          <p className="text-sm mt-1">Create your first template to extract custom fields from any document.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-surface-lowest rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[1rem] font-semibold text-primary leading-snug">{t.name}</p>
                {currentUserId !== t.user_id && (
                  <span className="bg-secondary-fixed text-on-secondary-container rounded-full text-xs px-2 py-0.5 flex-shrink-0">
                    Shared
                  </span>
                )}
              </div>
              <p className="text-xs text-[#4a5568] line-clamp-2">{t.document_hint}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-secondary-fixed text-on-secondary-container rounded-full text-xs px-2 py-0.5">
                  {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                </span>
                {canManage(t) && (
                  <button
                    onClick={() => handleToggleActive(t)}
                    className={`rounded-full text-xs px-2 py-0.5 transition-colors cursor-pointer ${
                      t.is_active
                        ? 'bg-secondary-fixed text-on-secondary-container hover:bg-secondary/20'
                        : 'bg-surface-container text-outline hover:bg-surface-low'
                    }`}
                  >
                    {t.is_active ? 'Active' : 'Inactive'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                <button
                  onClick={() => onPinToggle(t.id)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    pinnedTemplateIds.includes(t.id)
                      ? 'bg-secondary-fixed text-on-secondary-container hover:bg-secondary/20'
                      : 'bg-surface-low text-[#4a5568] hover:bg-surface-container'
                  }`}
                  title={pinnedTemplateIds.includes(t.id) ? 'Remove from sidebar' : 'Add to sidebar'}
                >
                  {pinnedTemplateIds.includes(t.id) ? '📌 In sidebar' : '+ Add to sidebar'}
                </button>
                <button
                  onClick={() => setTestingTemplate(t)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-low text-primary text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer"
                >
                  <FlaskConical size={12} />
                  Test
                </button>
                {canManage(t) && (
                  <>
                    <button
                      onClick={() => { setEditingTemplate(t); setWizardOpen(true); }}
                      className="p-1.5 rounded-lg text-outline hover:text-primary hover:bg-surface-low transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeletingTemplate(t)}
                      className="p-1.5 rounded-lg text-outline hover:text-red-400 hover:bg-surface-low transition-colors cursor-pointer"
                      title="Delete template"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Extracted Results ── */}
      {extractedGroups.length > 0 && (
        <div className="space-y-5">
          <h3 className="text-[1rem] font-semibold text-primary">Extracted Results</h3>
          {extractedGroups.map(g => (
            <div key={g.template.id} className="bg-surface-lowest rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-surface-low">
                <p className="text-sm font-semibold text-primary">{g.template.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#4a5568]">{g.rows.length} row{g.rows.length !== 1 ? 's' : ''}</span>
                  <button
                    onClick={() => exportCSV(g)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold cursor-pointer hover:opacity-90"
                  >
                    <Download size={12} />
                    Export CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-low">
                      <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Filename</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Date</th>
                      {g.template.fields.map(f => (
                        <th key={f.key} className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((row, i) => (
                      <tr key={i} className={`hover:bg-surface-low transition-colors ${i % 2 === 1 ? 'bg-surface-low/50' : ''}`}>
                        <td className="px-4 py-2 text-primary font-mono text-[11px]">{row.filename}</td>
                        <td className="px-4 py-2 text-[#4a5568]">{row.date ?? '—'}</td>
                        {g.template.fields.map(f => (
                          <td key={f.key} className="px-4 py-2 text-primary">{row.fields[f.key] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {wizardOpen && (
        <Wizard
          initial={editingTemplate}
          onSave={handleSave}
          onClose={() => { setWizardOpen(false); setEditingTemplate(null); }}
        />
      )}

      {testingTemplate && (
        <TestPanel
          template={testingTemplate}
          onClose={() => setTestingTemplate(null)}
          onFixHints={() => {
            const full = templates.find(t => t.name === testingTemplate.name);
            setEditingTemplate(full ?? null);
            setTestingTemplate(null);
            setWizardOpen(true);
          }}
        />
      )}

      {deletingTemplate && (
        <DeleteConfirm
          name={deletingTemplate.name}
          onConfirm={handleDelete}
          onCancel={() => setDeletingTemplate(null)}
        />
      )}
    </div>
  );
};

export default TemplatesTab;
