// Base for every typed error that carries its own HTTP status and a message
// safe to show the client. Thrown deep in a service/controller/middleware,
// caught once by handleHttpError - callers never format a response by hand.
// Domain-specific errors (e.g. services/auth/auth.errors.ts) extend this
// directly; the ones below are generic enough to reuse across any resource
// route (items, admins, pricing-rules, ...).
export class HttpError extends Error {
	statusCode: number;
	clientMessage: string;

	constructor(message: string, statusCode: number, clientMessage: string) {
		super(message);
		this.statusCode = statusCode;
		this.clientMessage = clientMessage;
		this.name = new.target.name;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class UnauthorizedError extends HttpError {
	constructor(message = 'Not authenticated', clientMessage = 'Invalid session') {
		super(message, 401, clientMessage);
	}
}

export class ForbiddenError extends HttpError {
	constructor(message = 'Not permitted', clientMessage = 'Forbidden') {
		super(message, 403, clientMessage);
	}
}

export class NotFoundError extends HttpError {
	constructor(resource: string) {
		super(`${resource} not found`, 404, `${resource} not found`);
	}
}

export class ValidationError extends HttpError {
	constructor(message: string) {
		super(message, 400, message);
	}
}

export class ConflictError extends HttpError {
	constructor(message: string) {
		super(message, 409, message);
	}
}
