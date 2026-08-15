import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export interface CustomSelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface CustomSelectGroup {
  label: ReactNode
  options: CustomSelectOption[]
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options?: CustomSelectOption[]
  groups?: CustomSelectGroup[]
  placeholder?: ReactNode
  title?: string
  ariaLabel?: string
  disabled?: boolean
  style?: CSSProperties
  className?: string
}

/** Shared dropdown surface for the workbench. Keeps selection semantics while avoiding native browser chrome. */
export function CustomSelect({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = '请选择',
  title,
  ariaLabel,
  disabled = false,
  style,
  className = ''
}: CustomSelectProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState(value)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>()
  const menuId = useId()

  const allOptions = [
    ...options,
    ...groups.flatMap((group) => group.options)
  ]
  const selected = allOptions.find((option) => option.value === value)

  const updateMenuPosition = (): void => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, Math.min(320, openUp ? spaceAbove : spaceBelow))
    setMenuStyle({
      left: rect.left,
      top: openUp ? Math.max(8, rect.top - maxHeight) : rect.bottom + 4,
      width: rect.width,
      maxHeight
    })
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onViewportChange = (): void => updateMenuPosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])

  const enabledOptions = allOptions.filter((option) => !option.disabled)
  const activeIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === activeValue))

  const openMenu = (): void => {
    if (disabled) return
    setActiveValue(value)
    updateMenuPosition()
    setOpen(true)
  }

  const choose = (nextValue: string): void => {
    const option = allOptions.find((item) => item.value === nextValue)
    if (!option || option.disabled) return
    onChange(nextValue)
    setActiveValue(nextValue)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeValue)
      else openMenu()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (!open) {
      openMenu()
      return
    }
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabledOptions.length - 1
        : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + enabledOptions.length) % enabledOptions.length
    const next = enabledOptions[nextIndex]
    if (next) setActiveValue(next.value)
  }

  const renderOption = (option: CustomSelectOption, index: number): JSX.Element => {
    const selectedOption = option.value === value
    const activeOption = option.value === activeValue
    return (
      <button
        key={`${option.value}-${index}`}
        id={`${menuId}-option-${index}`}
        type="button"
        className={`custom-select-option${activeOption ? ' active' : ''}`}
        role="option"
        aria-selected={selectedOption}
        disabled={option.disabled}
        onMouseEnter={() => setActiveValue(option.value)}
        onClick={() => choose(option.value)}
      >
        <span className="custom-select-option-mark" aria-hidden="true">{selectedOption ? '✓' : ''}</span>
        <span>{option.label}</span>
      </button>
    )
  }

  let optionIndex = 0
  const menu = open && menuStyle ? createPortal(
    <div
      ref={menuRef}
      id={menuId}
      className="custom-select-menu"
      role="listbox"
      aria-label={ariaLabel || title}
      style={menuStyle}
    >
      {options.map((option) => renderOption(option, optionIndex++))}
      {groups.map((group, groupIndex) => (
        <div className="custom-select-group" key={`group-${groupIndex}`}>
          <div className="custom-select-group-label">{group.label}</div>
          {group.options.map((option) => renderOption(option, optionIndex++))}
        </div>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <div ref={rootRef} className={`custom-select ${className}`} style={style}>
      <button
        ref={triggerRef}
        type="button"
        className={`custom-select-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="custom-select-value">{selected?.label ?? placeholder}</span>
        <span className="custom-select-chevron" aria-hidden="true">▾</span>
      </button>
      {menu}
    </div>
  )
}
