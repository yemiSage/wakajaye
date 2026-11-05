export const paymentCharges = [
  ['houseRent', 'House rent'],
  ['electricity', 'Electricity (light)'],
  ['sanitation', 'Sanitation'],
];

export const maxPaymentKobo = 100_000_000_000;
export const fixedPaymentCharges = Object.freeze({ electricity: 42_000, sanitation: 12_000 });

export function amountInKobo(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const [naira, kobo = ''] = value.split('.');
  return Number(naira) * 100 + Number(kobo.padEnd(2, '0'));
}

export function paymentLines(rent) {
  // Keep historical totals intact when a payment used the retired charge.
  if (!rent.charges || rent.charges.other > 0) return [['Rent payment', rent.amount]];
  return paymentCharges.filter(([key]) => rent.charges[key] > 0)
    .map(([key, label]) => [label, rent.charges[key]]);
}
