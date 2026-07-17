/**
 * OfficeMapPanel — Side panel wrapper for the office map canvas.
 * Wraps OfficeMapCanvas with ReactFlowProvider.
 */

import { ReactFlowProvider } from '@xyflow/react';
import { Network, PanelsTopLeft } from 'lucide-react';
import { OfficeMapCanvas } from './OfficeMapCanvas';
import { AgentOfficeView } from './AgentOfficeView';
import { useOfficeMapStore } from '@/stores';

export function OfficeMapPanel() {
  const viewMode = useOfficeMapStore((state) => state.viewMode);
  const setViewMode = useOfficeMapStore((state) => state.setViewMode);

  if (viewMode === 'office') {
    return <AgentOfficeView onOpenTopology={() => setViewMode('topology')} />;
  }

  return (
    <div className="relative h-full min-h-0 w-full">
      <ReactFlowProvider>
        <OfficeMapCanvas />
      </ReactFlowProvider>
      <div className="absolute left-4 top-4 z-50 flex border border-border bg-card/95 p-0.5 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => setViewMode('office')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelsTopLeft className="h-3.5 w-3.5" /> Office
        </button>
        <button
          type="button"
          aria-pressed="true"
          className="flex items-center gap-1.5 bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground"
        >
          <Network className="h-3.5 w-3.5" /> Topology
        </button>
      </div>
    </div>
  );
}
