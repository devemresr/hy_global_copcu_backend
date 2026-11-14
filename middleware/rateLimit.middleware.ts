import { rateLimit } from 'express-rate-limit';

// In-memory store (the default) - fine as long as this runs as a single
// process. If it's ever scaled to multiple instances/replicas behind a load
// balancer, swap the `store` option for a shared one (e.g. Redis), otherwise
// each replica counts requests separately and the limit stops being real.

export const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 300,
	message: {
		error: 'Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.',
	},
	standardHeaders: true,
	legacyHeaders: false,
});

// Login is brute-forceable (guess a password repeatedly) in a way generic
// API abuse isn't, so it gets its own much tighter window.
export const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		error:
			'Çok fazla giriş denemesi yaptınız. Lütfen daha sonra tekrar deneyin.',
	},
});
