// @ts-nocheck
import { assert, createChannel, ensureAdminSession, requestJson } from './_anthropic';

const VALID_BASE_URL = 'https://example.com';

function extractErrorMessage(json: unknown) {
  const errorMessage =
    (json as { error?: { message?: string } } | null)?.error?.message ?? JSON.stringify(json);

  return typeof errorMessage === 'string' ? errorMessage : JSON.stringify(json);
}

function assertInvalidChannelMutation(
  result: Awaited<ReturnType<typeof requestJson>>,
  expectedMessage: string,
  context: string
) {
  const message = extractErrorMessage(result.json);
  assert(!result.response.ok, `Expected ${context} to fail: ${JSON.stringify(result.json)}`);
  assert(result.response.status === 400, `Expected 400, got ${result.response.status}`);
  assert(
    message.includes(expectedMessage),
    `Unexpected ${context} message: ${JSON.stringify(result.json)}`
  );

  return {
    status: result.response.status,
    message,
  };
}

async function createProtocolMismatchCase(cookie: string) {
  const result = await requestJson(
    '/trpc/admin.channels.create',
    {
      method: 'POST',
      body: JSON.stringify({
        name: `admin-invalid-create-protocol-${Date.now()}`,
        provider: 'openai',
        protocol: 'anthropic_messages',
        baseUrl: VALID_BASE_URL,
        models: ['gpt-4o-mini'],
        defaultTestModel: 'gpt-4o-mini',
        status: 'active',
      }),
    },
    cookie
  );

  return assertInvalidChannelMutation(
    result,
    'Protocol anthropic_messages is incompatible with provider openai',
    'create protocol mismatch'
  );
}

async function updateProtocolMismatchCase(cookie: string) {
  const channelId = await createChannel(cookie, {
    name: `admin-invalid-update-protocol-${Date.now()}`,
    provider: 'openai',
    protocol: 'openai_chat_completions',
    baseUrl: VALID_BASE_URL,
    models: ['gpt-4o-mini'],
    defaultTestModel: 'gpt-4o-mini',
  });

  const result = await requestJson(
    '/trpc/admin.channels.update',
    {
      method: 'POST',
      body: JSON.stringify({
        id: channelId,
        name: `admin-invalid-update-protocol-${Date.now()}-mismatch`,
        provider: 'openai',
        protocol: 'anthropic_messages',
        baseUrl: VALID_BASE_URL,
        models: ['gpt-4o-mini'],
        defaultTestModel: 'gpt-4o-mini',
        status: 'active',
      }),
    },
    cookie
  );

  const failure = assertInvalidChannelMutation(
    result,
    'Protocol anthropic_messages is incompatible with provider openai',
    'update protocol mismatch'
  );

  return {
    channelId,
    ...failure,
  };
}

async function createDefaultTestModelMismatchCase(cookie: string) {
  const result = await requestJson(
    '/trpc/admin.channels.create',
    {
      method: 'POST',
      body: JSON.stringify({
        name: `admin-invalid-default-model-${Date.now()}`,
        provider: 'openai',
        protocol: 'openai_chat_completions',
        baseUrl: VALID_BASE_URL,
        models: ['gpt-4o-mini'],
        defaultTestModel: 'gpt-4o',
        status: 'active',
      }),
    },
    cookie
  );

  return assertInvalidChannelMutation(
    result,
    'defaultTestModel must be included in models',
    'create defaultTestModel mismatch'
  );
}

async function main() {
  const cookie = await ensureAdminSession();
  const createProtocolMismatch = await createProtocolMismatchCase(cookie);
  const updateProtocolMismatch = await updateProtocolMismatchCase(cookie);
  const createDefaultTestModelMismatch = await createDefaultTestModelMismatchCase(cookie);

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        createProtocolMismatch,
        updateProtocolMismatch,
        createDefaultTestModelMismatch,
      },
      null,
      2
    )
  );
}

await main();
