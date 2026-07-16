import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

// ── Polyfills for jsdom (React Flow needs ResizeObserver + DOMMatrix) ────────

class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverPolyfill);

if (typeof globalThis.DOMMatrix === 'undefined') {
  vi.stubGlobal('DOMMatrix', class {
    constructor() {}
    multiply(): unknown { return this; }
  });
}

// Must import AFTER polyfills are set
const { CodeMap } = await import('../../src/components/CodeMap');
const { useCodemapActivityStore } = await import('../../src/stores/codemap-activity-store');

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockPackageGraph = {
  nodes: [
    { id: 'pkg:core', label: '@wrongstack/core', kind: 'package', package: '@wrongstack/core', symbolCount: 120, fileCount: 30 },
    { id: 'pkg:cli', label: '@wrongstack/cli', kind: 'package', package: '@wrongstack/cli', symbolCount: 80, fileCount: 20 },
  ],
  edges: [
    { source: 'pkg:cli', target: 'pkg:core', weight: 5, refType: 'import' },
  ],
};

const mockFileGraph = {
  nodes: [
    { id: 'file:core/agent.ts', label: 'agent.ts', kind: 'file', package: '@wrongstack/core', file: 'src/core/agent.ts', symbolCount: 15 },
    { id: 'file:core/tool.ts', label: 'tool.ts', kind: 'file', package: '@wrongstack/core', file: 'src/core/tool.ts', symbolCount: 8 },
  ],
  edges: [
    { source: 'file:core/agent.ts', target: 'file:core/tool.ts', weight: 3, refType: 'call' },
  ],
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helper: set the fetch response for a URL ──────────────────────────────────

function setFetchResponse(url: string, data: unknown): void {
  mockFetch.mockImplementation(async (input: string | URL) => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.includes(url)) {
      return {
        ok: true,
        json: async () => data,
        statusText: 'OK',
      } as Response;
    }
    return {
      ok: false,
      json: async () => ({ error: 'not found' }),
      status: 404,
      statusText: 'Not Found',
    } as Response;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CodeMap component', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useCodemapActivityStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the toolbar with Packages breadcrumb on initial load', async () => {
    setFetchResponse('/api/codemap/packages', mockPackageGraph);
    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('Packages')).toBeDefined();
    });
  });

  it('renders package nodes after fetch completes', async () => {
    setFetchResponse('/api/codemap/packages', mockPackageGraph);
    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
      expect(screen.getByText('@wrongstack/cli')).toBeDefined();
    });
  });

  it('shows loading spinner before fetch resolves', () => {
    // Never resolves — pending promise
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<CodeMap />);

    // The component renders a Loader2 (spin) — check via svg role
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('shows error message when the index is unavailable (503)', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      json: async () => ({ error: 'CodeMap index unavailable' }),
      status: 503,
      statusText: 'Service Unavailable',
    }) as Response);

    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText(/CodeMap index unavailable/)).toBeDefined();
    });
  });

  it('drills down into a package on click and shows file nodes', async () => {
    // First call returns packages, second returns files
    let callCount = 0;
    mockFetch.mockImplementation(async (input: string | URL) => {
      callCount++;
      const u = typeof input === 'string' ? input : input.toString();
      if (callCount === 1 || u.includes('/api/codemap/packages')) {
        return { ok: true, json: async () => mockPackageGraph, statusText: 'OK' } as Response;
      }
      return { ok: true, json: async () => mockFileGraph, statusText: 'OK' } as Response;
    });

    render(<CodeMap />);

    // Wait for package nodes to appear
    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });

    // Click the @wrongstack/core node (it has role="button" and tabIndex)
    const coreNode = screen.getByText('@wrongstack/core');
    const clickableParent = coreNode.closest('[role="button"]') ?? coreNode;
    fireEvent.click(clickableParent);

    // Should now show file-level nodes
    await waitFor(() => {
      expect(screen.getByText('agent.ts')).toBeDefined();
      expect(screen.getByText('tool.ts')).toBeDefined();
    });
  });

  it('shows breadcrumb trail after drilling into a package', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async (input: string | URL) => {
      callCount++;
      const u = typeof input === 'string' ? input : input.toString();
      if (callCount === 1 || u.includes('/api/codemap/packages')) {
        return { ok: true, json: async () => mockPackageGraph, statusText: 'OK' } as Response;
      }
      return { ok: true, json: async () => mockFileGraph, statusText: 'OK' } as Response;
    });

    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });

    // Click to drill down
    const coreNode = screen.getByText('@wrongstack/core');
    const clickableParent = coreNode.closest('[role="button"]') ?? coreNode;
    fireEvent.click(clickableParent);

    // Back button should appear
    await waitFor(() => {
      expect(screen.getByText('Back')).toBeDefined();
    });
  });

  it('navigates back to package level via Back button', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async (input: string | URL) => {
      callCount++;
      const u = typeof input === 'string' ? input : input.toString();
      if (u.includes('/api/codemap/packages')) {
        return { ok: true, json: async () => mockPackageGraph, statusText: 'OK' } as Response;
      }
      return { ok: true, json: async () => mockFileGraph, statusText: 'OK' } as Response;
    });

    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });

    // Drill into @wrongstack/core
    const coreNode = screen.getByText('@wrongstack/core');
    fireEvent.click(coreNode.closest('[role="button"]') ?? coreNode);

    await waitFor(() => {
      expect(screen.getByText('agent.ts')).toBeDefined();
    });

    // Click Back
    fireEvent.click(screen.getByText('Back'));

    // Should show package nodes again
    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });
  });

  it('opens activity history drawer on Shift+click of a file node', async () => {
    // Start at file level directly by mocking the first fetch as files
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, json: async () => mockPackageGraph, statusText: 'OK' } as Response;
      }
      return { ok: true, json: async () => mockFileGraph, statusText: 'OK' } as Response;
    });

    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });

    // Drill into the package
    fireEvent.click(screen.getByText('@wrongstack/core').closest('[role="button"]')!);

    await waitFor(() => {
      expect(screen.getByText('agent.ts')).toBeDefined();
    });

    // Shift+click the agent.ts node
    const agentNode = screen.getByText('agent.ts');
    const clickable = agentNode.closest('[role="button"]') ?? agentNode;
    fireEvent.click(clickable, { shiftKey: true });

    // The drawer should show the file path
    await waitFor(() => {
      expect(screen.getByText('src/core/agent.ts')).toBeDefined();
    });
  });

  it('closes activity history drawer when X is clicked', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, json: async () => mockPackageGraph, statusText: 'OK' } as Response;
      }
      return { ok: true, json: async () => mockFileGraph, statusText: 'OK' } as Response;
    });

    const { container } = render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });

    fireEvent.click(screen.getByText('@wrongstack/core').closest('[role="button"]')!);

    await waitFor(() => {
      expect(screen.getByText('agent.ts')).toBeDefined();
    });

    // Open drawer
    fireEvent.click(screen.getByText('agent.ts').closest('[role="button"]')!, { shiftKey: true });

    await waitFor(() => {
      expect(screen.getByText('src/core/agent.ts')).toBeDefined();
    });

    // Find and click the X button (it has an svg X icon inside the drawer header)
    const drawer = container.querySelector('.absolute.right-0');
    expect(drawer).toBeTruthy();
    const xButton = drawer!.querySelector('button');
    expect(xButton).toBeTruthy();
    fireEvent.click(xButton!);

    // Drawer should be gone
    await waitFor(() => {
      expect(container.querySelector('.absolute.right-0')).toBeNull();
    });
  });

  it('records activity in the store and shows it in the drawer', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, json: async () => mockPackageGraph, statusText: 'OK' } as Response;
      }
      return { ok: true, json: async () => mockFileGraph, statusText: 'OK' } as Response;
    });

    render(<CodeMap />);

    await waitFor(() => {
      expect(screen.getByText('@wrongstack/core')).toBeDefined();
    });

    fireEvent.click(screen.getByText('@wrongstack/core').closest('[role="button"]')!);

    await waitFor(() => {
      expect(screen.getByText('agent.ts')).toBeDefined();
    });

    // Record an activity manually
    useCodemapActivityStore.getState().recordActivity({
      filePath: 'src/core/agent.ts',
      type: 'edit',
      timestamp: Date.now(),
      toolName: 'edit',
      agentName: 'test-agent',
    });

    // Open drawer via Shift+click
    fireEvent.click(screen.getByText('agent.ts').closest('[role="button"]')!, { shiftKey: true });

    // Should show the activity type and tool name
    await waitFor(() => {
      expect(screen.getByText('edit')).toBeDefined();
      expect(screen.getByText(/via edit/)).toBeDefined();
    });
  });
});
