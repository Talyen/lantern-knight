export class EditorConfirmation {
  private dialog = document.createElement('dialog');
  private resolve: ((accepted: boolean) => void) | undefined;

  constructor() {
    this.dialog.id = 'editor-confirmation';
    this.dialog.setAttribute('aria-labelledby', 'confirmation-title');
    this.dialog.setAttribute('aria-describedby', 'confirmation-message');
    this.dialog.innerHTML =
      '<form method="dialog"><h2 id="confirmation-title">Confirm action</h2><p id="confirmation-message"></p><div><button value="cancel" autofocus>Cancel</button><button id="confirmation-accept" value="accept"></button></div></form>';
    document.getElementById('app')!.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      const resolve = this.resolve;
      this.resolve = undefined;
      resolve?.(this.dialog.returnValue === 'accept');
    });
  }

  ask(message: string, action: string): Promise<boolean> {
    if (this.resolve) return Promise.resolve(false);
    this.dialog.querySelector('#confirmation-message')!.textContent = message;
    this.dialog.querySelector('#confirmation-accept')!.textContent = action;
    this.dialog.returnValue = 'cancel';
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.dialog.showModal();
    });
  }

  dispose() {
    this.resolve?.(false);
    this.resolve = undefined;
    this.dialog.remove();
  }
}
