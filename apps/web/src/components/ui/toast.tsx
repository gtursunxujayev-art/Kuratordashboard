'use client';

import { createContext, useCallback, useContext, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 inset-x-4 md:left-auto md:right-4 md:w-80 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-lg border"
            style={{
              background:
                toast.kind === 'success'
                  ? '#16a34a'
                  : toast.kind === 'error'
                  ? '#dc2626'
                  : 'var(--kd-surface)',
              color: toast.kind === 'info' ? 'var(--kd-text)' : '#fff',
              borderColor:
                toast.kind === 'success'
                  ? '#15803d'
                  : toast.kind === 'error'
                  ? '#991b1b'
                  : 'var(--kd-border)',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) return { show: () => {} };
  return ctx;
}
