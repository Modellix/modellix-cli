export const MODEL_TYPES = [
  'text-to-image',
  'text-to-video',
  'image-to-image',
  'image-to-video',
  'video-to-video',
] as const

export type ModelType = (typeof MODEL_TYPES)[number]
