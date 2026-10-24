/**
 * 对话上下文拼装（host 半侧，纯逻辑）：把桌宠已经查到的状态压缩成一小段 system 文本。
 *
 * 为什么需要：余额展示与对话是两条链路。`sections.balance` 只驱动动画/气泡，LLM 看不到；
 * 用户问“余额还有多少”时模型只能回避或编造。这里把**宿主已经查到的缓存**格式化成一段
 * 可读状态，注入对话 system。不额外发网络请求，不把凭证/账号细节带进去。
 *
 * 边界：
 * - 只读 `BalanceResult` 的展示字段，不读钱包以外的东西；
 * - 失败显式写“查询不可用”，绝不补 0 或猜数字；
 * - 没有数据时明确写“尚未刷新”，让模型照实说；
 * - 文本有长度上限（custom 节点树递归收集后截断），避免把大对象塞进 prompt。
 */
import type { BalanceResult } from './balance/types';

/** 余额格式化时允许的最长文本（防止 custom 树或错误信息把 prompt 撑大） */
const MAX_BALANCE_TEXT = 320;

/** 百分比：最多一位小数，去掉无意义的 .0 */
function pct(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

/** 从 custom 节点树里收集文本（只取 text，不取样式/图片），按出现顺序拼接 */
function customText(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { text?: unknown; children?: unknown };
  if (typeof n.text === 'string' && n.text.trim() !== '') out.push(n.text.trim());
  if (Array.isArray(n.children)) for (const child of n.children) customText(child, out);
  return out;
}

/** 余额结果 → 给模型看的一句话；null/undefined = 还没有数据 */
export function formatBalanceContext(balance: BalanceResult | null | undefined, at?: number): string {
  const when = Number.isFinite(at) && (at as number) > 0
    ? '，截至 ' +
      new Date(at as number).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  if (!balance) return `余额：尚未获取到（还没有刷新过）${when}`;
  if (!balance.ok) {
    const reason =
      balance.reason === 'unsupported'
        ? '当前服务商不支持余额查询'
        : balance.reason === 'credential-missing'
          ? '缺少余额查询凭证'
          : '余额查询失败';
    const extra = balance.message ? '：' + balance.message : '';
    return `余额：${reason}${extra}${when}`;
  }
  switch (balance.shape) {
    case 'money': {
      const wallets = balance.data.wallets
        .map((w) => `${w.currency} ${w.total}（充值 ${w.toppedUp} + 赠送 ${w.granted}）`)
        .join('；');
      const tier =
        balance.data.tier === 'peak' ? '；当前高峰计价' : balance.data.tier === 'idle' ? '；当前低谷计价' : '';
      return `余额：${wallets || '钱包为空'}${tier}${when}`;
    }
    case 'windows': {
      const rows: string[] = [];
      const d = balance.data;
      if (d.monthly !== undefined) rows.push(`月度已用 ${pct(d.monthly)}%`);
      if (d.rolling !== undefined) rows.push(`${d.rollingLabel ?? '5h'} 已用 ${pct(d.rolling)}%`);
      if (d.weekly !== undefined) rows.push(`周已用 ${pct(d.weekly)}%`);
      return `额度：${rows.join('，') || '没有窗口数据'}${when}`;
    }
    case 'points':
      return `余额：${balance.data.total} ${balance.data.unit}${when}`;
    case 'custom': {
      const text = customText(balance.data.views?.[0] ?? balance.data.rows).join(' ').slice(0, MAX_BALANCE_TEXT);
      return `余额：${text || '自定义余额视图'}${when}`;
    }
  }
}

/**
 * 拼出对话的【当前状态】段。
 * @param args.model 当前对话模型（provider/model），可缺省
 * @param args.balance 宿主缓存的余额结果；null = 还没刷新
 * @param args.balanceAt 最近一次余额刷新时间（ms），0/缺省 = 未知
 */
export function composeChatContext(args: {
  model?: { provider: string; model: string };
  balance?: BalanceResult | null;
  balanceAt?: number;
}): string {
  const lines = ['【当前状态】'];
  if (args.model?.provider && args.model.model) {
    lines.push(`- 当前模型：${args.model.provider}/${args.model.model}`);
  }
  lines.push(`- ${formatBalanceContext(args.balance, args.balanceAt)}`);
  lines.push(
    '主人问余额时，直接根据上面的余额回答，不要让他自己去查；没有数据就说明还没刷新，不要编造数字。' +
      '余额是插件已经查到的状态，不属于“需要去 DSH 才能查”的实时信息。',
  );
  return lines.join('\n');
}
