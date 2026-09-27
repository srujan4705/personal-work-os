import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/lib/auth';
import { Layout } from '../src/components/Layout';

describe('sign out', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the app, shows login, and drops cached personal data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));
    const qc = new QueryClient();
    qc.setQueryData(['me'], { id: 'u1', email: 'me@example.com', name: 'Me', timezone: 'UTC' });
    qc.setQueryData(['dashboard'], { secret: true });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Layout><p>private dashboard</p></Layout>} />
              <Route path="/login" element={<p>login page</p>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('private dashboard')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Sign out')[0]!);
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
    expect(screen.queryByText('private dashboard')).not.toBeInTheDocument();
    expect(qc.getQueryData(['me'])).toBeNull();
    expect(qc.getQueryData(['dashboard'])).toBeUndefined();
  });
});
