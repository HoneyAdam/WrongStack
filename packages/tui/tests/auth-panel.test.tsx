import { describe, expect, it } from 'vitest';
import { isAuthFlowUrlLine } from '../src/components/auth-panel.js';

describe('AuthPanel flow URL rendering helpers', () => {
  it('recognizes standalone OAuth URLs so the TUI can wrap instead of truncate them', () => {
    expect(
      isAuthFlowUrlLine(
        'https://auth.openai.com/oauth/authorize?response_type=code&client_id=x&state=y',
      ),
    ).toBe(true);
    expect(isAuthFlowUrlLine('  http://localhost:1455/auth/callback?code=abc&state=xyz  ')).toBe(
      true,
    );
  });

  it('does not treat explanatory log lines as URL-only lines', () => {
    expect(isAuthFlowUrlLine('Open this URL in your browser to sign in:')).toBe(false);
    expect(isAuthFlowUrlLine('Listening on http://localhost:1455/auth/callback')).toBe(false);
  });
});
