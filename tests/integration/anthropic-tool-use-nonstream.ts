// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  withMockJsonUpstream,
} from "./_anthropic";

async function callAnthropic(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 128,
      messages: [{ role: "user", content: "Use a tool" }],
    }),
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function main() {
  await withMockJsonUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      return {
        body: JSON.stringify({
          id: "chatcmpl-anthropic-tool-use-test",
          object: "chat.completion",
          created: 1710000002,
          model: parsed.model ?? "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "toolu_mock_123",
                    type: "function",
                    function: {
                      name: "get_weather",
                      arguments: JSON.stringify({
                        city: "Shanghai",
                        unit: "celsius",
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        headers: {
          "content-type": "application/json",
        },
      };
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `anthropic-tool-use-nonstream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-tool-use-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ["anthropic_messages"],
      });
      const { response, json } = await callAnthropic(rawKey);

      assert(response.ok, `Tool use request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get("content-type")?.includes("application/json"),
        `Unexpected content-type: ${response.headers.get("content-type")}`,
      );
      assert(response.headers.get("x-trace-id"), "Missing x-trace-id header");
      assert(json?.type === "message", `Unexpected response type: ${JSON.stringify(json)}`);
      assert(json?.role === "assistant", "Anthropic response role should be assistant");
      assert(Array.isArray(json?.content), "Anthropic response content should be an array");

      const toolUseBlock = json.content.find(
        (block) => block.type === "tool_use",
      );
      assert(toolUseBlock, `Missing tool_use block: ${JSON.stringify(json.content)}`);
      assert(toolUseBlock.id === "toolu_mock_123", `Unexpected tool_use id: ${toolUseBlock.id}`);
      assert(toolUseBlock.name === "get_weather", `Unexpected tool_use name: ${toolUseBlock.name}`);
      assert(
        toolUseBlock.input?.city === "Shanghai" && toolUseBlock.input?.unit === "celsius",
        `Unexpected tool_use input: ${JSON.stringify(toolUseBlock.input)}`,
      );
      assert(json.stop_reason === "tool_use", `Unexpected stop_reason: ${json.stop_reason}`);
      assert(json.stop_sequence === null, `Unexpected stop_sequence: ${json.stop_sequence}`);

      console.log(
        JSON.stringify(
          {
            status: "ok",
            traceId: response.headers.get("x-trace-id"),
            stopReason: json.stop_reason,
            toolUse: toolUseBlock,
          },
          null,
          2,
        ),
      );
    },
  );
}

await main();
