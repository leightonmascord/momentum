// Shared drag state for the per-column dashboard grid. Lives outside React
// so updates from dnd-kit's pointer callbacks don't trigger re-renders on
// every pointer move; readers bridge the values into React via
// useSyncExternalStore. Two events drive re-renders during a drag:
//   - 'draghover': over-column or over-widget changed (placeholder index)
//   - 'dragmeasure': the active widget's measured size changed
// SortableContext item arrays are memoized separately, so these
// re-renders don't cause the context to re-register and the 200ms
// transform transitions don't re-fire (that was the source of the
// earlier flicker).

export const overColumn$ = { current: null as number | null }
export const overId$ = { current: null as string | null }
export const activeWidgetSize$ = { current: null as { height: number } | null }

export function subscribeDragHover(cb: () => void): () => void {
  window.addEventListener('draghover', cb)
  window.addEventListener('dragmeasure', cb)
  return () => {
    window.removeEventListener('draghover', cb)
    window.removeEventListener('dragmeasure', cb)
  }
}

export function emitDragHover(): void {
  window.dispatchEvent(new Event('draghover'))
}

export function emitDragMeasure(): void {
  window.dispatchEvent(new Event('dragmeasure'))
}

export function resetDragState(): void {
  overColumn$.current = null
  overId$.current = null
  activeWidgetSize$.current = null
  emitDragHover()
}
