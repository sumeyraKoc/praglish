/**
 * Phaser klavye kisayollari window seviyesindeki keydown olaylarini dinler.
 * Bir DOM input'u odaktayken yazilan harflerin oyun etkilesimi veya oda
 * gecisi olarak yorumlanmasini engellemek icin kisayol handler'larinda kullan.
 */
export function isTextEntryEvent(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}
