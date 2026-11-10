import { ArrowUpRight, CheckCircle2, CircleDot, Clock3, MoveUpRight } from "lucide-react";
import { Reveal } from "@/components/observatory/reveal";
import { cn } from "@/utils/cn";

export type SectionCard = {
  label: string;
  value: string;
  note: string;
  tone?: "cyan" | "violet" | "green" | "red" | "amber";
};

export type SectionItem = {
  title: string;
  description: string;
  tag: string;
  tone?: "cyan" | "violet" | "green" | "red" | "amber";
};

export type SectionPageContent = {
  eyebrow: string;
  title: string;
  description: string;
  phase: string;
  stats: SectionCard[];
  panelTitle: string;
  panelDescription: string;
  items: SectionItem[];
};

export function SectionPage({ page }: { page: SectionPageContent }) {
  return (
    <main className="section-page">
      <Reveal className="section-heading">
        <div>
          <p className="section-eyebrow">
            <span className="eyebrow-mark" />
            {page.eyebrow}
          </p>
          <h1>
            {page.title}
            <span className="title-period">.</span>
          </h1>
          <p className="section-description">{page.description}</p>
        </div>
        <span className="phase-pill">
          <CircleDot size={12} />
          {page.phase}
        </span>
      </Reveal>

      <div className="section-stat-grid">
        {page.stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 0.05}>
            <article className="section-stat-card">
              <div className="stat-label">
                {stat.label}
                <span className={cn("stat-icon", stat.tone)}>
                  <CheckCircle2 size={15} />
                </span>
              </div>
              <div className="stat-number">{stat.value}</div>
              <div className="stat-note">
                <span className={cn("tone-dot", stat.tone)} />
                {stat.note}
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal className="foundation-panel" delay={0.12}>
        <div className="foundation-header">
          <div>
            <p className="panel-eyebrow">
              <Clock3 size={13} />
              FOUNDATION BUILD
            </p>
            <h2>{page.panelTitle}</h2>
            <p className="panel-description">{page.panelDescription}</p>
          </div>
          <span className="panel-phase">PHASE 01</span>
        </div>
        <div className="foundation-items">
          {page.items.map((item) => (
            <article key={item.title} className="foundation-item">
              <div className={cn("foundation-icon", item.tone)}>
                <MoveUpRight size={16} />
              </div>
              <div className="foundation-copy">
                <div>
                  <strong>{item.title}</strong>
                  <span className={cn("item-tag", item.tone)}>{item.tag}</span>
                </div>
                <p>{item.description}</p>
              </div>
              <ArrowUpRight className="item-arrow" size={15} />
            </article>
          ))}
        </div>
        <div className="foundation-footer">
          <span>
            <span className="status-led" />
            Architecture shell is ready
          </span>
          <span>FEATURE MODULES FOLLOW IN THE NEXT PHASE</span>
        </div>
      </Reveal>
    </main>
  );
}
