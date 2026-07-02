import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { getTags, getCategories, patchFile, createTag, createCategory } from '../api/client.js'

export default function TagEditor({ file, onSaved }) {
  const [categories, setCategories] = useState([])
  const [allTags, setAllTags] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [saveState, setSaveState] = useState('idle') // 'idle' | 'saving' | 'saved'

  // Inline new-tag state
  const [addingTagTo, setAddingTagTo] = useState(null)
  const [newTagName, setNewTagName] = useState('')
  // Inline new-category state
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const debounceRef = useRef(null)
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])

  useEffect(() => {
    Promise.all([getCategories(), getTags()]).then(([cats, tags]) => {
      setCategories(cats)
      setAllTags(tags)
    })
  }, [])

  useEffect(() => {
    if (file?.tags) setSelectedIds(new Set(file.tags.map((t) => t.id)))
  }, [file?.id])

  // Auto-save 600ms after the last toggle
  const scheduleAutoSave = useCallback((ids) => {
    clearTimeout(debounceRef.current)
    setSaveState('saving')
    debounceRef.current = setTimeout(async () => {
      try {
        const updated = await patchFile(file.id, {
          tag_ids: [...ids],
          needs_tagging: ids.size > 0 ? 0 : 1,
        })
        onSavedRef.current?.(updated)
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 1500)
      } catch {
        setSaveState('idle')
      }
    }, 600)
  }, [file?.id])

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const toggle = useCallback((tagId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(tagId) ? next.delete(tagId) : next.add(tagId)
      scheduleAutoSave(next)
      return next
    })
  }, [scheduleAutoSave])

  const handleAddTag = useCallback(async (catId) => {
    const name = newTagName.trim()
    if (!name) return
    const tag = await createTag({ category_id: catId, name })
    setAllTags((prev) => [...prev, tag])
    setSelectedIds((prev) => {
      const next = new Set([...prev, tag.id])
      scheduleAutoSave(next)
      return next
    })
    setNewTagName('')
    setAddingTagTo(null)
  }, [newTagName, scheduleAutoSave])

  const handleAddCategory = useCallback(async () => {
    const name = newCatName.trim()
    if (!name) return
    const cat = await createCategory({ name })
    setCategories((prev) => [...prev, cat])
    setNewCatName('')
    setAddingCategory(false)
  }, [newCatName])

  if (!file) return null

  return (
    <div className="flex flex-col gap-4">
      {/* Save status indicator */}
      <div className="h-4 flex items-center">
        {saveState === 'saving' && (
          <span className="text-xs text-slate-400 dark:text-slate-500">Saving…</span>
        )}
        {saveState === 'saved' && (
          <span className="text-xs text-emerald-500 flex items-center gap-1">
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      {categories.map((cat) => {
        const catTags = allTags.filter((t) => t.category_id === cat.id)
        const isAddingHere = addingTagTo === cat.id
        return (
          <div key={cat.id}>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider mb-2">
              {cat.name}
            </p>
            <div className="flex flex-wrap gap-1.5 items-center">
              {catTags.map((tag) => {
                const active = selectedIds.has(tag.id)
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggle(tag.id)}
                    className={`tag-btn ${active ? 'tag-btn-active' : ''}`}
                  >
                    {tag.name}
                  </button>
                )
              })}

              {/* Inline add-tag input */}
              {isAddingHere ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTag(cat.id)
                      if (e.key === 'Escape') { setAddingTagTo(null); setNewTagName('') }
                    }}
                    placeholder="Tag name…"
                    className="input py-0.5 text-xs w-28"
                  />
                  <button
                    onClick={() => handleAddTag(cat.id)}
                    className="btn-ghost p-1 text-brand"
                    title="Add tag"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={() => { setAddingTagTo(null); setNewTagName('') }}
                    className="btn-ghost p-1"
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setAddingTagTo(cat.id); setNewTagName('') }}
                  className="tag-btn flex items-center gap-1 text-slate-400 dark:text-slate-500 hover:text-brand"
                  title="Add tag to this category"
                >
                  <Plus size={10} /> Add
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Add new category */}
      {addingCategory ? (
        <div className="flex items-center gap-1.5 pt-1">
          <input
            autoFocus
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCategory()
              if (e.key === 'Escape') { setAddingCategory(false); setNewCatName('') }
            }}
            placeholder="Category name…"
            className="input py-0.5 text-xs w-36"
          />
          <button
            onClick={handleAddCategory}
            className="btn-ghost p-1 text-brand"
            title="Create category"
          >
            <Check size={12} />
          </button>
          <button
            onClick={() => { setAddingCategory(false); setNewCatName('') }}
            className="btn-ghost p-1"
            title="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingCategory(true)}
          className="self-start btn-ghost text-xs gap-1 text-slate-400 dark:text-slate-500 hover:text-brand px-2 py-1"
        >
          <Plus size={11} /> New Category
        </button>
      )}
    </div>
  )
}
