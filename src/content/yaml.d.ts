declare module '*.yaml' {
  const data: unknown
  export default data
}

/** Every content file, validated at build time (src/content/vite-plugin-content.ts). */
declare module 'virtual:bcps-content' {
  const content: import('./schema').Content
  export default content
}

/** Canonical public URL used for payment payloads on non-https builds (Vite define). */
declare const __CANONICAL_URL__: string
