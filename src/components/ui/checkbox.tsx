import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 复选框：原生 input 实现。
 * 保证 <label> 包裹时点击文本即可切换（自定义 button 实现在部分环境下不响应 label 转发点击），
 * 主题色跟随 accent-primary。
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "onChange" | "type"> & {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }
>(({ className, checked = false, onCheckedChange, ...props }, ref) => (
  <input
    type="checkbox"
    ref={ref}
    className={cn(
      "h-4 w-4 shrink-0 cursor-pointer rounded-[3px] accent-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
    checked={checked}
    onChange={() => onCheckedChange?.(!checked)}
  />
))
Checkbox.displayName = "Checkbox"

export { Checkbox }
