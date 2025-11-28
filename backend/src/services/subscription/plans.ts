export interface SubscriptionPlan {
  code: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  limits: {
    broadcast_limit: number;
    parsing_limit: number;
    audience_limit: number;
  };
  features: string[];
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    code: "free",
    name: "Free",
    price: 0,
    currency: "RUB",
    durationDays: 0,
    limits: {
      broadcast_limit: 0,
      parsing_limit: 3,
      audience_limit: 1,
    },
    features: [
      "Basic channel search",
      "Limited parsing",
      "Single audience segment",
    ],
  },
  {
    code: "week",
    name: "Weekly",
    price: 490,
    currency: "RUB",
    durationDays: 7,
    limits: {
      broadcast_limit: 10,
      parsing_limit: 20,
      audience_limit: 5,
    },
    features: [
      "Advanced search",
      "20 parsing requests per week",
      "Up to 5 audience segments",
      "10 broadcast messages",
    ],
  },
  {
    code: "month",
    name: "Monthly",
    price: 1490,
    currency: "RUB",
    durationDays: 30,
    limits: {
      broadcast_limit: 50,
      parsing_limit: 100,
      audience_limit: 20,
    },
    features: [
      "Full search capabilities",
      "100 parsing requests per month",
      "Up to 20 audience segments",
      "50 broadcast messages",
      "Priority support",
    ],
  },
  {
    code: "year",
    name: "Yearly",
    price: 14900,
    currency: "RUB",
    durationDays: 365,
    limits: {
      broadcast_limit: 1000,
      parsing_limit: 2000,
      audience_limit: 100,
    },
    features: [
      "Unlimited search",
      "2000 parsing requests per year",
      "Up to 100 audience segments",
      "1000 broadcast messages",
      "Priority support",
      "Dedicated account manager",
    ],
  },
];

export function getPlanByCode(code: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((plan) => plan.code === code);
}

export function getFreePlan(): SubscriptionPlan {
  const freePlan = getPlanByCode("free");
  if (!freePlan) {
    throw new Error("Free plan not configured");
  }
  return freePlan;
}
