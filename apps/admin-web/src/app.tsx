import React from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, redirect, RouterProvider, useNavigate } from '@tanstack/react-router';
import type { ApiKey, CreateApiKeyInput, Channel, CreateChannelInput, UpdateChannelStatusInput } from '@uhub/shared';
import {
  createApiKey as createApiKeyRequest,
  createChannel as createChannelRequest,
  listApiKeys,
  listChannels,
  revokeApiKey as revokeApiKeyRequest,
  updateChannelStatus,
} from './lib/api';
import { adminAuthClient, getAdminSession } from './lib/auth';

const queryClient = new QueryClient();
const channelsQueryKey = ['admin', 'channels'];
const apiKeysQueryKey = ['admin', 'apiKeys'];
const sessionQueryKey = ['admin', 'session'];
const initialChannelForm: CreateChannelInput = {
  name: '',
  provider: '',
  baseUrl: 'https://example.com',
  status: 'active',
  configJson: '{}',
};
const initialApiKeyForm: CreateApiKeyInput = {
  label: '',
  channelIds: [],
  endpointRules: ['openai_chat_completions'],
  maxConcurrency: 1,
  expiresAt: null,
};

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
  const [name, setName] = React.useState('Admin');
  const [email, setEmail] = React.useState('admin@example.com');
  const [password, setPassword] = React.useState('admin123456');
  const [error, setError] = React.useState<string | null>(null);

  const signInMutation = useMutation({
    mutationFn: async () => {
      setError(null);

      const session = await getAdminSession();
      if (session) {
        return session;
      }

      const signUpResult = await adminAuthClient.signUp.email({
        name,
        email,
        password,
      }).catch(() => null);

      if (!signUpResult) {
        await adminAuthClient.signIn.email({
          email,
          password,
        });
      }

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
      <p>Minimal Better Auth admin shell.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          signInMutation.mutate();
        }}
      >
        <div>
          <label htmlFor="admin-name">Name</label>
          <input id="admin-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label htmlFor="admin-email">Email</label>
          <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div>
          <label htmlFor="admin-password">Password</label>
          <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <button type="submit" disabled={signInMutation.isPending}>
          {signInMutation.isPending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {error ? <p>{error}</p> : null}
    </section>
  );
}

function ChannelsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<CreateChannelInput>(initialChannelForm);
  const [apiKeyForm, setApiKeyForm] = React.useState<CreateApiKeyInput>(initialApiKeyForm);
  const [expiresAtInput, setExpiresAtInput] = React.useState('');
  const [createdRawKey, setCreatedRawKey] = React.useState<string | null>(null);

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
      await queryClient.invalidateQueries({ queryKey: channelsQueryKey });
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
      setExpiresAtInput('');
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });
  const revokeApiKeyMutation = useMutation({
    mutationFn: (id: string) => revokeApiKeyRequest({ id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });

  const channels = channelsQuery.data ?? [];
  const activeChannels = channels.filter((channel) => channel.status === 'active');
  const apiKeys = apiKeysQuery.data ?? [];

  return (
    <section>
      <h2>Channels</h2>
      <p>Signed in as {sessionQuery.data?.user.email ?? 'unknown'}.</p>
      <button type="button" disabled={signOutMutation.isPending} onClick={() => signOutMutation.mutate()}>
        {signOutMutation.isPending ? 'Signing out...' : 'Sign out'}
      </button>
      <p>Milestone 2 minimal channel management shell.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          createChannelMutation.mutate({ ...form });
        }}
      >
        <div>
          <label htmlFor="channel-name">Name</label>
          <input id="channel-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </div>
        <div>
          <label htmlFor="channel-provider">Provider</label>
          <input id="channel-provider" value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))} />
        </div>
        <div>
          <label htmlFor="channel-base-url">Base URL</label>
          <input id="channel-base-url" value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} />
        </div>
        <div>
          <label htmlFor="channel-status">Status</label>
          <select
            id="channel-status"
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CreateChannelInput['status'] }))}
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div>
          <label htmlFor="channel-config-json">Config JSON</label>
          <textarea
            id="channel-config-json"
            value={form.configJson}
            onChange={(event) => setForm((current) => ({ ...current, configJson: event.target.value }))}
          />
        </div>
        <button type="submit" disabled={createChannelMutation.isPending}>
          {createChannelMutation.isPending ? 'Creating...' : 'Create channel'}
        </button>
      </form>

      {channelsQuery.isPending ? <p>Loading channels...</p> : null}
      {channelsQuery.error ? <p>Failed to load channels.</p> : null}
      {createChannelMutation.error ? <p>Failed to create channel.</p> : null}
      {updateStatusMutation.error ? <p>Failed to update channel status.</p> : null}
      {!channelsQuery.isPending && channels.length === 0 ? <p>No channels yet.</p> : null}

      <ul>
        {channels.map((channel: Channel) => {
          const nextStatus = channel.status === 'active' ? 'disabled' : 'active';
          return (
            <li key={channel.id}>
              <strong>{channel.name}</strong>
              <div>Provider: {channel.provider}</div>
              <div>Base URL: {channel.baseUrl}</div>
              <div>Status: {channel.status}</div>
              <button type="button" disabled={updateStatusMutation.isPending} onClick={() => updateStatusMutation.mutate({ id: channel.id, status: nextStatus })}>
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
            });
          }}
        >
          <div>
            <label htmlFor="api-key-label">Label</label>
            <input
              id="api-key-label"
              value={apiKeyForm.label}
              onChange={(event) => setApiKeyForm((current) => ({ ...current, label: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="api-key-channel">Allowed channel</label>
            <select
              id="api-key-channel"
              value={apiKeyForm.channelIds[0] ?? ''}
              onChange={(event) => setApiKeyForm((current) => ({ ...current, channelIds: event.target.value ? [event.target.value] : [] }))}
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
            <label htmlFor="api-key-max-concurrency">Max concurrency</label>
            <input
              id="api-key-max-concurrency"
              type="number"
              min={1}
              value={apiKeyForm.maxConcurrency}
              onChange={(event) => setApiKeyForm((current) => ({ ...current, maxConcurrency: Number(event.target.value) || 1 }))}
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
          <button type="submit" disabled={createApiKeyMutation.isPending || apiKeyForm.channelIds.length === 0}>
            {createApiKeyMutation.isPending ? 'Issuing...' : 'Issue key'}
          </button>
        </form>
        {createApiKeyMutation.error ? <p>Failed to issue API key.</p> : null}
        {revokeApiKeyMutation.error ? <p>Failed to revoke API key.</p> : null}
        {createdRawKey ? <p>Raw key: <code>{createdRawKey}</code></p> : null}
        {apiKeysQuery.isPending ? <p>Loading API keys...</p> : null}
        {apiKeysQuery.error ? <p>Failed to load API keys.</p> : null}
        <ul>
          {apiKeys.map((apiKey: ApiKey) => (
            <li key={apiKey.id}>
              <strong>{apiKey.label}</strong>
              <div>Prefix: {apiKey.keyPrefix}</div>
              <div>Status: {apiKey.status}</div>
              <div>Max concurrency: {apiKey.maxConcurrency}</div>
              <div>Endpoints: {apiKey.endpointRules.join(', ')}</div>
              <div>Channels: {apiKey.channelIds.join(', ')}</div>
              <div>Expires at: {apiKey.expiresAt ? new Date(apiKey.expiresAt).toISOString() : 'never'}</div>
              <button type="button" disabled={revokeApiKeyMutation.isPending || apiKey.status === 'revoked'} onClick={() => revokeApiKeyMutation.mutate(apiKey.id)}>
                {apiKey.status === 'revoked' ? 'Revoked' : 'Revoke key'}
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
