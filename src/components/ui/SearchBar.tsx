import { useState, useRef } from 'react'

interface SearchBarProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  autoFocus?: boolean
}

export function SearchBar({ placeholder = 'Buscar...', value, onChange, onClear, autoFocus }: SearchBarProps) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`flex items-center gap-3 bg-stone-100 rounded-2xl px-4 py-3 transition-all ${focused ? 'bg-white ring-2 ring-orange-400' : ''}`}>
      <svg className="h-5 w-5 text-stone-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="flex-1 bg-transparent text-stone-800 placeholder-stone-400 outline-none text-base"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
      />
      {value && (
        <button
          onClick={() => { onChange(''); onClear?.(); inputRef.current?.focus() }}
          className="text-stone-400 hover:text-stone-600 active:scale-90 transition-transform"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
