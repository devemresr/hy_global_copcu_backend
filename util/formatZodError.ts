import type { ZodError } from 'zod';

// Shared by validateBody.middleware.ts and any controller that parses its
// own req.query (Express 5 makes req.query a getter, so query validation
// can't reuse a body-reassigning middleware the same way).
export function formatZodError(error: ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
		.join('; ');
}
