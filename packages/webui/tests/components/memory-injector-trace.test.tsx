import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryInjectorTrace } from '../../src/components/MemoryManager/MemoryInjectorTrace.js';
import { useMemoryInjectorTraceStore } from '../../src/stores/memory-injector-store.js';
import { memoryTrace } from '../fixtures/memory-trace.js';

beforeEach(() => useMemoryInjectorTraceStore.getState().clear());
afterEach(cleanup);

describe('MemoryInjectorTrace', () => {
  it('renders only the compact matched/injected/filtered/context summary', () => {
    useMemoryInjectorTraceStore.getState().pushTrace(memoryTrace());
    render(<MemoryInjectorTrace />);

    expect(screen.getByText('12 matched')).toBeTruthy();
    expect(screen.getByText('1 injected')).toBeTruthy();
    expect(screen.getByText('11 filtered')).toBeTruthy();
    expect(screen.getByText('1 active')).toBeTruthy();
    expect(screen.queryByText('refreshSession rotates refresh tokens.')).toBeNull();
    expect(screen.queryByText('Why activated')).toBeNull();
  });
});
