export function HeroSection() {
  return (
    <section id="hem" aria-labelledby="hero-title" className="hero section-shell" tabIndex={-1}>
      <div>
        <p className="eyebrow">Din nästa favorit. Mitt i Karlskrona.</p>
        <h1 id="hero-title">
          <span>STOR SMAK.</span>
          <span>SKÖN KÄNSLA.</span>
        </h1>
        <p className="hero-description">
          Krispig pizza, riktigt god kebab och massor av kärlek.
          Kom hungrig, gå hem glad. Välkommen till Kebabhouse.
        </p>
        <div className="hero-actions">
          <a className="site-button" href="#meny">Se vår meny <span aria-hidden="true">↗</span></a>
          <a className="text-link" href="#om-oss">Lär känna oss</a>
        </div>
      </div>
      <div className="hero-image">
        <img src="/assets/pizza.svg" alt="Illustration av en nygräddad pizza med tomat och basilika" width="720" height="800" fetchPriority="high" />
        <div className="hero-badge" aria-label="Pizza, Kebab, Massor av kärlek">
          <span>Pizza, Kebab</span>
          <span aria-hidden="true" className="badge-heart">♥</span>
          <span>Massor av kärlek</span>
        </div>
      </div>
    </section>
  );
}
