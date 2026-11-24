import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { useDirectorStore } from "../store/directorStore";

type InspectorTab = {
  label: string;
  active: boolean;
  onClick: () => void;
};

type FieldValue = string | number;

type AxisControl = {
  axis: "X" | "Y" | "Z";
  ariaLabel: string;
  value: FieldValue;
  onChange: (value: string) => void;
  step?: string;
  min?: string;
  max?: string;
};

type TextFieldProps = {
  label: string;
  ariaLabel: string;
  value: FieldValue;
  onChange: (value: string) => void;
  type?: "text" | "number";
  step?: string;
  min?: string;
  max?: string;
};

type RangeNumberFieldProps = {
  label: string;
  rangeAriaLabel: string;
  numberAriaLabel: string;
  value: FieldValue;
  onValueChange: (value: string) => void;
  onRangeChange?: (value: string) => void;
  onNumberChange?: (value: string) => void;
  onNumberBlur?: (value: string) => void;
  min: string | number;
  max: string | number;
  step: string | number;
};

type InspectorSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type OptionElementProps = {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
};

const AXIS_DRAG_PIXELS_PER_STEP = 10;

function parseFiniteNumber(value: FieldValue | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStep(step: string | undefined) {
  const parsed = parseFiniteNumber(step);
  return parsed && parsed > 0 ? parsed : 1;
}

function decimalPlaces(value: FieldValue | undefined) {
  const stringValue = String(value ?? "");
  const decimal = stringValue.match(/\.(\d+)/);
  return decimal ? decimal[1].length : 0;
}

function clampValue(value: number, min?: string, max?: string) {
  const parsedMin = parseFiniteNumber(min);
  const parsedMax = parseFiniteNumber(max);
  const lowerBounded = parsedMin === null ? value : Math.max(parsedMin, value);
  return parsedMax === null ? lowerBounded : Math.min(parsedMax, lowerBounded);
}

function formatDraggedValue(value: number, precision: number) {
  return Number(value.toFixed(Math.min(precision, 6))).toString();
}

function stringifyOptionLabel(children: ReactNode) {
  return Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("")
    .trim();
}

function parseSelectOptions(children: ReactNode): InspectorSelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionElementProps>(child)) return [];

    const optionValue = child.props.value;
    if (optionValue === undefined || optionValue === null) return [];

    return [
      {
        value: String(optionValue),
        label: stringifyOptionLabel(child.props.children) || String(optionValue),
        disabled: child.props.disabled,
      },
    ];
  });
}

function useUndoBatchInteraction() {
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);
  const isBatchActiveRef = useRef(false);

  const beginInteraction = useCallback(() => {
    if (isBatchActiveRef.current) return;

    isBatchActiveRef.current = true;
    beginUndoBatch();
  }, [beginUndoBatch]);

  const endInteraction = useCallback(() => {
    if (!isBatchActiveRef.current) return;

    isBatchActiveRef.current = false;
    endUndoBatch();
  }, [endUndoBatch]);

  useEffect(() => endInteraction, [endInteraction]);

  return { beginInteraction, endInteraction };
}

