import { useState, useRef, useCallback, useEffect } from "react";
import { Stage, Layer, Group, Rect, Circle, Ellipse, Text, Line } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Table, Attendee, SeatAssignment } from "../types";
import type Konva from "konva";

interface Props {
  tables: Table[];
  attendees: Attendee[];
  seatAssignments: SeatAssignment[];
  onTableMove: (tableId: number, x: number, y: number) => void;
  onDropAttendee: (attendeeId: number, tableId: number, seatNumber: number) => void;
  onRemoveSeat: (assignmentId: number) => void;
  onTableResize?: (tableId: number, width: number, height: number, capacity: number) => void;
  selectedTableId: number | null;
  onSelectTable: (id: number | null) => void;
  drawMode?: boolean;
  drawShape?: "round" | "rectangular" | "oval";
  onDrawTable?: (name: string, shape: Table["shape"], width: number, height: number, capacity: number, x: number, y: number) => void;
  onCancelDraw?: () => void;
  onDeleteTable?: (tableId: number) => void;
  onRenameTable?: (tableId: number, name: string) => void;
  onRotateTable?: (tableId: number, rotation: number) => void;
  autoSeatRef?: React.MutableRefObject<(() => void) | null>;
  maximizeConversation?: boolean;
  onMaximizeConversationChange?: (val: boolean) => void;
}

const SEAT_SPACING = 52;

/** For rectangular tables, distribute seats proportionally based on table width/height */
function rectSeatLayout(capacity: number, width: number, height: number): { top: number; bottom: number; left: number; right: number } {
  // How many fit on each side based on dimensions
  const hFit = Math.max(1, Math.floor(width / SEAT_SPACING));
  const vFit = Math.max(1, Math.floor(height / SEAT_SPACING));
  const perimeter = 2 * (hFit + vFit);

  if (capacity <= 0) return { top: 0, bottom: 0, left: 0, right: 0 };

  // Distribute proportionally: top/bottom get hFit share, left/right get vFit share
  const ratio = capacity / perimeter;
  let top = Math.round(hFit * ratio);
  let bottom = Math.round(hFit * ratio);
  let left = Math.round(vFit * ratio);
  let right = Math.round(vFit * ratio);

  // Adjust to exactly match capacity
  let total = top + bottom + left + right;
  while (total < capacity) {
    // Add to the side with most room
    if (top <= bottom && top < hFit) { top++; }
    else if (bottom < hFit) { bottom++; }
    else if (left <= right && left < vFit) { left++; }
    else { right++; }
    total++;
  }
  while (total > capacity) {
    // Remove from the side with least impact
    if (right > 0 && right >= left) { right--; }
    else if (left > 0) { left--; }
    else if (bottom > 0 && bottom >= top) { bottom--; }
    else { top--; }
    total--;
  }

  return { top, bottom, left, right };
}

/** Compute table dimensions from capacity so seats are evenly spaced (fallback for new tables) */
function tableDimsFromCapacity(capacity: number): { width: number; height: number } {
  // Estimate a reasonable rectangle: wider than tall
  const hSeats = Math.max(1, Math.ceil(capacity / 4));
  const vSeats = Math.max(1, Math.floor((capacity - 2 * hSeats) / 2));
  return {
    width: Math.max(80, hSeats * SEAT_SPACING),
    height: Math.max(60, Math.max(vSeats, 1) * SEAT_SPACING),
  };
}

const CHAIR_SPACING = 56; // spacing for chair rows

function capacityFromDims(shape: string, width: number, height: number): number {
  if (shape === "chair-row") {
    const cols = Math.max(1, Math.floor(width / CHAIR_SPACING));
    const rows = Math.max(1, Math.floor(height / CHAIR_SPACING));
    return cols * rows;
  }
  if (shape === "round") {
    return Math.max(2, Math.round((2 * Math.PI * (width / 2 + 30)) / SEAT_SPACING));
  }
  if (shape === "oval") {
    const rx = width / 2 + 30, ry = height / 2 + 30;
    const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    return Math.max(2, Math.round(perim / SEAT_SPACING));
  }
  const across = Math.max(1, Math.floor(width / SEAT_SPACING));
  const down = Math.max(1, Math.floor(height / SEAT_SPACING));
  return 2 * (across + down);
}

function getSeatPositions(shape: string, width: number, height: number, capacity: number): { x: number; y: number }[] {
  const seats: { x: number; y: number }[] = [];
  const cx = width / 2;
  const cy = height / 2;

  if (shape === "chair-row") {
    // Grid of chairs: evenly spaced in rows and columns
    const cols = Math.max(1, Math.floor(width / CHAIR_SPACING));
    const rows = Math.max(1, Math.floor(height / CHAIR_SPACING));
    let placed = 0;
    for (let r = 0; r < rows && placed < capacity; r++) {
      for (let c = 0; c < cols && placed < capacity; c++) {
        seats.push({
          x: (c + 0.5) * (width / cols),
          y: (r + 0.5) * (height / rows),
        });
        placed++;
      }
    }
    return seats;
  }

  if (shape === "round" || shape === "oval") {
    const rx = width / 2 + 30;
    const ry = shape === "oval" ? height / 2 + 30 : rx;
    for (let i = 0; i < capacity; i++) {
      const angle = (2 * Math.PI * i) / capacity - Math.PI / 2;
      seats.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    }
  } else {
    const layout = rectSeatLayout(capacity, width, height);
    const offset = 32;

    // Top side — evenly spaced across width
    for (let j = 0; j < layout.top; j++) {
      const t = (j + 0.5) / layout.top;
      seats.push({ x: t * width, y: -offset });
    }
    // Bottom side
    for (let j = 0; j < layout.bottom; j++) {
      const t = (j + 0.5) / layout.bottom;
      seats.push({ x: t * width, y: height + offset });
    }
    // Right side
    for (let j = 0; j < layout.right; j++) {
      const t = (j + 0.5) / layout.right;
      seats.push({ x: width + offset, y: t * height });
    }
    // Left side
    for (let j = 0; j < layout.left; j++) {
      const t = (j + 0.5) / layout.left;
      seats.push({ x: -offset, y: t * height });
    }
  }
  return seats;
}

