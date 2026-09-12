import { describe, it, expect } from "vitest";
import {
  sanitizeResponsesToolName,
  MAX_RESPONSES_TOOL_NAME_LEN,
} from "../../open-sse/translator/formats/responsesApi.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("Responses API / Codex tool name sanitization", () => {
  describe("sanitizeResponsesToolName", () => {
    it("preserves valid tool names matching ^[a-zA-Z0-9_-]{1,64}$", () => {
      expect(sanitizeResponsesToolName("Bash")).toBe("Bash");
      expect(sanitizeResponsesToolName("read_file")).toBe("read_file");
      expect(sanitizeResponsesToolName("tool-123_abc")).toBe("tool-123_abc");
    });

    it("replaces invalid characters (colons, dots, slashes, spaces) with underscores", () => {
      expect(sanitizeResponsesToolName("default_api:Read")).toBe("default_api_Read");
      expect(sanitizeResponsesToolName("mcp::server::tool")).toBe("mcp__server__tool");
      expect(sanitizeResponsesToolName("tools/read.file test")).toBe("tools_read_file_test");
      expect(sanitizeResponsesToolName("custom@api#v1")).toBe("custom_api_v1");
    });

    it("clamps tool name to 64 characters", () => {
      const longName = "a".repeat(100);
      const sanitized = sanitizeResponsesToolName(longName);
      expect(sanitized.length).toBe(MAX_RESPONSES_TOOL_NAME_LEN);
      expect(sanitized.length).toBe(64);
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(sanitized)).toBe(true);
    });

    it("handles empty or non-string names safely", () => {
      expect(sanitizeResponsesToolName("")).toBe("tool");
      expect(sanitizeResponsesToolName("   ")).toBe("tool");
      expect(sanitizeResponsesToolName(null)).toBe("tool");
      expect(sanitizeResponsesToolName(undefined)).toBe("tool");
      expect(sanitizeResponsesToolName("::: ")).toBe("___");
    });
  });

  describe("openaiToOpenAIResponsesRequest", () => {
    it("sanitizes assistant tool calls and tools in request, populating _toolNameMap", () => {
      const body = {
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "default_api:Read",
                  arguments: JSON.stringify({ file: "test.txt" }),
                },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "default_api:Read",
              description: "Read a file",
              parameters: { type: "object", properties: { file: { type: "string" } } },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "default_api:Read" },
        },
      };

      const result = openaiToOpenAIResponsesRequest("gpt-5.6-terra", body, true);

      // Input item should have sanitized name matching pattern
      expect(result.input[0].type).toBe("function_call");
      expect(result.input[0].name).toBe("default_api_Read");
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(result.input[0].name)).toBe(true);

      // Tool declaration should have sanitized name
      expect(result.tools[0].name).toBe("default_api_Read");
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(result.tools[0].name)).toBe(true);

      // Tool choice should have sanitized name
      expect(result.tool_choice.name).toBe("default_api_Read");

      // _toolNameMap should record sanitized -> original mapping
      expect(result._toolNameMap).toBeInstanceOf(Map);
      expect(result._toolNameMap.get("default_api_Read")).toBe("default_api:Read");
    });

    it("sanitizes body.input items when input array is provided directly", () => {
      const body = {
        input: [
          {
            type: "function_call",
            call_id: "call_abc",
            name: "default_api:Bash",
            arguments: "{}",
          },
        ],
      };

      const result = openaiToOpenAIResponsesRequest("gpt-5.6-terra", body, true);
      expect(result.input[0].name).toBe("default_api_Bash");
      expect(result._toolNameMap.get("default_api_Bash")).toBe("default_api:Bash");
    });
  });

  describe("CodexExecutor.transformRequest", () => {
    it("sanitizes input[i].name and tools[i].name before sending upstream", () => {
      const executor = new CodexExecutor();
      const body = {
        model: "gpt-5.6-terra",
        input: [
          {
            type: "function_call",
            call_id: "call_621",
            name: "default_api:Read",
            arguments: "{}",
          },
          {
            type: "function_call",
            call_id: "call_622",
            name: "mcp__server:action.tool",
            arguments: "{}",
          },
        ],
        tools: [
          {
            type: "function",
            name: "default_api:Read",
            parameters: { type: "object", properties: {} },
          },
        ],
        tool_choice: {
          type: "function",
          name: "default_api:Read",
        },
      };

      const transformed = executor.transformRequest("gpt-5.6-terra", body, true, { connectionId: "test-conn" });

      expect(transformed.input[0].name).toBe("default_api_Read");
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(transformed.input[0].name)).toBe(true);

      expect(transformed.input[1].name).toBe("mcp__server_action_tool");
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(transformed.input[1].name)).toBe(true);

      expect(transformed.tools[0].name).toBe("default_api_Read");
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(transformed.tools[0].name)).toBe(true);

      expect(transformed.tool_choice.name).toBe("default_api_Read");
    });
  });

  describe("openaiResponsesToOpenAIResponse", () => {
    it("restores original tool name from state.toolNameMap", () => {
      const toolNameMap = new Map([["default_api_Read", "default_api:Read"]]);
      const state = {
        started: false,
        toolNameMap,
      };

      const chunk = {
        type: "response.output_item.added",
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_123",
          name: "default_api_Read",
        },
      };

      const result = openaiResponsesToOpenAIResponse(chunk, state);
      expect(result).not.toBeNull();
      expect(result.choices[0].delta.tool_calls[0].function.name).toBe("default_api:Read");
    });
  });
});
