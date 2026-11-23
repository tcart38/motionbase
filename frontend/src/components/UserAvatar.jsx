import React from 'react'
import { cn } from '@/lib/utils.js'
import { initials } from '@/lib/people.js'

// Small round initials badge. The color is stable per name so people are easy to tell apart.
const HUES = [210, 160, 30, 280, 340, 190, 100, 15]
const hue = (s) => HUES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]

export default function UserAvatar({ name, className, size = 'md' }) {
  const h = hue(name ?? '')
  return (
    <span
      aria-hidden
      style={{ '--av': h }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium',
        'bg-[oklch(0.9_0.05_var(--av))] text-[oklch(0.35_0.1_var(--av))] dark:bg-[oklch(0.35_0.07_var(--av))] dark:text-[oklch(0.92_0.05_var(--av))]',
        size === 'sm' ? 'size-4 text-[0.5rem]' : size === 'lg' ? 'size-9 text-sm' : 'size-6 text-[0.625rem]',
        className
      )}
    >
      {initials(name)}
    </span>
  )
}
