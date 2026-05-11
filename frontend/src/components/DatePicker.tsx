import { useEffect, useRef, useState } from "react";

interface DatePickerProps {
  value: string;                       // ISO date string YYYY-MM-DD or ""
  onChange: (next: string) => void;
  open: boolean;                       // controlled by the parent
  onOpen: () => void;
  onClose: () => void;
  onPick?: (next: string) => void;     // fired on a successful pick — parent uses this to chain pickers
  minDate?: string;                    // YYYY-MM-DD; days before this are disabled
  placeholder?: string;
  label?: string;                      // for aria-label / fallback display
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDisplay(s: string): string {
  const d = parseYmd(s);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }

function buildMonthDays(viewMonth: Date): { date: Date; inMonth: boolean }[] {
  const first = startOfMonth(viewMonth);
  // Start from the Sunday on or before the 1st
  const lead = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  // 6 rows × 7 cols = 42 cells
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: d, inMonth: d.getMonth() === viewMonth.getMonth() };
  });
}

export default function DatePicker({
  value,
  onChange,
  open,
  onOpen,
  onClose,
  onPick,
  minDate,
  placeholder = "Select a date",
  label,
}: DatePickerProps) {
  const initial = parseYmd(value) ?? parseYmd(minDate ?? "") ?? new Date();
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(initial));
  const [slideDir, setSlideDir] = useState<"up" | "down" | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wheelLockRef = useRef(false);
  const minDateObj = parseYmd(minDate ?? "");
  const selectedObj = parseYmd(value);

  // When opening, snap the visible month to the selected date (or min date)
  useEffect(() => {
    if (open) {
      const target = parseYmd(value) ?? parseYmd(minDate ?? "") ?? new Date();
      setViewMonth(startOfMonth(target));
    }
  }, [open, value, minDate]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = popoverRef.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    // Defer one tick so the same click that opened us doesn't immediately close us
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  // Esc to close, ArrowLeft/Right to nudge month
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft")  shiftMonth(-1);
      else if (e.key === "ArrowRight") shiftMonth(+1);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function shiftMonth(delta: number) {
    setSlideDir(delta > 0 ? "up" : "down");
    setViewMonth(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      return d;
    });
  }

  function handleWheel(e: React.WheelEvent) {
    if (wheelLockRef.current) return;
    if (Math.abs(e.deltaY) < 8) return;
    wheelLockRef.current = true;
    shiftMonth(e.deltaY > 0 ? +1 : -1);
    setTimeout(() => { wheelLockRef.current = false; }, 350);
  }

  function pickDate(d: Date) {
    if (minDateObj && d < minDateObj) return;
    const s = ymd(d);
    onChange(s);
    onClose();
    onPick?.(s);
  }

  const days = buildMonthDays(viewMonth);
  const todayYmd = ymd(new Date());

  return (
    <div className="dp-wrap">
      <button
        type="button"
        className={`dp-trigger ${open ? "dp-trigger-open" : ""}`}
        onClick={() => (open ? onClose() : onOpen())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ?? placeholder}
      >
        <span className={value ? "dp-trigger-value" : "dp-trigger-placeholder"}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {open && (
        <div ref={popoverRef} className="dp-popover" onWheel={handleWheel} role="dialog">
          <div className="dp-header">
            <button
              type="button"
              className="dp-nav"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >‹</button>
            <div
              key={`${viewMonth.getFullYear()}-${viewMonth.getMonth()}`}
              className={`dp-month-label ${slideDir ? `dp-slide-${slideDir}` : ""}`}
              onAnimationEnd={() => setSlideDir(null)}
            >
              {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </div>
            <button
              type="button"
              className="dp-nav"
              onClick={() => shiftMonth(+1)}
              aria-label="Next month"
            >›</button>
          </div>

          <div className="dp-weekdays">
            {WEEKDAYS.map((w, i) => <span key={i} className="dp-weekday">{w}</span>)}
          </div>

          <div
            key={`grid-${viewMonth.getFullYear()}-${viewMonth.getMonth()}`}
            className={`dp-grid ${slideDir ? `dp-slide-${slideDir}` : ""}`}
          >
            {days.map(({ date, inMonth }, i) => {
              const dYmd = ymd(date);
              const isSelected = selectedObj && ymd(selectedObj) === dYmd;
              const isToday = dYmd === todayYmd;
              const isDisabled = !!minDateObj && date < minDateObj;
              return (
                <button
                  key={i}
                  type="button"
                  className={[
                    "dp-day",
                    inMonth ? "" : "dp-day-out",
                    isSelected ? "dp-day-selected" : "",
                    isToday ? "dp-day-today" : "",
                    isDisabled ? "dp-day-disabled" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => pickDate(date)}
                  disabled={isDisabled}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={!!isSelected}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="dp-hint">Scroll to change month</div>
        </div>
      )}
    </div>
  );
}
