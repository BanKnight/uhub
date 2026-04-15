import { createTRPCUntypedClient, httpBatchLink } from '@trpc/client';
import type {
  AnalyticsSummary,
  ApiKey,
  AuditListInput,
  AuditRequestItem,
  Channel,
  CreateApiKeyInput,
  CreateApiKeyResult,
  CreateChannelInput,
  RevokeApiKeyInput,
  RotateApiKeyInput,
  UpdateChannelStatusInput,
} from '@uhub/shared';

const API_BASE_URL = 'http://localhost:8787';

const client = createTRPCUntypedClient({
  links: [
    httpBatchLink({
      url: `${API_BASE_URL}/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: 'include',
        });
      },
    }),
  ],
});

export { API_BASE_URL };

export function listChannels() {
  return client.query('admin.channels.list') as Promise<Channel[]>;
}

export function createChannel(input: CreateChannelInput) {
  return client.mutation('admin.channels.create', input) as Promise<Channel>;
}

export function updateChannelStatus(input: UpdateChannelStatusInput) {
  return client.mutation('admin.channels.status', input) as Promise<Channel>;
}

export function listApiKeys() {
  return client.query('admin.apiKeys.list') as Promise<ApiKey[]>;
}

export function createApiKey(input: CreateApiKeyInput) {
  return client.mutation('admin.apiKeys.create', input) as Promise<CreateApiKeyResult>;
}

export function revokeApiKey(input: RevokeApiKeyInput) {
  return client.mutation('admin.apiKeys.revoke', input) as Promise<ApiKey>;
}

export function rotateApiKey(input: RotateApiKeyInput) {
  return client.mutation('admin.apiKeyRotation.rotate', input) as Promise<CreateApiKeyResult>;
}

export function getAnalyticsSummary() {
  return client.query('admin.analytics.summary') as Promise<AnalyticsSummary>;
}

export function listAuditRequests(input: AuditListInput = {}) {
  return client.query('admin.audit.list', input) as Promise<AuditRequestItem[]>;
}
