import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCategories, getTags } from '@/api/client.js'

/** Categories + tags, with tags grouped per category (system categories are read-only in the UI). */
export function useTaxonomy() {
  const cats = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: 60_000 })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags, staleTime: 60_000 })

  const groups = useMemo(() => {
    const t = tags.data ?? []
    return (cats.data ?? []).map((c) => ({ ...c, tags: t.filter((x) => x.category_id === c.id) }))
  }, [cats.data, tags.data])

  return {
    categories: cats.data ?? [],
    tags: tags.data ?? [],
    groups,
    isLoading: cats.isLoading || tags.isLoading,
  }
}
