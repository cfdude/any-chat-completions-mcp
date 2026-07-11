#!/usr/bin/env node

import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import OpenAI from 'openai';

dotenv.config();

const AI_CHAT_BASE_URL = process.env.AI_CHAT_BASE_URL;
const AI_CHAT_KEY = process.env.AI_CHAT_KEY;
const AI_CHAT_MODEL = process.env.AI_CHAT_MODEL;
const AI_CHAT_NAME = process.env.AI_CHAT_NAME;
const AI_CHAT_TIMEOUT = process.env.AI_CHAT_TIMEOUT || "30000";
const AI_CHAT_SYSTEM_PROMPT = process.env.AI_CHAT_SYSTEM_PROMPT;
const AI_CHAT_ENABLE_CONVERSATIONS = /^(true|1)$/i.test(process.env.AI_CHAT_ENABLE_CONVERSATIONS ?? "");

if (!AI_CHAT_BASE_URL) {
  throw new Error("AI_CHAT_BASE_URL is required")
}

if (!AI_CHAT_KEY) {
  throw new Error("AI_CHAT_KEY is required")
}

if (!AI_CHAT_MODEL) {
  throw new Error("AI_CHAT_MODEL is required")
}

if (!AI_CHAT_NAME) {
  throw new Error("AI_CHAT_NAME is required")
}
const AI_CHAT_NAME_CLEAN = AI_CHAT_NAME.toLowerCase().replace(' ', '-')

