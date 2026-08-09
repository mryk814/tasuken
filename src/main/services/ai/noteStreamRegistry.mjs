export class AiNoteStreamRegistry {
  #controllers = new Map();

  start(requestId) {
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{12,100}$/.test(requestId) || this.#controllers.has(requestId)) {
      throw new Error("AI stream request idが不正です。");
    }
    const controller = new AbortController();
    this.#controllers.set(requestId, controller);
    return controller;
  }

  cancel(requestId) {
    const controller = this.#controllers.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  finish(requestId) {
    return this.#controllers.delete(requestId);
  }

  has(requestId) {
    return this.#controllers.has(requestId);
  }
}
