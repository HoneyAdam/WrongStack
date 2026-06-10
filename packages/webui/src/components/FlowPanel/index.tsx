/**
 * FlowPanel — React Flow canvas embedded inside the FlowSidebar.
 *
 * This is a separate component because React Flow requires a properly
 * sized container with ref access. We wrap it here so FlowSidebar
 * can render it as a tab content without structural issues.
 */

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { AgentFlowCanvas } from '../AgentFlowGraph/AgentFlowCanvas.js';

interface FlowPanelProps {
  className?: string;
}

export function FlowPanel({ className }: FlowPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className={cn('w-full h-full min-h-[400px]', className)}>
      <AgentFlowCanvas containerRef={containerRef} />
    </div>
  );
}
