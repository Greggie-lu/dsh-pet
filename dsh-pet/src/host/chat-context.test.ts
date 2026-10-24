/**
 * 对话上下文单元测试：余额格式化与“不要编造”的边界。
 *
 * 跑法：node --experimental-strip-types --test src/host/chat-context.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { composeChatContext, formatBalanceContext } from './chat-context.ts';

describe('formatBalanceContext', () => {
  test('money：币种 + 总额 + 充值/赠送', () => {
    const text = formatBalanceContext({
      ok: true,
      provider: 'deepseek-account',
      shape: 'money',
      data: {
        wallets: [{ currency: 'CNY', total: '12.34', granted: '2.34', toppedUp: '10.00' }],
        tier: 'idle',
      },
    });
    assert.match(text, /CNY 12\.34/);
    assert.match(text, /充值 10\.00/);
    assert.match(text, /赠送 2\.34/);
    assert.match(text, /低谷/);
  });

  test('windows：只列存在的窗口', () => {
    const text = formatBalanceContext({
      ok: true,
      provider: 'opencode-go',
      shape: 'windows',
      data: { monthly: 42, rolling: 10, rollingLabel: '5h' },
    });
    assert.match(text, /月度已用 42%/);
    assert.match(text, /5h 已用 10%/);
    assert.doesNotMatch(text, /周已用/);
  });

  test('points：数值 + 单位', () => {
    const text = formatBalanceContext({
      ok: true,
      provider: 'local',
      shape: 'points',
      data: { unit: '积分', total: '800' },
    });
    assert.match(text, /800 积分/);
  });

  test('失败：显式原因，不补 0', () => {
    const text = formatBalanceContext({
      ok: false,
      provider: 'deepseek-account',
      reason: 'credential-missing',
      message: '缺少凭证 DEEPSEEK_API_KEY',
    });
    assert.match(text, /缺少余额查询凭证/);
    assert.match(text, /DEEPSEEK_API_KEY/);
    assert.doesNotMatch(text, /0\.00/);
  });

  test('没有数据：明确说尚未刷新，不编造', () => {
    assert.match(formatBalanceContext(null), /尚未获取到/);
  });
});

describe('composeChatContext', () => {
  test('包含模型、余额与“直接回答/不要编造”的指令', () => {
    const text = composeChatContext({
      model: { provider: 'deepseek-account', model: 'deepseek-flash' },
      balance: {
        ok: true,
        provider: 'deepseek-account',
        shape: 'money',
        data: { wallets: [{ currency: 'CNY', total: '8.79', granted: '0.00', toppedUp: '8.79' }] },
      },
    });
    assert.match(text, /【当前状态】/);
    assert.match(text, /deepseek-account\/deepseek-flash/);
    assert.match(text, /CNY 8\.79/);
    assert.match(text, /直接根据上面的余额回答/);
  });
});
