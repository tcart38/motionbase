import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RiAddLine, RiPencilLine, RiDeleteBinLine, RiCloseLine, RiCheckLine } from '@remixicon/react'
import {
  createCategory, updateCategory, deleteCategoryPreview, deleteCategory,
  createTag, updateTag, deleteTagPreview, deleteTag,
} from '@/api/client.js'
import { useTaxonomy } from '@/hooks/useTaxonomy.js'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.jsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx'
import ConfirmAction from '@/components/ConfirmAction.jsx'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Create / edit a category (name, description for agents, single or multi selection). */
function CategoryDialog({ open, onOpenChange, category, onSave, busy }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selection, setSelection] = useState('multi')
  const [seen, setSeen] = useState(null)
  if (open && seen !== (category?.id ?? 'new')) {
    setSeen(category?.id ?? 'new')
    setName(category?.name ?? '')
    setDescription(category?.description ?? '')
    setSelection(category?.selection ?? 'multi')
  }
  if (!open && seen !== null) setSeen(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave({ name: name.trim(), description, selection }) }}
        >
          <DialogHeader>
            <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>The description tells AI agents when to use this category.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cat-desc">Description</Label>
            <Textarea id="cat-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. The format of the video. Pick the one that fits best." />
          </div>
          <div className="grid gap-1.5">
            <Label id="cat-sel-label">Selection</Label>
            <ToggleGroup variant="outline" aria-labelledby="cat-sel-label" value={[selection]}
              onValueChange={(v) => v[0] && setSelection(v[0])}>
              <ToggleGroupItem value="multi">Multiple tags</ToggleGroupItem>
              <ToggleGroupItem value="single">One tag only</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || busy}>{category ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TagChip({ tag, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(tag.name)
  if (editing) {
    const commit = () => { if (val.trim() && val.trim() !== tag.name) onRename(val.trim()); setEditing(false) }
    return (
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); commit() }}>
        <Input autoFocus aria-label={`Rename tag ${tag.name}`} value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} className="h-6 w-32" />
        <Button type="submit" variant="ghost" size="icon-xs" aria-label="Save tag name"><RiCheckLine /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancel rename" onClick={() => setEditing(false)}><RiCloseLine /></Button>
      </form>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-muted py-0.5 pl-2 pr-0.5 text-xs">
      {tag.name}
      <Button variant="ghost" size="icon-xs" aria-label={`Rename tag ${tag.name}`} onClick={() => { setVal(tag.name); setEditing(true) }}><RiPencilLine /></Button>
      <Button variant="ghost" size="icon-xs" aria-label={`Delete tag ${tag.name}`} onClick={onDelete}><RiDeleteBinLine /></Button>
    </span>
  )
}

function CategoryCard({ cat, onEdit, onDelete, onRenameTag, onDeleteTag, onAddTag }) {
  const [newTag, setNewTag] = useState('')
  const submit = (e) => { e.preventDefault(); if (newTag.trim()) { onAddTag(newTag.trim()); setNewTag('') } }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {cat.name}
          {cat.is_system ? <Badge variant="secondary">system</Badge> : null}
          <Badge variant="outline">{cat.selection === 'single' ? 'one tag' : 'multiple tags'}</Badge>
        </CardTitle>
        {cat.description && <CardDescription>{cat.description}</CardDescription>}
        {!cat.is_system && (
          <CardAction className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit category ${cat.name}`} onClick={onEdit}><RiPencilLine /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete category ${cat.name}`} onClick={onDelete}><RiDeleteBinLine /></Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {cat.tags.length === 0 && <p className="text-xs text-muted-foreground">No tags yet.</p>}
          {cat.tags.map((t) => cat.is_system
            ? <Badge key={t.id} variant="secondary">{t.name}</Badge>
            : <TagChip key={t.id} tag={t} onRename={(n) => onRenameTag(t, n)} onDelete={() => onDeleteTag(t)} />)}
        </div>
        {!cat.is_system && (
          <form onSubmit={submit} className="flex gap-1.5">
            <Input aria-label={`New tag in ${cat.name}`} placeholder="New tag…" value={newTag}
              onChange={(e) => setNewTag(e.target.value)} className="w-40" />
            <Button type="submit" variant="outline" disabled={!newTag.trim()}><RiAddLine /> Add</Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export default function TaxonomyTab() {
  const { groups, isLoading } = useTaxonomy()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(null) // { category? } when open
  const [confirm, setConfirm] = useState(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['tags'] }); qc.invalidateQueries({ queryKey: ['files'] }) }
  const run = (fn, ok) => async (...a) => {
    try { await fn(...a); refresh(); if (ok) toast.success(ok) } catch (e) { toast.error(e.message) }
  }

  const saveCat = useMutation({
    mutationFn: (body) => (dialog.category ? updateCategory(dialog.category.id, body) : createCategory(body)),
    onSuccess: () => { refresh(); setDialog(null) },
    onError: (e) => toast.error(e.message),
  })

  const askDeleteCategory = async (cat) => {
    const p = await deleteCategoryPreview(cat.id)
    setConfirm({
      title: `Delete category "${cat.name}"?`,
      description: p.affectedFiles > 0
        ? `This removes the category and all its tags from ${plural(p.affectedFiles, 'file')}.`
        : 'This category has no tags applied to files.',
      confirmLabel: 'Delete category',
      onConfirm: run(() => deleteCategory(cat.id), 'Category deleted'),
    })
  }
  const askDeleteTag = async (tag) => {
    const p = await deleteTagPreview(tag.id)
    setConfirm({
      title: `Delete tag "${tag.name}"?`,
      description: p.affectedFiles > 0
        ? `This tag is applied to ${plural(p.affectedFiles, 'file')} and will be removed from all of them.`
        : 'This tag is not applied to any files.',
      confirmLabel: 'Delete tag',
      onConfirm: run(() => deleteTag(tag.id), 'Tag deleted'),
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Categories group tags. A category set to one tag only replaces its previous tag when you pick another.
        </p>
        <Button onClick={() => setDialog({})}><RiAddLine /> New category</Button>
      </div>
      {isLoading && <Skeleton className="h-32 w-full" />}
      {groups.map((cat) => (
        <CategoryCard
          key={cat.id}
          cat={cat}
          onEdit={() => setDialog({ category: cat })}
          onDelete={() => askDeleteCategory(cat).catch((e) => toast.error(e.message))}
          onAddTag={run((name) => createTag({ category_id: cat.id, name }))}
          onRenameTag={run((t, name) => updateTag(t.id, { name }))}
          onDeleteTag={(t) => askDeleteTag(t).catch((e) => toast.error(e.message))}
        />
      ))}
      <CategoryDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        category={dialog?.category}
        busy={saveCat.isPending}
        onSave={(body) => saveCat.mutate(body)}
      />
      <ConfirmAction request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
