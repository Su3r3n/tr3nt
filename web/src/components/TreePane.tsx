import type { Project, StateStatus, TreeNode } from '../types';

interface Props {
  projects: Project[];
  projectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  tree: TreeNode[];
  selectedStateId: string | null;
  onSelectState: (id: string) => void;
  onSetStatus: (id: string, status: StateStatus) => void;
}

export function TreePane(props: Props) {
  const {
    projects,
    projectId,
    onSelectProject,
    onCreateProject,
    tree,
    selectedStateId,
    onSelectState,
    onSetStatus,
  } = props;

  return (
    <aside className="pane pane--tree">
      <header className="pane__head">
        <span className="brand">TR3NT</span>
        <button className="btn btn--ghost" onClick={onCreateProject} title="Новый проект">
          + проект
        </button>
      </header>

      <select
        className="select"
        value={projectId ?? ''}
        onChange={(event) => onSelectProject(event.target.value)}
      >
        {projects.length === 0 && <option value="">нет проектов</option>}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <div className="pane__body">
        {tree.length === 0 ? (
          <p className="empty">Дерево пусто.</p>
        ) : (
          tree.map((node) => (
            <Node
              key={node.id}
              node={node}
              selectedStateId={selectedStateId}
              onSelectState={onSelectState}
              onSetStatus={onSetStatus}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function Node({
  node,
  selectedStateId,
  onSelectState,
  onSetStatus,
}: {
  node: TreeNode;
  selectedStateId: string | null;
  onSelectState: (id: string) => void;
  onSetStatus: (id: string, status: StateStatus) => void;
}) {
  const selected = node.id === selectedStateId;

  return (
    <div className="node" style={{ marginLeft: node.depth === 0 ? 0 : 14 }}>
      <div
        className={`node__row${selected ? ' is-selected' : ''}${
          node.status === 'abandoned' ? ' is-abandoned' : ''
        }`}
        onClick={() => onSelectState(node.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelectState(node.id);
        }}
      >
        <span className="node__glyph">{node.kind === 'root' ? '●' : '├'}</span>
        <span className="node__title">{node.title}</span>
        <span className="node__count">{node.messageCount}</span>
        <button
          className="btn btn--tiny"
          title={node.status === 'abandoned' ? 'Вернуть в работу' : 'Пометить брошенной'}
          onClick={(event) => {
            event.stopPropagation();
            onSetStatus(node.id, node.status === 'abandoned' ? 'active' : 'abandoned');
          }}
        >
          {node.status === 'abandoned' ? '↺' : '×'}
        </button>
      </div>

      {node.branchPointSeq !== null && (
        <div className="node__fork">ветка от сообщения #{node.branchPointSeq}</div>
      )}

      {node.children.map((child) => (
        <Node
          key={child.id}
          node={child}
          selectedStateId={selectedStateId}
          onSelectState={onSelectState}
          onSetStatus={onSetStatus}
        />
      ))}
    </div>
  );
}
