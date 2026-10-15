export class EditorConfirmation {
  private dialog = document.getElementById('editor-confirmation') as HTMLDialogElement;
  private resolve: ((accepted: boolean) => void) | undefined;

  constructor() {
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
