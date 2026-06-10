import { useWebSocket } from '@/hooks/useWebSocket';
import { RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';

interface SessionActionsProps {
  wsConnected: boolean;
}

export function SessionActions({ wsConnected }: SessionActionsProps) {
  const { client } = useWebSocket();

  return (
    <div className="px-4 py-3 border-b">
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
    </div>
  );
}
