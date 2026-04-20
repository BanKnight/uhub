import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { channelProviderProtocolMap } from '@uhub/shared';
import type {
  AnalyticsSummary,
  ApiKey,
  AuditRequestItem,
  Channel,
  ChannelProvider,
  CreateApiKeyInput,
  CreateChannelInput,
  UpdateChannelInput,
  UpdateChannelStatusInput,
} from '@uhub/shared';
import React from 'react';
import {
  createApiKey as createApiKeyRequest,
  createChannel as createChannelRequest,
  getAnalyticsSummary as getAnalyticsSummaryRequest,
  listApiKeys,
  listAuditRequests,
  listChannels,
  revokeApiKey as revokeApiKeyRequest,
  rotateApiKey as rotateApiKeyRequest,
  updateChannel as updateChannelRequest,
  updateChannelStatus,
} from './lib/api';
import { adminAuthClient, getAdminSession } from './lib/auth';

const queryClient = new QueryClient();
const channelsQueryKey = ['admin', 'channels'];
const apiKeysQueryKey = ['admin', 'apiKeys'];
const analyticsQueryKey = ['admin', 'analytics'];
const auditQueryKey = ['admin', 'audit'];
const sessionQueryKey = ['admin', 'session'];
const initialChannelForm: CreateChannelInput = {
  name: '',
  provider: 'openai',
  protocol: 'openai_chat_completions',
  baseUrl: 'https://example.com',
  models: [],
  status: 'active',
};
const initialApiKeyForm: CreateApiKeyInput = {
  label: '',
  channelIds: [],
  endpointRules: ['openai_chat_completions'],
  maxConcurrency: 1,
  expiresAt: null,
  quota: {
    requestLimit: null,
  },
};

const endpointOptions: CreateApiKeyInput['endpointRules'] = [
  'openai_chat_completions',
  'anthropic_messages',
  'gemini_contents',
];

const providerOptions: ChannelProvider[] = ['openai', 'anthropic', 'gemini'];

function isStructuredProvider(provider: string): provider is ChannelProvider {
  return providerOptions.includes(provider as ChannelProvider);
}

function parseModelsInput(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseExpiresAtInput(value: string) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function RootLayout() {
  return (
    <main>
      <h1>admin-web</h1>
      <Outlet />
    </main>
  );
}

function SignInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const signInMutation = useMutation({
    mutationFn: async () => {
      setError(null);

      const session = await getAdminSession();
      if (session) {
        return session;
      }

      await adminAuthClient.signIn.email({
        email,
        password,
      });

      return getAdminSession();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      navigate({ to: '/' });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Sign in failed.');
    },
  });

  return (
    <section>
      <h2>Sign in</h2>
      <p>Sign in with the configured admin account.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          signInMutation.mutate();
        }}
      >
        <div>
          <label htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" disabled={signInMutation.isPending}>
          {signInMutation.isPending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {error ? <p>{error}</p> : null}
    </section>
  );
}

function formatNullableMetric(value: number | null) {
  return value === null ? 'n/a' : value;
}

function formatNullableTimestamp(value: number | null) {
  return value === null ? 'n/a' : new Date(value).toISOString();
}

