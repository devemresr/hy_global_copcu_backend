function sanitizeAndDetect(
	obj: any,
	depth: number = 0
): { sanitized: any; hadProhibited: boolean } {
	if (depth > 10) return { sanitized: {}, hadProhibited: false };

	if (Array.isArray(obj)) {
		let hadProhibited = false;
		const sanitized = obj.map((item) => {
			const result = sanitizeAndDetect(item, depth + 1);
			if (result.hadProhibited) hadProhibited = true;
			return result.sanitized;
		});
		return { sanitized, hadProhibited };
	}

	if (typeof obj !== 'object' || obj === null) {
		return { sanitized: obj, hadProhibited: false };
	}

	const sanitized: any = {};
	let hadProhibited = false;

	for (const key in obj) {
		// mongo-sanitize's rule: drop the whole key if it starts with '$', leave everything else untouched.
		if (/^\$/.test(key)) {
			hadProhibited = true;
			continue;
		}

		const result = sanitizeAndDetect(obj[key], depth + 1);
		sanitized[key] = result.sanitized;

		if (result.hadProhibited) {
			hadProhibited = true;
		}
	}

	return { sanitized, hadProhibited };
}

export default sanitizeAndDetect;
