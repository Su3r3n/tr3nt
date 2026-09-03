/**
 * Pure tree assembly. No database, no Nest — so the shape of the tree can be tested
 * without booting anything.
 */

export interface FlatState {
  id: string;
  parentId: string | null;
  title: string;
  kind: 'root' | 'branch';
  status: 'active' | 'abandoned' | 'merged';
  depth: number;
  branchPointSeq: number | null;
  messageCount: number;
  createdAt: Date | string;
}

export interface TreeNode extends FlatState {
  children: TreeNode[];
}

export function buildTree(rows: FlatState[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parentId);
    // A child whose parent is outside the given rows is treated as a root of what we were
    // given, rather than silently dropped.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byCreation = (a: TreeNode, b: TreeNode) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  const sortDeep = (nodes: TreeNode[]) => {
    nodes.sort(byCreation);
    for (const node of nodes) sortDeep(node.children);
  };
  sortDeep(roots);

  return roots;
}

/** Total states in a tree, for a cheap sanity assertion in tests and in the UI header. */
export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}
