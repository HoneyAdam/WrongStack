export interface CapturedInteraction {
  actionId: string;
  kind: 'click' | 'keyboard' | 'programmatic';
  occurredAt: string;
  target?: { tag?: string; role?: string; label?: string; testId?: string } | undefined;
  key?: string | undefined;
  modifiers?: string[] | undefined;
}

let recent: { value: CapturedInteraction; at: number } | undefined;
let installed = false;

export function installInteractionCapture(): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  const onClick = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target.closest('button,a,[role],[data-testid]') : null;
    recent = {
      at: Date.now(),
      value: {
        actionId: actionId(),
        kind: 'click',
        occurredAt: new Date().toISOString(),
        ...(element ? { target: describeElement(element) } : {}),
      },
    };
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) return;
    recent = {
      at: Date.now(),
      value: {
        actionId: actionId(),
        kind: 'keyboard',
        occurredAt: new Date().toISOString(),
        key: event.key,
        modifiers: modifiers(event),
        ...(event.target instanceof Element ? { target: describeElement(event.target) } : {}),
      },
    };
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  return () => {
    installed = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

export function interactionForCommand(): CapturedInteraction {
  if (recent && Date.now() - recent.at <= 1_500) return recent.value;
  return { actionId: actionId(), kind: 'programmatic', occurredAt: new Date().toISOString() };
}

function describeElement(element: Element): CapturedInteraction['target'] {
  const text = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent?.trim();
  return {
    tag: element.tagName.toLowerCase(),
    ...(element.getAttribute('role') ? { role: element.getAttribute('role')! } : {}),
    ...(text ? { label: text.slice(0, 120) } : {}),
    ...(element.getAttribute('data-testid') ? { testId: element.getAttribute('data-testid')! } : {}),
  };
}

function modifiers(event: KeyboardEvent): string[] {
  return [event.ctrlKey ? 'ctrl' : '', event.altKey ? 'alt' : '', event.shiftKey ? 'shift' : '', event.metaKey ? 'meta' : ''].filter(Boolean);
}

function actionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
