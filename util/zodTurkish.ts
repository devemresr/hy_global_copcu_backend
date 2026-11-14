import { z, type ZodErrorMap } from 'zod';

// Schema-specific Turkish messages take precedence over these defaults.
const turkishErrorMap: ZodErrorMap = (issue) => {
	let message = 'Geçersiz değer.';
	switch (issue.code) {
		case 'invalid_type':
			message =
				issue.received === 'undefined'
					? 'Bu alan zorunludur.'
					: issue.expected === 'integer'
						? 'Tam sayı girin.'
						: issue.expected === 'number'
							? 'Geçerli bir sayı girin.'
							: 'Bu alan için geçerli bir değer girin.';
			break;
		case 'invalid_string':
			message =
				issue.validation === 'email'
					? 'Geçerli bir e-posta adresi girin.'
					: issue.validation === 'datetime'
						? 'Geçerli bir tarih ve saat girin.'
						: 'Geçerli biçimde bir değer girin.';
			break;
		case 'too_small':
		case 'too_big': {
			const small = issue.code === 'too_small';
			const limit = small ? issue.minimum : issue.maximum;
			if (
				issue.type === 'string' ||
				issue.type === 'array' ||
				issue.type === 'set'
			) {
				const unit = issue.type === 'string' ? 'karakter' : 'öğe';
				message = issue.exact
					? `Tam olarak ${limit} ${unit} girin.`
					: `${small ? 'En az' : 'En fazla'} ${limit} ${unit} girin.`;
			} else {
				message = issue.exact
					? `Değer ${limit} olmalıdır.`
					: issue.inclusive
						? `Değer ${limit} sınırına eşit veya bu sınırdan ${small ? 'büyük' : 'küçük'} olmalıdır.`
						: `Değer ${limit} sınırından ${small ? 'büyük' : 'küçük'} olmalıdır.`;
			}
			break;
		}
		case 'invalid_enum_value':
		case 'invalid_literal':
			message = 'Geçerli bir seçenek seçin.';
			break;
		case 'unrecognized_keys':
			message = 'İstek tanınmayan alanlar içeriyor.';
			break;
		case 'invalid_date':
			message = 'Geçerli bir tarih girin.';
			break;
		case 'not_finite':
			message = 'Sonlu bir sayı girin.';
			break;
		case 'not_multiple_of':
			message = `Değer ${issue.multipleOf} sayısının katı olmalıdır.`;
			break;
	}
	return { message };
};

z.setErrorMap(turkishErrorMap);
export { z };
