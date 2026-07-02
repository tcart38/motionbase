import React from 'react'
import { X } from 'lucide-react'

export default function TagChip({ tag, onRemove }) {
  return (
    <span className="tag-chip gap-1">
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(tag) }}
          className="ml-0.5 hover:text-red-400 transition-colors"
          aria-label={`Remove tag ${tag.name}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}
