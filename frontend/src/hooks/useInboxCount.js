import { useQuery } from '@tanstack/react-query'
import { getFileCounts } from '@/api/client.js'

/** Counts for the sidebar: inbox (not yet confirmed by a person), needs_review (AI done, awaiting you), total. */
export function useFileCounts() {
  return useQuery({
    queryKey: ['counts'],
    queryFn: getFileCounts,
    refetchInterval: 60_000,
  })
}

export function useInboxCount() {
  return useFileCounts()
}
