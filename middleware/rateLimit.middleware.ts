import { rateLimit } from 'express-rate-limit';
import { SITE_ROUTES } from '../routes/routes.constant';

// In-memory store (the default) - fine as long as this runs as a single
// process. If it's ever scaled to multiple instances/replicas behind a load
// balancer, swap the `store` option for a shared one (e.g. Redis), otherwise
// each replica counts requests separately and the limit stops being real.

export const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 300,
	standardHeaders: true,
	legacyHeaders: false,
	// Polled every 30s per open tab and served from memory - counting it
	// would lock out several visitors sharing one IP.
	skip: (req) => req.method === 'GET' && req.path === SITE_ROUTES.STATUS,
});

// Login is brute-forceable (guess a password repeatedly) in a way generic
// API abuse isn't, so it gets its own much tighter window.
export const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: 'Too many login attempts - try again later' },
});
