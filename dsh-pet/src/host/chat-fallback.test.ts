/**
 * 对话预算/兜底单元测试：钉住这次改造新增的两条契约。
 *  1. chatMaxTokens / chatTemperature 真的进了 llm.stream 的 options；
 *  2. 超时返回可配置兜底文案，而不是 generate-error 或半截回答。
 *
 * 跑法：node --experimental-strip-types --test src/host/chat-fallback.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CHAT_FALLBACK, generateChat } from './chat.ts';

const ctx = {
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
  llm: undefined as unknown,
};

describe('generateChat —— 对话参数与兜底', () => {
  test('maxTokens / temperature 进入 llm.stream options', async () => {
    let captured: Record<string, unknown> | undefined;
    const fakeCtx = {
      ...ctx,
      llm: {
        stream(options: Record<string, unknown>) {
          captured = options;
          return (async function* () {})();
        },
      },
    };
    const result = await generateChat(fakeCtx, '你是女仆', [], '你好', [], undefined, {
      maxTokens: 512,
      temperature: 0.7,
    });
    // 空流没有正文，按失败返回；这里只关心请求参数已经带上了用户配置。
    assert.equal(result.ok, false);
    assert.equal(captured?.provider, 'deepseek-account');
    assert.equal(captured?.model, 'deepseek-flash');
    assert.equal(captured?.maxTokens, 512);
    assert.equal(captured?.temperature, 0.7);
  });

  test('超时 → 返回配置的兜底文案（fallback: true）', async () => {
    const fakeCtx = {
      ...ctx,
      llm: {
        stream() {
          return (async function* () {
            const e = new Error('timed out');
            e.name = 'TimeoutError';
            throw e;
          })();
        },
      },
    };
    const result = await generateChat(fakeCtx, '你是女仆', [], '讲个复杂问题', [], undefined, {
      fallbackText: '我想不明白，我要吃饭了。',
    });
    assert.deepEqual(result, { ok: true, text: '我想不明白，我要吃饭了。', fallback: true });
  });

  test('没有配置兜底文案 → 用内置默认', async () => {
    const fakeCtx = {
      ...ctx,
      llm: {
        stream() {
          return (async function* () {
            const e = new Error('aborted');
            e.name = 'AbortError';
            throw e;
          })();
        },
      },
    };
    const result = await generateChat(fakeCtx, '你是女仆', [], '复杂问题');
    assert.deepEqual(result, { ok: true, text: DEFAULT_CHAT_FALLBACK, fallback: true });
  });
});
