import { Loader, Sparkles, TriangleAlert } from 'lucide-react';
import type { RefineDecision, RefineState } from './lib/refine-model.js';

interface RefinePanelProps {
  state: RefineState;
  onDecision: (decision: RefineDecision) => void;
  onRetry: () => void;
  onRetryFallback: (ref: string) => void;
}

/** Review step for a refined prompt.
 *
 * Three faces, one per status: an in-flight spinner, a refined/original
 * comparison, and a recovery panel when the refine round-trip fails. The
 * failure face never silently sends the original — the user picks. */
export function RefinePanel({ state, onDecision, onRetry, onRetryFallback }: RefinePanelProps) {
  if (state.status === 'refining') {
    return (
      <div className="refine-panel refining" role="status" aria-live="polite">
        <Loader size={13} className="refine-spin" aria-hidden="true" />
        <span>
          Refining your prompt{state.provider && state.model ? ` on ${state.provider}/${state.model}` : ''}…
        </span>
        <button type="button" onClick={() => onDecision('original')}>
          Send as-is
        </button>
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <div className="refine-panel failed" role="alert">
        <div className="refine-head">
          <TriangleAlert size={13} aria-hidden="true" />
          <strong>Refine failed</strong>
          {state.provider && state.model ? (
            <span className="refine-model-label">
              on {state.provider}/{state.model}
            </span>
          ) : null}
          <span>{state.error ?? 'Unknown error'}</span>
        </div>
        <div className="refine-actions">
          <button type="button" onClick={onRetry}>
            Retry
          </button>
          {state.fallbackRef && (
            <button type="button" onClick={() => onRetryFallback(state.fallbackRef ?? '')}>
              Try {state.fallbackRef}
            </button>
          )}
          <button type="button" onClick={() => onDecision('edit')}>
            Edit
          </button>
          <button type="button" className="primary" onClick={() => onDecision('original')}>
            Send as-is
          </button>
        </div>
      </div>
    );
  }

  const showEnglish = state.english && state.english !== state.refined;
  return (
    <div className="refine-panel ready" role="dialog" aria-label="Review refined prompt">
      <div className="refine-head">
        <Sparkles size={13} aria-hidden="true" />
        <strong>Refined prompt</strong>
        {state.provider && state.model ? (
          <span className="refine-model-label">
            via {state.provider}/{state.model}
          </span>
        ) : null}
      </div>
      <div className="refine-compare">
        <div className="refine-column">
          <span>ORIGINAL</span>
          <p>{state.original}</p>
        </div>
        <div className="refine-column refined">
          <span>REFINED</span>
          <p>{state.refined}</p>
        </div>
      </div>
      {showEnglish && (
        <div className="refine-english">
          <span>ENGLISH</span>
          <p>{state.english}</p>
        </div>
      )}
      <div className="refine-actions">
        <button type="button" onClick={() => onDecision('edit')}>
          Edit
        </button>
        <button type="button" onClick={() => onDecision('original')}>
          Send original
        </button>
        {showEnglish && (
          <button type="button" onClick={() => onDecision('english')}>
            Send English
          </button>
        )}
        <button type="button" className="primary" onClick={() => onDecision('refined')}>
          Send refined
        </button>
      </div>
    </div>
  );
}