function AnalyticsSection({ analytics }: { analytics: AnalyticsSummary }) {
  return (
    <section>
      <h2>Dashboard</h2>
      <p>Milestone 8 analytics + lifecycle shell.</p>
      <ul>
        <li>Total requests: {analytics.totalRequests}</li>
        <li>Completed: {analytics.completedRequests}</li>
        <li>Failed: {analytics.failedRequests}</li>
        <li>Rejected: {analytics.rejectedRequests}</li>
        <li>Avg latency: {analytics.avgLatencyMs ?? 'n/a'}</li>
        <li>
          Success rate:{' '}
          {analytics.successRate === null ? 'n/a' : `${(analytics.successRate * 100).toFixed(1)}%`}
        </li>
        <li>Input tokens: {formatNullableMetric(analytics.inputTokens)}</li>
        <li>Output tokens: {formatNullableMetric(analytics.outputTokens)}</li>
        <li>Total tokens: {formatNullableMetric(analytics.totalTokens)}</li>
        <li>Total cost (micros USD): {formatNullableMetric(analytics.totalCostMicros)}</li>
        <li>Token availability: {analytics.tokenUsageAvailability}</li>
      </ul>

      <h3>By endpoint</h3>
      {analytics.endpointBreakdown.length === 0 ? <p>No request analytics yet.</p> : null}
      <ul>
        {analytics.endpointBreakdown.map((item) => (
          <li key={item.endpoint}>
            <strong>{item.endpoint}</strong>
            <div>Total: {item.totalRequests}</div>
            <div>Completed: {item.completedRequests}</div>
            <div>Failed: {item.failedRequests}</div>
            <div>Rejected: {item.rejectedRequests}</div>
            <div>Avg latency: {item.avgLatencyMs ?? 'n/a'}</div>
            <div>
              Success rate:{' '}
              {item.successRate === null ? 'n/a' : `${(item.successRate * 100).toFixed(1)}%`}
            </div>
            <div>Input tokens: {formatNullableMetric(item.inputTokens)}</div>
            <div>Output tokens: {formatNullableMetric(item.outputTokens)}</div>
            <div>Total tokens: {formatNullableMetric(item.totalTokens)}</div>
            <div>Total cost (micros USD): {formatNullableMetric(item.totalCostMicros)}</div>
            <div>Token availability: {item.tokenUsageAvailability}</div>
          </li>
        ))}
      </ul>

      <h3>By channel</h3>
      {analytics.channelBreakdown.length === 0 ? <p>No channel analytics yet.</p> : null}
      <ul>
        {analytics.channelBreakdown.map((item) => (
          <li key={item.channelId}>
            <strong>{item.channelName ?? item.channelId}</strong>
            <div>Channel ID: {item.channelId}</div>
            <div>Provider: {item.provider ?? 'n/a'}</div>
            <div>Total: {item.totalRequests}</div>
            <div>Completed: {item.completedRequests}</div>
            <div>Failed: {item.failedRequests}</div>
            <div>Rejected: {item.rejectedRequests}</div>
            <div>Avg latency: {item.avgLatencyMs ?? 'n/a'}</div>
            <div>
              Success rate:{' '}
              {item.successRate === null ? 'n/a' : `${(item.successRate * 100).toFixed(1)}%`}
            </div>
            <div>Input tokens: {formatNullableMetric(item.inputTokens)}</div>
            <div>Output tokens: {formatNullableMetric(item.outputTokens)}</div>
            <div>Total tokens: {formatNullableMetric(item.totalTokens)}</div>
            <div>Total cost (micros USD): {formatNullableMetric(item.totalCostMicros)}</div>
            <div>Token availability: {item.tokenUsageAvailability}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditSection({
  items,
  filters,
  setFilters,
}: {
  items: AuditRequestItem[];
  filters: {
    status: string;
    endpoint: string;
    apiKeyPrefix: string;
    traceId: string;
  };
  setFilters: React.Dispatch<
    React.SetStateAction<{
      status: string;
      endpoint: string;
      apiKeyPrefix: string;
      traceId: string;
    }>
  >;
}) {
  return (
    <section>
      <h2>Audit</h2>
      <div>
        <label htmlFor="audit-status">Status</label>
        <select
          id="audit-status"
          value={filters.status}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.value,
            }))
          }
        >
          <option value="">All</option>
          <option value="pending">pending</option>
          <option value="processing">processing</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="rejected">rejected</option>
        </select>
      </div>
      <div>
        <label htmlFor="audit-endpoint">Endpoint</label>
        <select
          id="audit-endpoint"
          value={filters.endpoint}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              endpoint: event.target.value,
            }))
          }
        >
          <option value="">All</option>
          <option value="openai_chat_completions">openai_chat_completions</option>
          <option value="anthropic_messages">anthropic_messages</option>
          <option value="gemini_contents">gemini_contents</option>
        </select>
      </div>
      <div>
        <label htmlFor="audit-prefix">Key prefix</label>
        <input
          id="audit-prefix"
          value={filters.apiKeyPrefix}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              apiKeyPrefix: event.target.value,
            }))
          }
        />
      </div>
      <div>
        <label htmlFor="audit-trace">Trace</label>
        <input
          id="audit-trace"
          value={filters.traceId}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              traceId: event.target.value,
            }))
          }
        />
      </div>

      {items.length === 0 ? <p>No audit requests yet.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.apiKeyLabel ?? item.apiKeyId}</strong>
            <div>Prefix: {item.apiKeyPrefix ?? 'n/a'}</div>
            <div>Endpoint: {item.endpoint}</div>
            <div>Channel: {item.channelName ?? item.channelId ?? 'n/a'}</div>
            <div>Provider: {item.provider ?? 'n/a'}</div>
            <div>Status: {item.status}</div>
            <div>HTTP: {item.httpStatus ?? 'n/a'}</div>
            <div>Latency: {item.latencyMs ?? 'n/a'}</div>
            <div>Trace: {item.traceId ?? 'n/a'}</div>
            <div>Input tokens: {formatNullableMetric(item.inputTokens)}</div>
            <div>Output tokens: {formatNullableMetric(item.outputTokens)}</div>
            <div>Total tokens: {formatNullableMetric(item.totalTokens)}</div>
            <div>Total cost (micros USD): {formatNullableMetric(item.totalCostMicros)}</div>
            <div>Token availability: {item.tokenUsageAvailability}</div>
            <div>Created: {new Date(item.createdAt).toISOString()}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChannelsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<CreateChannelInput>(initialChannelForm);
  const [apiKeyForm, setApiKeyForm] = React.useState<CreateApiKeyInput>(initialApiKeyForm);
  const [modelsInput, setModelsInput] = React.useState('');
  const [editingChannelId, setEditingChannelId] = React.useState<string | null>(null);
  const [requestQuotaInput, setRequestQuotaInput] = React.useState('');
  const [expiresAtInput, setExpiresAtInput] = React.useState('');
  const [createdRawKey, setCreatedRawKey] = React.useState<string | null>(null);
  const [auditFilters, setAuditFilters] = React.useState({
    status: '',
    endpoint: '',
    apiKeyPrefix: '',
    traceId: '',
  });

  const sessionQuery = useQuery({
    queryKey: sessionQueryKey,
    queryFn: getAdminSession,
  });
  const channelsQuery = useQuery({
    queryKey: channelsQueryKey,
    queryFn: () => listChannels(),
  });
  const apiKeysQuery = useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: () => listApiKeys(),
  });
  const analyticsQuery = useQuery({
    queryKey: analyticsQueryKey,
    queryFn: () => getAnalyticsSummaryRequest(),
  });
  const auditQuery = useQuery({
    queryKey: [...auditQueryKey, auditFilters],
    queryFn: () =>
      listAuditRequests({
        status: auditFilters.status
          ? (auditFilters.status as 'pending' | 'processing' | 'completed' | 'failed' | 'rejected')
          : undefined,
        endpoint: auditFilters.endpoint
          ? (auditFilters.endpoint as
              | 'openai_chat_completions'
              | 'anthropic_messages'
              | 'gemini_contents')
          : undefined,
        apiKeyPrefix: auditFilters.apiKeyPrefix || undefined,
        traceId: auditFilters.traceId || undefined,
      }),
  });

  const signOutMutation = useMutation({
    mutationFn: async () => adminAuthClient.signOut(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      navigate({ to: '/sign-in' });
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: (input: CreateChannelInput) => createChannelRequest(input),
    onSuccess: async () => {
      setForm({ ...initialChannelForm });
      setModelsInput('');
      setEditingChannelId(null);
      await queryClient.invalidateQueries({ queryKey: channelsQueryKey });
    },
  });

  const updateChannelMutation = useMutation({
    mutationFn: (input: UpdateChannelInput) => updateChannelRequest(input),
    onSuccess: async () => {
      setForm({ ...initialChannelForm });
      setModelsInput('');
      setEditingChannelId(null);
      await queryClient.invalidateQueries({ queryKey: channelsQueryKey });
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (input: UpdateChannelStatusInput) => updateChannelStatus(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: channelsQueryKey });
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });

  const createApiKeyMutation = useMutation({
    mutationFn: (input: CreateApiKeyInput) => createApiKeyRequest(input),
    onSuccess: async (result) => {
      setCreatedRawKey(result.rawKey);
      setApiKeyForm({ ...initialApiKeyForm });
      setRequestQuotaInput('');
      setExpiresAtInput('');
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });
  const revokeApiKeyMutation = useMutation({
    mutationFn: (id: string) => revokeApiKeyRequest({ id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      await queryClient.invalidateQueries({ queryKey: analyticsQueryKey });
      await queryClient.invalidateQueries({ queryKey: auditQueryKey });
    },
  });
  const rotateApiKeyMutation = useMutation({
    mutationFn: (id: string) => rotateApiKeyRequest({ id }),
    onSuccess: async (result) => {
      setCreatedRawKey(result.rawKey);
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      await queryClient.invalidateQueries({ queryKey: analyticsQueryKey });
      await queryClient.invalidateQueries({ queryKey: auditQueryKey });
    },
  });

  const channels = channelsQuery.data ?? [];
  const activeChannels = channels.filter((channel) => channel.status === 'active');
  const apiKeys = apiKeysQuery.data ?? [];

  return (
    <section>
      <h2>Channels</h2>
      <p>Signed in as {sessionQuery.data?.user.email ?? 'unknown'}.</p>
      <button
        type="button"
        disabled={signOutMutation.isPending}
        onClick={() => signOutMutation.mutate()}
      >
        {signOutMutation.isPending ? 'Signing out...' : 'Sign out'}
      </button>
      <p>Milestone 2 minimal channel management shell.</p>

      {analyticsQuery.data ? <AnalyticsSection analytics={analyticsQuery.data} /> : null}
      {analyticsQuery.isPending ? <p>Loading dashboard...</p> : null}
      {analyticsQuery.error ? <p>Failed to load dashboard.</p> : null}

      {auditQuery.data ? (
        <AuditSection items={auditQuery.data} filters={auditFilters} setFilters={setAuditFilters} />
      ) : null}
      {auditQuery.isPending ? <p>Loading audit...</p> : null}
      {auditQuery.error ? <p>Failed to load audit.</p> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const payload = {
            ...form,
            models: parseModelsInput(modelsInput),
          };

          if (editingChannelId) {
            updateChannelMutation.mutate({
              id: editingChannelId,
              ...payload,
            });
            return;
          }

          createChannelMutation.mutate(payload);
        }}
      >
        <div>
          <label htmlFor="channel-name">Name</label>
          <input
            id="channel-name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </div>
        <div>
          <label htmlFor="channel-provider">Provider</label>
          <select
            id="channel-provider"
            value={form.provider}
            onChange={(event) => {
              const provider = event.target.value as ChannelProvider;
              setForm((current) => ({
                ...current,
                provider,
                protocol: channelProviderProtocolMap[provider],
              }));
            }}
          >
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="channel-protocol">Protocol</label>
          <input id="channel-protocol" value={form.protocol} readOnly />
        </div>
        <div>
          <label htmlFor="channel-base-url">Upstream Base URL</label>
          <input
            id="channel-base-url"
            value={form.baseUrl}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))
            }
          />
        </div>
        <div>
          <label htmlFor="channel-status">Status</label>
          <select
            id="channel-status"
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as CreateChannelInput['status'],
              }))
            }
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div>
          <label htmlFor="channel-models">Allowed Models</label>
          <input
            id="channel-models"
            value={modelsInput}
            onChange={(event) => setModelsInput(event.target.value)}
            placeholder="gpt-4o-mini, claude-3-5-sonnet, gemini-2.5-flash"
          />
        </div>
        <button
          type="submit"
          disabled={createChannelMutation.isPending || updateChannelMutation.isPending}
        >
          {editingChannelId
            ? updateChannelMutation.isPending
              ? 'Saving...'
              : 'Save channel'
            : createChannelMutation.isPending
              ? 'Creating...'
              : 'Create channel'}
        </button>
        {editingChannelId ? (
          <button
            type="button"
            onClick={() => {
              setEditingChannelId(null);
              setForm({ ...initialChannelForm });
              setModelsInput('');
            }}
          >
            Cancel edit
          </button>
        ) : null}
      </form>

      {channelsQuery.isPending ? <p>Loading channels...</p> : null}
      {channelsQuery.error ? <p>Failed to load channels.</p> : null}
      {createChannelMutation.error ? <p>Failed to create channel.</p> : null}
      {updateChannelMutation.error ? <p>Failed to update channel.</p> : null}
      {updateStatusMutation.error ? <p>Failed to update channel status.</p> : null}
      {!channelsQuery.isPending && channels.length === 0 ? <p>No channels yet.</p> : null}

      <ul>
        {channels.map((channel: Channel) => {
          const nextStatus = channel.status === 'active' ? 'disabled' : 'active';
          const canEdit = isStructuredProvider(channel.provider);
          return (
            <li key={channel.id}>
              <strong>{channel.name}</strong>
              <div>Provider: {channel.provider}</div>
              <div>Protocol: {channel.protocol}</div>
              <div>Upstream Base URL: {channel.baseUrl}</div>
              <div>Models: {channel.models.length > 0 ? channel.models.join(', ') : 'n/a'}</div>
              {channel.configJson !== '{}' ? (
                <div>Legacy configJson: {channel.configJson}</div>
              ) : null}
              <div>Status: {channel.status}</div>
              <div>Gateway health: {channel.gatewayHealthStatus}</div>
              <div>
                Gateway unhealthy until: {formatNullableTimestamp(channel.gatewayUnhealthyUntil)}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  disabled={updateChannelMutation.isPending}
                  onClick={() => {
                    const provider = channel.provider as ChannelProvider;
                    setEditingChannelId(channel.id);
                    setForm({
                      name: channel.name,
                      provider,
                      protocol: channel.protocol,
                      baseUrl: channel.baseUrl,
                      models: channel.models,
                      status: channel.status,
                    });
                    setModelsInput(channel.models.join(', '));
                  }}
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                disabled={updateStatusMutation.isPending}
                onClick={() =>
                  updateStatusMutation.mutate({
                    id: channel.id,
                    status: nextStatus,
                  })
                }
              >
                Set {nextStatus}
              </button>
            </li>
          );
        })}
      </ul>

      <section>
        <h2>API keys</h2>
        <p>Milestone 3 minimal issuance shell.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createApiKeyMutation.mutate({
              ...apiKeyForm,
              expiresAt: parseExpiresAtInput(expiresAtInput),
              quota: {
                requestLimit: requestQuotaInput ? Number(requestQuotaInput) : null,
              },
            });
          }}
        >
          <div>
            <label htmlFor="api-key-label">Label</label>
            <input
              id="api-key-label"
              value={apiKeyForm.label}
              onChange={(event) =>
                setApiKeyForm((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="api-key-channel">Allowed channel</label>
            <select
              id="api-key-channel"
              value={apiKeyForm.channelIds[0] ?? ''}
              onChange={(event) =>
                setApiKeyForm((current) => ({
                  ...current,
                  channelIds: event.target.value ? [event.target.value] : [],
                }))
              }
            >
              <option value="">Select a channel</option>
              {activeChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="api-key-endpoint">Allowed endpoint</label>
            <select
              id="api-key-endpoint"
              value={apiKeyForm.endpointRules[0] ?? 'openai_chat_completions'}
              onChange={(event) =>
                setApiKeyForm((current) => ({
                  ...current,
                  endpointRules: [event.target.value as CreateApiKeyInput['endpointRules'][number]],
                }))
              }
            >
              {endpointOptions.map((endpoint) => (
                <option key={endpoint} value={endpoint}>
                  {endpoint}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="api-key-max-concurrency">Max concurrency</label>
            <input
              id="api-key-max-concurrency"
              type="number"
              min={1}
              value={apiKeyForm.maxConcurrency}
              onChange={(event) =>
                setApiKeyForm((current) => ({
                  ...current,
                  maxConcurrency: Number(event.target.value) || 1,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="api-key-request-quota">Request quota</label>
            <input
              id="api-key-request-quota"
              type="number"
              min={1}
              value={requestQuotaInput}
              onChange={(event) => setRequestQuotaInput(event.target.value)}
              placeholder="Unlimited if empty"
            />
          </div>
          <div>
            <label htmlFor="api-key-expires-at">Expires at</label>
            <input
              id="api-key-expires-at"
              type="datetime-local"
              value={expiresAtInput}
              onChange={(event) => setExpiresAtInput(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={createApiKeyMutation.isPending || apiKeyForm.channelIds.length === 0}
          >
            {createApiKeyMutation.isPending ? 'Issuing...' : 'Issue key'}
          </button>
        </form>
        {createApiKeyMutation.error ? <p>Failed to issue API key.</p> : null}
        {revokeApiKeyMutation.error ? <p>Failed to revoke API key.</p> : null}
        {rotateApiKeyMutation.error ? <p>Failed to rotate API key.</p> : null}
        {createdRawKey ? (
          <p>
            Raw key: <code>{createdRawKey}</code>
          </p>
        ) : null}
        {apiKeysQuery.isPending ? <p>Loading API keys...</p> : null}
        {apiKeysQuery.error ? <p>Failed to load API keys.</p> : null}
        <ul>
          {apiKeys.map((apiKey: ApiKey) => (
            <li key={apiKey.id}>
              <strong>{apiKey.label}</strong>
              <div>Prefix: {apiKey.keyPrefix}</div>
              <div>Status: {apiKey.status}</div>
              <div>Max concurrency: {apiKey.maxConcurrency}</div>
              <div>Request quota: {apiKey.quota.requestLimit ?? 'unlimited'}</div>
              <div>Endpoints: {apiKey.endpointRules.join(', ')}</div>
              <div>
                Channels:{' '}
                {apiKey.channels.length > 0
                  ? apiKey.channels
                      .map((channel) => `${channel.name} (${channel.provider})`)
                      .join(', ')
                  : apiKey.channelIds.join(', ')}
              </div>
              <div>
                Expires at: {apiKey.expiresAt ? new Date(apiKey.expiresAt).toISOString() : 'never'}
              </div>
              <button
                type="button"
                disabled={revokeApiKeyMutation.isPending || apiKey.status === 'revoked'}
                onClick={() => revokeApiKeyMutation.mutate(apiKey.id)}
              >
                {apiKey.status === 'revoked' ? 'Revoked' : 'Revoke key'}
              </button>
              <button
                type="button"
                disabled={rotateApiKeyMutation.isPending || apiKey.status === 'revoked'}
                onClick={() => rotateApiKeyMutation.mutate(apiKey.id)}
              >
                {rotateApiKeyMutation.isPending ? 'Rotating...' : 'Rotate key'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: SignInPage,
});
const channelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    const session = await getAdminSession();
    if (!session) {
      throw redirect({ to: '/sign-in' });
    }
  },
  component: ChannelsPage,
});

const routeTree = rootRoute.addChildren([signInRoute, channelsRoute]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
