import { HttpError } from '../../errors/HttpError';

// Every auth-specific error, grouped under one domain marker so a catch
// block can tell "this came from the auth layer" apart from a generic
// HttpError if it ever needs to. Each still carries its own status/message -
// see errors/handleHttpError.ts for the one place that formats these.
export class AuthError extends HttpError {}

export class MissingRefreshTokenError extends AuthError {
	constructor(message = 'No jwt cookie present on request') {
		super(
			message,
			401,
			'Oturum yenileme bilgisi eksik. Lütfen yeniden giriş yapın.',
		);
	}
}

export class RevokedSessionError extends AuthError {
	constructor(message = 'Refresh token session no longer exists') {
		super(
			message,
			401,
			'Oturumunuz sonlandırıldı. Lütfen yeniden giriş yapın.',
		);
	}
}

export class ExpiredRefreshTokenError extends AuthError {
	constructor(message = 'Refresh token exp claim has passed') {
		super(
			message,
			401,
			'Oturum yenileme süresi doldu. Lütfen yeniden giriş yapın.',
		);
	}
}

export class InvalidRefreshToken extends AuthError {
	constructor(message = 'Refresh token failed verification') {
		super(
			message,
			401,
			'Oturum yenileme bilgisi geçersiz. Lütfen yeniden giriş yapın.',
		);
	}
}

export class MissingAccessTokenError extends AuthError {
	constructor(message = 'No Bearer access token present on request') {
		super(message, 401, 'Giriş bilgisi eksik. Lütfen giriş yapın.');
	}
}

export class AccessTokenExpiredError extends AuthError {
	constructor(message = 'Access token exp claim has passed, refresh required') {
		super(message, 401, 'Oturum süresi doldu. Lütfen yeniden giriş yapın.');
	}
}

export class InvalidAccessTokenError extends AuthError {
	constructor(message = 'Access token failed signature/format verification') {
		super(message, 401, 'Giriş bilgisi geçersiz. Lütfen yeniden giriş yapın.');
	}
}

export class InvalidCredentialsError extends AuthError {
	constructor(message = 'Email/password did not match a user record') {
		super(message, 401, 'E-posta adresi veya şifre hatalı.');
	}
}

export class InvalidSessionError extends AuthError {
	constructor(
		message = 'userId from refresh token has no matching user record',
	) {
		super(message, 401, 'Oturum geçersiz. Lütfen yeniden giriş yapın.');
	}
}

export class AuthResponseError extends AuthError {
	constructor(message = 'Failed to issue auth response') {
		super(message, 500, 'Giriş işlemi tamamlanamadı. Lütfen tekrar deneyin.');
	}
}
