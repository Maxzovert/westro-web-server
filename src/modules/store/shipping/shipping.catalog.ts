export type ShippingMethod = {
  id: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
};

const METHODS: ShippingMethod[] = [
  {
    id: "standard",
    name: "Standard",
    description: "Delivery in 5–7 business days",
    amount: 99,
    currency: "INR",
    estimatedDaysMin: 5,
    estimatedDaysMax: 7,
  },
  {
    id: "express",
    name: "Express",
    description: "Delivery in 2–3 business days",
    amount: 199,
    currency: "INR",
    estimatedDaysMin: 2,
    estimatedDaysMax: 3,
  },
];

export function listShippingMethods(): ShippingMethod[] {
  return METHODS.map((method) => ({ ...method }));
}

export function findShippingMethod(id: string): ShippingMethod | null {
  return METHODS.find((method) => method.id === id) ?? null;
}
