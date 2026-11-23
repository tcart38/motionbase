import React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RiExternalLinkLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx'
import VideoPlayer from '@/components/VideoPlayer.jsx'

/** Watch a video without leaving the grid: filters, scroll position and selection stay as they are. */
export default function PlayerDialog({ file, onOpenChange }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (
    <Dialog open={!!file} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85vh,56rem)] w-[min(95vw,72rem)] max-w-none flex-col gap-3 p-3 sm:max-w-none">
        <DialogHeader className="flex-row items-center gap-2 pr-8">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">{file?.filename}</DialogTitle>
            <DialogDescription className="sr-only">Video preview</DialogDescription>
          </div>
          <Button variant="outline" onClick={() => navigate(`/player/${file.id}?${params.toString()}`)}>
            <RiExternalLinkLine data-icon="inline-start" /> Open page
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1">{file && <VideoPlayer file={file} />}</div>
      </DialogContent>
    </Dialog>
  )
}
