import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import type { FileNode } from '@shared/types'
import { ChevronIcon, FolderIcon, FolderOpenIcon, NewFileIcon, NewFolderIcon, StarIcon, UploadIcon, fileIconFor } from './icons'

const DRAG_TYPE = 'application/x-underleaf-path'

interface Props {
  tree: FileNode[]
  activePath: string | null
  mainFile: string
  dirty: Set<string>
  onOpen: (path: string) => void
  onContextMenu: (node: FileNode | null, x: number, y: number) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onUpload: (dir: string) => void
  onMove: (from: string, toDir: string) => void
  onDropExternal: (toDir: string, files: File[]) => void
}

export function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

export function FileTree(props: Props) {
  const { tree, activePath } = props
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<FileNode | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!activePath) return
    setSelected({ name: activePath.split('/').pop()!, path: activePath, type: 'file' })
    // Reveal the active file by expanding its ancestors.
    setExpanded((prev) => {
      const next = new Set(prev)
      let dir = parentDir(activePath)
      while (dir) {
        next.add(dir)
        dir = parentDir(dir)
      }
      return next.size === prev.size ? prev : next
    })
  }, [activePath])

  const targetDir = selected ? (selected.type === 'dir' ? selected.path : parentDir(selected.path)) : ''

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const onDragOver = (e: DragEvent, dir: string) => {
    const internal = e.dataTransfer.types.includes(DRAG_TYPE)
    const external = e.dataTransfer.types.includes('Files')
    if (!internal && !external) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    setDropTarget(dir)
  }

  const onDrop = (e: DragEvent, dir: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const from = e.dataTransfer.getData(DRAG_TYPE)
    if (from) {
      if (parentDir(from) !== dir && dir !== from && !dir.startsWith(from + '/')) props.onMove(from, dir)
    } else if (e.dataTransfer.files.length) {
      props.onDropExternal(dir, [...e.dataTransfer.files])
    }
  }

  const renderNodes = (nodes: FileNode[], depth: number) =>
    nodes.map((node) => {
      const isDir = node.type === 'dir'
      const open = expanded.has(node.path)
      const Icon = isDir ? (open ? FolderOpenIcon : FolderIcon) : fileIconFor(node.name)
      const classes = ['tree-row']
      if (selected?.path === node.path) classes.push('selected')
      if (isDir && dropTarget === node.path) classes.push('drop-target')
      return (
        <li key={node.path}>
          <div
            className={classes.join(' ')}
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, node.path)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={isDir ? (e) => onDragOver(e, node.path) : undefined}
            onDragLeave={isDir ? () => setDropTarget(null) : undefined}
            onDrop={isDir ? (e) => onDrop(e, node.path) : undefined}
            onClick={() => {
              setSelected(node)
              if (isDir) toggle(node.path)
              else props.onOpen(node.path)
            }}
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              setSelected(node)
              props.onContextMenu(node, e.clientX, e.clientY)
            }}
            title={node.path}
          >
            <span className={`tree-chevron${isDir ? '' : ' hidden'}${open ? ' open' : ''}`}>
              <ChevronIcon size={12} />
            </span>
            <Icon size={15} className="tree-icon" />
            <span className="tree-name">{node.name}</span>
            {node.path === props.mainFile && (
              <span className="tree-main" title="Main document">
                <StarIcon size={11} />
              </span>
            )}
            {props.dirty.has(node.path) && <span className="tree-dirty" title="Unsaved changes" />}
          </div>
          {isDir && open && node.children && node.children.length > 0 && <ul>{renderNodes(node.children, depth + 1)}</ul>}
        </li>
      )
    })

  return (
    <div className="file-tree">
      <div className="pane-header">
        <span className="pane-title">Files</span>
        <div className="pane-actions">
          <button className="icon-btn" title="New file" onClick={() => props.onNewFile(targetDir)}>
            <NewFileIcon />
          </button>
          <button className="icon-btn" title="New folder" onClick={() => props.onNewFolder(targetDir)}>
            <NewFolderIcon />
          </button>
          <button className="icon-btn" title="Upload files" onClick={() => props.onUpload(targetDir)}>
            <UploadIcon />
          </button>
        </div>
      </div>
      <div
        className={`tree-scroll${dropTarget === '' ? ' drop-target' : ''}`}
        onDragOver={(e) => onDragOver(e, '')}
        onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)}
        onDrop={(e) => onDrop(e, '')}
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          setSelected(null)
          props.onContextMenu(null, e.clientX, e.clientY)
        }}
      >
        <ul className="tree-root">{renderNodes(tree, 0)}</ul>
        {tree.length === 0 && <p className="tree-empty">This folder is empty. Create a file to get started.</p>}
      </div>
    </div>
  )
}
