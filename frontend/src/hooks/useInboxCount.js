import { useQuery } from '@tanstack/react-query'
import { getFiles } from '@/api/client.js'

// Inbox = media that still needs triage. Until review tracking is exposed on the
// UI file list, "untagged" is the closest signal.
export function useInboxCount() {
  return useQuery({
    queryKey: ['inbox-count'],
    queryFn: async () => (await getFiles({ untagged: '1', limit: 1 })).total ?? 0,
    refetchInterval: 60_000,
  })
}
