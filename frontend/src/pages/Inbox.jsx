import React from 'react'
import { RiInboxLine } from '@remixicon/react'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty.jsx'

// Placeholder: the triage workflow lands in a later chunk.
export default function Inbox() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold tracking-tight mb-4">Inbox</h1>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><RiInboxLine /></EmptyMedia>
          <EmptyTitle>Triage is coming</EmptyTitle>
          <EmptyDescription>New and untagged media will be reviewed here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
