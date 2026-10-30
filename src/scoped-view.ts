/** Keep IDs, label targets and SVG references unique across simultaneous views. */
export function scopedMarkup(markup: string, prefix: string) {
  return markup.replace(/id="([^"]+)"/g, (_, id: string) => `data-view="${id}" id="${prefix}-${id}"`)
    .replace(/for="([^"]+)"/g, (_, id: string) => `for="${prefix}-${id}"`)
    .replace(/aria-labelledby="([^"]+)"/g, (_, ids: string) => `aria-labelledby="${ids.split(' ').map(id => `${prefix}-${id}`).join(' ')}"`);
}
