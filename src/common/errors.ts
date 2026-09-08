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

export class ProviderError extends DomainError {
  constructor(
    message: string,
    code = 'provider_error',
    httpStatus = 502,
    readonly retryable = false,
  ) {
    super(message, code, httpStatus);
  }
}
