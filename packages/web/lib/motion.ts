/** Stagger helper: the i-th row prints i×step ms after the first. Pure CSS animation; no JS on the client. */
export const delay = (i: number, step = 35, base = 0): { animationDelay: string } => ({ animationDelay: `${base + i * step}ms` })
