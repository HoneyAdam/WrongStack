import React from 'react';
import { useUIStore, useChatStore } from '@/stores';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Terminal, ShieldAlert, AlertTriangle } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';

export function ConfirmDialog() {
  const { showConfirmDialog, confirmInfo, hideConfirm } = useUIStore();
  const { sendConfirm } = useWebSocket();

  const handleConfirm = (decision: 'yes' | 'no' | 'always' | 'deny') => {
    if (confirmInfo) {
      sendConfirm(confirmInfo.id, decision);
    }
    hideConfirm();
  };

  return (
    <Dialog open={showConfirmDialog} onOpenChange={() => hideConfirm()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-yellow-500" />
            Tool Confirmation Required
          </DialogTitle>
          <DialogDescription>
            A tool execution requires your confirmation to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {confirmInfo && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <Terminal className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium font-mono">{confirmInfo.toolName}</div>
                  <div className="text-sm text-muted-foreground">
                    Tool execution
                  </div>
                </div>
              </div>

              {confirmInfo.input && (
                <div className="p-3 rounded-lg bg-muted/50 border text-xs font-mono">
                  <div className="text-muted-foreground mb-2">Input:</div>
                  <pre className="whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {JSON.stringify(confirmInfo.input, null, 2)}
                  </pre>
                </div>
              )}

              {confirmInfo.suggestedPattern && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <div className="font-medium text-yellow-800 dark:text-yellow-200">
                      Suggested Pattern
                    </div>
                    <div className="font-mono text-xs mt-1">
                      {confirmInfo.suggestedPattern}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleConfirm('deny')}
          >
            Deny Always
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleConfirm('no')}
          >
            No
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleConfirm('always')}
          >
            Always
          </Button>
          <Button
            size="sm"
            onClick={() => handleConfirm('yes')}
          >
            Yes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}