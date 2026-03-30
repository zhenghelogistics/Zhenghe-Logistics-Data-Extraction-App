import React, { useEffect } from 'react';
import { XCircle, CheckCircle, X } from 'lucide-react';

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success';
}

interface ToastProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm max-w-sm w-full
      ${toast.type === 'error' ? 'bg-red-50 border border-red-100 text-red-800' : 'bg-secondary-fixed border border-secondary/20 text-on-secondary-container'}`}>
      {toast.type === 'error'
        ? <XCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
        : <CheckCircle size={16} className="mt-0.5 shrink-0 text-secondary" />}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button type="button" onClick={() => onDismiss(toast.id)} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>
    </div>
  );
};

const ToastStack: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end">
      {toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
};

export default ToastStack;