const server = new Server(
  {
    name: "any-chat-completions-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

/**
 * Handler for listing resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [],
  };
});

/**
 * Handler for reading the contents of a specific resource.
 */
server.setRequestHandler(ReadResourceRequestSchema, async () => {
    throw new Error(`Resource not found`);

});

/**
 * Handler that lists available tools.
 * Exposes a single "chat" tool that lets clients chat with another AI.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: `chat-with-${AI_CHAT_NAME_CLEAN}`,
        description: `Text chat with ${AI_CHAT_NAME}`,
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: `The content of the chat to send to ${AI_CHAT_NAME}`,
            },
            images: {
              type: "array",
              items: { type: "string" },
              description: `Optional image URLs or data: URIs to send alongside content (vision-capable models only). Not supported together with conversationId/previousResponseId.`,
            },
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  filename: { type: "string" },
                  mimeType: { type: "string", description: "e.g. application/pdf" },
                  data: { type: "string", description: "Base64-encoded file contents (no data: prefix - it is added automatically)" },
                },
                required: ["filename", "mimeType", "data"],
              },
              description: `Optional files (e.g. PDFs) to send alongside content. Not supported together with conversationId/previousResponseId.`,
            },
            responseSchema: {
              type: "object",
              description: `Optional JSON Schema to constrain the reply to structured JSON matching this schema. Not supported together with conversationId/previousResponseId.`,
            },
            responseSchemaName: {
              type: "string",
              description: `Name for the response format when responseSchema is supplied (default: "response"). Letters, digits, underscores, and dashes only, max 64 characters.`,
            },
            strict: {
              type: "boolean",
              description: `Whether to strictly enforce responseSchema (default: true). Only used when responseSchema is supplied.`,
            },
            ...(AI_CHAT_ENABLE_CONVERSATIONS ? {
              conversationId: {
                type: "string",
                description: `An existing conversation ID (from start-conversation-with-${AI_CHAT_NAME_CLEAN}) to continue a multi-turn conversation with full prior context, instead of a stateless single-turn exchange.`,
              },
              previousResponseId: {
                type: "string",
                description: `The response ID (from a prior conversation-mode reply's "conversationResponseId:" marker) to chain this call to, as a lighter-weight alternative to conversationId with no durable conversation object. Mutually exclusive with conversationId.`,
              }
            } : {}),
          },
          required: ["content"]
        }
      },
      ...(AI_CHAT_ENABLE_CONVERSATIONS ? [
        {
          name: `start-conversation-with-${AI_CHAT_NAME_CLEAN}`,
          description: `Start a new durable multi-turn conversation with ${AI_CHAT_NAME}. Returns a conversation ID to pass as conversationId on subsequent chat-with-${AI_CHAT_NAME_CLEAN} calls.`,
          inputSchema: {
            type: "object",
            properties: {},
          }
        }
      ] : []),
    ]
  };
});

/**
 * Handler for the chat tool.
 * Connects to an OpenAI SDK compatible AI Integration.
 */
function toErrorResult(error: any, logLabel: string) {
  const errorMessage = error?.response?.data?.error?.message || error?.message || 'Unknown error occurred';
  console.error(logLabel, errorMessage);
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${errorMessage}`
      }
    ],
    isError: true
  };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case `chat-with-${AI_CHAT_NAME_CLEAN}`: {
      const content = String(request.params.arguments?.content)
      if (!content) {
        throw new Error("Content is required")
      }
      const conversationId = request.params.arguments?.conversationId;
      const previousResponseId = request.params.arguments?.previousResponseId;
      const images = request.params.arguments?.images;
      const files = request.params.arguments?.files;
      const isThreaded = conversationId !== undefined || previousResponseId !== undefined;

      if (images !== undefined && !Array.isArray(images)) {
        return toErrorResult(new Error('images must be an array of strings'), 'Invalid arguments');
      }
      if (images !== undefined && !images.every((url: unknown) => typeof url === "string")) {
        return toErrorResult(new Error('images must be an array of strings'), 'Invalid arguments');
      }
      if (files !== undefined && (
        !Array.isArray(files) ||
        !files.every((f: unknown) =>
          typeof f === "object" && f !== null &&
          typeof (f as any).filename === "string" &&
          typeof (f as any).mimeType === "string" &&
          typeof (f as any).data === "string"
        )
      )) {
        return toErrorResult(new Error('files must be an array of { filename, mimeType, data } objects'), 'Invalid arguments');
      }

      const imageList = images as string[] | undefined;
      const fileList = files as { filename: string; mimeType: string; data: string }[] | undefined;
      const hasAttachments = (imageList !== undefined && imageList.length > 0) || (fileList !== undefined && fileList.length > 0);

      if (isThreaded && !AI_CHAT_ENABLE_CONVERSATIONS) {
        return toErrorResult(
          new Error(`conversationId/previousResponseId was supplied but conversation mode is disabled. Set AI_CHAT_ENABLE_CONVERSATIONS=true to enable it.`),
          'Conversation mode is not enabled'
        );
      }

      if (conversationId !== undefined && previousResponseId !== undefined) {
        return toErrorResult(
          new Error(`conversationId and previousResponseId are mutually exclusive; supply only one.`),
          'Invalid arguments'
        );
      }

      if (hasAttachments && isThreaded) {
        return toErrorResult(
          new Error(`images/files are not supported together with conversationId/previousResponseId in this version.`),
          'Invalid arguments'
        );
      }

      const responseSchema = request.params.arguments?.responseSchema;
      const responseSchemaName = request.params.arguments?.responseSchemaName;
      const strict = request.params.arguments?.strict;

      if (responseSchema !== undefined && (typeof responseSchema !== "object" || responseSchema === null || Array.isArray(responseSchema))) {
        return toErrorResult(new Error('responseSchema must be a JSON Schema object'), 'Invalid arguments');
      }
      if (responseSchemaName !== undefined && (typeof responseSchemaName !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(responseSchemaName))) {
        return toErrorResult(new Error('responseSchemaName must be a string of 1-64 characters (letters, digits, underscores, or dashes only)'), 'Invalid arguments');
      }
      if (strict !== undefined && typeof strict !== "boolean") {
        return toErrorResult(new Error('strict must be a boolean'), 'Invalid arguments');
      }

      if (responseSchema !== undefined && isThreaded) {
        return toErrorResult(
          new Error(`responseSchema is not supported together with conversationId/previousResponseId in this version.`),
          'Invalid arguments'
        );
      }

      const responseFormat = responseSchema !== undefined ? {
        type: "json_schema" as const,
        json_schema: {
          name: typeof responseSchemaName === "string" ? responseSchemaName : "response",
          schema: responseSchema as Record<string, unknown>,
          strict: typeof strict === "boolean" ? strict : true,
        },
      } : undefined;

      const messageContent: string | Array<Record<string, unknown>> = hasAttachments
        ? [
            { type: "text", text: content },
            ...(imageList ?? []).map((url) => ({ type: "image_url", image_url: { url } })),
            ...(fileList ?? []).map((f) => ({
              type: "file",
              file: { filename: f.filename, file_data: `data:${f.mimeType};base64,${f.data}` }
            })),
          ]
        : content;

      const client = new OpenAI({
        apiKey: AI_CHAT_KEY,
        baseURL: AI_CHAT_BASE_URL,
        timeout: parseInt(`${AI_CHAT_TIMEOUT}`, 10),
      });

      if (conversationId !== undefined || previousResponseId !== undefined) {
        try {
          const response = await client.responses.create({
            model: AI_CHAT_MODEL.trim(),
            input: content,
            store: true,
            ...(conversationId !== undefined ? { conversation: String(conversationId) } : {}),
            ...(previousResponseId !== undefined ? { previous_response_id: String(previousResponseId) } : {}),
            ...(AI_CHAT_SYSTEM_PROMPT ? { instructions: AI_CHAT_SYSTEM_PROMPT } : {}),
          });

          if (!response.output_text) {
            throw new Error('No response content received from API');
          }

          return {
            content: [
              {
                type: "text",
                text: response.output_text
              },
              {
                type: "text",
                text: `conversationResponseId: ${response.id}`
              }
            ]
          };
        } catch (error: any) {
          return toErrorResult(error, 'Response creation error:');
        }
      }

      try {
        const chatCompletion = await client.chat.completions.create({
          messages: [
            ...(AI_CHAT_SYSTEM_PROMPT ? [{ role: 'system' as const, content: AI_CHAT_SYSTEM_PROMPT }] : []),
            { role: 'user' as const, content: messageContent as any }
          ],
          model: AI_CHAT_MODEL.trim(), // Trim to remove any whitespace
          ...(responseFormat ? { response_format: responseFormat } : {}),
        });

        const responseContent = chatCompletion.choices[0]?.message?.content;

        if (!responseContent) {
          throw new Error('No response content received from API');
        }

        return {
          content: [
            {
              type: "text",
              text: responseContent
            }
          ]
        };
      } catch (error: any) {
        return toErrorResult(error, 'Chat completion error:');
      }
    }

    case `start-conversation-with-${AI_CHAT_NAME_CLEAN}`: {
      if (!AI_CHAT_ENABLE_CONVERSATIONS) {
        return toErrorResult(new Error('Conversation mode is not enabled'), 'Conversation mode is not enabled');
      }

      const client = new OpenAI({
        apiKey: AI_CHAT_KEY,
        baseURL: AI_CHAT_BASE_URL,
        timeout: parseInt(`${AI_CHAT_TIMEOUT}`, 10),
      });

      try {
        const conversation = await client.conversations.create();
        return {
          content: [
            {
              type: "text",
              text: conversation.id
            }
          ]
        };
      } catch (error: any) {
        return toErrorResult(error, 'Conversation creation error:');
      }
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * Handler that lists available prompts.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: []
  };
});

/**
 * Handler for the get prompt.
 */
server.setRequestHandler(GetPromptRequestSchema, async () => {
  throw new Error("Unknown prompt");
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});