export function InspectorPanel({
  title,
  ariaLabel,
  tabs,
  className,
  children,
  footer,
}: {
  title: string;
  ariaLabel: string;
  tabs?: InspectorTab[];
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={`panel-card right-inspector${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
      <header className="right-inspector-header">
        <h2 className="right-inspector-title">{title}</h2>
      </header>
      {tabs ? (
        <div className="tab-row right-inspector-tabs" role="tablist" aria-label={`${title}面板标签`}>
          {tabs.map((tab) => (
            <button
              key={tab.label}
              className="right-inspector-tab-button"
              type="button"
              aria-pressed={tab.active}
              onClick={tab.onClick}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`right-inspector-content ${tabs ? "" : "right-inspector-content-no-tabs"}`}>{children}</div>
      {footer}
    </section>
  );
}

export function InspectorTextField({
  label,
  ariaLabel,
  value,
  onChange,
  type = "text",
  step,
  min,
  max,
}: TextFieldProps) {
  const { beginInteraction, endInteraction } = useUndoBatchInteraction();

  return (
    <label className="inspector-field">
      <span className="inspector-field-label">{label}</span>
      <input
        aria-label={ariaLabel}
        className="inspector-text-input"
        max={max}
        min={min}
        step={step}
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={endInteraction}
        onFocus={beginInteraction}
      />
    </label>
  );
}

export function InspectorSelectField({
  label,
  ariaLabel,
  value,
  onChange,
  children,
  options,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
  options?: InspectorSelectOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const resolvedOptions = options ?? parseSelectOptions(children);
  const selectedOption = resolvedOptions.find((option) => option.value === value) ?? resolvedOptions[0];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (!dropdownRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function selectOption(option: InspectorSelectOption) {
    if (option.disabled) return;

    onChange(option.value);
    setIsOpen(false);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen(true);
    }
  }

  return (
    <div className="inspector-field inspector-select-field">
      <span className="inspector-field-label">{label}</span>
      <div className="inspector-dropdown" ref={dropdownRef}>
        <button
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className="inspector-dropdown-trigger"
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="inspector-dropdown-value">{selectedOption?.label ?? "请选择"}</span>
          <ChevronDown aria-hidden="true" className="inspector-dropdown-chevron" strokeWidth={1.8} />
        </button>
        {isOpen ? (
          <div aria-label={ariaLabel} className="inspector-dropdown-menu" role="listbox">
            {resolvedOptions.map((option) => {
              const isSelected = option.value === value;

              return (
                <button
                  aria-selected={isSelected}
                  className={`inspector-dropdown-option${isSelected ? " is-selected" : ""}`}
                  disabled={option.disabled}
                  key={option.value}
                  role="option"
                  type="button"
                  onClick={() => selectOption(option)}
                >
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function InspectorAxisGroup({ label, axes }: { label: string; axes: AxisControl[] }) {
  return (
    <div className="inspector-field inspector-axis-group" role="group" aria-label={label}>
      <span className="inspector-field-label">{label}</span>
      <div className="inspector-axis-row">
        {axes.map((control) => (
          <InspectorAxisInput key={control.ariaLabel} control={control} />
        ))}
      </div>
    </div>
  );
}

function InspectorAxisInput({ control }: { control: AxisControl }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const { beginInteraction, endInteraction } = useUndoBatchInteraction();

  useEffect(() => () => cleanupDragRef.current?.(), []);

  function applyDeltaFromValue(deltaSteps: number, value: FieldValue) {
    const step = parseStep(control.step);
    const startValue = parseFiniteNumber(value) ?? 0;
    const precision = Math.max(decimalPlaces(control.step), decimalPlaces(value));
    const nextValue = clampValue(startValue + deltaSteps * step, control.min, control.max);
    control.onChange(formatDraggedValue(nextValue, precision));
  }

  function handlePrefixMouseDown(event: MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;

    event.currentTarget.focus();
    event.preventDefault();
    event.stopPropagation();
    cleanupDragRef.current?.();
    beginInteraction();
    setIsDragging(true);

    const startX = event.clientX;
    const startValue = parseFiniteNumber(control.value) ?? 0;
    const step = parseStep(control.step);
    const precision = Math.max(decimalPlaces(control.step), decimalPlaces(control.value));
    let previousValue = formatDraggedValue(startValue, precision);

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      moveEvent.preventDefault();
      const deltaSteps = Math.round((moveEvent.clientX - startX) / AXIS_DRAG_PIXELS_PER_STEP);
      const nextValue = clampValue(startValue + deltaSteps * step, control.min, control.max);
      const formattedValue = formatDraggedValue(nextValue, precision);

      if (formattedValue !== previousValue) {
        previousValue = formattedValue;
        control.onChange(formattedValue);
      }
    };

    const stopDrag = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDrag);
      cleanupDragRef.current = null;
      setIsDragging(false);
      endInteraction();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDrag);
    cleanupDragRef.current = stopDrag;
  }

  function handlePrefixKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyDeltaFromValue(1, control.value);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      applyDeltaFromValue(-1, control.value);
    }
  }

  return (
    <div className={`inspector-axis-input${isDragging ? " is-dragging" : ""}`}>
      <button
        aria-label={`${control.ariaLabel} 拖动调整`}
        className="inspector-axis-prefix"
        type="button"
        onKeyDown={handlePrefixKeyDown}
        onMouseDown={handlePrefixMouseDown}
      >
        {control.axis}
      </button>
      <input
        aria-label={control.ariaLabel}
        className="inspector-axis-value"
        max={control.max}
        min={control.min}
        step={control.step}
        type="number"
        title={String(control.value)}
        value={draft ?? (typeof control.value === "number" ? Number(control.value.toFixed(2)) : control.value)}
        onChange={event => {
          setDraft(event.currentTarget.value);
          if (Number.isFinite(event.currentTarget.valueAsNumber)) control.onChange(event.currentTarget.value);
        }}
        onBlur={() => { setDraft(null); endInteraction(); }}
        onFocus={() => { setDraft(String(control.value)); beginInteraction(); }}
      />
    </div>
  );
}

export function InspectorRangeNumberField({
  label,
  rangeAriaLabel,
  numberAriaLabel,
  value,
  onValueChange,
  onRangeChange,
  onNumberChange,
  onNumberBlur,
  min,
  max,
  step,
}: RangeNumberFieldProps) {
  const rangeDragCleanupRef = useRef<(() => void) | null>(null);
  const { beginInteraction, endInteraction } = useUndoBatchInteraction();

  useEffect(() => () => rangeDragCleanupRef.current?.(), []);

  function stopRangeDrag() {
    window.removeEventListener("pointerup", stopRangeDrag);
    window.removeEventListener("pointercancel", stopRangeDrag);
    rangeDragCleanupRef.current = null;
    endInteraction();
  }

  function beginRangeDrag() {
    rangeDragCleanupRef.current?.();
    beginInteraction();
    window.addEventListener("pointerup", stopRangeDrag);
    window.addEventListener("pointercancel", stopRangeDrag);
    rangeDragCleanupRef.current = stopRangeDrag;
  }

  return (
    <div className="inspector-field inspector-range-field">
      <span className="inspector-field-label">{label}</span>
      <div className="inspector-range-row">
        <input
          aria-label={rangeAriaLabel}
          className="inspector-range"
          max={max}
          min={min}
          step={step}
          type="range"
          value={value}
          onChange={(event) => (onRangeChange ?? onValueChange)(event.currentTarget.value)}
          onPointerCancel={stopRangeDrag}
          onPointerDown={beginRangeDrag}
          onPointerUp={stopRangeDrag}
        />
        <input
          aria-label={numberAriaLabel}
          className="inspector-text-input inspector-range-value"
          max={max}
          min={min}
          step={step}
          type="number"
          value={value}
          onBlur={(event) => {
            onNumberBlur?.(event.currentTarget.value);
            endInteraction();
          }}
          onChange={(event) => (onNumberChange ?? onValueChange)(event.currentTarget.value)}
          onFocus={beginInteraction}
        />
      </div>
    </div>
  );
}

export function InspectorColorField({
  label,
  colorAriaLabel,
  hexAriaLabel,
  value,
  onColorChange,
  onHexChange,
}: {
  label: string;
  colorAriaLabel: string;
  hexAriaLabel: string;
  value: string;
  onColorChange: (value: string) => void;
  onHexChange: (value: string) => void;
}) {
  const { beginInteraction, endInteraction } = useUndoBatchInteraction();

  return (
    <label className="inspector-field">
      <span className="inspector-field-label">{label}</span>
      <div className="inspector-color-row">
        <input
          aria-label={colorAriaLabel}
          className="inspector-color-swatch"
          type="color"
          value={value}
          onChange={(event) => onColorChange(event.currentTarget.value)}
          onBlur={endInteraction}
          onFocus={beginInteraction}
        />
        <input
          aria-label={hexAriaLabel}
          className="inspector-text-input inspector-color-hex"
          value={value}
          onChange={(event) => onHexChange(event.currentTarget.value)}
          onBlur={endInteraction}
          onFocus={beginInteraction}
        />
      </div>
    </label>
  );
}

export function InspectorSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`inspector-section${className ? ` ${className}` : ""}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
