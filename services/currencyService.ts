// A simple helper function to get a timezone-offset-free YYYY-MM-DD string
export const toDateString = (date: Date): string => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
};

export const SUPPORTED_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'JPY'];

// Base currency is TRY. Rates are how many TRY 1 unit of the foreign currency is.
export const MOCK_RATES: { [date: string]: { [currency: string]: number } } = {
  'default':    { 'USD': 32.85, 'EUR': 35.25, 'GBP': 41.50, 'JPY': 0.21, 'TRY': 1.0 },
  '2025-10-29': { 'USD': 32.90, 'EUR': 35.30, 'GBP': 41.55, 'JPY': 0.22, 'TRY': 1.0 },
  '2025-10-28': { 'USD': 32.88, 'EUR': 35.28, 'GBP': 41.52, 'JPY': 0.21, 'TRY': 1.0 },
  '2025-10-27': { 'USD': 32.85, 'EUR': 35.25, 'GBP': 41.50, 'JPY': 0.21, 'TRY': 1.0 },
  '2025-10-26': { 'USD': 32.80, 'EUR': 35.20, 'GBP': 41.45, 'JPY': 0.20, 'TRY': 1.0 },
  '2025-10-25': { 'USD': 32.75, 'EUR': 35.15, 'GBP': 41.40, 'JPY': 0.19, 'TRY': 1.0 },
};

// Populate rates for the current date for demonstration purposes
const todayStr = toDateString(new Date());
if (!MOCK_RATES[todayStr]) {
    MOCK_RATES[todayStr] = MOCK_RATES['default'];
}


/**
 * Converts an amount from a source currency to a target currency.
 * @param amount The amount in the source currency.
 * @param sourceCurrency The currency to convert from (e.g., 'USD').
 * @param targetCurrency The currency to convert to (e.g., 'TRY').
 * @param date The date string (YYYY-MM-DD) for which to get the exchange rate.
 * @param rates The exchange rates table.
 * @returns The converted amount in the target currency.
 */
export const convertCurrency = (
    amount: number,
    sourceCurrency: string,
    targetCurrency: string,
    date: string,
    rates: typeof MOCK_RATES
): number => {
    if (!amount || sourceCurrency === targetCurrency) {
        return amount;
    }
    
    const ratesForDate = rates[date] || rates['default'];
    
    const sourceRateInBase = ratesForDate[sourceCurrency];
    const targetRateInBase = ratesForDate[targetCurrency];
    
    if (typeof sourceRateInBase !== 'number' || typeof targetRateInBase !== 'number') {
        console.warn(`Could not find exchange rate for ${sourceCurrency} or ${targetCurrency} on ${date}. Returning original amount.`);
        return amount; // Return original amount if a rate is missing
    }
    
    // 1. Convert source amount to base currency (TRY)
    const amountInBase = amount * sourceRateInBase;
    
    // 2. Convert from base currency to target currency
    return amountInBase / targetRateInBase;
};