function avatarColor(dietary: string | null | undefined) {
  if (!dietary) return "#1b4fff";
  const d = dietary.toLowerCase().trim();
  if (d.length > 0) return "#16a34a";
  return "#1b4fff";
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function firstNameShort(name: string) {
  return name.split(" ")[0].slice(0, 7);
}

function dietaryColor(attendee: Attendee): string | null {
  const d = (attendee.dietary_requirements ?? "").toLowerCase();
  if (!d) return null;
  if (d.includes("végan") || d.includes("vegan")) return "#15803d";
  if (d.includes("végétarien") || d.includes("vegetarian")) return "#16a34a";
  if (d.includes("sans gluten") || d.includes("gluten")) return "#b45309";
  return "#6b7280";
}

function dietaryEmoji(attendee: Attendee): string {
  const d = (attendee.dietary_requirements ?? "").toLowerCase();
  if (d.includes("végan") || d.includes("vegan")) return "🌱";
  if (d.includes("végétarien") || d.includes("vegetarian")) return "🌿";
  if (d.includes("sans gluten") || d.includes("gluten")) return "🌾";
  return "⚠";
}

export default function SeatingBoard({
  tables, attendees, seatAssignments,
  onTableMove, onDropAttendee, onRemoveSeat,
  onTableResize, selectedTableId, onSelectTable,
  drawMode = false, drawShape = "rectangular",
  onDrawTable, onCancelDraw, onDeleteTable, onRenameTable, onRotateTable,
  autoSeatRef, maximizeConversation, onMaximizeConversationChange,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [measuredCanvasWidth, setMeasuredCanvasWidth] = useState(840);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [dragOverSeat, setDragOverSeat] = useState<string | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [editingTableName, setEditingTableName] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [hoveredTable, setHoveredTable] = useState<number | null>(null);
  const [lockedTables, setLockedTables] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [maximizeContactLocal, setMaximizeContactLocal] = useState(false);
  const maximizeContact = maximizeConversation ?? maximizeContactLocal;
  const [sidebarPos, setSidebarPos] = useState<{ x: number; y: number } | null>(null);
  const sidebarDragRef = useRef<{ origX: number; origY: number; startX: number; startY: number } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  // Mobile: attendee panel toggled hidden by default so tables have room
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Draw-to-create state
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });
  const [namePrompt, setNamePrompt] = useState(false);
  const [pendingBounds, setPendingBounds] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [newTableName, setNewTableName] = useState("");

  // Per-table live resize state (overrides table data until committed)
  const [resizing, setResizing] = useState<{ id: number; w: number; h: number } | null>(null);

  const attendeeMap = new Map(attendees.map(a => [a.id, a]));
  const assignmentByAttendee = new Map(seatAssignments.map(sa => [sa.attendee_id, sa]));
  const assignmentBySeat = new Map(
    seatAssignments.map(sa => [`${sa.table_id}-${sa.seat_number}`, sa])
  );
  const tableMap = new Map(tables.map(t => [t.id, t]));
  const selectedTable = selectedTableId ? tableMap.get(selectedTableId) : null;

  // Get effective dimensions — use stored dims, fall back to capacity-based for legacy/new tables
  const effectiveDims = useCallback((table: Table) => {
    if (resizing && resizing.id === table.id) {
      return { width: resizing.w, height: resizing.h };
    }
    return { width: table.width, height: table.height };
  }, [resizing]);

  const findNearestEmptySeat = useCallback((dropX: number, dropY: number) => {
    let bestDist = 90;
    let bestTableId: number | null = null;
    let bestSeat = 0;

    for (const table of tables) {
      const { width, height } = effectiveDims(table);
      const positions = getSeatPositions(table.shape, width, height, table.capacity);

      // Check individual seat positions
      positions.forEach((pos, idx) => {
        const seatNum = idx + 1;
        if (assignmentBySeat.has(`${table.id}-${seatNum}`)) return;
        const absX = table.x_position + pos.x;
        const absY = table.y_position + pos.y;
        const dist = Math.hypot(dropX - absX, dropY - absY);
        if (dist < bestDist) {
          bestDist = dist; bestTableId = table.id; bestSeat = seatNum;
        }
      });

      // Also match drops on table body → first empty seat
      const cx = table.x_position + width / 2;
      const cy = table.y_position + height / 2;
      const bodyDist = Math.hypot(dropX - cx, dropY - cy);
      const hitR = Math.max(width, height) / 2 + 20;
      if (bodyDist < hitR) {
        for (let i = 0; i < positions.length; i++) {
          if (!assignmentBySeat.has(`${table.id}-${i + 1}`)) {
            if (bodyDist < bestDist) {
              bestDist = bodyDist; bestTableId = table.id; bestSeat = i + 1;
            }
            break;
          }
        }
      }
    }
    return bestTableId ? { tableId: bestTableId, seatNum: bestSeat } : null;
  }, [tables, assignmentBySeat, effectiveDims]);

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const result = findNearestEmptySeat(e.clientX - rect.left, e.clientY - rect.top);
    setDragOverSeat(result ? `${result.tableId}-${result.seatNum}` : null);
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSeat(null);
    const attendeeId = Number(e.dataTransfer.getData("attendeeId"));
    if (!attendeeId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const result = findNearestEmptySeat(e.clientX - rect.left, e.clientY - rect.top);
    if (result) onDropAttendee(attendeeId, result.tableId, result.seatNum);
  };

  const handleSeatDrop = (e: React.DragEvent, tableId: number, seatNum: number) => {
    e.preventDefault(); e.stopPropagation();
    const attendeeId = Number(e.dataTransfer.getData("attendeeId"));
    if (attendeeId && !assignmentBySeat.has(`${tableId}-${seatNum}`)) {
      onDropAttendee(attendeeId, tableId, seatNum);
    }
    setDragOverSeat(null);
  };

  const handleAutoSeat = async () => {
    const unseated = attendees.filter(a => !assignmentByAttendee.has(a.id));
    if (unseated.length === 0) return;
    const allEmptySeats: { tableId: number; seatNum: number }[] = [];
    if (maximizeContact) {
      const perTable = tables.map(table => {
        const { width, height } = effectiveDims(table);
        const positions = getSeatPositions(table.shape, width, height, table.capacity);
        return positions
          .map((_, idx) => idx + 1)
          .filter(sn => !assignmentBySeat.has(`${table.id}-${sn}`))
          .map(sn => ({ tableId: table.id, seatNum: sn }));
      }).filter(s => s.length > 0);
      let ri = 0;
      while (allEmptySeats.length < unseated.length) {
        let added = false;
        for (const seats of perTable) {
          if (ri < seats.length) { allEmptySeats.push(seats[ri]); added = true; }
        }
        if (!added) break;
        ri++;
      }
    } else {
      for (const table of tables) {
        const { width, height } = effectiveDims(table);
        const positions = getSeatPositions(table.shape, width, height, table.capacity);
        positions.forEach((_, idx) => {
          const sn = idx + 1;
          if (!assignmentBySeat.has(`${table.id}-${sn}`)) allEmptySeats.push({ tableId: table.id, seatNum: sn });
        });
      }
    }
    for (let i = 0; i < Math.min(unseated.length, allEmptySeats.length); i++) {
      await onDropAttendee(unseated[i].id, allEmptySeats[i].tableId, allEmptySeats[i].seatNum);
    }
  };

  // Expose auto-seat to parent via ref
  if (autoSeatRef) autoSeatRef.current = handleAutoSeat;

  // Measure the panel's real dimensions instead of trusting a hardcoded
  // width — the panel is 220px in CSS today, but breakpoints or future
  // resizing shouldn't break the drag clamp.
  const getSidebarSize = () => {
    const el = sidebarRef.current;
    return {
      w: el?.offsetWidth ?? 220,
      h: el?.offsetHeight ?? 200,
    };
  };

  const moveSidebarDrag = (clientX: number, clientY: number) => {
    if (!sidebarDragRef.current || !boardRef.current) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const { w, h } = getSidebarSize();
    const dx = clientX - sidebarDragRef.current.startX;
    const dy = clientY - sidebarDragRef.current.startY;
    const newX = Math.max(0, Math.min(boardRect.width - w, sidebarDragRef.current.origX + dx));
    const newY = Math.max(0, Math.min(boardRect.height - h, sidebarDragRef.current.origY + dy));
    setSidebarPos({ x: newX, y: newY });
  };

  const startSidebarDrag = (clientX: number, clientY: number) => {
    if (!boardRef.current) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const { w } = getSidebarSize();
    const currentX = sidebarPos ? sidebarPos.x : Math.max(0, boardRect.width - w);
    const currentY = sidebarPos ? sidebarPos.y : 0;
    sidebarDragRef.current = { origX: currentX, origY: currentY, startX: clientX, startY: clientY };
    if (!sidebarPos) setSidebarPos({ x: currentX, y: currentY });

    // Capture listener references locally so add/remove pair correctly
    // regardless of how many times the component re-renders mid-drag.
    // Without this, removeEventListener wouldn't match what was added.
    const onMove = (e: MouseEvent) => moveSidebarDrag(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) moveSidebarDrag(t.clientX, t.clientY);
    };
    const onEnd = () => {
      sidebarDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
    // Window-level so the drag survives the cursor leaving the board —
    // the source of the "clunky/stuck" feeling on fast drags.
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  };

  const handleSidebarHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startSidebarDrag(e.clientX, e.clientY);
  };

  const handleSidebarHandleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) startSidebarDrag(t.clientX, t.clientY);
  };

  // Legacy board-level handlers — kept as no-ops since drag is now
  // window-driven, but the JSX still wires them up.
  const handleBoardMouseMove = () => {};
  const handleBoardTouchMove = () => {};
  const handleBoardMouseUp = () => {};

  // Draw mode handlers
  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (!drawMode) return;
    const pos = stageRef.current!.getPointerPosition()!;
    setDrawing(true);
    setDrawStart(pos);
    setDrawCurrent(pos);
  };

  const handleStageMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (!drawMode || !drawing) return;
    const pos = stageRef.current!.getPointerPosition()!;
    setDrawCurrent(pos);
  };

  const handleStageMouseUp = () => {
    if (!drawMode || !drawing) return;
    setDrawing(false);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    // Accept as soon as the preview has at least one seat — the only thing we
    // reject here is a zero-drag click (the click-without-move case).
    // `capacityFromDims` already applies its own floors (e.g. round/oval
    // minimum of 2 seats), so this check mirrors that.
    const cap = capacityFromDims(drawShape, Math.max(w, 1), Math.max(h, 1));
    if (w < 6 && h < 6) return;      // ignore accidental clicks (no real drag)
    if (cap < 1) return;               // sanity: must produce at least one seat
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    setPendingBounds({ x, y, w, h });
    setNewTableName(drawShape === "chair-row" ? `Row ${tables.filter(t => t.shape === "chair-row").length + 1}` : `Table ${tables.length + 1}`);
    setNamePrompt(true);
  };

  const confirmDrawTable = () => {
    if (!newTableName.trim() || !onDrawTable) return;
    const { x, y, w, h } = pendingBounds;
    // For round, use the smaller dimension as diameter
    const finalW = drawShape === "round" ? Math.min(w, h) : w;
    const finalH = drawShape === "round" ? Math.min(w, h) : h;
    const cap = capacityFromDims(drawShape, finalW, finalH);
    onDrawTable(newTableName.trim(), drawShape, finalW, finalH, cap, x, y);
    setNamePrompt(false);
    setNewTableName("");
  };

  const unseatedAttendees = attendees.filter(a => !assignmentByAttendee.has(a.id));
  const filteredUnseated = unseatedAttendees.filter(a =>
    a.name.toLowerCase().includes(sidebarSearch.toLowerCase())
  );
  const filteredSeated = attendees.filter(a =>
    assignmentByAttendee.has(a.id) && a.name.toLowerCase().includes(sidebarSearch.toLowerCase())
  );

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setMeasuredCanvasWidth(Math.floor(entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canvasWidth = measuredCanvasWidth;
  const canvasHeight = 620;

  // Preview rect while drawing
  const previewX = Math.min(drawStart.x, drawCurrent.x);
  const previewY = Math.min(drawStart.y, drawCurrent.y);
  const previewW = Math.max(1, Math.abs(drawCurrent.x - drawStart.x));
  const previewH = Math.max(1, Math.abs(drawCurrent.y - drawStart.y));
  const previewCap = capacityFromDims(drawShape, previewW, previewH);
  const previewSeats = getSeatPositions(drawShape, previewW, previewH, previewCap);

  return (
    <div
      className="seating-board-v2"
      ref={boardRef}
      onMouseMove={handleBoardMouseMove}
      onMouseUp={handleBoardMouseUp}
      onMouseLeave={handleBoardMouseUp}
      onTouchMove={handleBoardTouchMove}
      onTouchEnd={handleBoardMouseUp}
      onTouchCancel={handleBoardMouseUp}
    >
      {/* Canvas */}
      <div
        ref={canvasWrapRef}
        className="sb-canvas-wrap"
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        style={{ cursor: drawMode ? "crosshair" : "default" }}
      >
        {/* Draw mode banner */}
        {drawMode && (
          <div className="sb-draw-banner">
            <span>Click and drag on the canvas to draw {drawShape === "chair-row" ? "a chair row" : "a table"}</span>
            <button className="sb-cancel-btn" onClick={onCancelDraw}>✕ Cancel</button>
          </div>
        )}

        {/* Name prompt overlay */}
        {namePrompt && (
          <div className="sb-name-prompt" style={{
            top: Math.min(pendingBounds.y + pendingBounds.h + 12, canvasHeight - 90),
            left: Math.min(pendingBounds.x, canvasWidth - 240),
          }}>
            <input
              autoFocus
              className="sb-name-input"
              value={newTableName}
              onChange={e => setNewTableName(e.target.value)}
              placeholder={drawShape === "chair-row" ? "Row name" : "Table name"}
              onKeyDown={e => {
                if (e.key === "Enter") confirmDrawTable();
                if (e.key === "Escape") { setNamePrompt(false); }
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={confirmDrawTable}>Add</button>
            <button className="btn btn-sm" onClick={() => setNamePrompt(false)}>Cancel</button>
          </div>
        )}

        {/* Zoom controls */}
        <div className="sb-zoom-controls">
          <button className="sb-zoom-btn" onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))}>+</button>
          <span className="sb-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="sb-zoom-btn" onClick={() => setZoom(z => Math.max(0.3, +(z - 0.1).toFixed(1)))}>−</button>
        </div>

        <Stage
          ref={stageRef}
          width={canvasWidth}
          height={canvasHeight}
          style={{ background: "transparent", display: "block", cursor: drawMode ? "crosshair" : "grab" }}
          scaleX={zoom}
          scaleY={zoom}
          draggable={!drawMode}
          dragBoundFunc={(pos) => {
            // Keep at least `keepVisible` px of the tables' bounding box inside
            // the viewport so the user can't lose their seating chart off-screen.
            // Set small (just enough to grab back onto something) so the user
            // doesn't feel an artificial wall when panning toward an edge.
            if (tables.length === 0) return pos;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const t of tables) {
              minX = Math.min(minX, t.x_position);
              minY = Math.min(minY, t.y_position);
              maxX = Math.max(maxX, t.x_position + t.width);
              maxY = Math.max(maxY, t.y_position + t.height);
            }
            const keepVisible = 20;
            const minPanX = keepVisible - maxX * zoom;
            const maxPanX = canvasWidth - keepVisible - minX * zoom;
            const minPanY = keepVisible - maxY * zoom;
            const maxPanY = canvasHeight - keepVisible - minY * zoom;
            return {
              x: Math.max(minPanX, Math.min(maxPanX, pos.x)),
              y: Math.max(minPanY, Math.min(maxPanY, pos.y)),
            };
          }}
          onWheel={e => {
            e.evt.preventDefault();
            const delta = e.evt.deltaY > 0 ? -0.05 : 0.05;
            setZoom(z => Math.min(2, Math.max(0.3, +(z + delta).toFixed(2))));
          }}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onClick={e => {
            if (drawMode) return;
            if (e.target === stageRef.current) onSelectTable(null);
          }}
        >
          <Layer>
            {/* Dot grid */}
            {Array.from({ length: Math.floor(canvasWidth / 40) + 1 }).map((_, i) =>
              Array.from({ length: Math.floor(canvasHeight / 40) + 1 }).map((_, j) => (
                <Circle key={`d${i}-${j}`} x={i * 40} y={j * 40} radius={1} fill="#e2e8f0" />
              ))
            )}

            {/* Draw preview */}
            {drawMode && drawing && previewW > 20 && previewH > 20 && (
              <Group x={previewX} y={previewY}>
                {drawShape === "chair-row" ? (
                  <Rect
                    width={previewW} height={previewH}
                    fill="rgba(27,79,255,0.04)" stroke="#1b4fff"
                    strokeWidth={1.5} dash={[4, 4]}
                  />
                ) : drawShape === "round" ? (
                  <Ellipse
                    x={previewW / 2} y={previewH / 2}
                    radiusX={Math.min(previewW, previewH) / 2}
                    radiusY={Math.min(previewW, previewH) / 2}
                    fill="rgba(27,79,255,0.08)" stroke="#1b4fff"
                    strokeWidth={2} dash={[6, 3]}
                  />
                ) : drawShape === "oval" ? (
                  <Ellipse
                    x={previewW / 2} y={previewH / 2}
                    radiusX={previewW / 2} radiusY={previewH / 2}
                    fill="rgba(27,79,255,0.08)" stroke="#1b4fff"
                    strokeWidth={2} dash={[6, 3]}
                  />
                ) : (
                  <Rect
                    width={previewW} height={previewH}
                    fill="rgba(27,79,255,0.08)" stroke="#1b4fff"
                    strokeWidth={2} cornerRadius={6} dash={[6, 3]}
                  />
                )}
                <Text
                  text={`${previewCap} ${drawShape === "chair-row" ? "chairs" : "seats"}`}
                  x={0} y={previewH / 2 - 7}
                  width={previewW} align="center"
                  fill="#1b4fff" fontSize={11} fontStyle="bold"
                />
                {previewSeats.map((pos, i) => (
                  <Circle key={i} x={pos.x} y={pos.y} radius={14}
                    fill="rgba(27,79,255,0.15)" stroke="#1b4fff" strokeWidth={1.5}
                  />
                ))}
              </Group>
            )}

            {/* Tables */}
            {tables.map(table => {
              const { width, height } = effectiveDims(table);
              // During resize, dynamically compute capacity from current dims
              const liveCapacity = resizing && resizing.id === table.id
                ? capacityFromDims(table.shape, width, height)
                : table.capacity;
              const seatPositions = getSeatPositions(table.shape, width, height, liveCapacity);
              const isSelected = selectedTableId === table.id;
              const occupiedCount = seatPositions.filter((_, idx) =>
                assignmentBySeat.has(`${table.id}-${idx + 1}`)
              ).length;

              const showDetail = zoom >= 0.6;
              const isTableHovered = hoveredTable === table.id;
              const isLocked = lockedTables.has(table.id);
              const showBlueStroke = isSelected || isTableHovered;
              const showHandles = (isSelected || isTableHovered) && !drawMode && !isLocked;

              const rotationDeg = table.rotation || 0;
              return (
                <Group
                  key={table.id}
                  // Position and drag are handled on this outer group so drag
                  // math stays in top-left coordinates. Content rotates via
                  // the inner group below.
                  x={table.x_position}
                  y={table.y_position}
                  draggable={!drawMode && !isLocked}
                  onDragEnd={e => onTableMove(table.id, e.target.x(), e.target.y())}
                  onMouseEnter={() => setHoveredTable(table.id)}
                  onMouseLeave={() => { if (hoveredTable === table.id) setHoveredTable(null); }}
                  onClick={() => { if (!drawMode) onSelectTable(isSelected ? null : table.id); }}
                >
                  <Group
                    // Rotate the entire table (body + seats + icons) around its
                    // center. Shift origin to center, offset content back, spin.
                    x={width / 2}
                    y={height / 2}
                    offsetX={width / 2}
                    offsetY={height / 2}
                    rotation={rotationDeg}
                  >
                  {/* Table body */}
                  {table.shape === "chair-row" ? (
                    <Rect
                      width={width} height={height}
                      fill="transparent"
                      stroke={showBlueStroke ? "#1b4fff" : "#e2e8f0"}
                      strokeWidth={showBlueStroke ? 1.5 : 1}
                      cornerRadius={4}
                      dash={showBlueStroke ? undefined : [4, 4]}
                    />
                  ) : table.shape === "round" || table.shape === "oval" ? (
                    <Ellipse
                      x={width / 2} y={height / 2}
                      radiusX={width / 2} radiusY={height / 2}
                      fill="white"
                      stroke={showBlueStroke ? "#1b4fff" : "#cbd5e1"}
                      strokeWidth={showBlueStroke ? 2.5 : 1.5}
                      shadowColor="rgba(0,0,0,0.08)" shadowBlur={8}
                    />
                  ) : (
                    <Rect
                      width={width} height={height} fill="white"
                      stroke={showBlueStroke ? "#1b4fff" : "#cbd5e1"}
                      strokeWidth={showBlueStroke ? 2.5 : 1.5}
                      cornerRadius={6}
                      shadowColor="rgba(0,0,0,0.08)" shadowBlur={8}
                    />
                  )}

                  {table.shape !== "chair-row" && (
                    <Group x={width / 2} y={height / 2 - 8} rotation={-rotationDeg}>
                      <Text
                        text={table.name}
                        x={-width / 2} y={-5.5}
                        width={width} align="center"
                        fill="#64748b" fontSize={11} fontStyle="bold"
                      />
                    </Group>
                  )}
                  {table.shape === "chair-row" && (
                    <Group x={width / 2} y={-11} rotation={-rotationDeg}>
                      <Text
                        text={table.name}
                        x={-width / 2} y={-5}
                        width={width} align="center"
                        fill="#94a3b8" fontSize={10} fontStyle="bold"
                      />
                    </Group>
                  )}
                  {showDetail && (
                    <Group
                      x={width / 2}
                      y={table.shape === "chair-row" ? 0 : height / 2 + 4}
                      rotation={-rotationDeg}
                    >
                      <Text
                        text={`${occupiedCount}/${liveCapacity}`}
                        x={-width / 2} y={-5}
                        width={width} align="center"
                        fill="#94a3b8" fontSize={10}
                      />
                    </Group>
                  )}

                  {/* Delete table button */}
                  {showDetail && onDeleteTable && (() => {
                    const delKey = `del-${table.id}`;
                    const isHovered = hoveredSeat === delKey;
                    const delX = table.shape === "chair-row" ? width + 12 : width / 2;
                    const delY = table.shape === "chair-row" ? -12 : height / 2 + 28;
                    return (
                      <Group
                        x={delX} y={delY}
                        onMouseEnter={() => setHoveredSeat(delKey)}
                        onMouseLeave={() => { if (hoveredSeat === delKey) setHoveredSeat(null); }}
                        onClick={(e: KonvaEventObject<MouseEvent>) => {
                          e.cancelBubble = true;
                          onDeleteTable(table.id);
                        }}
                      >
                        <Circle radius={9} fill={isHovered ? "#ef4444" : "white"} stroke={isHovered ? "#ef4444" : "#94a3b8"} strokeWidth={1.5} />
                        <Text text="✕" x={-9} y={-5.5} width={18} align="center" fill={isHovered ? "white" : "#94a3b8"} fontSize={10} fontStyle="bold" />
                      </Group>
                    );
                  })()}

                  {/* Rotate table icon — upper right on hover */}
                  {showDetail && isTableHovered && onRotateTable && !drawMode && !isLocked && (() => {
                    const rotKey = `rot-${table.id}`;
                    const rotHovered = hoveredSeat === rotKey;
                    const rotX = width - 14;
                    const rotY = 14;
                    return (
                      <Group
                        x={rotX} y={rotY}
                        onMouseEnter={() => setHoveredSeat(rotKey)}
                        onMouseLeave={() => { if (hoveredSeat === rotKey) setHoveredSeat(null); }}
                        onClick={(e: KonvaEventObject<MouseEvent>) => {
                          e.cancelBubble = true;
                          // Toggle between horizontal (0°) and vertical (90°)
                          // — no intermediate angles. Keeps layouts tidy.
                          const next = ((table.rotation || 0) % 180 === 90) ? 0 : 90;
                          onRotateTable(table.id, next);
                        }}
                      >
                        <Circle
                          radius={9}
                          fill={rotHovered ? "#1b4fff" : "white"}
                          stroke={rotHovered ? "#1b4fff" : "#94a3b8"}
                          strokeWidth={1.5}
                        />
                        {/* Circular arrow (refresh-style) icon built from two arcs + arrow head */}
                        <Text
                          text="⟳"
                          x={-9} y={-7}
                          width={18}
                          height={14}
                          align="center"
                          verticalAlign="middle"
                          fill={rotHovered ? "white" : "#64748b"}
                          fontSize={12}
                          fontStyle="bold"
                        />
                      </Group>
                    );
                  })()}

                  {/* Lock/unlock icon — upper left of table, inset from edge */}
                  {(() => {
                    const lockKey = `lock-${table.id}`;
                    const lockHovered = hoveredSeat === lockKey;
                    const lockColor = isLocked ? "#d97706" : (lockHovered ? "#64748b" : "#94a3b8");
                    return (
                      <Group
                        x={24} y={24}
                        onMouseEnter={() => setHoveredSeat(lockKey)}
                        onMouseLeave={() => { if (hoveredSeat === lockKey) setHoveredSeat(null); }}
                        onClick={(e: KonvaEventObject<MouseEvent>) => {
                          e.cancelBubble = true;
                          setLockedTables(prev => {
                            const next = new Set(prev);
                            next.has(table.id) ? next.delete(table.id) : next.add(table.id);
                            return next;
                          });
                        }}
                      >
                        <Circle
                          radius={11}
                          fill={lockHovered ? (isLocked ? "#fef3c7" : "#f1f5f9") : "rgba(255,255,255,0.85)"}
                          stroke={isLocked ? "#d97706" : (lockHovered ? "#94a3b8" : "transparent")}
                          strokeWidth={1}
                        />
                        {/* Lock body — rounded rect */}
                        <Rect
                          x={-4.5} y={-2}
                          width={9} height={7}
                          cornerRadius={1.5}
                          stroke={lockColor}
                          strokeWidth={1.4}
                          fill="transparent"
                        />
                        {/* Lock shackle — arc */}
                        <Line
                          points={isLocked
                            ? [-3, -2, -3, -5, 0, -7, 3, -5, 3, -2]
                            : [-3, -2, -3, -5, 0, -7, 3, -5, 3, -4]
                          }
                          stroke={lockColor}
                          strokeWidth={1.4}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.3}
                          closed={false}
                        />
                        {/* Keyhole dot */}
                        <Circle
                          x={0} y={1.5}
                          radius={1.2}
                          fill={lockColor}
                        />
                      </Group>
                    );
                  })()}

                  {/* Seat circles */}
                  {seatPositions.map((pos, idx) => {
                    const seatNum = idx + 1;
                    const key = `${table.id}-${seatNum}`;
                    const assignment = assignmentBySeat.get(key);
                    const attendee = assignment ? attendeeMap.get(assignment.attendee_id) : null;
                    const isOccupied = !!attendee;
                    const fillColor = attendee ? avatarColor(attendee.dietary_requirements) : "#e2e8f0";
                    const isDragOver = dragOverSeat === key && !isOccupied;

                    return (
                      <Group
                        key={seatNum}
                        x={pos.x} y={pos.y}
                        scaleX={isDragOver ? 1.35 : 1}
                        scaleY={isDragOver ? 1.35 : 1}
                        onMouseEnter={() => setHoveredSeat(key)}
                        onMouseLeave={() => { if (hoveredSeat === key) setHoveredSeat(null); }}
                        onClick={e => {
                          e.cancelBubble = true;
                        }}
                      >
                        <Rect
                          x={-22} y={-22}
                          width={44} height={44}
                          cornerRadius={6}
                          fill={isDragOver ? "#dbeafe" : fillColor}
                          stroke={isDragOver ? "#1b4fff" : isOccupied ? fillColor : "#cbd5e1"}
                          strokeWidth={isDragOver ? 2.5 : 1.5}
                          shadowColor={isOccupied ? fillColor : "transparent"}
                          shadowBlur={6}
                          shadowOpacity={0.4}
                          shadowOffsetY={2}
                        />
                        {/* Gradient highlight overlay */}
                        {isOccupied && (
                          <Rect
                            x={-22} y={-22}
                            width={44} height={22}
                            cornerRadius={[6, 6, 0, 0]}
                            fill="rgba(255,255,255,0.2)"
                          />
                        )}
                        <Group rotation={-rotationDeg}>
                          <Text
                            text={attendee ? firstNameShort(attendee.name) : String(seatNum)}
                            x={-22} y={-5} width={44} align="center"
                            fill={isOccupied ? "white" : "#94a3b8"}
                            fontSize={10}
                            fontStyle={isOccupied ? "bold" : "normal"}
                          />
                        </Group>
                        {showDetail && isOccupied && assignment && hoveredSeat === key && (
                          <Group
                            x={16} y={-20}
                            onClick={(e: KonvaEventObject<MouseEvent>) => {
                              e.cancelBubble = true;
                              onRemoveSeat(assignment.id);
                            }}
                          >
                            <Rect x={-7} y={-7} width={14} height={14} cornerRadius={7} fill="#e91e8f" stroke="white" strokeWidth={1.5} />
                            <Text
                              text="✕"
                              x={-7} y={-7}
                              width={14} height={14}
                              align="center"
                              verticalAlign="middle"
                              fill="white"
                              fontSize={9}
                              fontStyle="bold"
                            />
                          </Group>
                        )}
                      </Group>
                    );
                  })}
                  </Group>
                  {/* ^^ End of rotation inner group. Resize handles below stay
                       in the unrotated outer group so their drag math works. */}

                  {/* Resize handles — show on hover or selected, on the stroke edge */}
                  {showHandles && (() => {
                    const curW = resizing && resizing.id === table.id ? resizing.w : width;
                    const curH = resizing && resizing.id === table.id ? resizing.h : height;
                    const handles = table.shape === "round"
                      ? [
                          { id: "r", x: curW, y: curH / 2, axis: "x" as const },
                        ]
                      : [
                          { id: "r", x: curW, y: curH / 2, axis: "x" as const },
                          { id: "b", x: curW / 2, y: curH, axis: "y" as const },
                        ];
                    return handles.map(h => (
                      <Circle
                        key={h.id}
                        x={h.x} y={h.y}
                        radius={6}
                        fill="white" stroke="#1b4fff" strokeWidth={2}
                        draggable
                        onMouseEnter={(e) => {
                          const stage = e.target.getStage();
                          if (stage) stage.container().style.cursor = h.axis === "x" ? "ew-resize" : "ns-resize";
                        }}
                        onMouseLeave={(e) => {
                          const stage = e.target.getStage();
                          if (stage) stage.container().style.cursor = "default";
                        }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                          // Disable parent group drag
                          const parent = e.target.getParent();
                          if (parent) parent.draggable(false);
                          setResizing({ id: table.id, w: width, h: height });
                        }}
                        onDragMove={e => {
                          e.cancelBubble = true;
                          // Handle position is in parent (Group) coords
                          const localX = e.target.x();
                          const localY = e.target.y();
                          const newW = h.axis === "x" ? localX : (resizing?.w ?? width);
                          const newH = h.axis === "y" ? localY : (resizing?.h ?? height);
                          const w = Math.max(60, newW);
                          const hh = table.shape === "round" ? w : Math.max(40, newH);
                          setResizing({ id: table.id, w, h: hh });
                        }}
                        onDragEnd={e => {
                          e.cancelBubble = true;
                          // Re-enable parent group drag
                          const parent = e.target.getParent();
                          if (parent) parent.draggable(true);
                          if (resizing && onTableResize) {
                            const cap = capacityFromDims(table.shape, resizing.w, resizing.h);
                            onTableResize(table.id, resizing.w, resizing.h, cap);
                          }
                          // Reset handle to new edge position
                          e.target.x(h.axis === "x" ? (resizing?.w ?? width) : (resizing?.w ?? width) / 2);
                          e.target.y(h.axis === "y" ? (resizing?.h ?? height) : (resizing?.h ?? height) / 2);
                          setResizing(null);
                        }}
                        onClick={e => e.cancelBubble = true}
                      />
                    ));
                  })()}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {/* Mobile floating toggle — shows count of unassigned attendees */}
      <button
        type="button"
        className="sb-mobile-fab"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Show attendees"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span className="sb-mobile-fab-label">Attendees</span>
        {unseatedAttendees.length > 0 && (
          <span className="sb-mobile-fab-badge">{unseatedAttendees.length}</span>
        )}
      </button>

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className={`sb-sidebar ${mobileSidebarOpen ? "sb-sidebar-mobile-open" : ""}`}
        style={sidebarPos ? {
          position: "absolute",
          left: sidebarPos.x,
          top: sidebarPos.y,
          zIndex: 20,
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
          maxHeight: "96%",
        } : {}}
      >
        <button
          type="button"
          className="sb-sidebar-mobile-close"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Hide attendees"
        >
          ✕
        </button>
        <div
          className="sb-sidebar-handle"
          onMouseDown={handleSidebarHandleMouseDown}
          onTouchStart={handleSidebarHandleTouchStart}
        >
          <span className="sb-sidebar-handle-dots">⠿</span>
        </div>
        {selectedTable && !drawMode ? (
          <div className="sb-table-detail">
            <div className="sb-table-detail-header">
              <button className="sb-back-btn" onClick={() => onSelectTable(null)}>← All Attendees</button>
              {editingTableName === selectedTable.id ? (
                <input
                  className="sb-table-name-input"
                  value={editNameValue}
                  onChange={e => setEditNameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (editNameValue.trim() && onRenameTable) {
                        onRenameTable(selectedTable.id, editNameValue.trim());
                      }
                      setEditingTableName(null);
                    } else if (e.key === "Escape") {
                      setEditingTableName(null);
                    }
                  }}
                  onBlur={() => {
                    if (editNameValue.trim() && onRenameTable) {
                      onRenameTable(selectedTable.id, editNameValue.trim());
                    }
                    setEditingTableName(null);
                  }}
                  autoFocus
                />
              ) : (
                <div
                  className="sb-table-detail-title sb-table-detail-title-editable"
                  onClick={() => { setEditingTableName(selectedTable.id); setEditNameValue(selectedTable.name); }}
                  title="Click to rename"
                >
                  {selectedTable.name}
                  <svg className="sb-edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </div>
              )}
              <div className="sb-table-detail-count">
                {seatAssignments.filter(sa => sa.table_id === selectedTable.id).length}/{selectedTable.capacity} seats
              </div>
            </div>
            <div className="sb-seat-list">
              {(() => {
                const { width, height } = effectiveDims(selectedTable);
                return getSeatPositions(selectedTable.shape, width, height, selectedTable.capacity).map((_, idx) => {
                  const seatNum = idx + 1;
                  const key = `${selectedTable.id}-${seatNum}`;
                  const assignment = assignmentBySeat.get(key);
                  const attendee = assignment ? attendeeMap.get(assignment.attendee_id) : null;
                  const isOver = dragOverSeat === key;

                  return (
                    <div
                      key={seatNum}
                      className={`sb-seat-row ${attendee ? "sb-seat-occupied" : "sb-seat-empty"} ${isOver ? "sb-seat-dragover" : ""}`}
                      onDragOver={e => { if (!attendee) { e.preventDefault(); setDragOverSeat(key); } }}
                      onDragLeave={() => setDragOverSeat(null)}
                      onDrop={e => handleSeatDrop(e, selectedTable.id, seatNum)}
                    >
                      <div className="sb-seat-num">{seatNum}</div>
                      {attendee ? (
                        <>
                          <div className="sb-guest-avatar" style={{ background: avatarColor(attendee.dietary_requirements) }}>
                            {getInitials(attendee.name)}
                          </div>
                          <div className="sb-seat-info">
                            <div className="sb-seat-name">{attendee.name}</div>
                            {attendee.dietary_requirements && (
                              <div className="sb-seat-diet">{dietaryEmoji(attendee)} {attendee.dietary_requirements}</div>
                            )}
                          </div>
                          <button className="sb-unseat-btn" onClick={() => onRemoveSeat(assignment!.id)}>✕</button>
                        </>
                      ) : (
                        <div className="sb-empty-seat-label">Drop guest here</div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            <div className="sb-quick-guests">
              <div className="sb-quick-guests-title">Unassigned Attendees</div>
              {unseatedAttendees.length === 0 ? (
                <div className="sb-quick-empty">All attendees are seated</div>
              ) : (
                unseatedAttendees.map(a => (
                  <div
                    key={a.id}
                    className="sb-quick-guest-row"
                    draggable
                    onDragStart={e => e.dataTransfer.setData("attendeeId", String(a.id))}
                  >
                    <div className="sb-guest-avatar" style={{ background: avatarColor(a.dietary_requirements), width: 26, height: 26, fontSize: "0.65rem" }}>
                      {getInitials(a.name)}
                    </div>
                    <span className="sb-quick-guest-name">{a.name}</span>
                    {a.dietary_requirements && (
                      <span className="sb-quick-diet-icon" title={a.dietary_requirements}>
                        {dietaryEmoji(a)}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="sb-sidebar-header">
              <span className="sb-sidebar-title">ATTENDEES</span>
              <span className="sb-sidebar-count">{attendees.length}</span>
            </div>
            <div className="sb-search-wrap">
              <input
                className="sb-search"
                placeholder="Search attendees"
                value={sidebarSearch}
                onChange={e => setSidebarSearch(e.target.value)}
              />
            </div>
            <div className="sb-guest-list">
              {filteredUnseated.length > 0 && (
                <div className="sb-section-label">Unassigned ({unseatedAttendees.length})</div>
              )}
              {filteredUnseated.map(attendee => (
                <div
                  key={attendee.id}
                  className="sb-guest-row"
                  draggable
                  onDragStart={e => e.dataTransfer.setData("attendeeId", String(attendee.id))}
                >
                  <div className="sb-guest-avatar" style={{ background: avatarColor(attendee.dietary_requirements) }}>
                    {getInitials(attendee.name)}
                  </div>
                  <div className="sb-guest-info">
                    <div className="sb-guest-name">{attendee.name}</div>
                    {attendee.dietary_requirements && (
                      <div className="sb-guest-seat" style={{ color: dietaryColor(attendee) ?? undefined }}>
                        {dietaryEmoji(attendee)} {attendee.dietary_requirements}
                      </div>
                    )}
                  </div>
                  <span className="sb-drag-handle">⠿</span>
                </div>
              ))}

              {filteredSeated.length > 0 && (
                <div className="sb-section-label" style={{ marginTop: 8 }}>
                  Seated ({seatAssignments.length})
                </div>
              )}
              {filteredSeated.map(attendee => {
                const assignment = assignmentByAttendee.get(attendee.id);
                const table = assignment ? tableMap.get(assignment.table_id) : null;
                return (
                  <div
                    key={attendee.id}
                    className="sb-guest-row sb-guest-seated"
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData("attendeeId", String(attendee.id));
                      if (assignment) onRemoveSeat(assignment.id);
                    }}
                  >
                    <div className="sb-guest-avatar" style={{ background: avatarColor(attendee.dietary_requirements) }}>
                      {getInitials(attendee.name)}
                    </div>
                    <div className="sb-guest-info">
                      <div className="sb-guest-name">{attendee.name}</div>
                      {assignment && table && (
                        <div className="sb-guest-seat">
                          <span className="sb-seat-tag">{table.name} · Seat {assignment.seat_number}</span>
                        </div>
                      )}
                    </div>
                    {assignment && (
                      <button className="sb-unseat-btn" onClick={() => onRemoveSeat(assignment.id)}>✕</button>
                    )}
                  </div>
                );
              })}

              {filteredUnseated.length === 0 && filteredSeated.length === 0 && (
                <div style={{ padding: "20px 14px", color: "#94a3b8", fontSize: "0.83rem" }}>
                  No attendees found.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
