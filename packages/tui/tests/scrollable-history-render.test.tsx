import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ScrollableHistory } from '../src/components/scrollable-history.js';
import {
  ASSISTANT_TAIL_HEIGHT,
  type HistoryEntry,
  toolStreamBoxHeight,
} from '../src/components/history.js';

const entries: HistoryEntry[] = Array.from({ length: 50 }, (_, index) => ({
  id: index + 1,
  kind: 'user',
  text: `history-entry-${String(index + 1).padStart(2, '0')}`,
}));

describe('<ScrollableHistory /> content navigation', () => {
  it('passes its viewport height to the banner so a one-row history does not clip artwork', () => {
    const banner: HistoryEntry = {
      id: 0,
      kind: 'banner',
      version: '1.2.3',
      provider: 'openai',
      model: 'gpt-test',
      cwd: '/workspace/wrongstack',
    };
    const view = render(
      <ScrollableHistory
        entries={[banner]}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={1}
        onMeasure={() => {}}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('WrongStack v1.2.3');
    expect(frame).not.toContain('BUILT ON THE WRONG STACK');
    view.unmount();
  });

  it('changes the rendered history slice when scrollOffset changes', () => {
    const history = (scrollOffset: number) => (
      <ScrollableHistory
        entries={entries}
        streamingText=""
        toolStream={null}
        scrollOffset={scrollOffset}
        viewportRows={8}
        onMeasure={() => {}}
      />
    );

    const view = render(history(0));
    // First layout populates the height cache; rerender enters virtual mode.
    view.rerender(history(0));
    const newest = view.lastFrame() ?? '';
    expect(newest).toContain('history-entry-50');
    expect(newest).not.toContain('history-entry-01');

    view.rerender(history(10_000));
    const oldest = view.lastFrame() ?? '';
    expect(oldest).toContain('history-entry-01');
    expect(oldest).not.toContain('history-entry-50');
    view.unmount();
  });

  it('virtualizes a long transcript on the first frame', () => {
    const view = render(
      <ScrollableHistory
        entries={entries}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={8}
        onMeasure={() => {}}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('history-entry-50');
    expect(frame).not.toContain('history-entry-01');
    expect(frame).not.toContain('history-entry-25');
    view.unmount();
  });

  it('keeps the transcript virtualized while assistant text is streaming', () => {
    const view = render(
      <ScrollableHistory
        entries={entries}
        streamingText="live assistant output"
        toolStream={null}
        scrollOffset={0}
        viewportRows={20}
        onMeasure={() => {}}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('live assistant output');
    expect(frame).toContain('history-entry-50');
    expect(frame).not.toContain('history-entry-01');
    view.unmount();
  });

  it('adds and removes the fixed assistant tail from the measured virtual scroll range', () => {
    const measurements: number[] = [];
    const history = (streamingText: string) => (
      <ScrollableHistory
        entries={entries}
        streamingText={streamingText}
        toolStream={null}
        scrollOffset={0}
        viewportRows={20}
        onMeasure={(lines) => {
          measurements.push(lines);
        }}
      />
    );

    const view = render(history(''));
    view.rerender(history(''));
    const entryLines = measurements.at(-1) ?? 0;
    expect(entryLines).toBeGreaterThan(0);

    view.rerender(history('live assistant output'));
    expect(measurements.at(-1)).toBe(entryLines + ASSISTANT_TAIL_HEIGHT);

    view.rerender(history(''));
    expect(measurements.at(-1)).toBe(entryLines);
    view.unmount();
  });

  it('reserves the scrollbar columns when sizing assistant content', () => {
    const assistant: HistoryEntry = {
      id: 1,
      kind: 'assistant',
      text: 'x'.repeat(200),
    };
    const view = render(
      <ScrollableHistory
        entries={[assistant]}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={8}
        onMeasure={() => {}}
        maxWidth={40}
      />,
    );

    const lines = (view.lastFrame() ?? '').split('\n');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(40);
    view.unmount();
  });

  it('keeps structured diff tools ungrouped so each entry honors the summary threshold', () => {
    const replaceEntries: HistoryEntry[] = Array.from({ length: 2 }, (_, entryIndex) => ({
      id: entryIndex + 1,
      kind: 'tool',
      name: 'replace',
      durationMs: 1,
      ok: true,
      input: { path: 'src/' },
      output: JSON.stringify({
        results: Array.from({ length: 5 }, (_, fileIndex) => ({
          path: `src/file-${entryIndex + 1}-${fileIndex + 1}.ts`,
          diff: `--- a.ts\n+++ b.ts\n@@ -1 +1 @@\n-old-${fileIndex + 1}\n+new-${fileIndex + 1}`,
        })),
      }),
    }));
    const view = render(
      <ScrollableHistory
        entries={replaceEntries}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={60}
        onMeasure={() => {}}
        multiDiffSummaryThreshold={0}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).not.toContain('replace ×2');
    expect(frame).not.toContain('5 files');
    expect(frame.match(/Update\(/g)).toHaveLength(2);
    view.unmount();
  });

  it('keeps consecutive edit/update tool results ungrouped', () => {
    const editEntries: HistoryEntry[] = Array.from({ length: 3 }, (_, entryIndex) => ({
      id: entryIndex + 1,
      kind: 'tool',
      name: 'edit',
      durationMs: 2,
      ok: true,
      input: { path: `src/file-${entryIndex + 1}.ts` },
      output: JSON.stringify({
        path: `src/file-${entryIndex + 1}.ts`,
        replacements: 1,
        diff: `--- a.ts\n+++ b.ts\n@@ -1 +1 @@\n-old-${entryIndex + 1}\n+new-${entryIndex + 1}`,
      }),
    }));
    const view = render(
      <ScrollableHistory
        entries={editEntries}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={60}
        onMeasure={() => {}}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).not.toContain('edit ×3');
    expect(frame.match(/Update\(/g)).toHaveLength(3);
    view.unmount();
  });

  it('includes the fixed streaming tail in the shared scroll range', () => {
    let measured = -1;
    const view = render(
      <ScrollableHistory
        entries={[]}
        streamingText="live assistant output"
        toolStream={null}
        scrollOffset={0}
        viewportRows={20}
        onMeasure={(lines) => {
          measured = lines;
        }}
      />,
    );

    expect(measured).toBe(ASSISTANT_TAIL_HEIGHT);
    view.unmount();
  });

  it('keeps the fixed tool tail in the shared range while scrolled up', () => {
    const measurements: number[] = [];
    const history = (toolText: string, scrollOffset: number) => (
      <ScrollableHistory
        entries={entries}
        streamingText=""
        toolStream={
          toolText
            ? { toolUseId: 'read-1', name: 'read', text: toolText, startedAt: Date.now() }
            : null
        }
        scrollOffset={scrollOffset}
        viewportRows={20}
        onMeasure={(lines) => measurements.push(lines)}
      />
    );

    const offsetWithinToolTail = 1;
    const view = render(history('', offsetWithinToolTail));
    view.rerender(history('', offsetWithinToolTail));
    const entryLines = measurements.at(-1) ?? 0;
    view.rerender(history('live read output', offsetWithinToolTail));

    expect(measurements.at(-1)).toBe(entryLines + toolStreamBoxHeight('read'));
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('live read output');
    expect(frame).toContain('history-entry-50');
    view.unmount();
  });

  it('groups consecutive read results under one compact header', () => {
    const readEntries: HistoryEntry[] = Array.from({ length: 3 }, (_, index) => ({
      id: index + 1,
      kind: 'tool',
      name: 'read',
      durationMs: index + 1,
      ok: true,
      input: { path: `src/file-${index + 1}.ts` },
    }));
    const view = render(
      <ScrollableHistory
        entries={readEntries}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={12}
        onMeasure={() => {}}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('read ×3');
    expect(frame.match(/\bread\b/g)).toHaveLength(1);
    for (let index = 1; index <= 3; index++) {
      expect(frame).toContain(`src/file-${index}.ts`);
    }
    view.unmount();
  });

  it('bounds consecutive same-tool groups so one virtual item cannot grow forever', () => {
    const toolEntries: HistoryEntry[] = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      kind: 'tool',
      name: 'read',
      durationMs: 0,
      ok: true,
      input: { path: `bounded-file-${String(index + 1).padStart(2, '0')}.ts` },
    }));
    const view = render(
      <ScrollableHistory
        entries={toolEntries}
        streamingText=""
        toolStream={null}
        scrollOffset={0}
        viewportRows={8}
        onMeasure={() => {}}
      />,
    );

    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('bounded-file-50.ts');
    expect(frame).not.toContain('bounded-file-01.ts');
    expect(frame).not.toContain('×50');
    expect(frame).toMatch(/read ×(?:2|12)/);
    view.unmount();
  });

  it('scrolls a consecutive tool group using its rendered height', () => {
    const toolEntries: HistoryEntry[] = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      kind: 'tool',
      name: 'read',
      durationMs: 0,
      ok: true,
      input: { path: `group-file-${String(index + 1).padStart(2, '0')}.ts` },
    }));
    const history = (scrollOffset: number) => (
      <ScrollableHistory
        entries={toolEntries}
        streamingText=""
        toolStream={null}
        scrollOffset={scrollOffset}
        viewportRows={8}
        onMeasure={() => {}}
      />
    );

    const view = render(history(0));
    view.rerender(history(0));
    const newest = view.lastFrame() ?? '';
    expect(newest).toContain('group-file-50.ts');
    expect(newest).not.toContain('group-file-01.ts');

    view.rerender(history(10_000));
    const oldest = view.lastFrame() ?? '';
    expect(oldest).toContain('group-file-01.ts');
    expect(oldest).not.toContain('group-file-50.ts');
    view.unmount();
  });
});
