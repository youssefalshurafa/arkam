// Country dial codes for the signup WhatsApp/phone field. `flag` is a plain emoji so no image
// assets are needed. The default selection (see DEFAULT_DIAL_CODE) targets the app's primary
// MENA audience. Kept broad but curated — add entries as needed.

export type CountryDialCode = {
 code: string; // ISO 3166-1 alpha-2
 dial: string; // E.164 country calling code, incl. leading '+'
 name: string;
 flag: string;
};

export const DEFAULT_DIAL_CODE = '+20'; // Egypt

// Sorted alphabetically by name. Dial codes are not unique (e.g. +1 covers US/CA), which is fine —
// the value we persist is just the dial code prefixed to the national number.
export const COUNTRY_DIAL_CODES: CountryDialCode[] = [
 { code: 'DZ', dial: '+213', name: 'Algeria', flag: '🇩🇿' },
 { code: 'AR', dial: '+54', name: 'Argentina', flag: '🇦🇷' },
 { code: 'AU', dial: '+61', name: 'Australia', flag: '🇦🇺' },
 { code: 'AT', dial: '+43', name: 'Austria', flag: '🇦🇹' },
 { code: 'BH', dial: '+973', name: 'Bahrain', flag: '🇧🇭' },
 { code: 'BD', dial: '+880', name: 'Bangladesh', flag: '🇧🇩' },
 { code: 'BE', dial: '+32', name: 'Belgium', flag: '🇧🇪' },
 { code: 'BR', dial: '+55', name: 'Brazil', flag: '🇧🇷' },
 { code: 'CA', dial: '+1', name: 'Canada', flag: '🇨🇦' },
 { code: 'CN', dial: '+86', name: 'China', flag: '🇨🇳' },
 { code: 'CO', dial: '+57', name: 'Colombia', flag: '🇨🇴' },
 { code: 'DK', dial: '+45', name: 'Denmark', flag: '🇩🇰' },
 { code: 'EG', dial: '+20', name: 'Egypt', flag: '🇪🇬' },
 { code: 'FI', dial: '+358', name: 'Finland', flag: '🇫🇮' },
 { code: 'FR', dial: '+33', name: 'France', flag: '🇫🇷' },
 { code: 'DE', dial: '+49', name: 'Germany', flag: '🇩🇪' },
 { code: 'GH', dial: '+233', name: 'Ghana', flag: '🇬🇭' },
 { code: 'GR', dial: '+30', name: 'Greece', flag: '🇬🇷' },
 { code: 'IN', dial: '+91', name: 'India', flag: '🇮🇳' },
 { code: 'ID', dial: '+62', name: 'Indonesia', flag: '🇮🇩' },
 { code: 'IQ', dial: '+964', name: 'Iraq', flag: '🇮🇶' },
 { code: 'IE', dial: '+353', name: 'Ireland', flag: '🇮🇪' },
 { code: 'IT', dial: '+39', name: 'Italy', flag: '🇮🇹' },
 { code: 'JP', dial: '+81', name: 'Japan', flag: '🇯🇵' },
 { code: 'JO', dial: '+962', name: 'Jordan', flag: '🇯🇴' },
 { code: 'KE', dial: '+254', name: 'Kenya', flag: '🇰🇪' },
 { code: 'KW', dial: '+965', name: 'Kuwait', flag: '🇰🇼' },
 { code: 'LB', dial: '+961', name: 'Lebanon', flag: '🇱🇧' },
 { code: 'LY', dial: '+218', name: 'Libya', flag: '🇱🇾' },
 { code: 'MY', dial: '+60', name: 'Malaysia', flag: '🇲🇾' },
 { code: 'MA', dial: '+212', name: 'Morocco', flag: '🇲🇦' },
 { code: 'NL', dial: '+31', name: 'Netherlands', flag: '🇳🇱' },
 { code: 'NZ', dial: '+64', name: 'New Zealand', flag: '🇳🇿' },
 { code: 'NG', dial: '+234', name: 'Nigeria', flag: '🇳🇬' },
 { code: 'NO', dial: '+47', name: 'Norway', flag: '🇳🇴' },
 { code: 'OM', dial: '+968', name: 'Oman', flag: '🇴🇲' },
 { code: 'PK', dial: '+92', name: 'Pakistan', flag: '🇵🇰' },
 { code: 'PS', dial: '+970', name: 'Palestine', flag: '🇵🇸' },
 { code: 'PH', dial: '+63', name: 'Philippines', flag: '🇵🇭' },
 { code: 'PL', dial: '+48', name: 'Poland', flag: '🇵🇱' },
 { code: 'PT', dial: '+351', name: 'Portugal', flag: '🇵🇹' },
 { code: 'QA', dial: '+974', name: 'Qatar', flag: '🇶🇦' },
 { code: 'RO', dial: '+40', name: 'Romania', flag: '🇷🇴' },
 { code: 'RU', dial: '+7', name: 'Russia', flag: '🇷🇺' },
 { code: 'SA', dial: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
 { code: 'SN', dial: '+221', name: 'Senegal', flag: '🇸🇳' },
 { code: 'SG', dial: '+65', name: 'Singapore', flag: '🇸🇬' },
 { code: 'ZA', dial: '+27', name: 'South Africa', flag: '🇿🇦' },
 { code: 'KR', dial: '+82', name: 'South Korea', flag: '🇰🇷' },
 { code: 'ES', dial: '+34', name: 'Spain', flag: '🇪🇸' },
 { code: 'SD', dial: '+249', name: 'Sudan', flag: '🇸🇩' },
 { code: 'SE', dial: '+46', name: 'Sweden', flag: '🇸🇪' },
 { code: 'CH', dial: '+41', name: 'Switzerland', flag: '🇨🇭' },
 { code: 'SY', dial: '+963', name: 'Syria', flag: '🇸🇾' },
 { code: 'TW', dial: '+886', name: 'Taiwan', flag: '🇹🇼' },
 { code: 'TZ', dial: '+255', name: 'Tanzania', flag: '🇹🇿' },
 { code: 'TH', dial: '+66', name: 'Thailand', flag: '🇹🇭' },
 { code: 'TN', dial: '+216', name: 'Tunisia', flag: '🇹🇳' },
 { code: 'TR', dial: '+90', name: 'Turkey', flag: '🇹🇷' },
 { code: 'AE', dial: '+971', name: 'United Arab Emirates', flag: '🇦🇪' },
 { code: 'GB', dial: '+44', name: 'United Kingdom', flag: '🇬🇧' },
 { code: 'US', dial: '+1', name: 'United States', flag: '🇺🇸' },
 { code: 'YE', dial: '+967', name: 'Yemen', flag: '🇾🇪' },
];
