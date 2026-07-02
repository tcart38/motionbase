import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function probeVideo(filepath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filepath,
  ])

  const data = JSON.parse(stdout)
  const videoStream = data.streams?.find((s) => s.codec_type === 'video')
  const format = data.format || {}

  let fps = null
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number)
    if (den) fps = parseFloat((num / den).toFixed(4))
  }

  return {
    duration: format.duration ? parseFloat(format.duration) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    fps,
  }
}

export async function probeImage(filepath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    filepath,
  ])

  const data = JSON.parse(stdout)
  const stream = data.streams?.find((s) => s.codec_type === 'video')
  return {
    duration: null,
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    fps: null,
  }
}

export async function generateThumbnail(filepath, fileType, outPath, duration) {
  const seekTime = fileType === 'video' && duration
    ? String(Math.min(3, duration * 0.1))
    : '0'

  const args = fileType === 'video'
    ? ['-ss', seekTime, '-i', filepath, '-vf', 'scale=480:-2', '-vframes', '1', '-y', outPath]
    : ['-i', filepath, '-vf', 'scale=480:-2', '-vframes', '1', '-y', outPath]

  await execFileAsync('ffmpeg', args)
}
