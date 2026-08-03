import { useEffect } from "react";
import { LandingHeader } from "./components/landing-header";
import { HeroSection } from "./components/hero-section";
import { FeaturesCarouselSection } from "./components/features-carousel";
import { PersonasSection } from "./components/personas-section";
import { RadarChartSection } from "./components/radar-chart";
import { TestimonialsSection } from "./components/testimonials-section";
import { PricingSection } from "./components/pricing-section";
import { LandingFooter } from "./components/landing-footer";

export default function LandingPage() {
    useEffect(() => {
        window.scrollTo(0, 0);
        document.title = "无限画布 (Infinite Canvas) - 官方网站宣传页";
    }, []);

    return (
        <div className="relative min-h-screen w-full overflow-y-auto overflow-x-hidden bg-stone-950 text-stone-100 font-sans selection:bg-orange-500 selection:text-stone-950">
            <LandingHeader />
            <main>
                <HeroSection />
                <FeaturesCarouselSection />
                <PersonasSection />
                <RadarChartSection />
                <TestimonialsSection />
                <PricingSection />
            </main>
            <LandingFooter />
        </div>
    );
}
