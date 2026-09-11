export interface RememberedDialogueMessage {
  author: string;
  text: string;
  kind: string;
}

const dialogueMessages = new Map<string, RememberedDialogueMessage[]>();

/**
 * Yalnizca mevcut sayfa omru boyunca tutulan roleplay gorusme kaydi.
 * localStorage/sessionStorage kullanmaz; sayfa yenilenince kendiliginden silinir.
 */
export function rememberDialogueMessage(location: string, message: RememberedDialogueMessage): void {
  const messages = dialogueMessages.get(location) ?? [];
  messages.push(message);
  dialogueMessages.set(location, messages);
}

export function getRememberedDialogue(location: string): readonly RememberedDialogueMessage[] {
  return dialogueMessages.get(location) ?? [];
}

export function clearRememberedDialogues(): void {
  dialogueMessages.clear();
}
