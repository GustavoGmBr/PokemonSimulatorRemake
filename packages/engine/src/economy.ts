/** Ajustes de economia aplicados aos preços e às recompensas novas. */
export const itemPrice = (base: number): number => Math.ceil(base * 1.5);
export const rewardMoney = (base: number): number => Math.floor(base * 0.5);
