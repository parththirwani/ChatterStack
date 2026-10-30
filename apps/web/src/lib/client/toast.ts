import { create } from 'zustand';

export type ToastTone = 'info' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Short-lived notices drawn by <Toaster />. Kept outside the app store so any module can raise one. */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, tone = 'info') => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().show(message, 'info'),
  error: (message: string) => useToastStore.getState().show(message, 'error'),
};
