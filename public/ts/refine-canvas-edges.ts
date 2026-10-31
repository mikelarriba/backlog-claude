// ── Refine canvas: SVG edge drawing (SEC / BLOCKS / PARALLEL) ──
// Split out of refine-canvas.ts (#699). Pure drawing: path geometry lives in
// canvas-geometry.ts, popups in refine-edges.ts.
import type { BlockEdge, ParallelPair, CanvasPos } from './canvasLayout.js';
import { computeSecEdges } from './canvasLayout.js';
import { canvasContext } from './state.js';
import {
  computeSecEdgePath,
  computeBlocksEdgePath,
  computeParallelBracketPath,
} from './canvas-geometry.js';
import type { CardPos } from './canvas-geometry.js';
import { _showEdgePopup } from './refine-edges.js';

export function drawCanvasEdges(
  svg: SVGSVGElement,
  cardPositions: Record<string, CardPos>,
  _epicFilename: string,
  _epicCenterX: number,
  _totalW: number
): void {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrow-blocks" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#ef4444"/>
    </marker>
    <marker id="arrow-sec" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="var(--border)"/>
    </marker>`;
  svg.appendChild(defs);

  // Helper: make a path clickable with a wider transparent hit area
  function addHitArea(svg: SVGSVGElement, d: string, onClick: (e: MouseEvent) => void): void {
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('pointer-events', 'stroke');
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', onClick as EventListener);
    svg.appendChild(hit);
  }

  // Keyboard-operable alternative to addHitArea's mouse click — the edge's
  // invisible hit-area <path> can't receive focus, so its text label
  // doubles as a focusable proxy: Enter/Space opens the same _showEdgePopup
  // the mouse click opens, positioned at the label's own screen rect
  // instead of a cursor position, mirroring the canvas-handle keyboard
  // link-creation flow above (getBoundingClientRect() in place of
  // clientX/clientY) (#486).
  function makeEdgeLabelFocusable(
    label: SVGTextElement,
    ariaLabel: string,
    onActivate: (clientX: number, clientY: number) => void
  ): void {
    label.setAttribute('tabindex', '0');
    label.setAttribute('role', 'button');
    label.setAttribute('aria-label', ariaLabel);
    label.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      const rect = label.getBoundingClientRect();
      onActivate(rect.left, rect.top);
    });
  }

  // SEC arrows: cards sharing a column, consecutive rows (skipped where a
  // BLOCKS edge already connects the pair — BLOCKS takes precedence)
  const blocksList = _activePanelState.blocks as unknown as BlockEdge[];
  const parallelList = _activePanelState.parallel as unknown as ParallelPair[];
  const secEdges = computeSecEdges(
    _activePanelState.layout as Record<string, CanvasPos>,
    blocksList
  );
  for (const { src: srcFn, tgt: tgtFn } of secEdges) {
    const src = cardPositions[srcFn];
    const tgt = cardPositions[tgtFn];
    if (!src || !tgt || src === tgt) continue;

    const { d, labelX, labelY } = computeSecEdgePath(src, tgt);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'var(--border)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrow-sec)');
    svg.appendChild(path);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(labelX));
    label.setAttribute('y', String(labelY));
    label.setAttribute('class', 'canvas-edge-label');
    label.textContent = 'SEC';
    svg.appendChild(label);
  }

  // BLOCKS arrows (red) — clickable
  for (const { src, tgt } of blocksList) {
    if (src === tgt) continue;
    const s = cardPositions[src];
    const t = cardPositions[tgt];
    if (!s || !t) continue;

    const srcDt =
      _activePanelState.stories.find((c) => c.filename === src)?.docType || canvasContext.docType;
    const tgtDt =
      _activePanelState.stories.find((c) => c.filename === tgt)?.docType || canvasContext.docType;

    const { d, labelX, labelY } = computeBlocksEdgePath(s, t);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#ef4444');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrow-blocks)');
    svg.appendChild(path);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(labelX));
    label.setAttribute('y', String(labelY));
    label.setAttribute('class', 'canvas-edge-label canvas-edge-label--blocks');
    label.textContent = 'BLOCKS';
    svg.appendChild(label);

    const openBlocksPopup = (clientX: number, clientY: number): void => {
      _showEdgePopup(clientX, clientY, 'blocks', src, srcDt || '', tgt, tgtDt || '');
    };
    addHitArea(svg, d, (e: MouseEvent) => {
      e.stopPropagation();
      openBlocksPopup(e.clientX, e.clientY);
    });
    const srcTitle = allDocs.find((doc) => doc.filename === src)?.title ?? src;
    const tgtTitle = allDocs.find((doc) => doc.filename === tgt)?.title ?? tgt;
    makeEdgeLabelFocusable(
      label,
      `BLOCKS dependency: ${srcTitle} blocks ${tgtTitle}. Press Enter to manage this dependency.`,
      openBlocksPopup
    );
  }

  // PARALLEL brackets — clickable
  for (const { a, b } of parallelList) {
    const pa = cardPositions[a];
    const pb = cardPositions[b];
    if (!pa || !pb) continue;

    const aDt =
      _activePanelState.stories.find((c) => c.filename === a)?.docType || canvasContext.docType;
    const bDt =
      _activePanelState.stories.find((c) => c.filename === b)?.docType || canvasContext.docType;

    const { d, labelX, labelY } = computeParallelBracketPath(pa, pb);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'var(--type-story-color, #3b82f6)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-dasharray', '5 3');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(labelX));
    label.setAttribute('y', String(labelY));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'canvas-edge-label canvas-edge-label--parallel');
    label.textContent = 'PARALLEL';
    svg.appendChild(label);

    const openParallelPopup = (clientX: number, clientY: number): void => {
      _showEdgePopup(clientX, clientY, 'parallel', a, aDt || '', b, bDt || '');
    };
    addHitArea(svg, d, (e: MouseEvent) => {
      e.stopPropagation();
      openParallelPopup(e.clientX, e.clientY);
    });
    const aTitle = allDocs.find((doc) => doc.filename === a)?.title ?? a;
    const bTitle = allDocs.find((doc) => doc.filename === b)?.title ?? b;
    makeEdgeLabelFocusable(
      label,
      `PARALLEL dependency between ${aTitle} and ${bTitle}. Press Enter to manage this dependency.`,
      openParallelPopup
    );
  }
}
