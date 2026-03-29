declare global {
  interface Window {
    ipc?: { postMessage(msg: string): void };
  }
}

export function windowCommand(cmd: string) {
  window.ipc?.postMessage(cmd);
}
