import { describe, expect, it } from 'vitest';
import {
  assertBrowserUrlAllowed,
  redactBrowserText,
  safeBrowserUrl,
} from '../src/browser/security.js';

describe('browser security boundary', () => {
  it('allows public https URLs and removes sensitive URL components from output', async () => {
    await expect(
      assertBrowserUrlAllowed('https://example.com/path?q=secret#fragment', {
        allowPrivateHosts: false,
        navigation: true,
      }),
    ).resolves.toBeInstanceOf(URL);
    expect(safeBrowserUrl('https://user:pass@example.com/path?q=secret#fragment')).toBe(
      'https://example.com/path',
    );
  });

  it('blocks credentials, unsupported protocols, localhost, and private addresses', async () => {
    await expect(
      assertBrowserUrlAllowed('https://user:pass@example.com/', {
        allowPrivateHosts: false,
        navigation: true,
      }),
    ).rejects.toThrow(/credentials/);
    await expect(
      assertBrowserUrlAllowed('file:///etc/passwd', {
        allowPrivateHosts: false,
        navigation: true,
      }),
    ).rejects.toThrow(/unsupported protocol/);
    await expect(
      assertBrowserUrlAllowed('http://127.0.0.1/', {
        allowPrivateHosts: false,
        navigation: true,
      }),
    ).rejects.toThrow(/private|loopback/);
    await expect(
      assertBrowserUrlAllowed('http://localhost/', {
        allowPrivateHosts: false,
        navigation: true,
      }),
    ).rejects.toThrow(/localhost/);
  });

  it('allows private fixture hosts only through an explicit host option', async () => {
    await expect(
      assertBrowserUrlAllowed('http://127.0.0.1:3000/', {
        allowPrivateHosts: true,
        navigation: true,
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('redacts common console credential forms', () => {
    const redacted = redactBrowserText(
      'Authorization Bearer abc.def token=top-secret password=hunter2 api_key=key123',
    );
    expect(redacted).not.toContain('abc.def');
    expect(redacted).not.toContain('top-secret');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('key123');
  });
});
