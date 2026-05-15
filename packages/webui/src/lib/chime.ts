/**
 * Tiny soft chime played when a long-running agent run completes. We don't
 * ship an audio asset — the sound is synthesized with Web Audio so it's
 * zero-bytes-shipped and trivially tweakable.
 *
 * Tuned to be unobtrusive: two notes ascending, ~250ms total, ~-12dB
 * envelope. Quiet enough to not startle on a still office, audible enough
 * to cut through music. Browsers require a prior user interaction before
 * any audio plays — by the time the agent has actually finished a turn the
 * user has already typed, so the autoplay policy is satisfied.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  // SSR/Test guard plus older Safari (webkit prefix).
  const Cls =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Cls) return null;
  try {
    ctx = new Cls();
  } catch {
    return null;
  }
  return ctx;
}

function tone(freq: number, startAt: number, durSec: number): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + startAt;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Quick attack, exponential decay — sounds like a soft "bing".
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + durSec + 0.02);
}

export function playCompletionChime(): void {
  // Two-note arpeggio: E5 → A5 (a perfect fourth, pleasant + non-alarming).
  tone(659.25, 0, 0.18);
  tone(880, 0.12, 0.24);
}
