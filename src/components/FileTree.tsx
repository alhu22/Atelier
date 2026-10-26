import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ProjectFiles } from "@/types";

interface FileNode {
  path: string;
  name: string;
  children?: FileNode[];
}

function ancestors(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

function buildTree(paths: string[]): FileNode[] {
  const root: FileNode[] = [];
  for (const path of paths.sort()) {
    let siblings = root;
    const parts = path.split("/");
    parts.forEach((name, index) => {
      const nodePath = parts.slice(0, index + 1).join("/");
      let node = siblings.find((item) => item.path === nodePath);
      if (!node) {
        node = { path: nodePath, name, ...(index < parts.length - 1 ? { children: [] } : {}) };
        siblings.push(node);
      }
      if (node.children) siblings = node.children;
    });
  }
  return root;
}

export function FileTree({
  files,
  activeFile,
  onSelectFile,
}: {
  files: ProjectFiles;
  activeFile: string;
  onSelectFile: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(Object.keys(files)), [files]);
  const [expanded, setExpanded] = useState(() => new Set(ancestors(activeFile)));
  const [focused, setFocused] = useState(activeFile);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setExpanded((current) => new Set([...current, ...ancestors(activeFile)]));
    setFocused(activeFile);
  }, [activeFile]);

  const rows: { node: FileNode; level: number; position: number; size: number; parent?: string }[] = [];
  function visit(nodes: FileNode[], level: number, parent?: string) {
    nodes.forEach((node, index) => {
      rows.push({ node, level, parent, position: index + 1, size: nodes.length });
      if (node.children && expanded.has(node.path)) visit(node.children, level + 1, node.path);
    });
  }
  visit(tree, 1);
  const tabStop = rows.some(({ node }) => node.path === focused) ? focused : rows[0]?.node.path;

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function focus(path?: string) {
    if (!path) return;
    setFocused(path);
    buttons.current.get(path)?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const { node, parent } = rows[index];
    switch (event.key) {
      case "ArrowDown": focus(rows[index + 1]?.node.path); break;
      case "ArrowUp": focus(rows[index - 1]?.node.path); break;
      case "Home": focus(rows[0]?.node.path); break;
      case "End": focus(rows.at(-1)?.node.path); break;
      case "ArrowRight":
        if (node.children) {
          if (!expanded.has(node.path)) toggle(node.path);
          else focus(node.children[0]?.path);
        }
        break;
      case "ArrowLeft":
        if (node.children && expanded.has(node.path)) toggle(node.path);
        else focus(parent);
        break;
      default: return;
    }
    event.preventDefault();
  }

  return (
    <div aria-label="Project files" className="space-y-0.5 px-1 pb-3" role="tree">
      {rows.map(({ node, level, position, size }, index) => (
        <button
          aria-expanded={node.children ? expanded.has(node.path) : undefined}
          aria-level={level}
          aria-posinset={position}
          aria-selected={node.children ? undefined : node.path === activeFile}
          aria-setsize={size}
          className={`flex w-full items-center gap-1 rounded py-1.5 pr-2 text-left font-mono text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${node.path === activeFile ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
          key={node.path}
          onClick={() => {
            setFocused(node.path);
            if (node.children) toggle(node.path);
            else onSelectFile(node.path);
          }}
          onFocus={() => setFocused(node.path)}
          onKeyDown={(event) => handleKey(event, index)}
          ref={(element) => {
            if (element) buttons.current.set(node.path, element);
            else buttons.current.delete(node.path);
          }}
          role="treeitem"
          style={{ paddingLeft: `${8 + (level - 1) * 14}px` }}
          tabIndex={node.path === tabStop ? 0 : -1}
          title={node.path}
          type="button"
        >
          <span aria-hidden="true" className="w-3 shrink-0">
            {node.children ? (expanded.has(node.path) ? "\u25be" : "\u25b8") : ""}
          </span>
          <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 20 20">
            {node.children ? <path d="M2 5h6l2 2h8v10H2Z" /> : <path d="M5 2h7l4 4v12H5Zm7 0v5h4" />}
          </svg>
          <span className="truncate">{node.name}</span>
        </button>
      ))}
    </div>
  );
}
