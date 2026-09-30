/**
 * Tiny bilingual layer (简体中文 / English). Strings live next to their use as L('中文', 'English');
 * data tables carry `{ zh, en }` pairs. Listeners rebuild DOM and 3D labels when the language flips.
 */
export type Lang = 'zh' | 'en'
export type Txt = { zh: string; en: string }

let lang: Lang = 'zh'
const listeners = new Set<(l: Lang) => void>()

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  if (typeof document !== 'undefined') document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
  for (const f of listeners) f(next)
}

export function onLang(f: (l: Lang) => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Pick the string for the current language. */
export function L(zh: string, en: string): string {
  return lang === 'en' ? en : zh
}

export function T(t: Txt): string {
  return lang === 'en' ? t.en : t.zh
}
