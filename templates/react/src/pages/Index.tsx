import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { HeroSection } from "@/components/sections/HeroSection";

export function Index() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Keep malformed hashes non-fatal. */ }
    const section = document.getElementById(id);
    section?.scrollIntoView();
    section?.focus({ preventScroll: true });
  }, [hash]);

  return (
    <>
      <HeroSection />
      <section aria-labelledby="menu-title" className="menu-section section-shell" id="meny" tabIndex={-1}>
        <p className="eyebrow">Gott, enkelt, fullt av smak</p>
        <h2 id="menu-title">VAD ÄR DU SUGEN PÅ?</h2>
        <div className="menu-grid">
          {[
            ["01", "PIZZA", "Från klassiska favoriter till pizza med extra allt. Hitta din favorit och gör kvällen lite godare."],
            ["02", "KEBAB", "I bröd, som rulle eller på tallrik. Välj det som passar din hunger."],
            ["03", "TILLBEHÖR", "Något krispigt vid sidan av och något kallt att dricka. Det lilla extra till din måltid."],
          ].map(([number, title, description]) => (
            <article className="menu-card" key={title}>
              <span className="menu-number">{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <p className="section-note">Ett smakprov på vårt utbud. Kontakta restaurangen för aktuell meny, priser och allergener.</p>
      </section>
      <section aria-labelledby="about-title" className="about-section section-shell" id="om-oss" tabIndex={-1}>
        <div>
          <p className="eyebrow">Kebabhouse Karlskrona</p>
          <h2 id="about-title">GOD MAT.<br />GOTT SÄLLSKAP.</h2>
        </div>
        <div>
          <p>Vi gillar det enkla: god mat och en skön stund tillsammans. En pizza att dela, en kebab på språng eller en paus mitt i vardagen.</p>
          <p>Hos Kebabhouse finns det plats för både den stora hungern och det lilla hänget. Välkommen förbi.</p>
          <a className="text-link" href="#kontakt">Hitta till oss <span aria-hidden="true">↗</span></a>
        </div>
      </section>
      <section aria-labelledby="more-title" className="section-shell details-section" id="mer" tabIndex={-1}>
        <p className="eyebrow">Vi ses snart</p>
        <h2 id="more-title">BRA ATT VETA.</h2>
        <div className="details-grid">
          <section aria-labelledby="hours-title" id="oppettider">
            <h3 id="hours-title">ÖPPETTIDER</h3>
            <p>Aktuella öppettider publiceras snart. Kontrollera dagens tider med restaurangen innan ditt besök, särskilt vid helgdagar.</p>
            <a className="text-link" href="#kontakt">Hitta kontaktuppgifter</a>
          </section>
          <section aria-labelledby="contact-title" id="kontakt">
            <h3 id="contact-title">KONTAKT &amp; HITTA HIT</h3>
            <p>Kebabhouse, Karlskrona</p>
            <p>Hitta restaurangens adress, telefonnummer och vägbeskrivning på Google Maps.</p>
            <a className="text-link" href="https://www.google.com/maps/search/?api=1&query=Kebabhouse%20Karlskrona" target="_blank" rel="noreferrer">Öppna Google Maps <span aria-hidden="true">↗</span><span className="sr-only"> (ny flik)</span></a>
          </section>
          <section aria-labelledby="order-title" id="bestall" tabIndex={-1}>
            <h3 id="order-title">BESTÄLL ONLINE</h3>
            <p>Onlinebeställning är inte ansluten ännu. Kontakta restaurangen för aktuella beställningsalternativ.</p>
            <a className="site-button" href="#meny">Utforska menyn</a>
          </section>
        </div>
      </section>
    </>
  );
}
