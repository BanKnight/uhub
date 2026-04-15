import { createTRPCUntypedClient, httpBatchLink } from '@trpc/client';
import type {
  ApiKey,
  Channel,
  CreateApiKeyInput,
  CreateApiKeyResult,
  CreateChannelInput,
  RevokeApiKeyInput,
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
