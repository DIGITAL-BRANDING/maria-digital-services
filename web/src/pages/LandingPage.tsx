import { useState } from 'react';
import { Link } from 'react-router-dom';
import WhatsappFloat from '../components/WhatsappFloat';
import { 
  Phone, 
  Mail, 
  MapPin, 
  Menu, 
  X, 
  ShieldCheck, 
  ArrowRight,
  Smartphone,
  Wifi,
  Zap,
  Tv,
  Lock,
  Headphones
} from 'lucide-react';

export default function MariaLandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Dynamic VTU Services array based on screenshots while preserving branding
  const vtuServices = [
    {
      title: "Airtime Top-up",
      desc: "Instant recharge for MTN, Glo, Airtel, 9mobile at best rates",
      priceTag: "From ₦50",
      icon: Smartphone
    },
    {
      title: "Data Plans",
      desc: "Affordable data bundles for all networks, daily/weekly/monthly",
      priceTag: "From ₦100",
      icon: Wifi
    },
    {
      title: "Electricity Bills",
      desc: "Pay prepaid/postpaid bills for all Nigerian discos instantly",
      priceTag: "All Discos",
      icon: Zap
    },
    {
      title: "Cable TV",
      desc: "DSTV, GOTV, Startimes subscriptions with instant activation",
      priceTag: "All Packages",
      icon: Tv
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* Top Bar Header */}
      <div className="bg-[#0A192F] text-white text-sm py-2.5 px-4 sm:px-8 border-b border-amber-500/30">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex flex-wrap items-center gap-6 text-xs sm:text-sm">
            <a href="tel:+2348000000000" className="flex items-center gap-2 hover:text-amber-400 transition-colors">
              <Phone className="w-4 h-4 text-amber-400" />
              <span>+234 703 424 8143</span>
            </a>
            <a href="mailto:info@maria.com.ng" className="flex items-center gap-2 hover:text-amber-400 transition-colors">
              <Mail className="w-4 h-4 text-amber-400" />
              <span>info@maria.com.ng</span>
            </a>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-300">
            <MapPin className="w-4 h-4 text-amber-400" />
            <span>Kano State, Nigeria</span>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md shadow-sm border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex justify-between items-center">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <img src="/branding/logo.jpg" alt="MARIA Integrity General Enterprise" className="h-12 w-12 rounded-full border-2 border-[#D4AF37] bg-white object-contain p-0.5 shadow-md" />
            <div>
              <span className="text-2xl font-black tracking-wider text-[#0A192F] block leading-none">MARIA</span>
              <span className="text-[9px] font-bold tracking-widest text-[#D4AF37] uppercase block mt-1">
                Integrity General Enterprise
              </span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-8 font-medium text-slate-700">
            <a href="#home" className="hover:text-[#D4AF37] transition-colors">Home</a>
            <a href="#about" className="hover:text-[#D4AF37] transition-colors">About Us</a>
            <a href="#services" className="hover:text-[#D4AF37] transition-colors">Services</a>
            <a href="#features" className="hover:text-[#D4AF37] transition-colors">Features</a>
            <a href="#contact" className="hover:text-[#D4AF37] transition-colors">Contact</a>
          </div>

          {/* CTA Button */}
          <div className="hidden md:block">
            <Link 
              to="/login" 
              className="bg-[#0A192F] text-amber-400 border border-amber-400/40 hover:bg-[#D4AF37] hover:text-[#0A192F] px-5 py-2.5 rounded-lg font-semibold transition-all duration-300 shadow-sm"
            >
              Get Started
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden text-slate-700 p-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Dropdown */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 px-4 py-4 space-y-3 shadow-lg">
            <a href="#home" className="block text-slate-700 font-medium py-1" onClick={() => setIsMenuOpen(false)}>Home</a>
            <a href="#about" className="block text-slate-700 font-medium py-1" onClick={() => setIsMenuOpen(false)}>About Us</a>
            <a href="#services" className="block text-slate-700 font-medium py-1" onClick={() => setIsMenuOpen(false)}>Services</a>
            <a href="#features" className="block text-slate-700 font-medium py-1" onClick={() => setIsMenuOpen(false)}>Features</a>
            <a href="#contact" className="block text-slate-700 font-medium py-1" onClick={() => setIsMenuOpen(false)}>Contact</a>
            <Link 
              to="/login" 
              className="block text-center bg-[#0A192F] text-amber-400 py-2.5 rounded-lg font-semibold mt-2"
              onClick={() => setIsMenuOpen(false)}
            >
              Get Started
            </Link>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section id="home" className="relative bg-[#0A192F] text-white py-20 lg:py-28 overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#D4AF37_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-8 relative z-10 grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-[#D4AF37] px-3.5 py-1.5 rounded-full text-sm font-medium">
              <span className="animate-pulse">🚀</span>
              <span>Nigeria's Best Digital Platform</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
              Fastest Digital <span className="text-[#D4AF37]">Solutions</span> in Africa
            </h1>
            <p className="text-slate-300 text-lg leading-relaxed max-w-xl">
              Experience lightning-fast transactions for airtime, data, bills, subscriptions, BVN Verifications, BVN Modifications and BVN License Creation with Maria Integrity Enterprise.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <Link 
                to="/login" 
                className="inline-flex items-center justify-center gap-2 bg-[#D4AF37] text-[#0A192F] font-bold px-7 py-3.5 rounded-lg hover:bg-amber-400 transition-all shadow-lg"
              >
                <span>Start Now</span>
                <ArrowRight className="w-5 h-5" />
              </Link>
              <a 
                href="#services" 
                className="inline-flex items-center justify-center bg-transparent border border-slate-600 hover:border-amber-400 text-slate-200 hover:text-white px-7 py-3.5 rounded-lg transition-all"
              >
                Explore Services
              </a>
            </div>
          </div>
          
          {/* Animated Dashboard Overview Container */}
          <div className="relative mt-10 md:mt-0">
            {/* Glowing effect behind dashboard */}
            <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/30 to-[#D4AF37]/20 rounded-2xl blur-xl animate-pulse"></div>

            {/* Floating Badge (Animated) - hidden below sm: entirely. These
                two decorative badges are meant to float in the open space
                beside the dashboard card in the desktop 2-column hero grid;
                on mobile (single column) there is no open space next to
                the card for them to float into, so no amount of
                repositioning keeps them from landing on top of card
                content (the "Monthly Usage" row, in one reported case).
                Simplest reliable fix: they just don't render on mobile. */}
            <div className="absolute -top-6 -right-4 z-20 hidden items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 text-slate-800 shadow-xl [animation-duration:3s] sm:flex animate-bounce">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold leading-tight">Secure Payments</p>
                <p className="text-[10px] text-slate-500">256-bit SSL Encrypted</p>
              </div>
            </div>

            {/* Floating Instant Delivery Tag - same reasoning as above. */}
            <div className="absolute -bottom-5 -left-4 z-20 hidden items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-slate-800 shadow-xl animate-pulse sm:flex">
              <Zap className="h-4 w-4 shrink-0 fill-amber-500 text-amber-500" />
              <div>
                <p className="text-xs font-bold">Instant Delivery</p>
                <p className="text-[10px] text-slate-500">Under 5 seconds</p>
              </div>
            </div>

            {/* Dashboard Card Frame */}
            <div className="dashboard-overview relative z-10 bg-[#0b2f73] rounded-2xl shadow-2xl p-6 text-white border border-blue-400/50 space-y-5">
              {/* Top Controls Header */}
              <div className="flex justify-between items-center border-b border-white/15 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-400 block"></span>
                  <span className="w-3 h-3 rounded-full bg-amber-400 block"></span>
                  <span className="w-3 h-3 rounded-full bg-emerald-400 block"></span>
                </div>
                <span className="text-xs font-bold text-blue-200 uppercase tracking-wider">Dashboard Overview</span>
              </div>

              {/* Animated Transaction Rows.
                  Colors here are explicit hex rather than the `slate-*` /
                  `blue-*` / `purple-*` / `amber-*` / `rose-*` scale these
                  rows previously used - see the note above the contact
                  form further down this file for why. */}
              <div className="space-y-3">
                {/* BVN Services Row */}
                <div className="flex items-center justify-between rounded-xl border border-[#0A192F]/10 bg-white p-3 transition-all hover:-translate-y-0.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf1ff] text-[#1d4ed8]">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0A192F]">BVN Services</p>
                      <p className="text-[10px] text-[#0A192F]/60">Update BVN Information</p>
                      <p className="text-[10px] text-[#0A192F]/40">Completed in 24Hrs - 3 Working Days</p>
                    </div>
                  </div>
                  <span className="rounded bg-[#e6f9f0] px-2 py-1 text-xs font-bold text-[#059669]">₦6,000 - ₦10,000</span>
                </div>
                {/* Airtime Row */}
                <div className="flex items-center justify-between rounded-xl border border-[#0A192F]/10 bg-white p-3 transition-all hover:-translate-y-0.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf1ff] text-[#1d4ed8]">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0A192F]">Airtime Purchase</p>
                      <p className="text-[10px] text-[#0A192F]/60">MTN ₦1,000</p>
                    </div>
                  </div>
                  <span className="rounded bg-[#e6f9f0] px-2 py-1 text-xs font-bold text-[#059669]">+₦1,000</span>
                </div>

                {/* Data Row */}
                <div className="flex items-center justify-between rounded-xl border border-[#0A192F]/10 bg-white p-3 transition-all hover:-translate-y-0.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#f3ecff] text-[#7e22ce]">
                      <Wifi className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0A192F]">Data Bundle</p>
                      <p className="text-[10px] text-[#0A192F]/60">Glo 10GB</p>
                    </div>
                  </div>
                  <span className="rounded bg-[#fdecec] px-2 py-1 text-xs font-bold text-[#dc2626]">-₦2,500</span>
                </div>

                {/* Electricity Bill Row */}
                <div className="flex items-center justify-between rounded-xl border border-[#0A192F]/10 bg-white p-3 transition-all hover:-translate-y-0.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fdf3e0] text-[#b45309]">
                      <Zap className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0A192F]">Electricity Bill</p>
                      <p className="text-[10px] text-[#0A192F]/60">Ikeja Electric</p>
                    </div>
                  </div>
                  <span className="rounded bg-[#fdecec] px-2 py-1 text-xs font-bold text-[#dc2626]">-₦5,000</span>
                </div>
              </div>

              {/* Usage Progress Bar */}
              <div className="pt-2">
                <div className="mb-1.5 flex justify-between text-[11px] font-bold text-white/70">
                  <span>Monthly Usage</span>
                  <span className="text-white">₦45,000 / ₦100,000</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div className="h-full w-[45%] rounded-full bg-gradient-to-r from-[#D4AF37] to-[#f7c948] transition-all duration-1000"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-10 bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 text-center">
            <div>
              <h3 className="text-3xl sm:text-4xl font-extrabold text-[#0A192F]">50,000+</h3>
              <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1">Active Users</p>
            </div>
            <div>
              <h3 className="text-3xl sm:text-4xl font-extrabold text-[#0A192F]">99.9%</h3>
              <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1">Success Rate</p>
            </div>
            <div className="col-span-2 md:col-span-1">
              <h3 className="text-3xl sm:text-4xl font-extrabold text-[#0A192F]">24/7</h3>
              <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1">Support Hours</p>
            </div>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-20 bg-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Our Services</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0A192F]">Comprehensive Digital Solutions</h2>
            <p className="text-slate-600 text-sm">Tailored VTU and automated payment systems designed for your daily convenience.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {vtuServices.map((service, index) => {
              const IconComp = service.icon;
              return (
                <div key={index} className="bg-[#0b2f73] text-white p-6 rounded-2xl border border-blue-400/50 shadow-lg hover:shadow-xl transition-all duration-300 space-y-4 group flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center text-white group-hover:bg-cyan-500 transition-colors">
                      <IconComp className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-bold text-white">{service.title}</h3>
                    <p className="text-blue-100 text-xs leading-relaxed">{service.desc}</p>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-white">{service.priceTag}</span>
                    <a href="#contact" className="text-[#0A192F] group-hover:text-[#D4AF37] transition-colors">
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Why Choose Us Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Why Choose Us</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0A192F]">Built For Speed & Reliability</h2>
            <p className="text-slate-600 text-sm">We provide the best experience with cutting-edge transaction technology.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-[#0b2f73] text-white border border-blue-400/50 text-center space-y-4 hover:shadow-lg transition-all">
              <div className="w-14 h-14 bg-[#0A192F] text-[#D4AF37] rounded-xl flex items-center justify-center mx-auto">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">Lightning Fast</h3>
              <p className="text-blue-100 text-xs leading-relaxed">
                Transactions completed in under 5 seconds with 99.9% uptime guarantee.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#0b2f73] text-white border border-blue-400/50 text-center space-y-4 hover:shadow-lg transition-all">
              <div className="w-14 h-14 bg-[#0A192F] text-[#D4AF37] rounded-xl flex items-center justify-center mx-auto">
                <Lock className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">Secure & Safe</h3>
              <p className="text-blue-100 text-xs leading-relaxed">
                Bank-grade encryption and secure payment processing for total peace of mind.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-[#0b2f73] text-white border border-blue-400/50 text-center space-y-4 hover:shadow-lg transition-all">
              <div className="w-14 h-14 bg-[#0A192F] text-[#D4AF37] rounded-xl flex items-center justify-center mx-auto">
                <Headphones className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white">24/7 Support</h3>
              <p className="text-blue-100 text-xs leading-relaxed">
                Dedicated customer support team available round the clock to assist you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 text-center"><h2 className="text-3xl sm:text-4xl font-bold text-[#0A192F]">What Our <span className="text-cyan-500">Customers Say</span></h2><p className="mt-3 text-slate-600">Trusted by thousands of satisfied users</p><div className="mt-12 grid gap-8 text-left md:grid-cols-3">{[['MS','Muhammad Saleem','Best platform for VTU services! Transactions are instant and customer support is amazing. Highly recommended!'],['SU','Sunusi Usama',"I've been using this platform for 6 months. Never had any issues. The best part is the competitive rates!"],['MO','Mohammed Odugwuene','The API integration was seamless. Perfect for my business needs. 5/5 stars!']].map(([initial,name,quote]) => <article key={name} className="rounded-2xl border border-slate-200 bg-slate-50 p-7"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 font-bold text-white">{initial}</span><div><b>{name}</b><div className="text-amber-400">★★★★★</div></div></div><p className="mt-5 text-sm italic leading-relaxed text-slate-600">“{quote}”</p></article>)}</div></div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="grid md:grid-cols-2 gap-12 bg-[#0A192F] text-white rounded-2xl p-8 sm:p-12 shadow-2xl relative overflow-hidden">
            <div className="space-y-6 z-10">
              <span className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Get In Touch</span>
              <h2 className="text-3xl font-bold">Ready to Get Started?</h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                Reach out to Maria Integrity Enterprise today for inquiries, API integrations, or support.
              </p>
              
              <div className="space-y-4 pt-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-[#D4AF37]">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Phone</p>
                    <p className="text-sm font-semibold text-white">+234 703 424 8143</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-[#D4AF37]">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Email</p>
                    <p className="text-sm font-semibold text-white">info@maria.com.ng</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-[#D4AF37]">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Office Address</p>
                    <p className="text-sm font-semibold text-white">Kano State, Nigeria</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Contact Form.
                NOTE: colors here are intentionally explicit hex / a
                proven-working palette (matching FORM_INPUT_CLASSES in
                components/verification/shared.tsx) rather than the
                `slate-*` scale the form previously used, which some
                mobile screenshots showed rendering as blank input boxes
                with invisible labels/borders. If this recurs after
                deploying, it's very likely a stale CDN/service-worker
                cache serving an old bundle - a hard refresh
                (Ctrl/Cmd+Shift+R) or clearing site data should confirm. */}
            <form onSubmit={(e) => e.preventDefault()} className="relative z-10 space-y-4 rounded-xl bg-white p-6 text-[#0A192F] sm:p-8">
              <h3 className="text-xl font-bold text-[#0A192F]">Send Us A Message</h3>

              <div>
                <label className="mb-1 block text-xs font-semibold text-[#0A192F]/70">Full Name</label>
                <input
                  type="text"
                  placeholder="Your Name"
                  className="w-full rounded-lg border border-[#0A192F]/20 bg-white px-4 py-2.5 text-sm text-[#0A192F] placeholder:text-[#0A192F]/40 focus:outline-none focus:ring-2 focus:ring-[#0A192F]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-[#0A192F]/70">Email Address</label>
                <input
                  type="email"
                  placeholder="your.email@example.com"
                  className="w-full rounded-lg border border-[#0A192F]/20 bg-white px-4 py-2.5 text-sm text-[#0A192F] placeholder:text-[#0A192F]/40 focus:outline-none focus:ring-2 focus:ring-[#0A192F]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-[#0A192F]/70">Message</label>
                <textarea
                  rows={4}
                  placeholder="How can we help you?"
                  className="w-full resize-none rounded-lg border border-[#0A192F]/20 bg-white px-4 py-2.5 text-sm text-[#0A192F] placeholder:text-[#0A192F]/40 focus:outline-none focus:ring-2 focus:ring-[#0A192F]"
                ></textarea>
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-[#0A192F] py-3 font-bold text-amber-400 shadow-md transition-colors hover:bg-[#D4AF37] hover:text-[#0A192F]"
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0A192F] text-slate-400 text-xs border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>© {new Date().getFullYear()} MARIA Integrity General Enterprise. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#home" className="hover:text-amber-400 transition-colors">Privacy Policy</a>
            <a href="#home" className="hover:text-amber-400 transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>
      <WhatsappFloat />
    </div>
  );
}
