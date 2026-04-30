import { useState } from 'react';
import type { PageNode } from '../types';

interface Props {
  tree: PageNode;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
}

function truncateTitle(title: string, max = 60): string {
  if (title.length <= max) return title;
  return title.slice(0, max).trimEnd() + '…';
}

export function PageTree({ tree, selectedPageId, onSelectPage }: Props) {
  return (
    <div className="page-tree">
      <h3>Pages</h3>
      <TreeNode node={tree} depth={0} selectedPageId={selectedPageId} onSelectPage={onSelectPage} />
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selectedPageId,
  onSelectPage,
}: {
  node: PageNode;
  depth: number;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
}) {
  const isSelected = node.page_id === selectedPageId;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div className="tree-node">
      <div className="tree-node-row" style={{ paddingLeft: `${depth * 16}px` }}>
        {hasChildren ? (
          <button
            className="tree-toggle"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <button
          className={`tree-node-label ${isSelected ? 'selected' : ''}`}
          onClick={() => onSelectPage(node.page_id)}
          title={node.title}
        >
          {truncateTitle(node.title)}
        </button>
      </div>
      {hasChildren && expanded && node.children.map((child) => (
        <TreeNode
          key={child.page_id}
          node={child}
          depth={depth + 1}
          selectedPageId={selectedPageId}
          onSelectPage={onSelectPage}
        />
      ))}
    </div>
  );
}
