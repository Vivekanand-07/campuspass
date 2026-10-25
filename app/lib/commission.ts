export const PLATFORM_COMMISSION_RATE = 0.02;

export function calculateCommission(amountInRupees: number) {
  if (!Number.isFinite(amountInRupees) || amountInRupees < 0) {
    throw new Error("Invalid payment amount");
  }

  const totalPaise = Math.round(amountInRupees * 100);
  const commissionPaise = Math.round(
    totalPaise * PLATFORM_COMMISSION_RATE
  );

  const organizerPaise = totalPaise - commissionPaise;

  return {
    totalAmount: totalPaise / 100,
    commission: commissionPaise / 100,
    organizerAmount: organizerPaise / 100,
  };
}