import { ChevronDown } from 'lucide-react';
import type { PendingModelSwitch } from './hooks/use-model-catalog.js';
import { isVisionModel } from './lib/model-capabilities.js';
import type { ModelDescriptor } from './types.js';

export interface ModelSwitcherProps {
  selectedModel: string;
  groupedModels: [string, ModelDescriptor[]][];
  providerLabels: Record<string, string>;
  disabled: boolean;
  pendingModelSwitch: PendingModelSwitch | null;
  onSelectModel: (provider: string, model: string) => void;
  onConfirmSwitch: () => void;
  onCancelSwitch: () => void;
}

function formatWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function ModelSwitcher(props: ModelSwitcherProps): React.JSX.Element {
  const {
    selectedModel,
    groupedModels,
    providerLabels,
    disabled,
    pendingModelSwitch,
    onSelectModel,
    onConfirmSwitch,
    onCancelSwitch,
  } = props;

  return (
    <div className="model-control">
      <select
        className="model-select"
        value={selectedModel}
        disabled={disabled}
        aria-label="Switch model"
        onChange={(event) => {
          const value = event.target.value;
          const tabIndex = value.indexOf('\t');
          if (tabIndex === -1) return;
          const provider = value.slice(0, tabIndex);
          const model = value.slice(tabIndex + 1);
          onSelectModel(provider, model);
        }}
      >
        {groupedModels.length === 0 && <option value="">Loading models…</option>}
        {groupedModels.map(([provider, entries]) => (
          <optgroup key={provider} label={providerLabels[provider] ?? provider}>
            {entries.map((entry) => {
              const vision = isVisionModel(entry.id);
              const window = entry.contextWindow ? ` · ${formatWindow(entry.contextWindow)}` : '';
              return (
                <option key={entry.id} value={`${provider}\t${entry.id}`}>
                  {entry.name}
                  {window}
                  {vision ? ' 👁' : ''}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>
      <ChevronDown size={11} className="model-chevron" aria-hidden="true" />
      {pendingModelSwitch && (
        <div
          className="model-switch-warning"
          role="alertdialog"
          aria-label="Smaller context window"
        >
          <p>
            <strong>{pendingModelSwitch.modelName}</strong> has a smaller context window (
            {formatWindow(pendingModelSwitch.nextWindow)} vs current{' '}
            {formatWindow(pendingModelSwitch.currentWindow)}). The session may need to compact
            mid-run.
          </p>
          <div className="model-switch-warning-actions">
            <button type="button" className="model-switch-confirm" onClick={onConfirmSwitch}>
              Switch anyway
            </button>
            <button type="button" className="model-switch-cancel" onClick={onCancelSwitch}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
