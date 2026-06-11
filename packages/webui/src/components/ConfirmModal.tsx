/**
 * ConfirmModal — promise-based in-app replacement for window.confirm().
 *
 * Native confirm() blocks the event loop, can't be styled, and on some
 * embedded/webview hosts is silently disabled (returning false and making
 * destructive actions impossible). Call `confirmModal({...})` from any
 * event handler and await the user's choice; `<ConfirmModalHost />` is
 * mounted once in App next to the other global overlays.
 *
 * Distinct from ConfirmDialog.tsx, which handles the agent's tool-approval
 * flow driven by WS `tool.confirm_needed` events.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export interface ConfirmModalOptions {
  title: string;
  /** Optional body text shown under the title. */
  message?: string | undefined;
  /** Label for the confirming button. Default "Confirm". */
  confirmLabel?: string | undefined;
  /** Label for the dismissing button. Default "Cancel". */
  cancelLabel?: string | undefined;
  /** Destructive styling for the confirm button (deletes etc.). */
  danger?: boolean | undefined;
}

interface ConfirmRequest extends ConfirmModalOptions {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmModalState {
  request: ConfirmRequest | null;
  open: (request: ConfirmRequest) => void;
  settle: (confirmed: boolean) => void;
}

/** Internal — used by ConfirmModalHost and tests. Call confirmModal() instead. */
export const useConfirmModalStore = create<ConfirmModalState>()((set, get) => ({
  request: null,
  open: (request) => {
    // A second confirm while one is pending dismisses the first — native
    // confirm() can't stack either, and resolving false is the safe answer.
    get().request?.resolve(false);
    set({ request });
  },
  settle: (confirmed) => {
    get().request?.resolve(confirmed);
    set({ request: null });
  },
}));

/** Ask the user to confirm. Resolves true on confirm, false otherwise. */
export function confirmModal(options: ConfirmModalOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmModalStore.getState().open({ ...options, resolve });
  });
}

export function ConfirmModalHost() {
  const request = useConfirmModalStore((s) => s.request);
  const settle = useConfirmModalStore((s) => s.settle);

  // Enter confirms — Radix already maps Escape to close (→ cancel).
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        useConfirmModalStore.getState().settle(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.message && <DialogDescription>{request.message}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => settle(false)}>
            {request?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={request?.danger ? 'destructive' : 'default'}
            size="sm"
            autoFocus
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
