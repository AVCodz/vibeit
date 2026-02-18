import type { Metadata } from "next";
import { GoDotFill } from "react-icons/go";
import { HiUser, HiRocketLaunch, HiBuildingOffice2 } from "react-icons/hi2";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FiCheckCircle } from "react-icons/fi";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing — VibeIt",
  description:
    "Choose the perfect plan for your needs. Start building AI-generated websites for free, or upgrade for advanced export options and unlimited generations.",
};

const tiers = [
  {
    name: "Basic",
    icon: HiUser,
    price: "Free",
    period: null,
    originalPrice: null,
    description: "Perfect for individuals",
    features: [
      "3 AI Website Generations / month",
      "Standard Response Speed",
      "Basic UI Components",
      "Community Support",
      "VibeIt Subdomain",
      "Basic Code Export",
      "Single Project",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Pro",
    icon: HiRocketLaunch,
    price: "$19",
    period: "/month",
    originalPrice: "$29",
    description: "Ideal for developers and designers",
    features: [
      "All Basic Plan Features",
      "Unlimited AI Generations",
      "Fast Response Speed",
      "Full Code Export (React + Tailwind)",
      "Premium Components",
      "Priority Support",
      "Custom Domain Connection",
      "Multiple Projects",
      "Advanced Reporting",
    ],
    cta: "Get Started",
    popular: true,
  },
  {
    name: "Enterprise",
    icon: HiBuildingOffice2,
    price: "$49",
    period: "/month",
    originalPrice: "$79",
    description: "Perfect for teams and agencies",
    features: [
      "All Pro Plan Features",
      "Dedicated Account Manager",
      "White-label Options",
      "Advanced Security Features",
      "Team Collaboration Tools",
      "Onboarding and Training",
      "Unlimited Users",
      "API Access with Higher Limits",
      "Commercial License",
    ],
    cta: "Get Started",
    popular: false,
  },
];

function CornerDots() {
  return (
    <>
      <GoDotFill className="absolute z-10 top-1.5 left-1.5 size-3 text-muted-foreground" />
      <GoDotFill className="absolute z-10 top-1.5 right-1.5 size-3 text-muted-foreground" />
      <GoDotFill className="absolute z-10 bottom-1.5 left-1.5 size-3 text-muted-foreground" />
      <GoDotFill className="absolute z-10 bottom-1.5 right-1.5 size-3 text-muted-foreground" />
    </>
  );
}

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-5xl py-16 px-6 sm:pb-24 pt-16">
      <div className="mb-12 text-center sm:mb-12">
        <p className="animate-fade-up mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground opacity-0 [animation-delay:200ms]">
          Pricing Plans
        </p>
        <h1 className="animate-fade-up text-3xl font-bold tracking-tight opacity-0 [animation-delay:400ms] sm:text-4xl">
          Simple, Transparent Pricing
          <br />
          for Every Builder
        </h1>
        <p className="animate-fade-up mx-auto mt-4 max-w-2xl text-base text-muted-foreground opacity-0 [animation-delay:600ms]">
          Whether you&apos;re just experimenting or shipping production apps, we have
          a plan that fits your workflow. No hidden fees.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {tiers.map((tier, i) => (
          <div
            key={tier.name}
            className={cn(
              "animate-fade-up overflow-hidden rounded-xl border bg-card opacity-0",
              tier.popular
                ? "border-border/60 shadow-lg lg:-translate-y-4"
                : "border-border/40",
            )}
            style={{ animationDelay: `${800 + i * 100}ms` }}
          >
            {/* Top section — inner bordered area with corner dots */}
            <div className="relative m-3 rounded-lg border border-border/30 bg-background/60 overflow-hidden">
              <CornerDots />
              <div className="relative z-0 p-5">
                {/* Tier name + badge */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <tier.icon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-semibold tracking-tight">
                      {tier.name}
                    </span>
                  </div>
                  {tier.popular && (
                    <span className="rounded-md border border-border/60 bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-foreground">
                      Popular
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="mb-5 flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight">
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-sm text-muted-foreground">
                      {tier.period}
                    </span>
                  )}
                  {tier.originalPrice && (
                    <span className="ml-auto text-lg text-muted-foreground/50 line-through">
                      {tier.originalPrice}
                    </span>
                  )}
                </div>

                {/* CTA */}
                <Button
                  asChild
                  className={cn(
                    "w-full",
                    tier.popular
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "",
                  )}
                  variant={tier.popular ? "default" : "outline"}
                >
                  <Link href="/auth">{tier.cta}</Link>
                </Button>
              </div>
            </div>

            {/* Bottom section — description + feature list */}
            <div className="px-5 pb-5 pt-1">
              <p className="mb-4 text-sm text-foreground/80">
                {tier.description}
              </p>
              <ul className="space-y-3">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2.5 text-sm text-foreground/80"
                  >
                    <FiCheckCircle className="size-4 shrink-0 text-foreground/80" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
