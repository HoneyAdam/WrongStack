import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores';
import { CheckCircle2, Cpu, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';

interface CatalogModel {
  id: string;
  name: string;
  releaseDate?: string | undefined;
  contextWindow?: number | undefined;
  inputCost?: number | undefined;
  outputCost?: number | undefined;
  capabilities: string[];
}

interface CatalogProvider {
  id: string;
  name: string;
}

export interface ModelSectionProps {
  /** Current provider id. */
  provider: string;
  /** Provider → models cache. */
  catalogModels: Record<string, CatalogModel[]>;
  /** The current catalog provider object (for displaying name). */
  currentCatalogProvider: CatalogProvider | undefined;
  /** Loading flag. */
  isLoadingModels: boolean;
  setIsLoadingModels: (v: boolean) => void;
  /** Called when a model is selected. */
  onModelSelect: (modelId: string) => void;
  /** Refresh model list from backend. */
  refreshModels: (providerId: string) => void;
}

export function ModelSection({
  provider,
  catalogModels,
  currentCatalogProvider,
  isLoadingModels,
  setIsLoadingModels,
  onModelSelect,
  refreshModels,
}: ModelSectionProps) {
  const model = useConfigStore((s) => s.model);

  return (
    <div className="space-y-4">
      {provider ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {currentCatalogProvider?.name || provider}
              </p>
              <p className="text-xs text-muted-foreground">{provider}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsLoadingModels(true);
                refreshModels(provider);
              }}
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingModels && 'animate-spin')} />
            </Button>
          </div>

          {isLoadingModels && !catalogModels[provider] ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading models...</span>
            </div>
          ) : (
            <div className="space-y-1">
              {(catalogModels[provider] || []).map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => onModelSelect(m.id)}
                  className={cn(
                    'w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all',
                    model === m.id
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <div>
                    <span className="font-medium">{m.name || m.id}</span>
                    <div className="flex gap-2 mt-1">
                      {m.capabilities.map((cap) => (
                        <span key={cap} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {m.contextWindow && <div>{m.contextWindow / 1000}k context</div>}
                    {m.inputCost && m.outputCost && (
                      <div>
                        ${m.inputCost}/${m.outputCost}
                      </div>
                    )}
                    {model === m.id && (
                      <CheckCircle2 className="h-4 w-4 text-primary mt-1" />
                    )}
                  </div>
                </button>
              ))}

              {catalogModels[provider]?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No models found for this provider. The catalog might be empty or still
                  loading.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <Cpu className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Select a provider first</p>
        </div>
      )}
    </div>
  );
}
