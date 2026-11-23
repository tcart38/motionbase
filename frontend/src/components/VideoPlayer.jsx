import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  RiPlayFill, RiPauseFill, RiVolumeUpFill, RiVolumeMuteFill, RiVolumeDownFill, RiFullscreenLine,
  RiFullscreenExitLine, RiSkipBackMiniFill, RiSkipForwardMiniFill, RiRepeatLine, RiSpeedLine,
} from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Slider } from '@/components/ui/slider.jsx'
import { Toggle } from '@/components/ui/toggle.jsx'
import { Kbd } from '@/components/ui/kbd.jsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.jsx'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx'
import { cn } from '@/lib/utils.js'
import { streamUrl } from '@/api/client.js'

export const RATES = [0.25, 0.5, 1, 1.5, 2]
const VOLUME_KEY = 'player:volume'
const MUTED_KEY = 'player:muted'

function readStorage(key) { try { return localStorage.getItem(key) } catch { return null } }
function writeStorage(key, v) { try { localStorage.setItem(key, v) } catch { /* ignore */ } }

export function formatTime(secs) {
  if (!Number.isFinite(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function Tip({ label, keys, children }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label} {keys && <Kbd className="ml-1">{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Video player. Fills its parent (give the parent a height) and letterboxes the clip.
 * Shortcuts (when no text field or menu has focus):
 *   Space / K play-pause · M mute · F fullscreen · , and . or PgUp/PgDn step a frame · ← → seek 5 s
 *   [ and ] slower / faster · L loop
 * `reservedKeys` (lowercase) lists keys the host page binds itself, which the player then ignores.
 */
export default function VideoPlayer({ file, className, autoPlay = true, reservedKeys }) {
  const containerRef = useRef(null)
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [scrub, setScrub] = useState(null)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => {
    const saved = parseFloat(readStorage(VOLUME_KEY))
    return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 1
  })
  const [muted, setMuted] = useState(() => readStorage(MUTED_KEY) === '1')
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState(false)

  const fps = file?.fps || 30

  // A new <video> source resets playback state and re-applies the saved volume.
  useEffect(() => {
    setPlaying(false); setCurrentTime(0); setDuration(0); setRate(1); setError(false); setScrub(null)
    const v = videoRef.current
    if (v) { v.volume = volume; v.muted = muted; v.playbackRate = 1 }
  }, [file?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {}); else v.pause()
  }, [])

  const seekBy = useCallback((delta) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta))
  }, [])

  const stepFrame = useCallback((dir) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    seekBy(dir / fps)
  }, [fps, seekBy])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const next = !v.muted
    v.muted = next
    setMuted(next)
    writeStorage(MUTED_KEY, next ? '1' : '0')
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen()
    else containerRef.current?.requestFullscreen?.()
  }, [])

  const changeRate = useCallback((r) => {
    setRate(r)
    if (videoRef.current) videoRef.current.playbackRate = r
  }, [])

  const stepRate = useCallback((dir) => {
    setRate((cur) => {
      const i = RATES.indexOf(cur)
      const next = RATES[Math.max(0, Math.min(RATES.length - 1, (i === -1 ? RATES.indexOf(1) : i) + dir))]
      if (videoRef.current) videoRef.current.playbackRate = next
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement) {
        if (t.closest('input, textarea, select, [contenteditable=true], [role=menu], [role=listbox], [role=dialog]:not(:has(video))')) return
        if (t.closest('button, [role=slider]') && (e.key === ' ' || e.key === 'Enter')) return // let focused controls handle it
      }
      const handlers = {
        ' ': togglePlay, k: togglePlay, m: toggleMute, f: toggleFullscreen, l: () => setLoop((v) => !v),
        ',': () => stepFrame(-1), '.': () => stepFrame(1), PageUp: () => stepFrame(-1), PageDown: () => stepFrame(1),
        ArrowLeft: () => seekBy(e.shiftKey ? -1 : -5), ArrowRight: () => seekBy(e.shiftKey ? 1 : 5),
        '[': () => stepRate(-1), ']': () => stepRate(1),
      }
      if (reservedKeys?.includes(e.key.toLowerCase())) return
      if (e.key === 'M') return // Shift+M opens the folder picker on the Player page
      const fn = handlers[e.key] || handlers[e.key.toLowerCase?.()]
      if (fn) { e.preventDefault(); fn() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [togglePlay, toggleMute, toggleFullscreen, stepFrame, seekBy, stepRate, reservedKeys])

  if (!file || file.file_type !== 'video') return null

  const shown = scrub ?? currentTime
  const VolIcon = muted || volume === 0 ? RiVolumeMuteFill : volume < 0.5 ? RiVolumeDownFill : RiVolumeUpFill

  return (
    <div
      ref={containerRef}
      className={cn('flex size-full min-h-0 flex-col overflow-hidden rounded-xl bg-black text-white', fullscreen && 'rounded-none', className)}
    >
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          key={file.id}
          src={streamUrl(file.id)}
          className="size-full cursor-pointer object-contain"
          preload="metadata"
          playsInline
          loop={loop}
          aria-label={file.filename}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
          onLoadedMetadata={() => {
            const v = videoRef.current
            if (!v) return
            setDuration(v.duration || 0)
            v.volume = volume; v.muted = muted
            if (autoPlay) v.play().catch(() => {})
          }}
          onError={() => setError(true)}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-xs text-white/80">
            This file could not be played in the browser. You can still download it.
          </div>
        )}
      </div>

      <div className="space-y-1.5 bg-zinc-950 px-3 pb-2 pt-2.5">
        <Slider
          value={[shown]}
          min={0}
          max={duration || 1}
          step={0.01}
          disabled={!duration}
          aria-label="Seek"
          onValueChange={(v) => {
            const t = Array.isArray(v) ? v[0] : v
            setScrub(t)
            if (videoRef.current) videoRef.current.currentTime = t
          }}
          onValueCommitted={() => setScrub(null)}
          className="[&_[data-slot=slider-thumb]]:size-3"
        />

        <div className="flex flex-wrap items-center gap-0.5 text-white">
          <Tip label="Previous frame" keys="PgUp">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" onClick={() => stepFrame(-1)} aria-label="Previous frame"><RiSkipBackMiniFill /></Button>
          </Tip>
          <Tip label={playing ? 'Pause' : 'Play'} keys="Space">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <RiPauseFill /> : <RiPlayFill />}
            </Button>
          </Tip>
          <Tip label="Next frame" keys="PgDn">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" onClick={() => stepFrame(1)} aria-label="Next frame"><RiSkipForwardMiniFill /></Button>
          </Tip>
          <span className="ml-1.5 font-mono text-xs tabular-nums text-white/70" aria-label="Playback position">
            {formatTime(shown)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          <Tip label="Loop" keys="L">
            <Toggle pressed={loop} onPressedChange={setLoop} aria-label="Loop" size="sm" className="text-white/80 hover:bg-white/15 hover:text-white aria-pressed:bg-white/20 aria-pressed:text-white">
              <RiRepeatLine />
            </Toggle>
          </Tip>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="min-w-12 text-white hover:bg-white/15 hover:text-white aria-expanded:bg-white/15 aria-expanded:text-white" aria-label={`Playback speed ${rate}x`} />}>
              <RiSpeedLine data-icon="inline-start" /> {rate}x
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuRadioGroup value={String(rate)} onValueChange={(v) => changeRate(Number(v))}>
                {RATES.map((r) => <DropdownMenuRadioItem key={r} value={String(r)}>{r}x</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tip label={muted ? 'Unmute' : 'Mute'} keys="M">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}><VolIcon /></Button>
          </Tip>
          <Slider
            value={[muted ? 0 : volume]}
            min={0}
            max={1}
            step={0.05}
            aria-label="Volume"
            className="mx-1 shrink-0 data-horizontal:w-20"
            onValueChange={(v) => {
              const val = Array.isArray(v) ? v[0] : v
              const nowMuted = val === 0
              setVolume(val); setMuted(nowMuted)
              if (videoRef.current) { videoRef.current.volume = val; videoRef.current.muted = nowMuted }
              writeStorage(VOLUME_KEY, String(val)); writeStorage(MUTED_KEY, nowMuted ? '1' : '0')
            }}
          />
          <Tip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} keys="F">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {fullscreen ? <RiFullscreenExitLine /> : <RiFullscreenLine />}
            </Button>
          </Tip>
        </div>
      </div>
    </div>
  )
}
