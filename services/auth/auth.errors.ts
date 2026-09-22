import { HttpError } from '../../errors/HttpError';

// Every auth-specific error, grouped under one domain marker so a catch
// block can tell "this came from the auth layer" apart from a generic
// HttpError if it ever needs to. Each still carries its own status/message -
// see errors/handleHttpError.ts for the one place that formats these.
export class AuthError extends HttpError {}

export class MissingRefreshTokenError extends AuthError {
	constructor(message = 'No jwt cookie present on request') {
		super(message, 401, 'No refresh token provided');
	}
}

export class RevokedSessionError extends AuthError {
	constructor(message = 'Refresh token jti found in the session blacklist') {
		super(message, 401, 'Session has been revoked');
	}
}

export class ExpiredRefreshTokenError extends AuthError {
	constructor(message = 'Refresh token exp claim has passed') {
		super(message, 401, 'Refresh token expired');
	}
}

export class InvalidRefreshToken extends AuthError {
	constructor(message = 'Refresh token failed verification') {
		super(message, 401, 'Invalid refresh token');
	}
}

export class MissingAccessTokenError extends AuthError {
	constructor(message = 'No Bearer access token present on request') {
		super(message, 401, 'No access token provided');
	}
}

export class AccessTokenExpiredError extends AuthError {
	constructor(message = 'Access token exp claim has passed, refresh required') {
		super(message, 401, 'Access token expired');
	}
}

export class InvalidCredentialsError extends AuthError {
	constructor(message = 'Email/password did not match a user record') {
		super(message, 401, 'Invalid credentials');
	}
}

export class InvalidSessionError extends AuthError {
	constructor(message = 'userId from refresh token has no matching user record') {
		super(message, 401, 'Invalid session');
	}
}

export class AuthResponseError extends AuthError {
	constructor(message = 'Failed to issue auth response') {
		super(message, 500, 'Authentication response failed');
	}
}
