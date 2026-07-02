import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Check, X, Sun, Moon } from 'lucide-react'
import {
  getCategories, getTags, createCategory, updateCategory, deleteCategoryPreview, deleteCategory,
  createTag, updateTag, deleteTagPreview, deleteTag,
  getSettings, updateSettings,
} from '../api/client.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

function EditInline({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel() }}
        className="input py-1 text-xs w-32"
      />
      <button onClick={() => onSave(val)} className="btn-ghost p-1"><Check size={12} /></button>
      <button onClick={onCancel} className="btn-ghost p-1"><X size={12} /></button>
    </div>
  )
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const [categories, setCategories] = useState([])
  const [allTags, setAllTags] = useState([])
  const [scanInterval, setScanInterval] = useState('30')
  const [version, setVersion] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editingCatId, setEditingCatId] = useState(null)
  const [editingTagId, setEditingTagId] = useState(null)
  const [newCatName, setNewCatName] = useState('')
  const [newTagNames, setNewTagNames] = useState({}) // catId -> string
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    const [cats, tags, settings] = await Promise.all([getCategories(), getTags(), getSettings()])
    setCategories(cats)
    setAllTags(tags)
    setScanInterval(settings.scan_interval || '30')
    setVersion(settings.version || null)
  }, [])

  useEffect(() => { load() }, [load])

  // --- Category actions ---
  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    await createCategory({ name: newCatName.trim() })
    setNewCatName('')
    load()
  }

  const handleRenameCategory = async (id, name) => {
    if (!name.trim()) return
    await updateCategory(id, { name: name.trim() })
    setEditingCatId(null)
    load()
  }

  const handleDeleteCategory = async (cat) => {
    const preview = await deleteCategoryPreview(cat.id)
    setConfirm({
      title: `Delete category "${cat.name}"?`,
      description: preview.affectedFiles > 0
        ? `This will remove the category and all its tags from ${preview.affectedFiles} file(s).`
        : 'This category has no tags applied to files.',
      onConfirm: async () => {
        await deleteCategory(cat.id)
        setConfirm(null)
        load()
      },
    })
  }

  // --- Tag actions ---
  const handleAddTag = async (catId) => {
    const name = (newTagNames[catId] || '').trim()
    if (!name) return
    await createTag({ category_id: catId, name })
    setNewTagNames((prev) => ({ ...prev, [catId]: '' }))
    load()
  }

  const handleRenameTag = async (id, name) => {
    if (!name.trim()) return
    await updateTag(id, { name: name.trim() })
    setEditingTagId(null)
    load()
  }

  const handleDeleteTag = async (tag) => {
    const preview = await deleteTagPreview(tag.id)
    setConfirm({
      title: `Delete tag "${tag.name}"?`,
      description: preview.affectedFiles > 0
        ? `This tag is applied to ${preview.affectedFiles} file(s) and will be removed from all of them.`
        : 'This tag is not applied to any files.',
      onConfirm: async () => {
        await deleteTag(tag.id)
        setConfirm(null)
        load()
      },
    })
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await updateSettings({ scan_interval: scanInterval })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-baseline gap-2 mb-6">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
        {version && (
          <span className="text-xs text-slate-400 dark:text-slate-500">v{version}</span>
        )}
      </div>

      {/* Appearance */}
      <section className="card p-4 mb-6">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Appearance</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-500 dark:text-slate-400 w-40">Theme</label>
          <div className="flex gap-1.5">
            <button
              onClick={() => setTheme('dark')}
              className={`btn gap-1.5 ${theme === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
            >
              <Moon size={13} /> Dark
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`btn gap-1.5 ${theme === 'light' ? 'btn-primary' : 'btn-ghost'}`}
            >
              <Sun size={13} /> Light
            </button>
          </div>
        </div>
      </section>

      {/* Scan settings */}
      <section className="card p-4 mb-6">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Scanning</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-500 dark:text-slate-400 w-40">Auto-scan interval</label>
          <input
            type="number"
            min="0"
            value={scanInterval}
            onChange={(e) => setScanInterval(e.target.value)}
            className="input w-24 text-sm"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">minutes (0 = disabled)</span>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="btn-primary mt-3 disabled:opacity-50"
        >
          <Check size={14} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>

      {/* Tag categories */}
      <section>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Tag Categories</h2>

        <div className="space-y-4">
          {categories.map((cat) => {
            const catTags = allTags.filter((t) => t.category_id === cat.id)
            return (
              <div key={cat.id} className="card p-4">
                {/* Category header */}
                <div className="flex items-center gap-2 mb-3">
                  {editingCatId === cat.id ? (
                    <EditInline
                      value={cat.name}
                      onSave={(v) => handleRenameCategory(cat.id, v)}
                      onCancel={() => setEditingCatId(null)}
                    />
                  ) : (
                    <>
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{cat.name}</span>
                      {cat.is_system ? (
                        <span className="text-xs text-slate-500 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">system</span>
                      ) : (
                        <>
                          <button onClick={() => setEditingCatId(cat.id)} className="btn-ghost p-1 ml-1">
                            <Pencil size={11} />
                          </button>
                          <button onClick={() => handleDeleteCategory(cat)} className="btn-ghost p-1 text-red-400">
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {catTags.map((tag) => (
                    <div key={tag.id} className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700 rounded-lg pl-2.5 pr-1 py-1">
                      {editingTagId === tag.id ? (
                        <EditInline
                          value={tag.name}
                          onSave={(v) => handleRenameTag(tag.id, v)}
                          onCancel={() => setEditingTagId(null)}
                        />
                      ) : (
                        <>
                          <span className="text-xs text-slate-700 dark:text-slate-200">{tag.name}</span>
                          <button onClick={() => setEditingTagId(tag.id)} className="btn-ghost p-0.5 ml-0.5">
                            <Pencil size={9} />
                          </button>
                          <button onClick={() => handleDeleteTag(tag)} className="btn-ghost p-0.5 text-red-400">
                            <Trash2 size={9} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add tag */}
                <div className="flex items-center gap-1.5">
                  <input
                    placeholder="New tag…"
                    value={newTagNames[cat.id] || ''}
                    onChange={(e) => setNewTagNames((p) => ({ ...p, [cat.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag(cat.id)}
                    className="input py-1 text-xs w-32"
                  />
                  <button onClick={() => handleAddTag(cat.id)} className="btn-ghost py-1 text-xs">
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Add category */}
        <div className="flex items-center gap-2 mt-4">
          <input
            placeholder="New category…"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            className="input py-1.5 text-sm w-48"
          />
          <button onClick={handleAddCategory} className="btn-primary py-1.5 text-sm">
            <Plus size={14} /> Add Category
          </button>
        </div>
      </section>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
