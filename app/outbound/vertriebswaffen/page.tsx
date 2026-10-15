"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type Weapon = { id:number; title:string; category:string; link:string; top:boolean };
type Touch = { day:number; id:number; subject:string; body:string };

const names = [
  "Website war gestern",
  "Jobportal-Falle",
  "Unsichtbarer Bewerberverlust",
  "Mehr Anzeigen oder besserer Ablauf?",
  "Fünf typische Reibungspunkte",
  "Echtes Loom-Dashboard",
  "Vom Klick zum Gespräch",
  "WhatsApp statt Lebenslaufhürde",
  "Follow-ups ohne Hinterherlaufen",
  "Woher kam die Bewerbung?",
  "Echte Case Studies",
  "Stimmen echter Kunden",
  "Vorher–Nachher im Webauftritt",
  "Persönlich mit Raphael",
  "Ein Blick in die Umsetzung",
  "Bewerberverlust-Rechner",
  "Kostenmodelle vergleichen",
  "Recruiting-ROI richtig rechnen",
  "Was eine Vakanz im Alltag bedeutet",
  "Zeitfresser im Bewerberprozess",
  "Bestehende Website behalten",
  "Warum nicht selbst bauen?",
  "Datenschutz transparent erklären",
  "Interner Aufwand im Projekt",
  "Was nach dem Start passiert",
  "Zwei-Minuten-Recruiting-Check",
  "Individuelle Website-Analyse",
  "Der Umsetzungsfahrplan",
  "Persönlicher System-Rundgang",
  "15-Minuten-Klarheitsgespräch"
] as const;
const categories = ["Aufmerksamkeit","Aufmerksamkeit","Aufmerksamkeit","Aufmerksamkeit","Aufmerksamkeit","Produktbeweis","Produktbeweis","Produktbeweis","Produktbeweis","Produktbeweis","Vertrauen","Vertrauen","Vertrauen","Vertrauen","Vertrauen","Wirtschaftlichkeit","Wirtschaftlichkeit","Wirtschaftlichkeit","Wirtschaftlichkeit","Wirtschaftlichkeit","Einwände","Einwände","Einwände","Einwände","Einwände","Abschluss","Abschluss","Abschluss","Abschluss","Abschluss"] as const;
const topIds = [1,6,16,11,17,9,26] as const;
const URL = "https://digitalegewinner.de/vertriebswaffen.html#waffe-";
const weapons: Weapon[] = names.map((title, i)=>({ id:i+1, title, category:categories[i], link:URL+(i+1), top:topIds.includes((i+1) as typeof topIds[number]) }));
const touches:Touch[] = [
  {
    "day": 1,
    "id": 1,
    "subject": "Ein Gedanke zu Ihrer Karriereseite",
    "body": "beim Blick auf [KONKRETE, BELEGTE BEOBACHTUNG] ist mir aufgefallen, dass der Weg bis zum ersten Kontakt vielleicht noch einfacher ginge.\n\nDieses kurze Video erklärt, weshalb wir Websysteme statt bloßer Karriereseiten bauen."
  },
  {
    "day": 3,
    "id": 6,
    "subject": "So sieht es hinter den Kulissen aus",
    "body": "Sie hatten [THEMA AUS DEM GESPRÄCH] angesprochen.\n\nHier ist der echte Loom-Rundgang durch unser Dashboard. Das zeigt den Ablauf besser als eine lange Präsentation."
  },
  {
    "day": 6,
    "id": 16,
    "subject": "Eine kleine Beispielrechnung",
    "body": "bei Ihrer Suche nach [AKTUELLE STELLE] wollte ich Ihnen noch einen kleinen Gedanken mitgeben: Wie zuverlässig erreicht eine Rückmeldung den Interessenten?\n\nIn diesem Rechner lassen sich unterschiedliche Szenarien ausprobieren – ausdrücklich nur Beispieldaten."
  },
  {
    "day": 10,
    "id": 11,
    "subject": "Zwei Beispiele aus unserer Arbeit",
    "body": "bevor ich Ihnen weitere Dinge über unsere Arbeit erzähle, zeige ich Ihnen lieber unsere veröffentlichten Projekte.\n\nSie sehen dort die Umsetzung. Konkrete Recruiting-Ergebnisse behaupten wir ohne Nachweis natürlich nicht."
  },
  {
    "day": 15,
    "id": 17,
    "subject": "Eine andere Sicht auf Jobportale",
    "body": "bei [BELEGTES STELLENPORTAL / KANAL] musste ich noch an den Unterschied zwischen laufender Anzeige, Vermittlung und einem eigenen Kontaktweg denken.\n\nIch habe die Ansätze einmal sachlich gegenübergestellt."
  },
  {
    "day": 22,
    "id": 9,
    "subject": "Das könnte etwas Zeit sparen",
    "body": "ich habe noch einmal an [TATSÄCHLICH GENANNTER ENG PASS] gedacht.\n\nHier zeigen wir, welche Schritte rund um Bestätigung und Wiedervorlage man sinnvoll vorbereiten kann."
  },
  {
    "day": 30,
    "id": 26,
    "subject": "Ich lasse Ihnen das einfach hier",
    "body": "falls [OFFENE STELLE] noch aktuell ist, könnte Ihnen dieser kurze Recruiting-Check helfen, den Bewerbungsweg selbst zu beurteilen.\n\nWenn das Thema gerade keine Priorität hat, ist das selbstverständlich auch in Ordnung."
  }
];

