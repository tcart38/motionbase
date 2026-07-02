import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Maximize2, Minimize2 } from 'lucide-react'
import { streamUrl } from '../api/client.js'

const RATES = [0.25, 0.5, 1, 1.5, 2]

function formatTime(secs) {
  if (!isFinite(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function VideoPlayer({ file }) {
  const containerRef = useRef(null)
  const videoRef = useRef(null)
  const scrubBarRef = useRef(null)
  const slotRef = useRef(null)
  const controlsRef = useRef(null)
  const [slot, setSlot] = useState({ w: 0, h: 0, ctrl: 0 })
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)

  const durationRef = useRef(0)
  const wasPlayingRef = useRef(false)

  useEffect(() => { durationRef.current = duration }, [duration])

  const fps = file?.fps || 30

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setRate(1)
  }, [file?.id])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Measure the available slot so we can size the player box to the video's
  // "contain" fit in JS. Pure CSS can't fit both axes while scaling up — it
  // always pins one axis and letterboxes/pillarboxes the other.
  useEffect(() => {
    const el = slotRef.current
    if (!el) return
    const measure = () => setSlot({
      w: el.clientWidth,
      h: el.clientHeight,
      ctrl: controlsRef.current?.offsetHeight || 0,
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (controlsRef.current) ro.observe(controlsRef.current)
    return () => ro.disconnect()
  }, [isFullscreen])

  const stepFrame = useCallback((dir) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dir * (1 / fps)))
  }, [fps])

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'ArrowLeft')  { e.preventDefault(); stepFrame(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [stepFrame])

  useEffect(() => {
    if (!isScrubbing) return
    const seekToX = (clientX) => {
      const bar = scrubBarRef.current
      const v = videoRef.current
      if (!bar || !v || !durationRef.current) return
      const rect = bar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const t = pct * durationRef.current
      v.currentTime = t
      setCurrentTime(t)
    }
    const onMouseMove = (e) => seekToX(e.clientX)
    const onMouseUp = (e) => {
      seekToX(e.clientX)
      setIsScrubbing(false)
      if (wasPlayingRef.current) videoRef.current?.play().catch(() => {})
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isScrubbing])

  const handleScrubStart = useCallback((e) => {
    e.preventDefault()
    const v = videoRef.current
    if (!v || !durationRef.current) return
    wasPlayingRef.current = !v.paused
    v.pause()
    setIsScrubbing(true)
    const bar = scrubBarRef.current
    if (bar) {
      const rect = bar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const t = pct * durationRef.current
      v.currentTime = t
      setCurrentTime(t)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    playing ? v.pause() : v.play()
  }, [playing])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  const setPlaybackRate = useCallback((r) => {
    setRate(r)
    if (videoRef.current) videoRef.current.playbackRate = r
  }, [])

  const handleVolumeChange = useCallback((e) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (videoRef.current) {
      videoRef.current.volume = val
      videoRef.current.muted = val === 0
    }
    setMuted(val === 0)
  }, [])

  if (!file || file.file_type !== 'video') return null

  const progress = duration ? (currentTime / duration) * 100 : 0

  // Size the player box to the video's "contain" fit within the measured slot.
  // We fit the video into (slot width, slot height − controls), then add the
  // controls height back so the whole box hugs the video on every side.
  const ar = file.width && file.height ? file.width / file.height : 16 / 9
  // Minimum box width so narrow (portrait) videos don't squish the controls bar.
  const MIN_BOX_W = 680
  const boxStyle = (() => {
    if (isFullscreen || !slot.w || !slot.h) return undefined
    const availH = Math.max(0, slot.h - slot.ctrl)
    let vW = slot.w
    let vH = vW / ar
    if (vH > availH) { vH = availH; vW = vH * ar }
    // Widen the box (not the video) to fit the controls; the video pillarboxes inside.
    const boxW = Math.min(slot.w, Math.max(vW, MIN_BOX_W))
    return { width: `${Math.round(boxW)}px`, height: `${Math.round(vH + slot.ctrl)}px` }
  })()

  const box = (
    <div
      ref={containerRef}
      style={boxStyle}
      className={`bg-black overflow-hidden flex flex-col min-h-0
        ${isFullscreen ? 'fixed inset-0 z-50 w-full h-full' : 'rounded-xl'}`}
    >
      <video
        ref={videoRef}
        src={streamUrl(file.id)}
        className="flex-1 min-h-0 w-full object-contain cursor-pointer block"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => { if (!isScrubbing) setCurrentTime(videoRef.current?.currentTime || 0) }}
        onLoadedMetadata={() => { setDuration(videoRef.current?.duration || 0); videoRef.current?.play().catch(() => {}) }}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        preload="metadata"
      />

      {/* Controls — always dark */}
      <div ref={controlsRef} className="px-4 py-3 space-y-2 bg-zinc-950/95 flex-shrink-0">
        <div
          ref={scrubBarRef}
          className={`relative h-1.5 bg-zinc-700 rounded-full group
            ${isScrubbing ? 'cursor-grabbing' : 'cursor-pointer'}`}
          onMouseDown={handleScrubStart}
        >
          <div
            className="absolute inset-y-0 left-0 bg-brand rounded-full transition-none"
            style={{ width: `${progress}%` }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full transition-opacity
              ${isScrubbing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => stepFrame(-1)} className="p-1 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Prev frame (←)">
            <SkipBack size={14} />
          </button>
          <button onClick={togglePlay} className="btn-primary px-3 py-1.5" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button onClick={() => stepFrame(1)} className="p-1 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Next frame (→)">
            <SkipForward size={14} />
          </button>
          <span className="text-xs text-zinc-400 font-mono tabular-nums ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {RATES.map((r) => (
              <button
                key={r}
                onClick={() => setPlaybackRate(r)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer
                  ${rate === r ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                {r}x
              </button>
            ))}
          </div>

          <button
            onClick={() => { const v = videoRef.current; if (!v) return; v.muted = !muted; setMuted(!muted) }}
            className="p-1 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
            onChange={handleVolumeChange} className="w-20 accent-brand" aria-label="Volume" />

          <button onClick={toggleFullscreen} className="p-1 text-zinc-300 hover:text-white transition-colors cursor-pointer ml-1"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
    </div>
  )

  if (isFullscreen) return box

  // The slot fills the available area; the box is centered and sized to fit it.
  return (
    <div ref={slotRef} className="w-full h-full flex items-center justify-start">
      {box}
    </div>
  )
}
