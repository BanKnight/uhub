import React from 'react';
import ReactDOM from 'react-dom/client';
import type { PortalExchangeResult, PortalOverview, RequestHistoryItem } from '@uhub/shared';

const API_BASE_URL = 'http://localhost:8787';

type ErrorPayload = {
  error?: string;
};

function formatNullableTimestamp(value: number | null) {
  return typeof value === 'number' ? new Date(value).toISOString() : 'n/a';
}

function formatNullableMetric(value: number | null) {
  return value === null ? 'n/a' : value;
}

function App() {
  const [rawKey, setRawKey] = React.useState('');
  const [session, setSession] = React.useState<PortalExchangeResult | null>(null);
  const [overview, setOverview] = React.useState<PortalOverview | null>(null);
  const [requests, setRequests] = React.useState<RequestHistoryItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoadingPortal, setIsLoadingPortal] = React.useState(false);

  const loadPortalData = React.useCallback(async () => {
    setIsLoadingPortal(true);
    setError(null);

    try {
      const [overviewResponse, requestsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/portal/me`, {
          credentials: 'include',
        }),
        fetch(`${API_BASE_URL}/portal/requests`, {
          credentials: 'include',
        }),
      ]);

      if (!overviewResponse.ok || !requestsResponse.ok) {
        const payload = (await overviewResponse.json().catch(() => null)) as ErrorPayload | null;
        setSession(null);
        setOverview(null);
        setRequests([]);
        setError(payload?.error ?? 'Portal session is not available.');
        return;
      }

      setOverview((await overviewResponse.json()) as PortalOverview);
      setRequests((await requestsResponse.json()) as RequestHistoryItem[]);
    } finally {
      setIsLoadingPortal(false);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/portal/auth/exchange`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rawKey }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setError(payload?.error ?? 'API key exchange failed.');
        return;
      }

      const exchange = (await response.json()) as PortalExchangeResult;
      setSession(exchange);
      setRawKey('');
      await loadPortalData();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>key-portal</h1>
      {!session ? (
        <section>
          <h2>API key login</h2>
          <form onSubmit={handleSubmit}>
            <label htmlFor="raw-key">API key</label>
            <input
              id="raw-key"
              value={rawKey}
              onChange={(event) => setRawKey(event.target.value)}
              placeholder="uhub_..."
            />
            <button type="submit" disabled={isSubmitting || rawKey.length === 0}>
              {isSubmitting ? 'Exchanging...' : 'Log in'}
            </button>
          </form>
          {error ? <p>{error}</p> : null}
        </section>
      ) : (
        <>
          <section>
            <h2>Portal overview</h2>
            <p>
              Logged in as {session.label}. Session expires at{' '}
              {new Date(session.expiresAt).toISOString()}.
            </p>
            {isLoadingPortal ? <p>Loading portal data...</p> : null}
            {overview ? (
              <>
                <ul>
                  <li>Status: {overview.apiKey.status}</li>
                  <li>
                    Expires at:{' '}
                    {overview.apiKey.expiresAt
                      ? new Date(overview.apiKey.expiresAt).toISOString()
                      : 'never'}
                  </li>
                  <li>Max concurrency: {overview.apiKey.maxConcurrency}</li>
                  <li>Allowed endpoints: {overview.apiKey.endpointRules.join(', ')}</li>
                  <li>
                    Allowed channels:{' '}
                    {overview.apiKey.channels.length > 0
                      ? overview.apiKey.channels
                          .map((channel) => `${channel.name} (${channel.provider})`)
                          .join(', ')
                      : 'n/a'}
                  </li>
                </ul>

                <h3>Usage</h3>
                <ul>
                  <li>Total requests: {overview.usage.totalRequests}</li>
                  <li>Success: {overview.usage.successRequests}</li>
                  <li>Failed: {overview.usage.failedRequests}</li>
                  <li>Rejected: {overview.usage.rejectedRequests}</li>
                  <li>Input tokens: {formatNullableMetric(overview.usage.tokens.inputTokens)}</li>
                  <li>Output tokens: {formatNullableMetric(overview.usage.tokens.outputTokens)}</li>
                  <li>Total tokens: {formatNullableMetric(overview.usage.tokens.totalTokens)}</li>
                  <li>
                    Total cost (micros USD):{' '}
                    {formatNullableMetric(overview.usage.cost.totalCostMicros)}
                  </li>
                  <li>Token availability: {overview.usage.tokens.tokenUsageAvailability}</li>
                  <li>Last used at: {formatNullableTimestamp(overview.usage.lastUsedAt)}</li>
                  <li>Quota limit: {formatNullableMetric(overview.usage.quota.quotaLimit)}</li>
                  <li>Quota used: {formatNullableMetric(overview.usage.quota.quotaUsed)}</li>
                  <li>
                    Quota remaining: {formatNullableMetric(overview.usage.quota.quotaRemaining)}
                  </li>
                </ul>
              </>
            ) : null}
          </section>
          <section>
            <h2>Recent requests</h2>
            {requests.length === 0 ? (
              <p>No requests yet.</p>
            ) : (
              <ul>
                {requests.map((request) => (
                  <li key={request.id}>
                    <strong>{request.endpoint}</strong>
                    <div>Model: {request.model ?? 'n/a'}</div>
                    <div>Channel: {request.channelName ?? request.channelId ?? 'n/a'}</div>
                    <div>Provider: {request.provider ?? 'n/a'}</div>
                    <div>Status: {request.status}</div>
                    <div>Trace: {request.traceId ?? 'n/a'}</div>
                    <div>Latency: {request.latencyMs ?? 'n/a'}</div>
                    <div>HTTP: {request.httpStatus ?? 'n/a'}</div>
                    <div>Input tokens: {formatNullableMetric(request.inputTokens)}</div>
                    <div>Output tokens: {formatNullableMetric(request.outputTokens)}</div>
                    <div>Total tokens: {formatNullableMetric(request.totalTokens)}</div>
                    <div>
                      Total cost (micros USD): {formatNullableMetric(request.totalCostMicros)}
                    </div>
                    <div>Token availability: {request.tokenUsageAvailability}</div>
                    <div>Created: {new Date(request.createdAt).toISOString()}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
