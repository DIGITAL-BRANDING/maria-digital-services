export function nairaToKobo(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
  return BigInt(Math.round(amount * 100));
}

export function koboToNaira(amount: bigint): number {
  return Number(amount) / 100;
}
