// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingModelSwitch } from '../src/hooks/use-model-catalog.js';
import { ModelSwitcher } from '../src/model-switcher.js';
import type { ModelDescriptor } from '../src/types.js';

const roots: Root[] = [];

function makeModels(): [string, ModelDescriptor[]][] {
  return [
    [
      'openai',
      [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128_000 },
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128_000 },
        { id: 'vision-model', name: 'Vision', contextWindow: 64_000 },
      ],
    ],
  ];
}

const pending: PendingModelSwitch = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  modelName: 'GPT-4o mini',
  currentWindow: 128_000,
  nextWindow: 64_000,
};

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

function select(container: HTMLElement): HTMLSelectElement {
  const el = container.querySelector('.model-select');
  if (!el) throw new Error('.model-select not found');
  return el as HTMLSelectElement;
}

function render(props: Partial<Parameters<typeof ModelSwitcher>[0]> = {}): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      <ModelSwitcher
        selectedModel={props.selectedModel ?? 'openai\tgpt-4o'}
        groupedModels={props.groupedModels ?? makeModels()}
        providerLabels={props.providerLabels ?? { openai: 'OpenAI' }}
        disabled={props.disabled ?? false}
        pendingModelSwitch={props.pendingModelSwitch ?? null}
        onSelectModel={props.onSelectModel ?? vi.fn()}
        onConfirmSwitch={props.onConfirmSwitch ?? vi.fn()}
        onCancelSwitch={props.onCancelSwitch ?? vi.fn()}
      />,
    ),
  );
  return container;
}

describe('ModelSwitcher — select rendering', () => {
  it('renders one optgroup per provider with its models as options', () => {
    const container = render();
    const groups = container.querySelectorAll('optgroup');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.getAttribute('label')).toBe('OpenAI');

    const options = container.querySelectorAll('optgroup option');
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain('GPT-4o');
    expect(options[0]?.textContent).toContain('128K');
  });

  it('shows a vision emoji for vision-capable models', () => {
    const container = render();
    const options = container.querySelectorAll('optgroup option');
    const visionOption = Array.from(options).find((o) => o.textContent?.includes('Vision'));
    expect(visionOption?.textContent).toContain('👁');
  });

  it('disables the select when disabled=true', () => {
    const container = render({ disabled: true });
    expect(select(container).disabled).toBe(true);
  });

  it('shows Loading models… when groupedModels is empty', () => {
    const container = render({ groupedModels: [] });
    const placeholder = select(container).querySelector('option');
    expect(placeholder?.textContent).toBe('Loading models…');
  });
});

describe('ModelSwitcher — option values', () => {
  it('uses provider\\tmodel as the option value for onChange splitting', () => {
    const onSelectModel = vi.fn();
    const container = render({ onSelectModel });
    const sel = select(container);
    act(() => {
      sel.value = 'openai\tgpt-4o-mini';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectModel).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
  });

  it('ignores a value without a tab separator', () => {
    const onSelectModel = vi.fn();
    const container = render({ onSelectModel });
    const sel = select(container);
    act(() => {
      sel.value = 'no-tab-here';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectModel).not.toHaveBeenCalled();
  });
});

describe('ModelSwitcher — warning dialog', () => {
  it('does not render a warning when pendingModelSwitch is null', () => {
    const container = render({ pendingModelSwitch: null });
    expect(container.querySelector('.model-switch-warning')).toBeNull();
  });

  it('renders the warning with model name and context sizes when pending', () => {
    const container = render({ pendingModelSwitch: pending });
    const warning = container.querySelector('.model-switch-warning');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('GPT-4o mini');
    expect(warning?.textContent).toContain('64K');
    expect(warning?.textContent).toContain('128K');
  });

  it('calls onConfirmSwitch when the confirm button is clicked', () => {
    const onConfirmSwitch = vi.fn();
    const container = render({ pendingModelSwitch: pending, onConfirmSwitch });
    const btn = container.querySelector<HTMLButtonElement>('.model-switch-confirm');
    act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onConfirmSwitch).toHaveBeenCalledTimes(1);
  });

  it('calls onCancelSwitch when the cancel button is clicked', () => {
    const onCancelSwitch = vi.fn();
    const container = render({ pendingModelSwitch: pending, onCancelSwitch });
    const btn = container.querySelector<HTMLButtonElement>('.model-switch-cancel');
    act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onCancelSwitch).toHaveBeenCalledTimes(1);
  });
});
