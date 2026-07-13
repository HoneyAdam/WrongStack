import { describe, it, expect } from 'vitest';

// We'll test with a real net.Server since mocking it is fragile
// The module is simple enough that real port-binding tests are more reliable

import { isPortFree, findFreePort } from '../src/server/port-utils.js';

describe('port-utils', () => {
  // Use a high port range to avoid conflicts
  const BASE_PORT = 23456;

  describe('isPortFree', () => {
    it('resolves to true when the port is free', async () => {
      // Ports in the 20000+ range are usually free in CI
      const result = await isPortFree('127.0.0.1', BASE_PORT);
      expect(result).toBe(true);
    });

    it('resolves to false when the port is occupied', async () => {
      // Bind a server to occupy a port
      const net = await import('node:net');
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.listen(BASE_PORT + 1, '127.0.0.1', (err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        const result = await isPortFree('127.0.0.1', BASE_PORT + 1);
        expect(result).toBe(false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('findFreePort', () => {
    it('returns a free port at or above startPort', async () => {
      const port = await findFreePort('127.0.0.1', BASE_PORT + 10);
      expect(port).toBeGreaterThanOrEqual(BASE_PORT + 10);
      expect(port).toBeLessThanOrEqual(65535);
    });

    it('skips excluded ports', async () => {
      const exclude = new Set([BASE_PORT + 20]);
      const port = await findFreePort('127.0.0.1', BASE_PORT + 20, { exclude });
      // Should skip BASE_PORT + 20 and return the next one
      expect(port).toBe(BASE_PORT + 21);
      expect(exclude.has(port)).toBe(false);
    });

    it('wraps port beyond 65535 into the ephemeral range', async () => {
      // startPort > 65535 should wrap
      const port = await findFreePort('127.0.0.1', 65536, { maxTries: 1 });
      // 1024 + (65536 % 50000) = 1024 + 15536 = 16560
      expect(port).toBe(16560);
    });

    it('throws ToolValidationError when no free port is found', async () => {
      // Use an impossible port with maxTries=1 and mock that isPortFree returns false
      // We can force this by binding a real server to the target port first
      const net = await import('node:net');
      const server = net.createServer();
      const occupyPort = BASE_PORT + 30;
      await new Promise<void>((resolve, reject) => {
        server.listen(occupyPort, '127.0.0.1', (err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        // With maxTries=1, it should only try the occupied port
        await expect(
          findFreePort('127.0.0.1', occupyPort, { maxTries: 1 })
        ).rejects.toThrow(/No free port found/);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('uses default options when none provided', async () => {
      const port = await findFreePort('127.0.0.1', BASE_PORT + 40);
      expect(port).toBe(BASE_PORT + 40);
    });

    it('iterates when startPort is occupied', async () => {
      const net = await import('node:net');
      const server = net.createServer();
      const occupyPort = BASE_PORT + 50;
      await new Promise<void>((resolve, reject) => {
        server.listen(occupyPort, '127.0.0.1', (err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        // maxTries=2 so it can try occupyPort and then the next one
        const port = await findFreePort('127.0.0.1', occupyPort, { maxTries: 3 });
        expect(port).toBe(occupyPort + 1);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
