import { useWebSocket } from '@/hooks/useWebSocket';
import { useChatStore } from '@/stores';
import { Database, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';

interface SessionActionsProps {
  wsConnected: boolean;
}

export function SessionActions({ wsConnected }: SessionActionsProps) {
  const clearMessages = useChatStore((s) => s.clearMessages);
  const { client } = useWebSocket();

  return (
    <div className="px-4 py-3 border-b space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start text-destructive hover:text-destructive"
        onClick={() => { clearMessages(); client?.clearContext?.(); }}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Clear context
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={() => client?.newSession?.()}
        disabled={!wsConnected}
      >
        <RotateCcw className="h-4 w-4 mr-2" />
        New session
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={() => client?.compactContext?.()}
        disabled={!wsConnected}
      >
        <Database className="h-4 w-4 mr-2" />
        Compact context
      </Button>
    </div>
  );
}
