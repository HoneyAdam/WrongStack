/**
 * MailboxComposer interaction tests — the "send a prompt with zero connected
 * agents" form. The sender is injected so the tests exercise the full form
 * flow (expand → fill → send → status) without a server; one test uses the
 * real store sender against a mocked global fetch to pin the wire format.
 *
 * @vitest-environment jsdom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailboxComposer, type MailboxComposerProps } from '../src/views/mailbox-composer.js';

interface MountHandle {
  root: Root;
  container: HTMLDivElement;
}

let mounted: MountHandle | null = null;

function mount(props: MailboxComposerProps): MountHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(MailboxComposer, props));
  });
  mounted = { root, container };
  return mounted;
}

afterEach(() => {
  if (mounted !== null) {
    act(() => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function click(el: Element | null): void {
  expect(el).not.toBeNull();
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes(text),
    ) ?? null
  );
}

/** React-compatible programmatic value set for controlled inputs. */
function setValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

const PROJECTS = [
  { projectId: 'abc123def456', label: 'WrongStack' },
  { projectId: 'fff000fff000', label: 'OtherProject' },
];

function expand(container: HTMLElement): void {
  click(findButton(container, 'Compose'));
}

describe('MailboxComposer', () => {
  it('is collapsed by default and disabled with no projects', () => {
    const { container } = mount({ projects: [] });
    const compose = findButton(container, 'Compose');
    expect(compose?.disabled).toBe(true);
    expect(container.querySelector('.hq-composer')).toBeNull();
  });

  it('sends the filled form through the injected sender and reports delivery', async () => {
    const sender = vi.fn().mockResolvedValue({
      delivered: true,
      messageId: 'msg-12345678-rest',
      to: 'leader',
      type: 'steer',
    });
    const { container } = mount({ projects: PROJECTS, sender });
    expand(container);

    // Send is disabled until a body is present.
    expect(findButton(container, 'Send')?.disabled).toBe(true);

    setValue(
      container.querySelector('textarea') as HTMLTextAreaElement,
      'run the full test suite next',
    );
    const subjectInput = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.placeholder.startsWith('subject'),
    );
    setValue(subjectInput as HTMLInputElement, 'After current task');
    click(findButton(container, 'Send'));
    await act(async () => {});

    expect(sender).toHaveBeenCalledWith({
      projectId: 'abc123def456', // first project is the default target
      type: 'steer',
      to: 'leader',
      subject: 'After current task',
      body: 'run the full test suite next',
      priority: 'normal',
      audience: 'all',
    });
    expect(container.querySelector('.hq-composer-status.ok')?.textContent).toContain('msg-1234');
    // Body is cleared for the next message.
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('omits `to` for broadcast and honors project/priority selection', async () => {
    const sender = vi.fn().mockResolvedValue({ delivered: true, to: 'all', type: 'broadcast' });
    const { container } = mount({ projects: PROJECTS, sender });
    expand(container);

    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
    setValue(selects[0] as HTMLSelectElement, 'fff000fff000'); // project
    setValue(selects[1] as HTMLSelectElement, 'broadcast'); // type — hides `to`
    const prioritySelect = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).at(
      -1,
    );
    setValue(prioritySelect as HTMLSelectElement, 'high');
    setValue(container.querySelector('textarea') as HTMLTextAreaElement, 'stop all work');
    click(findButton(container, 'Send'));
    await act(async () => {});

    expect(sender).toHaveBeenCalledWith({
      projectId: 'fff000fff000',
      type: 'broadcast',
      subject: 'HQ prompt',
      body: 'stop all work',
      priority: 'high',
      audience: 'all',
    });
  });

  it('shows the sender error inline', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('could not resolve target project mailbox'));
    const { container } = mount({ projects: PROJECTS, sender });
    expand(container);
    setValue(container.querySelector('textarea') as HTMLTextAreaElement, 'hello');
    click(findButton(container, 'Send'));
    await act(async () => {});

    expect(container.querySelector('.hq-composer-status.err')?.textContent).toContain(
      'could not resolve target project mailbox',
    );
  });

  it('can restrict a project message to leader agents', async () => {
    const sender = vi.fn().mockResolvedValue({ delivered: true, to: 'all', type: 'broadcast' });
    const { container } = mount({ projects: PROJECTS, sender });
    expand(container);

    const audienceSelect = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find(
      (select) => Array.from(select.options).some((option) => option.value === 'leaders'),
    );
    const typeSelect = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).find(
      (select) => Array.from(select.options).some((option) => option.value === 'result'),
    );
    setValue(typeSelect as HTMLSelectElement, 'result');
    setValue(audienceSelect as HTMLSelectElement, 'leaders');
    setValue(container.querySelector('textarea') as HTMLTextAreaElement, 'leader-only context');
    click(findButton(container, 'Send'));
    await act(async () => {});

    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'result',
        audience: 'leaders',
        body: 'leader-only context',
      }),
    );
  });

  it('default sender posts to /api/mailbox-send with the JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ delivered: true, to: 'leader', type: 'steer' }), {
        status: 202,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = mount({ projects: PROJECTS });
    expand(container);
    setValue(container.querySelector('textarea') as HTMLTextAreaElement, 'wire check');
    click(findButton(container, 'Send'));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/mailbox-send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      projectId: 'abc123def456',
      type: 'steer',
      body: 'wire check',
    });
  });
});
