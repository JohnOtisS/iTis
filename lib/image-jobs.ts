declare global {
  var __itisImageControllers: Map<string, AbortController> | undefined;
}

const controllers = globalThis.__itisImageControllers ?? new Map<string, AbortController>();
globalThis.__itisImageControllers = controllers;

export function registerImageJob(id: string, controller: AbortController) {
  controllers.set(id, controller);
}

export function abortImageJob(id: string) {
  const controller = controllers.get(id);
  controller?.abort();
  return Boolean(controller);
}

export function releaseImageJob(id: string) {
  controllers.delete(id);
}
