export class EngineError extends Error {
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown>) {
    super(message);
  }
}
