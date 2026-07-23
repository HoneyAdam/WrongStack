import { describe, expect, it } from 'vitest';
import { EMPTY_KEY, type KeyEvent } from '../src/components/input.js';
import { overlayPointerKey } from '../src/overlay-key-router.js';
import { createTestState } from './helpers/create-test-state.js';

function mouseKey(button: 'left' | 'right'): KeyEvent {
  return {
    ...EMPTY_KEY,
    mouse: {
      kind: 'press',
      button,
      x: 12,
      y: 8,
      wheel: 0,
      shift: false,
      meta: false,
      ctrl: false,
      motion: false,
    },
  };
}

describe('overlayPointerKey', () => {
  it('maps left click to Enter only while a selectable overlay is open', () => {
    expect(overlayPointerKey(createTestState(), '', mouseKey('left'))).toEqual({
      isEnter: false,
      cancelAction: null,
    });

    const state = createTestState({
      promptPicker: { ...createTestState().promptPicker, open: true },
    });
    expect(overlayPointerKey(state, '', mouseKey('left'))).toEqual({
      isEnter: true,
      cancelAction: null,
    });
  });

  it.each([
    ['modePicker', { type: 'modePickerClose' }],
    ['promptPicker', { type: 'promptPickerClose' }],
    ['projectPicker', { type: 'projectPickerClose' }],
    ['statuslinePicker', { type: 'statuslineClose' }],
    ['pluginPicker', { type: 'pluginPickerClose' }],
    ['mcpPicker', { type: 'mcpPickerClose' }],
    ['toolsPicker', { type: 'toolsPickerClose' }],
    ['helpPanel', { type: 'helpClose' }],
    ['brainPanel', { type: 'brainClose' }],
    ['shadowPanel', { type: 'shadowClose' }],
    ['fKeyPicker', { type: 'fKeyPickerClose' }],
    ['authPanel', { type: 'authClose' }],
  ] as const)('maps right click on %s to its close action', (field, expected) => {
    const base = createTestState();
    const state = createTestState({
      [field]: { ...base[field], open: true },
    });

    expect(overlayPointerKey(state, '', mouseKey('right'))).toEqual({
      isEnter: false,
      cancelAction: expected,
    });
  });

  it('maps right click in the model list to Back before closing the picker', () => {
    const state = createTestState({
      modelPicker: { ...createTestState().modelPicker, open: true, step: 'model' },
    });

    expect(overlayPointerKey(state, '', mouseKey('right'))).toEqual({
      isEnter: false,
      cancelAction: { type: 'modelPickerBack' },
    });
  });
});
