export const DRAWING_COLORS = [
  '#FF0000',
  '#00FF00',
  '#0080FF',
  '#FFFF00',
  '#FFFFFF',
  '#000000',
] as const;

export type DrawingColor = (typeof DRAWING_COLORS)[number];
