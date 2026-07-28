import { afterEach, expect, test } from 'bun:test';

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

/**
 * React Native defines a `window` global that is the global object, and it has
 * no DOM event methods. A `typeof window === 'undefined'` guard passes there,
 * which is why this only failed on a device and never in the suite.
 */
test('subscribing does not crash where window exists without DOM event methods', async () => {
  (globalThis as { window?: unknown }).window = {};

  const { browserSessionCoordinator } = await import(
    '../src/features/auth/browser-session-coordinator'
  );

  let unsubscribe: (() => void) | undefined;
  expect(() => {
    unsubscribe = browserSessionCoordinator.subscribe(() => undefined);
  }).not.toThrow();

  expect(typeof unsubscribe).toBe('function');
  expect(() => unsubscribe?.()).not.toThrow();
});

test('publishing does not crash without DOM storage', async () => {
  (globalThis as { window?: unknown }).window = {};

  const { browserSessionCoordinator } = await import(
    '../src/features/auth/browser-session-coordinator'
  );

  expect(() => browserSessionCoordinator.publish('authenticated', 'doctor-1')).not.toThrow();
  expect(browserSessionCoordinator.current().state).toBe('authenticated');
});
