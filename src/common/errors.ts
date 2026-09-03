/**
 * Domain errors carry an HTTP status but never import from @nestjs/*: the domain layer
 * must stay usable from a CLI, a test or a future desktop process without a web server.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`, 'not_found', 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = 'conflict') {
    super(message, code, 409);
  }
}

export class InvalidRequestError extends DomainError {
  constructor(message: string, code = 'invalid_request') {
    super(message, code, 400);
  }
}
