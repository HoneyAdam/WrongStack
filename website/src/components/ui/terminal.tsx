"use client"

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A dark terminal window frame — intentionally dark in both site themes. */
export function TerminalFrame({
  title = "wrongstack",
  right,
  children,
  className,
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("terminal", className)}>
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="font-mono text-xs text-zinc-400">{title}</span>
        </div>
        {right && <div className="font-mono text-xs text-zinc-500">{right}</div>}
      </div>
      <div className="bg-[#07080d] p-4 font-mono text-[13px] leading-relaxed text-zinc-200">
        {children}
      </div>
    </div>
  )
}

/** Syntax-lite line helpers for terminal content. */
export const Prompt = ({ children }: { children: ReactNode }) => (
  <span>
    <span className="text-term-green">❯ </span>
    <span className="text-zinc-100">{children}</span>
  </span>
)

export const Out = ({
  children,
  tone = "muted",
}: {
  children: ReactNode
  tone?: "muted" | "green" | "yellow" | "blue" | "purple" | "red"
}) => {
  const map: Record<string, string> = {
    muted: "text-zinc-500",
    green: "text-term-green",
    yellow: "text-term-yellow",
    blue: "text-term-blue",
    purple: "text-term-purple",
    red: "text-term-red",
  }
  return <span className={map[tone]}>{children}</span>
}
