import { describe, expect, it, vi } from 'vitest';

import { runConversation, type Completion, type LlmClient } from './llm.ts';

/** A mock LLM that replays a fixed script of completions (clamping to the last). */
function scriptedLlm(script: Completion[]): LlmClient {
  let turn = 0;
  return {
    complete: () => {
      const completion = script[Math.min(turn, script.length - 1)];
      turn += 1;
      return Promise.resolve(completion ?? { content: [], stopReason: 'end_turn' });
    },
  };
}

describe('runConversation', () => {
  it('runs a tool call, feeds the result back, and finishes on the closing text', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'tool_use', id: 't1', name: 'get_quotes', input: { symbols: ['BNB'] } }],
        stopReason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Skipping: edge too thin.' }], stopReason: 'end_turn' },
    ]);
    const getQuotes = vi.fn(() => Promise.resolve('{"BNB":600}'));

    const result = await runConversation({
      llm,
      system: 'sys',
      userText: 'go',
      tools: [{ name: 'get_quotes', description: 'd', inputSchema: { type: 'object' } }],
      handlers: { get_quotes: getQuotes },
      maxIterations: 6,
    });

    expect(result.finalText).toBe('Skipping: edge too thin.');
    expect(result.iterations).toBe(2);
    expect(getQuotes).toHaveBeenCalledOnce();
    expect(getQuotes).toHaveBeenCalledWith({ symbols: ['BNB'] });
  });

  it('stops at the iteration guard when the model never stops calling tools', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'tool_use', id: 'loop', name: 'get_quotes', input: {} }],
        stopReason: 'tool_use',
      },
    ]);

    const result = await runConversation({
      llm,
      system: 'sys',
      userText: 'go',
      tools: [{ name: 'get_quotes', description: 'd', inputSchema: { type: 'object' } }],
      handlers: { get_quotes: () => Promise.resolve('ok') },
      maxIterations: 3,
    });

    expect(result.iterations).toBe(3);
  });

  it('does not crash when the model calls an unknown tool', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'tool_use', id: 'm', name: 'mystery', input: {} }],
        stopReason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'done' }], stopReason: 'end_turn' },
    ]);

    const result = await runConversation({
      llm,
      system: 'sys',
      userText: 'go',
      tools: [],
      handlers: {},
      maxIterations: 6,
    });

    expect(result.finalText).toBe('done');
  });
});