function textFor(t:Touch, name:string){return `Hallo ${name.trim() || "[ANSPRECHPARTNER]"},\n\n${t.body}\n\n${URL+t.id}\n\nViele Grüße\nRaphael`;}

export default function VertriebswaffenPage(){
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("Top 7");
  const [active,setActive]=useState(0);
  const [name,setName]=useState("");
  const [copied,setCopied]=useState("");
  const current=touches[active]??touches[0];
  const visible=useMemo(()=>weapons.filter(w=>(filter==="Alle"||(filter==="Top 7"?w.top:w.category===filter))&&(w.title+" "+w.category).toLowerCase().includes(search.toLowerCase())),[filter,search]);
  async function copy(v:string,label:string){try{await navigator.clipboard.writeText(v);setCopied(label);}catch{setCopied("Kopieren derzeit nicht verfügbar");}}
  return <main className={styles.root}>
    <div className={styles.top}><span className={styles.eyebrow}>DG OUTBOUND / CONVERSION ARSENAL</span><span className={styles.draft}>7 Nachrichten · Entwürfe · Versand deaktiviert</span></div>
    <h1>30 Vertriebswaffen. <em>7 Nachrichten, die passen.</em></h1>
    <p className={styles.lead}>Sofort verwendbare Inhalte für Pflege- und Handwerkskunden: echtes Loom-Video, Case Studies, Rechner, Vergleiche und Einwandbehandlung. Im Versand verwenden wir nur die sieben stärksten und passen jede Nachricht an den Betrieb an.</p>
    <div className={styles.stats}><div><strong>30</strong><span>Sales-Inhalte</span></div><div><strong>7</strong><span>priorisierte Touchpoints</span></div><div><strong>0</strong><span>automatische Sendungen</span></div></div>
    <section className={styles.panel}>
      <div className={styles.head}><div><span className={styles.eyebrow}>PERSONALISIERTER INFO-FLOW</span><h2>Sieben vorbereitete Mails</h2></div><a href="/mail" className={styles.link}>Postfach öffnen →</a></div>
      <p className={styles.hint}>Start nur nach zulässiger Kontaktgrundlage und Prüfung des individuellen Anlasses. Nach Antwort, Opt-out oder Termin keine Folgestufen mehr. Platzhalter vor Versand ersetzen.</p>
      <div className={styles.steps}>{touches.map((t,i)=><button type="button" key={t.id} onClick={()=>{setActive(i);setCopied("");}} className={active===i?styles.stepActive:styles.step}>Tag {t.day} <small>#{t.id}</small></button>)}</div>
      <div className={styles.editor}>
        <label>Ansprechpartner (optional, nur für die Vorschau)<input value={name} onChange={e=>setName(e.target.value)} placeholder="z. B. Frau Müller" /></label>
        <div className={styles.subject}><span>BETREFF</span><strong>{current.subject}</strong></div>
        <pre>{textFor(current,name)}</pre>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={()=>void copy("Betreff: "+current.subject+"\n\n"+textFor(current,name),"Mailvorlage kopiert")}>Vorlage kopieren</button>
          <a className={styles.secondary} href={`mailto:?subject=${encodeURIComponent(current.subject)}&body=${encodeURIComponent(textFor(current,name))}`}>In E-Mail-App öffnen</a>
          <a className={styles.secondary} href={URL+current.id} target="_blank" rel="noopener noreferrer">Verkaufsinhalt öffnen ↗</a>
        </div>
        {copied&&<p className={styles.success} aria-live="polite">{copied}</p>}
      </div>
    </section>
    <section className={styles.panel}>
      <div className={styles.head}><div><span className={styles.eyebrow}>KONTENT-BIBLIOTHEK</span><h2>Alle 30 Vertriebswaffen</h2></div><a href="https://digitalegewinner.de/vertriebswaffen.html" target="_blank" rel="noopener noreferrer" className={styles.link}>Öffentliche Bibliothek ↗</a></div>
      <div className={styles.filters}><select aria-label="Kategorie wählen" value={filter} onChange={e=>setFilter(e.target.value)}>{["Top 7","Alle","Aufmerksamkeit","Produktbeweis","Vertrauen","Wirtschaftlichkeit","Einwände","Abschluss"].map(f=><option key={f}>{f}</option>)}</select><input aria-label="Vertriebswaffe suchen" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Inhalte suchen …"/></div>
      <div className={styles.cards}>{visible.map(w=><article key={w.id}><span className={styles.id}>#{String(w.id).padStart(2,"0")} {w.top&&"· TOP 7"}</span><strong>{w.title}</strong><span className={styles.category}>{w.category}</span><div><a target="_blank" rel="noopener noreferrer" href={w.link}>Ansehen ↗</a><button type="button" onClick={()=>void copy(w.link,"Direktlink kopiert")}>Link kopieren</button></div></article>)}</div>
      {!visible.length&&<p>Keine Ergebnisse. Filter anpassen.</p>}
    </section>
    <p className={styles.disclaimer}>Kein automatischer Mailversand. Diese Seite ist eine operative Vorlagenbibliothek und umgeht weder die bestehende Compliance-Engine noch Opt-out- oder Kontaktregeln.</p>
  </main>;
}
