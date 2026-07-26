import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AccountSummary } from '../src/features/users/AccountSummary'

test('account summary renders the identity supplied by the backend', () => {
  const markup = renderToStaticMarkup(
    <AccountSummary
      user={{
        id: 'user-1',
        email: 'user@example.com',
        displayName: 'Demo User',
        role: 'admin',
        isApproved: false,
        specialty: null,
        createdAt: '2026-07-20T00:00:00.000Z',
      }}
    />,
  )

  expect(markup).toContain('Demo User')
  expect(markup).toContain('user@example.com')
  expect(markup).toContain('Workspace role: Admin')
  expect(markup).toContain('Jul 20, 2026')
})
