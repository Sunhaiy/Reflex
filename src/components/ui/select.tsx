import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import * as React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"

export interface SelectOption {
    label: string
    value: string
}

interface SelectProps {
    value: string
    onChange: (value: string) => void
    options: SelectOption[]
    placeholder?: string
    className?: string
    disabled?: boolean
}

export function Select({ value, onChange, options, placeholder = "Select...", className, disabled }: SelectProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const containerRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    const selectedOption = options.find(o => o.value === value)

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [isOpen])

    // Scroll highlighted item into view
    useEffect(() => {
        if (!isOpen || highlightedIndex < 0 || !listRef.current) return
        const item = listRef.current.children[highlightedIndex] as HTMLElement
        if (item) item.scrollIntoView({ block: "nearest" })
    }, [highlightedIndex, isOpen])

    // Reset highlight when opening
    useEffect(() => {
        if (isOpen) {
            const idx = options.findIndex(o => o.value === value)
            setHighlightedIndex(idx >= 0 ? idx : 0)
        }
    }, [isOpen, options, value])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (disabled) return

        switch (e.key) {
            case "Enter":
            case " ":
                e.preventDefault()
                if (isOpen && highlightedIndex >= 0) {
                    onChange(options[highlightedIndex].value)
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
                    setHighlightedIndex(i => Math.min(i + 1, options.length - 1))
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
    }, [disabled, isOpen, highlightedIndex, options, onChange])

    return (
        <div ref={containerRef} className={cn("relative", className)}>
            {/* Trigger */}
            <button
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
                <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
                    {selectedOption?.label || placeholder}
                </span>
                <HugeiconsIcon icon={ArrowDown01Icon} className={cn(
                                    "ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                                    isOpen && "rotate-180"
                                )} />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div
                    className={cn(
                        "glass-panel absolute z-50 mt-2 w-full min-w-[8rem] overflow-hidden rounded-2xl shadow-xl",
                        "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
                    )}
                >
                    <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto p-1">
                        {options.map((option, index) => {
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
                                    <span className="flex-1 truncate">{option.label}</span>
                                    {isSelected && (
                                        <HugeiconsIcon icon={Tick01Icon} className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
