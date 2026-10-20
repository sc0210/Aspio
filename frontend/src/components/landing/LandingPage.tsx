'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeatures } from '@/hooks/useFeatures';
import {
  CreditCardIcon,
  ChartBarIcon,
  TrophyIcon,
  BanknotesIcon,
  UserGroupIcon,
  CalendarDaysIcon,
  ArrowPathIcon,
  UsersIcon,
  WalletIcon,
  GlobeAsiaAustraliaIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  DocumentArrowDownIcon,
} from '@heroicons/react/24/outline';
import { useDemo } from '@/contexts/DemoContext';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Card } from '@/components/ui/Card';

const FEATURE_COLORS = [
  { bg: 'bg-primary-50 dark:bg-primary-900/20', icon: 'text-primary-700 dark:text-primary-400', accent: 'from-primary-400/60 via-primary-300/40 to-indigo-400/60' },
  { bg: 'bg-violet-50 dark:bg-violet-900/20',   icon: 'text-violet-600 dark:text-violet-400',   accent: 'from-violet-400/60 via-violet-300/40 to-purple-400/60' },
  { bg: 'bg-amber-50 dark:bg-amber-900/20',     icon: 'text-amber-700 dark:text-amber-400',     accent: 'from-amber-400/60 via-amber-300/40 to-yellow-400/60' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'text-emerald-700 dark:text-emerald-400', accent: 'from-emerald-400/60 via-teal-300/40 to-cyan-400/60' },
  { bg: 'bg-teal-50 dark:bg-teal-900/20',       icon: 'text-teal-700 dark:text-teal-400',       accent: 'from-teal-400/60 via-cyan-300/40 to-emerald-400/60' },
  { bg: 'bg-rose-50 dark:bg-rose-900/20',       icon: 'text-rose-600 dark:text-rose-400',       accent: 'from-rose-400/60 via-pink-300/40 to-rose-400/60' },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll<HTMLElement>('.reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return ref;
}

export function LandingPage() {
  const { enableDemo } = useDemo();
  const { t, i18n } = useTranslation('common');
  const { lineBot } = useFeatures();
  const featuresRef = useReveal();
  const capabilitiesRef = useReveal();
  const asianRef = useReveal();
  const ctaRef = useReveal();

  // The hero shot is a real capture of the app, so it has to match the language
  // the visitor is actually reading — an English page showing a Chinese UI reads
  // as a stock photo of someone else's product.
  const isZh = i18n.language?.toLowerCase().startsWith('zh');
  const heroShot = isZh ? '/screenshots/dashboard-zh.jpg' : '/screenshots/dashboard-en.jpg';

  // The three that describe the core loop: money in and out, what it's invested
  // in, and what you're aiming at. Everything else supports these.
  const primaryFeatures = [
    { name: t('landing.features.expenseTracking.title'), description: t('landing.features.expenseTracking.description'), icon: CreditCardIcon },
    { name: t('landing.features.portfolio.title'),       description: t('landing.features.portfolio.description'),       icon: ChartBarIcon },
    { name: t('landing.features.goals.title'),           description: t('landing.features.goals.description'),           icon: TrophyIcon },
  ];

  const secondaryFeatures = [
    { name: t('landing.features.loans.title'),       icon: BanknotesIcon },
    { name: t('landing.features.savings.title'),     icon: UserGroupIcon },
    { name: t('landing.features.review.title'),      icon: CalendarDaysIcon },
    { name: t('landing.features.rebalancing.title'), icon: ArrowPathIcon },
    { name: t('landing.features.peerCompare.title'), icon: UsersIcon },
  ];

  // Capability statements, not testimonials — each one is something the app
  // actually does and can be checked in the demo. The LINE bot is an optional
  // add-on, so it is only claimed where this instance has it configured.
  const capabilities = [
    { icon: WalletIcon,                       title: t('landing.capabilities.wallets.title'),  description: t('landing.capabilities.wallets.description') },
    { icon: GlobeAsiaAustraliaIcon,           title: t('landing.capabilities.markets.title'),  description: t('landing.capabilities.markets.description') },
    ...(lineBot ? [{ icon: ChatBubbleOvalLeftEllipsisIcon, title: t('landing.capabilities.lineBot.title'), description: t('landing.capabilities.lineBot.description') }] : []),
    { icon: DocumentArrowDownIcon,            title: t('landing.capabilities.csv.title'),      description: t('landing.capabilities.csv.description') },
  ];

  const asianMarketItems = [
    { emoji: '🏅', title: t('landing.asianMarket.items.stocks.title'),      desc: t('landing.asianMarket.items.stocks.description'),      accent: 'from-amber-400/60 via-yellow-300/40 to-amber-400/60',   iconBg: 'bg-amber-50 dark:bg-amber-900/20',   delay: '0ms' },
    { emoji: '🏛️', title: t('landing.asianMarket.items.pension.title'),     desc: t('landing.asianMarket.items.pension.description'),     accent: 'from-primary-400/60 via-indigo-300/40 to-violet-400/60', iconBg: 'bg-primary-50 dark:bg-primary-900/20', delay: '120ms' },
    { emoji: '🪙', title: t('landing.asianMarket.items.alternative.title'), desc: t('landing.asianMarket.items.alternative.description'), accent: 'from-violet-400/60 via-purple-300/40 to-indigo-400/60', iconBg: 'bg-violet-50 dark:bg-violet-900/20',   delay: '240ms' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/80 dark:border-gray-700/80 animate-fade-in-down">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-primary-600 rounded-xl flex items-center justify-center shadow-sm">
                <span className="text-white font-bold text-lg">A</span>
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100">Aspiro</span>
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* compact at every width: the full variant spells out the language
                  name ("🇺🇸 English"), which ran 161px in a header that also has to
                  fit sign-in and get-started. The flag already identifies the
                  current language, and the name stays available via the button's
                  title and aria-label, and in the dropdown itself. This also drops
                  the previous pair of switchers where one was always display:none. */}
              <LanguageSwitcher variant="dropdown" compact />
              <ThemeToggle />
              <Link
                href="/auth/signin"
                className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {t('landing.header.signIn')}
              </Link>
              <Link
                href="/auth/signup"
                className="hidden sm:inline-flex items-center px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 shadow-sm transition-all duration-150 hover:shadow hover:-translate-y-px"
              >
                {t('landing.header.getStarted')}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* The root layout's wrapper is a div, so each page names its own main landmark. */}
      <main>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800">
        {/* Floating decorative circles */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5 pointer-events-none animate-float-slow" />
        <div className="absolute -bottom-48 -left-24 w-[32rem] h-[32rem] rounded-full bg-black/10 pointer-events-none animate-float" style={{ animationDelay: '1.5s' }} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-10 items-center">

            {/* Copy */}
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/90 text-xs font-semibold mb-6 backdrop-blur-sm animate-fade-in">
                <GlobeAsiaAustraliaIcon className="w-3.5 h-3.5" />
                {t('landing.hero.badge')}
              </div>

              <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-5 animate-fade-in-up animation-delay-100">
                {t('landing.hero.title')}{' '}
                <span className="text-indigo-200">{t('landing.hero.titleHighlight')}</span>
              </h1>

              <p className="text-lg text-primary-200 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed animate-fade-in-up animation-delay-200">
                {t('landing.hero.subtitle')}
              </p>

              {/* The demo leads: it is the only path that shows the product without
                  asking for anything, so it converts better than a signup form. */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start items-stretch sm:items-center animate-fade-in-up animation-delay-300">
                <button
                  onClick={enableDemo}
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-primary-700 bg-white hover:bg-gray-50 shadow-lg shadow-black/20 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
                >
                  {t('landing.hero.tryDemo')}
                </button>
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white border border-white/30 bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5"
                >
                  {t('landing.hero.createAccount')}
                </Link>
              </div>

              <p className="mt-4 text-xs text-primary-200/80 animate-fade-in-up animation-delay-400">
                {t('landing.hero.noAccountNeeded')}
              </p>
            </div>

            {/* Product shot */}
            <div className="relative animate-fade-in-up animation-delay-200">
              <div className="rounded-2xl overflow-hidden border border-white/20 shadow-2xl shadow-black/40 bg-white">
                {/* Browser chrome, so the shot reads as a real screen rather than art */}
                <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 border-b border-gray-200">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <Image
                  src={heroShot}
                  alt={t('landing.hero.screenshotAlt')}
                  width={1440}
                  height={900}
                  className="w-full h-auto"
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>
            </div>

          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-20 bg-white dark:bg-gray-900" ref={featuresRef}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14 reveal">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              {t('landing.features.title')}
            </h2>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              {t('landing.features.subtitle')}
            </p>
          </div>

          {/* Three headline capabilities carry the weight */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {primaryFeatures.map((feature, i) => {
              const color = FEATURE_COLORS[i];
              const Icon = feature.icon;
              return (
                <Card
                  key={feature.name}
                  style={{ transitionDelay: `${i * 100}ms` }}
                  padding="none"
                  clip
                  className="reveal"
                >
                  <div className={`h-px bg-gradient-to-r ${color.accent}`} />
                  <div className="p-7">
                    <div className={`w-12 h-12 ${color.bg} rounded-xl flex items-center justify-center mb-5`}>
                      <Icon className={`w-6 h-6 ${color.icon}`} />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      {feature.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* The rest, compact — present without competing for attention */}
          <div className="reveal grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {secondaryFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.name}
                  className="flex flex-col items-center text-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40"
                >
                  <Icon className="w-5 h-5 text-gray-500 dark:text-gray-500" />
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 leading-snug">
                    {feature.name}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="reveal mt-10 text-center">
            <button
              onClick={enableDemo}
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 shadow-sm transition-all duration-150 hover:shadow hover:-translate-y-px"
            >
              {t('landing.features.exploreInDemo')}
            </button>
          </div>
        </div>
      </section>

      {/* ── What it actually does ── */}
      <section className="py-20 bg-gray-50 dark:bg-gray-800/50" ref={capabilitiesRef}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14 reveal">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              {t('landing.capabilities.title')}
            </h2>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              {t('landing.capabilities.subtitle')}
            </p>
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-5 ${capabilities.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            {capabilities.map((item, i) => {
              const color = FEATURE_COLORS[(i + 3) % FEATURE_COLORS.length];
              const Icon = item.icon;
              return (
                <Card
                  key={item.title}
                  style={{ transitionDelay: `${i * 100}ms` }}
                  padding="none"
                  clip
                  className="reveal"
                >
                  <div className={`h-px bg-gradient-to-r ${color.accent}`} />
                  <div className="p-6">
                    <div className={`w-11 h-11 ${color.bg} rounded-xl flex items-center justify-center mb-4`}>
                      <Icon className={`w-5 h-5 ${color.icon}`} />
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1.5">
                      {item.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Asian Market ── */}
      <section className="py-20 bg-white dark:bg-gray-900" ref={asianRef}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 reveal">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              {t('landing.asianMarket.title')}
            </h2>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-3xl mx-auto">
              {t('landing.asianMarket.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {asianMarketItems.map(item => (
              <Card
                key={item.title}
                style={{ transitionDelay: item.delay }}
                padding="none"
                clip
                hover
                className="reveal"
              >
                <div className={`h-px bg-gradient-to-r ${item.accent}`} />
                <div className="p-5 flex items-center gap-4">
                  <div className={`w-11 h-11 ${item.iconBg} rounded-xl flex items-center justify-center flex-shrink-0 text-xl`}>
                    {item.emoji}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-white">{item.title}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.desc}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800" ref={ctaRef}>
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/5 pointer-events-none animate-float-slow" />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-black/10 pointer-events-none animate-float" style={{ animationDelay: '2s' }} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <div className="reveal">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              {t('landing.cta.title')}
            </h2>
            <p className="text-lg text-primary-200 mb-8 max-w-2xl mx-auto">
              {t('landing.cta.subtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl text-sm font-semibold text-primary-700 bg-white hover:bg-gray-50 shadow-lg shadow-black/20 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
              >
                {t('landing.cta.getStartedFree')}
              </Link>
              <button
                onClick={enableDemo}
                className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl text-sm font-semibold text-white border border-white/30 bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5"
              >
                {t('landing.hero.tryDemo')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      </main>

      <footer className="bg-gray-900 dark:bg-gray-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">A</span>
              </div>
              <span className="text-xl font-bold text-white">Aspiro</span>
            </Link>

            <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
              <Link href="/privacy" className="text-gray-500 dark:text-gray-400 hover:text-white transition-colors text-sm">
                {t('landing.footer.privacy')}
              </Link>
              <Link href="/terms" className="text-gray-500 dark:text-gray-400 hover:text-white transition-colors text-sm">
                {t('landing.footer.terms')}
              </Link>
              <Link href="/support" className="text-gray-500 dark:text-gray-400 hover:text-white transition-colors text-sm">
                {t('landing.footer.support')}
              </Link>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-500 text-sm">
            <p>{t('landing.footer.copyright')}</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
