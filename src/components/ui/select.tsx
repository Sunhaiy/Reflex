import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import * as React from "react"
import { createPortal } from "react-dom"
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react"
import { cn } from "@/lib/utils"

export interface SelectOption {
    label: string
    value: string
    icon?: React.ReactNode
}

interface SelectProps {
    value: string
    onChange: (value: string) => void
    options: SelectOption[]
    placeholder?: string
    className?: string
    disabled?: boolean
    searchable?: boolean
    searchPlaceholder?: string
    emptyText?: string
}

export function Select({
    value,
    onChange,
    options,
    placeholder = "Select...",
    className,
    disabled,
    searchable = false,
    searchPlaceholder = "Search...",
    emptyText = "No matches",
}: SelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const [query, setQuery] = useState("")
    const containerRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
    const [openAbove, setOpenAbove] = useState(false)

    const selectedOption = options.find(o => o.value === value)
    const filteredOptions = searchable && query.trim()
        ? options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        : options

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return
        const handleClick = (e: MouseEvent) => {
            const target = e.target as Node
            if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [isOpen])

    const updateMenuPosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return

        const viewportGap = 12
        const menuGap = 8
        const availableBelow = window.innerHeight - rect.bottom - viewportGap - menuGap
        const availableAbove = rect.top - viewportGap - menuGap
        const openAbove = availableBelow < 180 && availableAbove > availableBelow
        const maxHeight = Math.max(140, Math.min(260, openAbove ? availableAbove : availableBelow))
        const width = Math.min(rect.width, window.innerWidth - viewportGap * 2)
        const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap)

        setOpenAbove(openAbove)
        setMenuStyle(openAbove
            ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + menuGap }
            : { left, width, maxHeight, top: rect.bottom + menuGap })
    }, [])

    useLayoutEffect(() => {
        if (!isOpen) return
        updateMenuPosition()
        window.addEventListener("resize", updateMenuPosition)
        window.addEventListener("scroll", updateMenuPosition, true)
        return () => {
            window.removeEventListener("resize", updateMenuPosition)
            window.removeEventListener("scroll", updateMenuPosition, true)
        }
    }, [isOpen, updateMenuPosition])

    // Scroll highlighted item into view
    useEffect(() => {
        if (!isOpen || highlightedIndex < 0 || !listRef.current) return
        const item = listRef.current.children[highlightedIndex] as HTMLElement
        if (item) item.scrollIntoView({ block: "nearest" })
    }, [highlightedIndex, isOpen])

    // Reset highlight when opening
    useEffect(() => {
        if (isOpen) {
            setQuery("")
            const idx = filteredOptions.findIndex(o => o.value === value)
            setHighlightedIndex(idx >= 0 ? idx : filteredOptions.length > 0 ? 0 : -1)
        }
    // Filtering updates highlightedIndex from the input handler; including the derived
    // list here would reset the query every time a character is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, value])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (disabled) return

        switch (e.key) {
            case "Enter":
            case " ":
                e.preventDefault()
                if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
                    onChange(filteredOptions[highlightedIndex].value)
                    setIsOpen(false)
                } else {
                    setIsOpen(true)
                }
                break
            case "ArrowDown":
                e.preventDefault()
                if (!isOpen) {
                    setIsOpen(true)
                } else {
                    setHighlightedIndex(i => Math.min(i + 1, filteredOptions.length - 1))
                }
                break
            case "ArrowUp":
                e.preventDefault()
                if (isOpen) {
                    setHighlightedIndex(i => Math.max(i - 1, 0))
                }
                break
            case "Escape":
                e.preventDefault()
                setIsOpen(false)
                break
            case "Tab":
                setIsOpen(false)
                break
        }
    }, [disabled, isOpen, highlightedIndex, filteredOptions, onChange])

    return (
        <div ref={containerRef} className={cn("relative", className)}>
            {/* Trigger */}
            <button
                ref={triggerRef}
                type="button"
                role="combobox"
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                disabled={disabled}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                onKeyDown={handleKeyDown}
                className={cn(
                    "flex h-11 w-full items-center justify-between rounded-xl border border-input bg-background/48 px-3.5 py-2 text-sm transition-all",
                    "hover:border-foreground/20 hover:bg-background/68",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    isOpen && "ring-1 ring-ring border-ring"
                )}
            >
                <span className="flex min-w-0 items-center gap-2.5">
                    {selectedOption?.icon}
                    <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
                        {selectedOption?.label || placeholder}
                    </span>
                </span>
                <HugeiconsIcon icon={ArrowDown01Icon} className={cn(
                                    "ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                                    isOpen && "rotate-180"
                                )} />
            </button>

            {/* Dropdown */}
            {isOpen && createPortal(
                <div
                    ref={menuRef}
                    className={cn(
                        "glass-panel fixed z-[100] flex min-w-[8rem] flex-col overflow-hidden rounded-2xl border-border/80 bg-popover/95 backdrop-blur-2xl",
                        "animate-in fade-in-0 zoom-in-95 duration-150 ease-out",
                        // Grow away from the trigger, so the menu reads as unfolding from it.
                        openAbove
                            ? "origin-bottom slide-in-from-bottom-2"
                            : "origin-top slide-in-from-top-2",
                    )}
                    style={menuStyle}
                >
                    {searchable && (
                        <div className="shrink-0 border-b border-border/55 p-2">
                            <input
                                autoFocus
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value)
                                    setHighlightedIndex(0)
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault()
                                        setIsOpen(false)
                                    } else if (event.key === 'ArrowDown') {
                                        event.preventDefault()
                                        setHighlightedIndex(index => Math.min(index + 1, filteredOptions.length - 1))
                                    } else if (event.key === 'ArrowUp') {
                                        event.preventDefault()
                                        setHighlightedIndex(index => Math.max(index - 1, 0))
                                    } else if (event.key === 'Enter' && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
                                        event.preventDefault()
                                        onChange(filteredOptions[highlightedIndex].value)
                                        setIsOpen(false)
                                    }
                                }}
                                placeholder={searchPlaceholder}
                                className="h-8 w-full rounded-lg border border-input/70 bg-background/60 px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                            />
                        </div>
                    )}
                    <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
                        {filteredOptions.length === 0 && (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyText}</div>
                        )}
                        {filteredOptions.map((option, index) => {
                            const isSelected = option.value === value
                            const isHighlighted = index === highlightedIndex

                            return (
                                <div
                                    key={option.value}
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => {
                                        onChange(option.value)
                                        setIsOpen(false)
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                    className={cn(
                                        "relative flex cursor-pointer items-center rounded-xl px-3 py-2.5 text-sm transition-colors",
                                        "select-none outline-none",
                                        isHighlighted && "bg-accent text-accent-foreground",
                                        isSelected && !isHighlighted && "text-primary",
                                        !isHighlighted && !isSelected && "text-foreground"
                                    )}
                                >
                                    {option.icon}
                                    <span className={cn("flex-1 truncate", option.icon && "ml-2.5")}>{option.label}</span>
                                    {isSelected && (
                                        <HugeiconsIcon icon={Tick01Icon} className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            , document.body)}
        </div>
    )
}
