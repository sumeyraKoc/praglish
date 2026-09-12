export const DIALOGUE_SCROLL_STEP_PX = 10;

export const DIALOGUE_SCROLL_INTERVAL_MS = 120;

export function attachDialogueScrollControls(
  root: HTMLElement,
  messages: HTMLElement,
): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>(".dialogue-scroll-button");

  buttons.forEach((button) => {
    const direction = button.dataset.scrollDirection === "up" ? -1 : 1;
    let repeatTimer: number | undefined;

    const scrollOnce = (): void => {
      messages.scrollTop += direction * DIALOGUE_SCROLL_STEP_PX;
    };

    const stopRepeating = (): void => {
      if (repeatTimer !== undefined) {
        window.clearInterval(repeatTimer);
        repeatTimer = undefined;
      }
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      scrollOnce();
      repeatTimer = window.setInterval(scrollOnce, DIALOGUE_SCROLL_INTERVAL_MS);
    });
    button.addEventListener("pointerup", stopRepeating);
    button.addEventListener("pointercancel", stopRepeating);
    button.addEventListener("lostpointercapture", stopRepeating);
  });
}
