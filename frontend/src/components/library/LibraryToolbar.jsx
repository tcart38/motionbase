import React from 'react'
import {
  RiSearchLine, RiCloseLine, RiSortAsc, RiSortDesc, RiCheckboxMultipleLine, RiShuffleLine, RiLayoutGridLine,
} from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.jsx'
import { Toggle } from '@/components/ui/toggle.jsx'

export const SORT_OPTIONS = [
  { value: 'date_added', label: 'Date added' },
  { value: 'filename', label: 'Filename' },
  { value: 'duration', label: 'Duration' },
]

export const GRID_SIZES = [
  { label: 'XS', cols: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10' },
  { label: 'S', cols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7' },
  { label: 'M', cols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' },
  { label: 'L', cols: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4' },
  { label: 'XL', cols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' },
]

export default function LibraryToolbar({
  searchInput, onSearchInput, sort, order, onSort, onOrder, gridSize, onGridSize,
  selecting, onToggleSelect, onRandom, canRandom,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 max-w-sm flex-1">
        <RiSearchLine className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          placeholder="Search filenames and notes…"
          aria-label="Search library"
          className="h-8 pl-7 pr-7 [&::-webkit-search-cancel-button]:hidden"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => onSearchInput('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <RiCloseLine className="size-3.5" />
          </button>
        )}
      </div>

      <Select items={SORT_OPTIONS} value={sort} onValueChange={onSort}>
        <SelectTrigger size="default" className="h-8 w-36" aria-label="Sort by"><SelectValue /></SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon-lg"
        onClick={onOrder}
        aria-label={order === 'desc' ? 'Descending. Switch to ascending' : 'Ascending. Switch to descending'}
        title={order === 'desc' ? (sort === 'date_added' ? 'Newest first' : 'Descending') : (sort === 'date_added' ? 'Oldest first' : 'Ascending')}
      >
        {order === 'desc' ? <RiSortDesc /> : <RiSortAsc />}
      </Button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Toggle variant="outline" size="lg" pressed={selecting} onPressedChange={onToggleSelect} aria-label="Selection mode">
          <RiCheckboxMultipleLine /> Select
        </Toggle>
        <Button variant="outline" size="lg" onClick={onRandom} disabled={!canRandom} title="Open a random file from this view">
          <RiShuffleLine data-icon="inline-start" /> Random
        </Button>
        <div className="flex items-center gap-1.5">
          <RiLayoutGridLine className="size-3.5 text-muted-foreground" aria-hidden />
          <ToggleGroup
            value={[String(gridSize)]}
            onValueChange={(v) => v[0] !== undefined && onGridSize(Number(v[0]))}
            variant="outline"
            spacing={0}
            aria-label="Grid size"
          >
            {GRID_SIZES.map((g, i) => (
              <ToggleGroupItem key={g.label} value={String(i)} aria-label={`Grid size ${g.label}`} size="sm">{g.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </div>
  )
}
