'use client';

import SiteLayout from '@/components/marketing/SiteLayout';
import { MarketingImagesProvider } from '@/components/marketing/MarketingMockup';
import Hero from '@/components/marketing/Hero';
import TrustStrip from '@/components/marketing/TrustStrip';
import FeatureShowcase from '@/components/marketing/FeatureShowcase';
import FeatureGrid from '@/components/marketing/FeatureGrid';
import PricingTeaser from '@/components/marketing/PricingTeaser';
import Faq from '@/components/marketing/Faq';
import CtaBand from '@/components/marketing/CtaBand';

const HOME_FAQ = [
 { q: 'home_faq_q1', a: 'home_faq_a1' },
 { q: 'home_faq_q2', a: 'home_faq_a2' },
 { q: 'home_faq_q3', a: 'home_faq_a3' },
 { q: 'home_faq_q4', a: 'home_faq_a4' },
 { q: 'home_faq_q5', a: 'home_faq_a5' },
];

export default function HomePage() {
 return (
  <SiteLayout>
   <MarketingImagesProvider>
    <Hero />
    <TrustStrip />
    <FeatureShowcase />
    <FeatureGrid />
    <PricingTeaser />
    <Faq titleKey="home_faq_title" pairs={HOME_FAQ} />
    <CtaBand />
   </MarketingImagesProvider>
  </SiteLayout>
 );
}
