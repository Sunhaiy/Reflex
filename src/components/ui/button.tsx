import * as React from "react"
import { cn } from "@/lib/utils"

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "secondary" | "ghost" | "destructive" | "outline", size?: "default" | "sm" | "lg" | "icon" }>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985]",
          {
            "bg-primary text-primary-foreground shadow-sm shadow-primary/15 hover:brightness-105": variant === "default",
            "bg-secondary/80 text-secondary-foreground hover:bg-secondary": variant === "secondary",
            "hover:bg-foreground/[0.065] hover:text-foreground": variant === "ghost",
            "bg-destructive text-destructive-foreground shadow-sm hover:brightness-105": variant === "destructive",
            "border border-input bg-background/45 hover:border-foreground/20 hover:bg-background/75": variant === "outline",
            "h-10 px-4 py-2": size === "default",
            "h-8 rounded-lg px-3 text-xs": size === "sm",
            "h-11 px-7": size === "lg",
            "h-9 w-9 rounded-xl": size === "icon",
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
