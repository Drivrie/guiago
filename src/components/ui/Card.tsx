import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  padding?: 'none' | 'sm' | 'md' | 'lg'
  shadow?: boolean
}

export function Card({ children, className = '', onClick, padding = 'md', shadow = true }: CardProps) {
  const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }
  const base = `bg-white rounded-2xl ${shadow ? 'shadow-sm' : ''} ${paddings[padding]} ${onClick ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''} ${className}`

  if (onClick) {
    return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick()} className={base}>{children}</div>
  }
  return <div className={base}>{children}</div>
}
