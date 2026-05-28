import { useCallback, useEffect, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { PhasePanel } from './PhasePanel';
import { TaskBoard } from './TaskBoard';
import type { PhaseItem } from './PhasePanel';
import type { TaskItem } from './TaskBoard';
import type { WSServerMessage } from '@/types';

interface AutoPhaseState {
  phases: PhaseItem[];
  tasks: TaskItem[];
  activePhaseId: string;
  overallPercent: number;
  autonomous: boolean;
  title: string;
}

/**
 * AutoPhaseView — Solda faz paneli, sağda görev listesi olan ana AutoPhase ekranı.
 *
 * WebSocket üzerinden gerçek zamanlı güncelleme alır.
 */
export function AutoPhaseView(): React.ReactElement {
  const { client, selectAutoPhase } = useWebSocket();
  const [state, setState] = useState<AutoPhaseState>({
    phases: [],
    tasks: [],
    activePhaseId: '',
    overallPercent: 0,
    autonomous: true,
    title: '',
  });

  // WebSocket'ten AutoPhase state güncellemelerini dinle
  useEffect(() => {
    const handleMessage = (msg: WSServerMessage) => {
      if (msg.type === 'autophase.state' && msg.payload) {
        setState(msg.payload as unknown as AutoPhaseState);
      }
    };

    client.on('autophase.state', handleMessage);
    return () => client.off('autophase.state', handleMessage);
  }, [client]);

  const handlePhaseClick = useCallback(
    (phaseId: string) => selectAutoPhase(phaseId),
    [selectAutoPhase],
  );

  const handleToggleAutonomous = useCallback(() => {
    client.send({ type: 'autophase.toggleAutonomous', payload: {} });
  }, [client]);

  const handleTaskStatusChange = useCallback(
    (taskId: string, status: string) => {
      client.send({ type: 'autophase.taskStatus', payload: { taskId, status } });
    },
    [client],
  );

  const activePhase = state.phases.find((p) => p.id === state.activePhaseId);

  return (
    <div className="flex h-full w-full">
      {/* Sol Panel — Fazlar */}
      <PhasePanel
        phases={state.phases}
        activePhaseId={state.activePhaseId}
        onPhaseClick={handlePhaseClick}
        overallPercent={state.overallPercent}
        autonomous={state.autonomous}
        onToggleAutonomous={handleToggleAutonomous}
      />

      {/* Sağ Panel — Görevler */}
      <div className="flex-1 flex flex-col min-w-0">
        {activePhase ? (
          <TaskBoard
            phaseName={activePhase.name}
            phaseStatus={activePhase.status}
            tasks={state.tasks}
            onTaskStatusChange={handleTaskStatusChange}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Bir faz seçin</p>
          </div>
        )}
      </div>
    </div>
  );
}