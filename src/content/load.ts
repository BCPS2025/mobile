import data from 'virtual:bcps-content'
import type { Content } from './schema'

/** All content, validated at build time by vite-plugin-content (plain JSON at run time). */
export const content: Content = data

export const copyText = content.copy
