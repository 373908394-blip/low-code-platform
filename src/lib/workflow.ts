import type { BizApproval, WfNode } from '@/types';

/** 递归收集流程全部节点（含条件分支/并行分支内的子节点），供按 node_id 查找节点配置 */
export function collectWfNodes(nodes: WfNode[]): WfNode[] {
  return nodes.flatMap((n) => [n, ...collectWfNodes((n.branches ?? []).flatMap((b) => b.nodes ?? []))]);
}

/**
 * 依次审批（sequential）逐人排队辅助：
 * 当前轮到的人 = 审批人顺序（approvers，运行时已解析为具体用户 id）中首位尚未通过的人。
 * 非依次审批模式或全员已通过时返回 null。
 */
export const currentTurnOf = (a: Pick<BizApproval, 'mode' | 'approvers' | 'acts'>): string | null => {
  if (a.mode !== 'sequential') return null;
  return (a.approvers ?? []).find((id) => !(a.acts ?? []).some((x) => x.action === 'approve' && x.user_id === id)) ?? null;
};
