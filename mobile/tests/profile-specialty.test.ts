import { afterEach, expect, test } from 'bun:test';
import { doctorSpecialtySchema, SPECIALTY_NAMES } from '@mediqaz/contracts';

import { UsersApi } from '../src/features/users/api';
import { ApiTransport } from '../src/platform/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const profileResponse = {
  user: {
    id: 'doctor-1',
    email: 'doctor@example.com',
    displayName: 'Доктор',
    role: 'user',
    isApproved: true,
    specialty: 'surgeon',
    createdAt: '2026-07-27T00:00:00.000Z',
  },
};

function createApi(capture: Array<{ method: string; path: string; body: unknown }>) {
  globalThis.fetch = async (input, init) => {
    capture.push({
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(profileResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const transport = new ApiTransport({
    expire: () => undefined,
    getAccessToken: () => 'access-token',
    getGeneration: () => 1,
    isGenerationCurrent: () => true,
    refresh: async () => undefined,
    setAccessToken: () => true,
  });

  return new UsersApi(transport);
}

test('saves the specialty through the profile endpoint with an authenticated PATCH', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const api = createApi(calls);

  const result = await api.updateProfile({ displayName: 'Доктор', specialty: 'surgeon' });

  expect(result.user.specialty).toBe('surgeon');
  expect(calls).toEqual([
    {
      method: 'PATCH',
      path: '/api/users/me',
      body: { displayName: 'Доктор', specialty: 'surgeon' },
    },
  ]);
});

test('rejects a specialty the backend does not know before sending it', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const api = createApi(calls);

  // Validation is synchronous, so an unknown specialty never becomes a request.
  expect(() =>
    api.updateProfile({ displayName: 'Доктор', specialty: 'dentist' as never }),
  ).toThrow();
  expect(calls).toHaveLength(0);
});

test('clearing the specialty is expressible, so a wrong pick is recoverable', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const api = createApi(calls);

  await api.updateProfile({ displayName: 'Доктор', specialty: null });

  expect(calls[0]?.body).toEqual({ displayName: 'Доктор', specialty: null });
});

test('every selectable specialty has a Russian label the doctor can recognise', () => {
  for (const specialty of doctorSpecialtySchema.options) {
    const label = SPECIALTY_NAMES[specialty];
    expect(label).toBeTruthy();
    // The picker shows labels, not keys, so a doctor never sees "ent".
    expect(label).not.toBe(specialty);
  }
});
