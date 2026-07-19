import { create } from 'zustand';

export interface MemoryInjectorTraceMemory {
  id: string;
  kind: string;
  text: string;
  score: number;
  relationStrength: number;
  anchor?: string | undefined;
  anchors: string[];
  tags: string[];
  activationReasons: string[];
  importance: number;
  confidence: number;
  freshness: number;
  persistence: string;
}

export interface MemoryInjectorTrace {
  runId: string;
  at: string;
  outcome: 'injected' | 'empty' | 'error';
  trigger: string;
  toolName: string;
  queryPreview: string;
  paths: string[];
  taskSignals: string[];
  contextPressure: number;
  budget: { maxHints: number; maxChars: number };
  candidates: number;
  eligible: number;
  rejected: {
    duplicate: number;
    belowScore: number;
    alreadyVisible: number;
    cooldown: number;
    budget: number;
  };
  activated: MemoryInjectorTraceMemory[];
  injected: MemoryInjectorTraceMemory[];
  injectedChars: number;
  error?: string | undefined;
  sessionId?: string | undefined;
}

interface MemoryInjectorTraceState {
  traces: MemoryInjectorTrace[];
  pushTrace: (trace: MemoryInjectorTrace) => void;
  clear: () => void;
}

const MAX_TRACES = 50;

export const useMemoryInjectorTraceStore = create<MemoryInjectorTraceState>()((set) => ({
  traces: [],
  pushTrace: (trace) => set((state) => ({
    traces: [trace, ...state.traces.filter((item) => item.runId !== trace.runId)].slice(0, MAX_TRACES),
  })),
  clear: () => set({ traces: [] }),
}));
