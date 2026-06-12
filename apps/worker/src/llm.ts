import Anthropic from '@anthropic-ai/sdk';

import type { WorkerConfig } from './config.ts';
import { log, preview } from './log.ts';

/**
 * A thin LLM port so the inner reason-and-act loop can be driven by a mock in
 * tests. The Anthropic adapter is the only place the SDK is touched.
 */

export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolHandler = (input: unknown) => Promise<string>;

interface TextPart {
  type: 'text';
  text: string;
}
interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
interface ToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  content: string;
}
type ContentPart = TextPart | ToolUsePart | ToolResultPart;

interface Message {
  role: 'user' | 'assistant';
  content: ContentPart[];
}

export interface Completion {
  content: (TextPart | ToolUsePart)[];
  stopReason: string;
}

export interface LlmClient {
  complete: (args: {
    system: string;
    tools: LlmTool[];
    messages: Message[];
  }) => Promise<Completion>;
}

function toSdkMessage(message: Message): Anthropic.MessageParam {
  const content = message.content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    if (part.type === 'tool_use') {
      return { type: 'tool_use', id: part.id, name: part.name, input: part.input };
    }
    return { type: 'tool_result', tool_use_id: part.toolUseId, content: part.content };
  });
  return { role: message.role, content } as Anthropic.MessageParam;
}

/** Anthropic-backed LLM client. Defaults to Haiku (cheap); model is configurable. */
export function createAnthropicClient(config: WorkerConfig): LlmClient {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — see apps/worker/.env.example.');
  }
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  return {
    async complete({ system, tools, messages }) {
      const response = await client.messages.create({
        model: config.ANTHROPIC_MODEL,
        max_tokens: 1024,
        // cache the stable system + tool prefix across ticks
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
        })),
        messages: messages.map((message) => toSdkMessage(message)),
      });

      if (config.LOG_RESPONSES) {
        log.info('claude response', {
          model: config.ANTHROPIC_MODEL,
          stopReason: response.stop_reason,
          usage: response.usage,
          content: preview(response.content),
        });
      }

      const content: (TextPart | ToolUsePart)[] = [];
      for (const block of response.content) {
        if (block.type === 'text') {
          content.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
        }
      }
      return { content, stopReason: response.stop_reason ?? 'end_turn' };
    },
  };
}

/**
 * Bounded reason-and-act loop: feed the model a kickoff, run any tools it calls,
 * feed the results back, repeat until it stops calling tools or the iteration
 * guard trips. Returns the model's closing narrative.
 */
export async function runConversation(args: {
  llm: LlmClient;
  system: string;
  userText: string;
  tools: LlmTool[];
  handlers: Record<string, ToolHandler>;
  maxIterations: number;
}): Promise<{ finalText: string; iterations: number }> {
  const { llm, system, userText, tools, handlers, maxIterations } = args;
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: userText }] }];
  let finalText = '';
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;
    const completion = await llm.complete({ system, tools, messages });
    messages.push({ role: 'assistant', content: completion.content });

    const textParts = completion.content.filter((part): part is TextPart => part.type === 'text');
    if (textParts.length > 0) {
      finalText = textParts
        .map((part) => part.text)
        .join('\n')
        .trim();
    }

    const toolUses = completion.content.filter(
      (part): part is ToolUsePart => part.type === 'tool_use',
    );
    if (toolUses.length === 0) {
      break;
    }

    const results: ContentPart[] = [];
    for (const call of toolUses) {
      const handler = handlers[call.name];
      const content = handler ? await handler(call.input) : `Unknown tool: ${call.name}`;
      results.push({ type: 'tool_result', toolUseId: call.id, content });
    }
    messages.push({ role: 'user', content: results });
  }

  return { finalText, iterations };
}
