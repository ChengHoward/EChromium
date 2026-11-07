import type { BookmarkImportNode } from '../shared/bookmark-folders'

/** Read only names and href attributes from an inert document; never attach imported DOM. */
export function parseBookmarkHtml(source: string): BookmarkImportNode[] {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  let count = 0
  function list(element: Element, depth: number): BookmarkImportNode[] {
    if (depth > 12) throw new Error('导入的文件夹层级超过 12 层。')
    const rows: BookmarkImportNode[] = [],
      consumed = new Set<Element>()
    for (const child of element.children) {
      if (consumed.has(child)) continue
      const heading = child.tagName === 'DT' ? child.querySelector(':scope > h3') : null
      const anchor =
        child.tagName === 'A' ? child : child.tagName === 'DT' ? child.querySelector(':scope > a') : null
      if (heading) {
        if (++count > 5000) throw new Error('一次最多导入 5000 个书签与文件夹。')
        const nested =
          child.querySelector(':scope > dl') ||
          (child.nextElementSibling?.tagName === 'DL' ? child.nextElementSibling : null)
        if (nested) consumed.add(nested)
        rows.push({ title: heading.textContent || '', children: nested ? list(nested, depth + 1) : [] })
      } else if (anchor) {
        if (++count > 5000) throw new Error('一次最多导入 5000 个书签与文件夹。')
        rows.push({ title: anchor.textContent || '', url: anchor.getAttribute('href') || '' })
      } else if (child.tagName === 'DL') rows.push(...list(child, depth))
    }
    return rows
  }
  return list(doc.querySelector('dl') || doc.body, 0)
}
