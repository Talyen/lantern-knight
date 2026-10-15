// Bridge existing release/close contracts to lexical resource ownership. Native
// stacks retain an operation failure when cleanup also fails (SuppressedError).
export function onExit(action: () => void): Disposable {
  const scope = new DisposableStack();
  scope.defer(action);
  return scope;
}
export function onAsyncExit(action: () => void | PromiseLike<void>): AsyncDisposable {
  const scope = new AsyncDisposableStack();
  scope.defer(action);
  return scope;
}
