import { beforeEach, describe, expect, it } from 'vitest';
import { WS_HANDLERS } from '../../src/hooks/ws-handlers';
import { useSddWizardStore } from '../../src/stores/sdd-wizard-store';

/** Dispatch a server→client message through the real WS_HANDLERS map. */
function dispatch(type: string, payload: unknown) {
  WS_HANDLERS[type]?.({ type, payload } as never);
}

describe('WS_HANDLERS — SDD wizard client wiring', () => {
  beforeEach(() => {
    useSddWizardStore.getState().reset();
  });

  it('sdd.spec.snapshot updates the wizard store', () => {
    dispatch('sdd.spec.snapshot', {
      sessionId: 's1',
      phase: 'spec_review',
      title: 'OAuth login',
      questionCount: 2,
      minQuestions: 1,
      maxQuestions: 3,
      answers: [{ question: 'Q', answer: 'A' }],
      spec: { id: 'sp', title: 'OAuth login', overview: 'ov', requirements: [] },
      taskCount: 0,
      prompt: 'review',
      busy: false,
    });
    const snap = useSddWizardStore.getState().snapshot;
    expect(snap?.phase).toBe('spec_review');
    expect(snap?.title).toBe('OAuth login');
    expect(snap?.spec?.title).toBe('OAuth login');
  });

  it('sdd.spec.agent_text stores the latest agent message', () => {
    dispatch('sdd.spec.agent_text', { text: 'Which providers?' });
    expect(useSddWizardStore.getState().agentText).toBe('Which providers?');
  });

  it('sdd.spec.error surfaces the error', () => {
    dispatch('sdd.spec.error', { message: 'A goal is required.' });
    expect(useSddWizardStore.getState().error).toBe('A goal is required.');
  });

  it('a fresh snapshot clears a prior error', () => {
    useSddWizardStore.getState().setError('old');
    dispatch('sdd.spec.snapshot', {
      sessionId: 's1',
      phase: 'questioning',
      title: 'X',
      questionCount: 0,
      minQuestions: 1,
      maxQuestions: 3,
      answers: [],
      taskCount: 0,
      prompt: 'p',
      busy: true,
    });
    expect(useSddWizardStore.getState().error).toBeNull();
  });

  it('sdd.run.started records the runId (drives the Live Board hand-off)', () => {
    dispatch('sdd.run.started', { runId: 'run-42' });
    expect(useSddWizardStore.getState().startedRunId).toBe('run-42');
  });
});
